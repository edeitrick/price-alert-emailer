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

function amazonFallback(html) {
  const title = html.match(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i);
  const price =
    html.match(/"priceAmount"\s*:\s*([\d.]+)/) ??
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
    // Only look inside the availability box; "Currently unavailable" appears elsewhere on most pages.
    inStock: !/id=["']outOfStock["']/.test(html) &&
      !/Currently unavailable|out of stock/i.test(
        (html.match(/id=["']availability["'][\s\S]{0,600}/)?.[0] ?? '').replace(/<[^>]+>/g, ' ')),
  };
}

// Sephora and others publish a ProductGroup (the product) with one Product per
// shade/size. Use the variant in the URL (?skuId=) if any, else the cheapest one.
function productFromGroup(group, url) {
  const variants = (group.hasVariant ?? []).filter((v) => isType(v, 'Product'));
  const sku = new URL(url).searchParams.get('skuId');
  const variant = variants.find((v) => sku && String(v.sku) === sku);
  return {
    ...(variant ?? {}),
    name: group.name ?? variant?.name,
    brand: group.brand ?? variant?.brand,
    image: variant?.image ?? group.image ?? variants[0]?.image,
    offers: variant ? variant.offers : variants.flatMap((v) => [].concat(v.offers ?? [])),
  };
}

// Returns { title, brand, gtin, image, price, currency, inStock } — any field may be null.
export function extractProduct(html, url) {
  const nodes = jsonLdNodes(html);
  const group = nodes.find((n) => isType(n, 'ProductGroup'));
  const product = group ? productFromGroup(group, url) : nodes.find((n) => isType(n, 'Product')) ?? {};
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
    result.inStock = a.inStock;
  }
  if (domainOf(url) === 'target.com') {
    // Target has no price in its structured data; it renders it a few seconds after load.
    const price = html.match(/data-test=["']product-price["'][^>]*>\s*\$?([\d,]+(?:\.\d{2})?)/);
    const brand = html.match(/"primary_brand"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/);
    result.price = result.price ?? (price ? parsePrice(price[1]) : null);
    result.brand = result.brand ?? (brand ? decodeEntities(brand[1]) : null);
    if (/data-test=["'][^"']*(?:outOfStock|soldOut)[^"']*["']/i.test(html)) result.inStock = false;
  }
  return result;
}

// Product page links from a store's search results page.
export function extractSearchLinks(html, searchUrl, limit = 5) {
  const pattern = PRODUCT_LINK_PATTERNS[domainOf(searchUrl)];
  if (!pattern) return [];
  const links = new Set();
  for (const [, href] of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const path = decodeEntities(href);
    if (!pattern.test(path)) continue;
    try {
      const abs = new URL(path, searchUrl);
      abs.search = '';
      abs.hash = '';
      links.add(abs.toString());
    } catch { /* ignore bad hrefs */ }
    if (links.size >= limit) break;
  }
  return [...links];
}

// --- Matching ----------------------------------------------------------------

const STOPWORDS = new Set(['the', 'and', 'with', 'for', 'new', 'by', 'of', 'a', 'an', 'in', '-', '|', '&']);

function sizeOf(title) {
  const m = title.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz|ml|g|mg|lb|ct|count|pack)\b/);
  return m ? `${parseFloat(m[1])}${m[2].replace(/[\s.]/g, '')}` : null;
}

// Words stores use interchangeably.
const SYNONYMS = { facial: 'face', moisturiser: 'moisturizer', colour: 'color', lipstick: 'lip', moisturizing: 'moisturizer' };
const brandKey = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\d+(?:\.\d+)?\s*(fl\.?\s*oz|oz|ml|g|mg|lb|ct|count|pack)\b/g, ' ') // sizes compared separately
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map((w) => SYNONYMS[w] ?? w);
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
  const sa = sizeOf(a.title);
  const sb = sizeOf(b.title);
  if (sa && sb && sa !== sb) score *= 0.5; // different size = different product
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
