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
    if (price && (!best.price || price < best.price)) {
      best = {
        price,
        currency: o.priceCurrency ?? o.priceSpecification?.priceCurrency,
        inStock: o.availability ? !/OutOfStock|SoldOut|Discontinued/i.test(o.availability) : true,
      };
    }
  }
  return best;
}

function amazonFallback(html) {
  const title = html.match(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i);
  const price =
    html.match(/"priceAmount"\s*:\s*([\d.]+)/) ??
    html.match(/<span class=["']a-offscreen["']>\s*\$([\d,.]+)\s*<\/span>/);
  const asin = html.match(/name=["']ASIN["'][^>]*value=["']([A-Z0-9]{10})["']/);
  return {
    title: title ? decodeEntities(title[1]).trim() : null,
    price: price ? parsePrice(price[1]) : null,
    asin: asin?.[1] ?? null,
    inStock: !/id=["']outOfStock["']|Currently unavailable/i.test(html),
  };
}

// Returns { title, brand, gtin, image, price, currency, inStock } — any field may be null.
export function extractProduct(html, url) {
  const product = jsonLdNodes(html).find((n) => isType(n, 'Product')) ?? {};
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
    result.inStock = a.inStock;
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

export function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

// 0..1 score that two listings are the same product.
export function matchScore(a, b) {
  if (a.gtin && b.gtin) return String(a.gtin).replace(/^0+/, '') === String(b.gtin).replace(/^0+/, '') ? 1 : 0;

  const ta = new Set(normalizeTitle(`${a.brand ?? ''} ${a.title}`));
  const tb = new Set(normalizeTitle(`${b.brand ?? ''} ${b.title}`));
  if (!ta.size || !tb.size) return 0;
  const overlap = [...ta].filter((w) => tb.has(w)).length;
  let score = overlap / Math.min(ta.size, tb.size) * 0.7 + overlap / Math.max(ta.size, tb.size) * 0.3;

  if (a.brand && b.brand && a.brand.toLowerCase() !== b.brand.toLowerCase()) score *= 0.5;
  const sa = sizeOf(a.title);
  const sb = sizeOf(b.title);
  if (sa && sb && sa !== sb) score *= 0.5; // different size = different product
  return Math.round(score * 100) / 100;
}

export const AUTO_MATCH_THRESHOLD = 0.85;
