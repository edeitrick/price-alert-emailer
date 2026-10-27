// Product extraction and matching helpers.
// Plain ES module with no DOM dependency, shared by the extension (popup and
// service worker) and the Node price checker (checker/check.mjs).

const PRODUCT_LINK_PATTERNS = {
  'amazon.com': /\/dp\/[A-Z0-9]{10}/,
  'sephora.com': /\/product\/[^"'?#]+/,
  'ulta.com': /\/p\/[^"'?#]+/,
  'target.com': /\/p\/[^"'?#]+\/-\/A-\d+/,
};

export function domainOf(url) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return host.split('.').slice(-2).join('.');
}

// Strips tracking from product links (e.g. Amazon's /ref=…?crid=… → /dp/ASIN).
export function canonicalUrl(url) {
  const u = new URL(url);
  const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
  if (domainOf(url) === 'amazon.com' && asin) return `https://www.amazon.com/dp/${asin[1]}`;
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|ref|crid|sprefix|qid|keywords|dib|gclid|fbclid|icid|om_)/i.test(key)) u.searchParams.delete(key);
  }
  u.hash = '';
  return u.toString();
}

export function parsePrice(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value > 0 ? value : null;
  const match = String(value).replace(/,/g, '').match(/\d+(\.\d{1,2})?/);
  const n = match ? parseFloat(match[0]) : NaN;
  return n > 0 ? n : null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function meta(html, key) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*content=["']([^"']*)["']` +
    `|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${key}["']`, 'i');
  const m = html.match(re);
  return m ? decodeEntities(m[1] ?? m[2]).trim() : null;
}

// --- Sizes -------------------------------------------------------------------
// Different sizes of the same product are different products for price alerts,
// so sizes are read from the page and compared in ounce-equivalents.

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|fluid\s*ounces?|ml|milliliters?|millilitres?|kg|kilograms?|lbs?|pounds?|oz\.?|ounces?|g|grams?|l|liters?|litres?|ct|count|pieces|pcs)(?![a-z])/i;
const PACK_RE = /(?:pack|set|case|box)\s+of\s+(\d+)|(\d+)\s*[- ]?(?:pack|pk|ct pack)\b|\(\s*(\d+)\s*(?:items?|pack|count)\s*\)/i;

function unitInfo(unit) {
  const u = unit.toLowerCase().replace(/[\s.]/g, '');
  if (/^(floz|fluidounces?)$/.test(u)) return ['vol', 1];
  if (/^(ml|milliliters?|millilitres?)$/.test(u)) return ['vol', 1 / 29.5735];
  if (/^(l|liters?|litres?)$/.test(u)) return ['vol', 33.814];
  if (/^(oz|ounces?)$/.test(u)) return ['oz', 1]; // could be fluid or weight
  if (/^(g|grams?)$/.test(u)) return ['wt', 1 / 28.3495];
  if (/^(kg|kilograms?)$/.test(u)) return ['wt', 35.274];
  if (/^(lbs?|pounds?)$/.test(u)) return ['wt', 16];
  return ['count', 1];
}

// "13.52 fl oz (Pack of 2)" → { label, value (oz-equivalent), kind, pack }. Null if no size.
export function parseSize(text) {
  if (!text) return null;
  const t = decodeEntities(String(text));
  const m = t.match(SIZE_RE);
  const p = t.match(PACK_RE);
  const pack = p ? Number(p[1] ?? p[2] ?? p[3]) : null;
  if (!m && !pack) return null;
  if (!m) return { label: `Pack of ${pack}`, value: null, kind: null, pack };
  const [kind, factor] = unitInfo(m[2]);
  const label = `${parseFloat(m[1])} ${m[2].replace(/\.$/, '').toLowerCase().replace(/\s+/g, ' ')}${pack > 1 ? ` (pack of ${pack})` : ''}`;
  return { label, value: parseFloat(m[1]) * factor, kind, pack };
}

const compatible = (a, b) => a === b || a === 'oz' && (b === 'vol' || b === 'wt') || b === 'oz' && (a === 'vol' || a === 'wt');

// true = same size, false = different, null = can't tell.
export function sameSize(a, b) {
  // A multi-pack vs a listing that doesn't mention a pack is almost always a single.
  if ((a?.pack ?? 1) !== (b?.pack ?? 1) && Math.max(a?.pack ?? 1, b?.pack ?? 1) > 1) return false;
  if (!a || !b) return null;
  if (a.value == null || b.value == null || !compatible(a.kind, b.kind)) return a.pack && b.pack ? true : null;
  return Math.abs(a.value - b.value) / Math.max(a.value, b.value) <= 0.03; // 13.5 oz ≈ 13.52 fl oz
}

