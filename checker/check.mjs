// Price checker — run every 6 hours by .github/workflows/check-prices.yml.
//   1. Finds matching listings at the user's other stores (new items, then weekly).
//   2. Fetches current prices for stores that allow server checks.
//   3. Emails the user when the cheapest listing beats their threshold.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, EMAIL_FROM, WEB_APP_URL
import { createClient } from '@supabase/supabase-js';
import { extractProduct, extractSearchLinks, matchScore, AUTO_MATCH_THRESHOLD } from '../extension/lib/extract.js';
import { sendAlertEmail } from './email.mjs';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const REMATCH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const DELAY_MS = 1500;
const MIN_FUZZY_CONFIDENCE = 0.6; // below this we don't even suggest a match
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; PriceAlertEmailer/0.1; +https://github.com/edeitrick/price-alert-emailer)',
  'Accept-Language': 'en-US,en;q=0.9',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { matched: 0, checked: 0, failed: 0, emailed: 0 };

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function must({ data, error }) {
  if (error) throw error;
  return data;
}

// --- 1. Cross-store matching -------------------------------------------------

async function findMatches(stores) {
  const cutoff = new Date(Date.now() - REMATCH_AFTER_MS).toISOString();
  const items = must(await db.from('items')
    .select('id, user_id, title, brand, gtin, category, matched_at, listings(store_id, url)')
    .eq('active', true)
    .or(`matched_at.is.null,matched_at.lt.${cutoff}`));

  for (const item of items) {
    const userStores = must(await db.from('user_stores').select('store_id').eq('user_id', item.user_id));
    const haveStores = new Set(item.listings.map((l) => l.store_id));
    const targets = userStores
      .map((us) => stores.get(us.store_id))
      .filter((s) => s && s.server_fetch && s.search_url && !haveStores.has(s.id))
      .filter((s) => s.categories.includes(item.category));

    // Stores the checker can't reach are searched by the extension; leave
    // matched_at alone so the extension still picks this item up.
    if (!targets.length) continue;
    for (const store of targets) {
      try {
        const best = await searchStore(store, item);
        if (best && best.score >= MIN_FUZZY_CONFIDENCE) {
          must(await db.from('listings').upsert({
            item_id: item.id,
            store_id: store.id,
            url: best.url,
            match_type: item.gtin && best.product.gtin ? 'gtin' : 'fuzzy',
            match_confidence: best.score,
            last_price: best.product.price,
            in_stock: best.product.inStock,
            last_checked_at: new Date().toISOString(),
          }, { onConflict: 'item_id,url', ignoreDuplicates: true }));
          stats.matched++;
        }
      } catch (err) {
        console.warn(`search ${store.domain} for "${item.title}" failed: ${err.message}`);
      }
    }
    must(await db.from('items').update({ matched_at: new Date().toISOString() }).eq('id', item.id));
  }
}

async function searchStore(store, item) {
  // Try the barcode first, then fall back to brand + title.
  const queries = [item.gtin, [item.brand, item.title].filter(Boolean).join(' ').slice(0, 120)].filter(Boolean);
  let links = [];
  for (const query of queries) {
    const searchUrl = store.search_url.replace('{q}', encodeURIComponent(query));
    links = extractSearchLinks(await fetchHtml(searchUrl), searchUrl, 4);
    if (links.length) break;
    await sleep(DELAY_MS);
  }

  let best = null;
  for (const url of links) {
    await sleep(DELAY_MS);
    try {
      const product = extractProduct(await fetchHtml(url), url);
      if (!product.title || !product.price) continue;
      const score = matchScore(item, product);
      if (!best || score > best.score) best = { url, product, score };
      if (score === 1) break;
    } catch { /* try the next candidate */ }
  }
  return best;
}

// --- 2. Price refresh --------------------------------------------------------

async function refreshPrices(stores) {
  const listings = must(await db.from('listings')
    .select('id, url, store_id, items!inner(active)')
    .eq('items.active', true)
    .neq('status', 'rejected'));

  for (const listing of listings) {
    if (!stores.get(listing.store_id)?.server_fetch) continue; // extension handles these
    try {
      const product = extractProduct(await fetchHtml(listing.url), listing.url);
      if (!product.price) throw new Error('no price found');
      must(await db.from('price_history').insert({ listing_id: listing.id, price: product.price, in_stock: product.inStock }));
      must(await db.from('listings').update({
        last_price: product.price, in_stock: product.inStock, last_checked_at: new Date().toISOString(),
      }).eq('id', listing.id));
      stats.checked++;
    } catch (err) {
      stats.failed++;
      console.warn(`price check failed ${listing.url}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }
}

// --- 3. Alerts ---------------------------------------------------------------

function isTrusted(listing) {
  return listing.status === 'confirmed'
    || (listing.status === 'active' && listing.match_confidence >= AUTO_MATCH_THRESHOLD);
}

async function sendAlerts(stores) {
  const items = must(await db.from('items')
    .select('id, user_id, title, image_url, baseline_price, threshold_pct, currency, listings(*), alerts_sent(price, sent_at)')
    .eq('active', true));
  const emails = new Map(must(await db.from('profiles').select('id, email')).map((p) => [p.id, p.email]));

  for (const item of items) {
    const candidates = item.listings.filter((l) => isTrusted(l) && l.in_stock !== false && l.last_price > 0);
    if (!candidates.length) continue;
    const best = candidates.reduce((a, b) => (b.last_price < a.last_price ? b : a));

    const target = item.baseline_price * (1 - item.threshold_pct / 100);
    if (best.last_price > target) continue;

    // Only re-alert if the price fell below the last price we emailed about.
    const lastAlert = item.alerts_sent.sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
    if (lastAlert && best.last_price >= lastAlert.price) continue;

    const email = emails.get(item.user_id);
    if (!email) continue;
    try {
      await sendAlertEmail({
        to: email,
        item,
        listing: best,
        storeName: stores.get(best.store_id)?.name ?? 'the store',
        pctOff: Math.round((1 - best.last_price / item.baseline_price) * 100),
      });
      must(await db.from('alerts_sent').insert({ item_id: item.id, listing_id: best.id, price: best.last_price }));
      stats.emailed++;
    } catch (err) {
      console.error(`email failed for item ${item.id}: ${err.message}`);
    }
  }
}

// --- main --------------------------------------------------------------------

const stores = new Map(must(await db.from('stores').select('*')).map((s) => [s.id, s]));
await findMatches(stores);
await refreshPrices(stores);
await sendAlerts(stores);
console.log('done', stats);