// The best size text on a product page: structured data, then store details, then the title.
function sizeText(html, product, url) {
  const fromLd = product.size ?? product.Size ?? product.weight?.value;
  if (fromLd) return typeof fromLd === 'object' ? `${fromLd.value} ${fromLd.unitText ?? ''}` : String(fromLd);
  if (domainOf(url) === 'amazon.com') {
    const twister = html.match(/(?:inline-twister-expanded-dimension-text-size_name|id=["']variation_size_name["'][\s\S]{0,600}?class=["']selection)["'][^>]*>([^<]+)</);
    if (twister && parseSize(twister[1])) return twister[1];
    for (const row of ['po-size', 'po-item_volume', 'po-unit_count', 'po-net_content_volume']) {
      const m = html.match(new RegExp(`${row}[\\s\\S]{0,800}?po-break-word["'][^>]*>([^<]+)<`));
      if (m && parseSize(m[1])?.value) return m[1];
    }
    const details = html.replace(/<[^>]+>/g, ' ').match(/(?:Unit Count|Item Volume|Size)\s*[:‎\s]*(\d+(?:\.\d+)?\s*(?:Fluid Ounces?|fl\.?\s*oz|Ounces?|ml|Grams?|Count))/i);
    if (details) return details[1];
  }
  const labelled = html.replace(/<[^>]+>/g, ' ').match(/\bSize:?\s+(\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|oz|ml|g)\b[^\s<]*)/i);
  return labelled?.[1] ?? null;
}

function jsonLdNodes(html) {
  const nodes = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const [, body] of html.matchAll(re)) {
    try {
      const data = JSON.parse(body.trim());
      const stack = Array.isArray(data) ? [...data] : [data];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        nodes.push(node);
        if (Array.isArray(node['@graph'])) stack.push(...node['@graph']);
        if (Array.isArray(node.hasVariant)) stack.push(...node.hasVariant);
      }
    } catch { /* malformed JSON-LD is common; skip it */ }
  }
  return nodes;
}

function isType(node, type) {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function offerFrom(offers) {
  if (!offers) return {};
  const list = Array.isArray(offers) ? offers : [offers];
  let best = {};
  for (const o of list) {
    const price = parsePrice(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
    if (!price) continue;
    const inStock = o.availability ? !/OutOfStock|SoldOut|Discontinued/i.test(o.availability) : true;
    // Cheapest in-stock offer wins; an out-of-stock one only if nothing is in stock.
    const better = !best.price || (inStock && !best.inStock) || (inStock === best.inStock && price < best.price);
    if (better) best = { price, inStock, currency: o.priceCurrency ?? o.priceSpecification?.priceCurrency };
  }
  return best;
}

// Kindle book pages have no price in Amazon's page data, and their first price
// on the page is often another format's, so read the Kindle price box itself.
function isKindlePage(html) {
  return /id=["']kindle-price["']/.test(html)
    || /<title>[^<]*(?:eBook|Kindle Store|Kindle Edition)[^<]*<\/title>/i.test(html);
}

function amazonFallback(html) {
  const title = html.match(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i);
  const kindle = isKindlePage(html);
  const price = kindle
    ? html.match(/id=["']kindle-price["'][^>]*>\s*\$?\s*([\d,]+\.\d{2})/)
      ?? html.match(/id=["']tmm-grid-swatch-KINDLE["'][\s\S]{0,1500}?\$([\d,]+\.\d{2})\s*before credits/)
      ?? html.match(/id=["']tmm-grid-swatch-KINDLE["'][\s\S]{0,1500}?\$([\d,]+\.\d{2})/)
    : html.match(/"priceAmount"\s*:\s*([\d.]+)/) ??
      html.match(/<span class=["']a-offscreen["']>\s*\$([\d,.]+)\s*<\/span>/);
  const asin = html.match(/name=["']ASIN["'][^>]*value=["']([A-Z0-9]{10})["']/);
  const imgTag = html.match(/<img[^>]*\bid=["']landingImage["'][^>]*>/)?.[0] ?? '';
  const image = imgTag.match(/data-old-hires=["'](https[^"']+)["']/) ?? imgTag.match(/\bsrc=["'](https[^"']+)["']/)
    ?? decodeEntities(imgTag).match(/(https:\/\/[^"]+?\.jpg)/);
  // Brand row in the product overview table, else the "Visit the X Store" byline.
  const overview = html.match(/po-brand[\s\S]{0,800}?po-break-word["'][^>]*>([^<]+)</);
  const byline = html.match(/<a[^>]*\bid=["']bylineInfo["'][^>]*>([\s\S]*?)<\/a>/i);
  const brand = overview
    ? decodeEntities(overview[1]).trim()
    : byline
      ? decodeEntities(byline[1].replace(/<[^>]+>/g, '')).trim().replace(/^(Visit the|Brand:)\s*/i, '').replace(/\s*Store$/i, '')
      : null;
  return {
    title: title ? decodeEntities(title[1]).trim() : null,
    image: image?.[1] ?? null,
    brand: brand || null,
    price: price ? parsePrice(price[1]) : null,
    asin: asin?.[1] ?? null,
    kindle,
    // Only look inside the availability box; "Currently unavailable" appears elsewhere on most pages.
    inStock: !/id=["']outOfStock["']/.test(html) &&
      !/Currently unavailable|out of stock/i.test(
        (html.match(/id=["']availability["'][\s\S]{0,600}/)?.[0] ?? '').replace(/<[^>]+>/g, ' ')),
  };
}

// Sephora and others publish a ProductGroup (the product) with one Product per
// shade/size. Use the variant in the URL (?skuId=), else one matching the size
// we're looking for, else the cheapest one.
function productFromGroup(group, url, preferSize) {
  const variants = (group.hasVariant ?? []).filter((v) => isType(v, 'Product'));
  const sku = new URL(url).searchParams.get('skuId');
  const variant = variants.find((v) => sku && String(v.sku) === sku)
    ?? (preferSize ? variants.find((v) => sameSize(parseSize(v.size ?? v.name), preferSize)) : undefined);
  return {
    ...(variant ?? {}),
    name: group.name ?? variant?.name,
    brand: group.brand ?? variant?.brand,
    image: variant?.image ?? group.image ?? variants[0]?.image,
    offers: variant ? variant.offers : variants.flatMap((v) => [].concat(v.offers ?? [])),
  };
}

// Returns { title, brand, gtin, image, price, currency, inStock, size } — any field may be null.
// `preferSize` (a parseSize result) picks the matching shade/size variant when a page has several.
export function extractProduct(html, url, { preferSize } = {}) {
  const nodes = jsonLdNodes(html);
  const group = nodes.find((n) => isType(n, 'ProductGroup'));
  const product = group ? productFromGroup(group, url, preferSize) : nodes.find((n) => isType(n, 'Product')) ?? {};
  const offer = offerFrom(product.offers);
  const brand = typeof product.brand === 'string' ? product.brand : product.brand?.name;
  const image = Array.isArray(product.image) ? product.image[0] : product.image?.url ?? product.image;

  const result = {
    title: product.name ? decodeEntities(String(product.name)).trim() : meta(html, 'og:title'),
    brand: brand ?? meta(html, 'product:brand') ?? null,
    gtin: product.gtin13 ?? product.gtin12 ?? product.gtin14 ?? product.gtin8 ?? product.gtin ?? null,
    image: image ?? meta(html, 'og:image'),
    price: offer.price ?? parsePrice(meta(html, 'product:price:amount') ?? meta(html, 'price')),
    currency: offer.currency ?? meta(html, 'product:price:currency') ?? 'USD',
    inStock: offer.inStock ?? true,
  };

  if (domainOf(url) === 'amazon.com') {
    const a = amazonFallback(html);
    result.title = a.title ?? result.title;
    result.price = a.price ?? result.price;
    result.image = a.image ?? result.image;
    result.brand = result.brand ?? a.brand;
    result.inStock = a.kindle ? true : a.inStock; // ebooks are always available
    if (a.kindle) result.format = 'Kindle eBook';
  }
  if (domainOf(url) === 'target.com') {
    // Target has no price in its structured data; it renders it a few seconds after load.
    const price = html.match(/data-test=["']product-price["'][^>]*>\s*\$?([\d,]+(?:\.\d{2})?)/);
    const brand = html.match(/"primary_brand"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/);
    result.price = result.price ?? (price ? parsePrice(price[1]) : null);
    result.brand = result.brand ?? (brand ? decodeEntities(brand[1]) : null);
    if (/data-test=["'][^"']*(?:outOfStock|soldOut)[^"']*["']/i.test(html)) result.inStock = false;
  }
  // Size from the page, else the title; keep a pack count from the title ("(2 Items)").
  const fromPage = parseSize(sizeText(html, product, url));
  const fromTitle = parseSize(result.title);
  const size = fromPage ?? fromTitle;
  if (size && !size.pack && fromTitle?.pack) size.pack = fromTitle.pack;
  // Books: the format stands in for the size, so a Kindle edition never matches a paperback.
  result.size = result.format ?? size?.label ?? null;
  return result;
}

// Links to other sizes of the product on its page (Ulta's 1.6 oz / 6.7 oz / 13.5 oz
// buttons, Target's 1.69 fl oz / 13.52 fl oz buttons): short links whose text is a size.
export function extractSizeOptions(html, pageUrl) {
  const options = [];
  for (const [, href, inner] of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    if (/^javascript:/i.test(href)) continue;
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).trim();
    if (text.length > 40) continue;
    const size = parseSize(text);
    if (size?.value) options.push({ label: text, size, url: new URL(decodeEntities(href), pageUrl).toString() });
  }
  return options;
}

const NOT_PRODUCT_PATH = /^\/?$|\/$|\/(cart|bag|basket|account|login|signin|search|help|stores?|store-locator|gift-?cards?|wishlist|favorites)(\/|$)/i;

// Product page links from a store's search results page. Known stores use a
// link pattern; any other store uses links that wrap a product image. Keeps
// size-picking parameters (Target's ?preselect=, Ulta's ?sku=).
export function extractSearchLinks(html, searchUrl, limit = 5) {
  const pattern = PRODUCT_LINK_PATTERNS[domainOf(searchUrl)];
  const host = new URL(searchUrl).host;
  const hrefs = pattern
    ? [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]).filter((h) => pattern.test(decodeEntities(h)))
    : [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>((?:(?!<\/a>)[\s\S]){0,3000}?)<\/a>/gi)]
        .filter((m) => /<img\b/i.test(m[2]))
        .map((m) => m[1]);
  const links = new Set();
  for (const href of hrefs) {
    try {
      const abs = new URL(decodeEntities(href), searchUrl);
      if (abs.host !== host || (!pattern && NOT_PRODUCT_PATH.test(abs.pathname))) continue;
      links.add(canonicalUrl(abs.toString()));
    } catch { /* ignore bad hrefs */ }
    if (links.size >= limit) break;
  }
  return [...links];
}

// The store's search page as a template with {q}, from the page's structured
// data or its search box. Null if the page doesn't have one we can use.
export function discoverSearchUrl(html, pageUrl) {
  for (const node of jsonLdNodes(html)) {
    const actions = [].concat(node.potentialAction ?? []);
    for (const a of actions) {
      const template = typeof a.target === 'string' ? a.target : a.target?.urlTemplate;
      const param = String(a['query-input'] ?? '').match(/name=(\w+)/)?.[1] ?? 'search_term_string';
      if (template?.includes(`{${param}}`)) return new URL(template.replace(`{${param}}`, '{q}'), pageUrl).toString();
    }
  }
  for (const [form, attrs, body] of html.matchAll(/<form\b([^>]*)>([\s\S]{0,4000}?)<\/form>/gi)) {
    if (!/role=["']search["']|action=["'][^"']*search/i.test(attrs) || /method=["']post/i.test(attrs)) continue;
    const action = attrs.match(/action=["']([^"']+)["']/)?.[1];
    const input = body.match(/<input\b[^>]*type=["'](?:search|text)["'][^>]*>/i)?.[0] ?? body.match(/<input\b[^>]*name=["'](?:q|query|search|searchTerm|keyword|k|s)["'][^>]*>/i)?.[0];
    const name = input?.match(/name=["']([^"']+)["']/)?.[1];
    if (action && name) {
      const url = new URL(decodeEntities(action), pageUrl);
      url.searchParams.set(name, '{q}');
      return url.toString().replace('%7Bq%7D', '{q}');
    }
  }
  return null;
}

// --- Matching ----------------------------------------------------------------

const STOPWORDS = new Set(['the', 'and', 'with', 'for', 'new', 'by', 'of', 'a', 'an', 'in', '-', '|', '&']);

// Words stores use interchangeably.
const SYNONYMS = { facial: 'face', moisturiser: 'moisturizer', colour: 'color', lipstick: 'lip', moisturizing: 'moisturizer' };
const brandKey = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(new RegExp(SIZE_RE.source, 'gi'), ' ') // sizes and packs are compared separately
    .replace(new RegExp(PACK_RE.source, 'gi'), ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w)) // keeps model numbers like "11"; drops the "s" of "women's"
    .map((w) => SYNONYMS[w] ?? w);
}

function formatOf(text) {
  const t = text.toLowerCase();
  if (/\b(kindle|ebook|e-book)\b/.test(t)) return 'ebook';
  if (/\baudio ?book|audible\b/.test(t)) return 'audio';
  if (/\bhardcover|hardback\b/.test(t)) return 'hardcover';
  if (/\bpaperback|softcover\b/.test(t)) return 'paperback';
  return null;
}

function genderOf(text) {
  const t = text.toLowerCase();
  if (/\b(women'?s?|womens|ladies|female)\b/.test(t)) return 'women';
  if (/\b(men'?s?|mens|male)\b/.test(t)) return 'men';
  if (/\b(kids'?|boys'?|girls'?|youth|toddler|baby)\b/.test(t)) return 'kids';
  return null;
}

// Title words that describe the product, minus the brand's own words.
function productWords(item) {
  const brandWords = new Set(item.brand ? normalizeTitle(item.brand) : []);
  return new Set(normalizeTitle(item.title).filter((w) => !brandWords.has(w)));
}

// 0..1 score that two listings are the same product.
export function matchScore(a, b) {
  if (a.gtin && b.gtin) return String(a.gtin).replace(/^0+/, '') === String(b.gtin).replace(/^0+/, '') ? 1 : 0;

  // Strip both brands from both titles so "La Roche Posay" vs "La Roche-Posay" doesn't count.
  const brands = [a.brand, b.brand].filter(Boolean).join(' ');
  const ta = productWords({ ...a, brand: brands });
  const tb = productWords({ ...b, brand: brands });
  if (!ta.size || !tb.size) return 0;
  const overlap = [...ta].filter((w) => tb.has(w)).length;
  let score = overlap / Math.min(ta.size, tb.size) * 0.7 + overlap / Math.max(ta.size, tb.size) * 0.3;

  if (a.brand && b.brand && !brandKey(a.brand).includes(brandKey(b.brand)) && !brandKey(b.brand).includes(brandKey(a.brand))) {
    score *= 0.5;
  }
  // Model numbers ("Clifton 10" vs "Clifton 11") must agree when both titles have them.
  const na = [...ta].filter((w) => /^\d+$/.test(w)).sort().join();
  const nb = [...tb].filter((w) => /^\d+$/.test(w)).sort().join();
  if (na && nb && na !== nb) score *= 0.3;

  // Kindle vs paperback vs hardcover vs audiobook are different products.
  const fa = formatOf(`${a.title} ${a.size ?? ''}`);
  const fb = formatOf(`${b.title} ${b.size ?? ''}`);
  if (fa && fb && fa !== fb) score *= 0.3;

  // Women's vs men's (or kids') versions are different products.
  const ga = genderOf(`${a.title} ${a.size ?? ''}`);
  const gb = genderOf(`${b.title} ${b.size ?? ''}`);
  if (ga && gb && ga !== gb) score *= 0.3;

  // Different sizes or pack counts are different products. If either size is
  // unknown, cap the score so the match is never trusted without the user's ✓.
  const same = sameSize(parseSize(a.size) ?? parseSize(a.title), parseSize(b.size) ?? parseSize(b.title));
  if (same === false) score *= 0.3;
  else if (same === null) score = Math.min(score, AUTO_MATCH_THRESHOLD - 0.01);
  return Math.round(score * 100) / 100;
}

export const AUTO_MATCH_THRESHOLD = 0.85;
export const MIN_MATCH_SCORE = 0.6; // below this we don't even suggest a match

// Short search phrase for another store: brand + the first words of the title,
// without size/pack details that stores word differently.
export function searchQuery(item) {
  const title = item.title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/[,|–—]| - /)[0]
    .replace(/\b\d+(\.\d+)?\s*(fl\.?\s*oz|oz|ml|g|ct|count|pack)\b/gi, ' ');
  const words = title.split(/\s+/).filter(Boolean);
  const brand = item.brand && !title.toLowerCase().includes(item.brand.toLowerCase()) ? [item.brand] : [];
  return [...brand, ...words].slice(0, 9).join(' ');
}
