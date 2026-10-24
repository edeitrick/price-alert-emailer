// Service worker: receives the session from the web app and, every 6 hours,
// (1) searches the user's other stores for each item and (2) refreshes prices.
// Both load pages in a hidden (minimized) Chrome window, the same way a person
// would see them: stores block or don't render prices for the cloud checker.
import { api, rpc, setSession, clearSession, getSession } from './lib/supabase.js';
import { extractProduct, extractSearchLinks, matchScore, searchQuery, canonicalUrl, MIN_MATCH_SCORE } from './lib/extract.js';

const ALARM = 'refresh-prices';
const PAGE_TIMEOUT_MS = 20_000; // give up on a page that never shows a price
const BETWEEN_PAGES_MS = 2_000; // be gentle with the stores
const RECHECK_AFTER_MS = 30 * 60 * 1000; // skip prices checked in the last 30 minutes
const REMATCH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const CANDIDATES_PER_STORE = 3;

let running = false;

function ensureAlarm() {
  chrome.alarms.get(ALARM, (alarm) => {
    if (!alarm) chrome.alarms.create(ALARM, { periodInMinutes: 360, delayInMinutes: 1 });
  });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'session' && msg.session?.access_token) {
    setSession(msg.session).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'signout') {
    clearSession().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// From the popup: "Check my prices now", and right after saving an item.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'refresh-now') {
    runAll().then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  }
  if (msg?.type === 'match-item' && msg.itemId) {
    runAll({ itemIds: [msg.itemId] }).then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) runAll().catch(console.error);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); resolve(); };
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, PAGE_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// Loads a page and polls its rendered HTML until `read(html, url)` returns
// something (prices and search results often appear after load), or times out.
async function loadAndRead(tabId, url, read) {
  await chrome.tabs.update(tabId, { url });
  await waitForLoad(tabId);
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const [{ result: html }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.outerHTML,
      });
      const tab = await chrome.tabs.get(tabId);
      const value = read(html, tab.url || url);
      if (value) return value;
    } catch { /* page still navigating; try again */ }
    await sleep(1500);
  }
  return null;
}

const readProduct = (tabId, url) =>
  loadAndRead(tabId, url, (html, pageUrl) => {
    const product = extractProduct(html, pageUrl);
    return product.price ? product : null;
  });

const readSearchResults = (tabId, url) =>
  loadAndRead(tabId, url, (html) => {
    const links = extractSearchLinks(html, url, CANDIDATES_PER_STORE);
    return links.length ? links : null;
  });

// --- Cross-store matching ------------------------------------------------------

async function matchItems(tabId, itemIds) {
  const stats = { searched: 0, matched: 0 };
  const filter = itemIds ? `&id=in.(${itemIds.join(',')})` : '';
  const items = await api(
    `/rest/v1/items?select=id,title,brand,gtin,category,matched_at,listings(store_id,url,status)&active=eq.true${filter}`,
  );
  const userStores = (await api('/rest/v1/user_stores?select=stores(id,name,categories,search_url)'))
    .map((us) => us.stores)
    .filter((s) => s?.search_url);

  for (const item of items) {
    if (!itemIds && item.matched_at && Date.now() - Date.parse(item.matched_at) < REMATCH_AFTER_MS) continue;
    const listedStores = new Set(item.listings.map((l) => l.store_id));
    const rejected = new Set(item.listings.filter((l) => l.status === 'rejected').map((l) => l.url));
    const targets = userStores.filter((s) => !listedStores.has(s.id) && s.categories.includes(item.category));

    for (const store of targets) {
      stats.searched++;
      const searchUrl = store.search_url.replace('{q}', encodeURIComponent(searchQuery(item)));
      const links = ((await readSearchResults(tabId, searchUrl)) ?? [])
        .map(canonicalUrl)
        .filter((u) => !rejected.has(u));

      let best = null;
      for (const url of links) {
        await sleep(BETWEEN_PAGES_MS);
        const product = await readProduct(tabId, url);
        if (!product) continue;
        const score = matchScore(item, product);
        if (!best || score > best.score) best = { url, product, score };
        if (score === 1) break;
      }

      if (best && best.score >= MIN_MATCH_SCORE) {
        const [listing] = await api('/rest/v1/listings?on_conflict=item_id,url', {
          method: 'POST',
          prefer: 'return=representation,resolution=ignore-duplicates',
          body: {
            item_id: item.id,
            store_id: store.id,
            url: best.url,
            match_type: item.gtin && best.product.gtin ? 'gtin' : 'fuzzy',
            match_confidence: best.score,
          },
        });
        if (listing) {
          // Records the price too, so the dashboard shows it right away.
          await rpc('record_price', { p_listing_id: listing.id, p_price: best.product.price, p_in_stock: best.product.inStock });
          stats.matched++;
        }
      }
      await sleep(BETWEEN_PAGES_MS);
    }
    await api(`/rest/v1/items?id=eq.${item.id}`, { method: 'PATCH', body: { matched_at: new Date().toISOString() } });
  }
  return stats;
}

// --- Price refresh -------------------------------------------------------------

async function refreshPrices(tabId, itemIds) {
  const stats = { checked: 0, failed: 0 };
  const filter = itemIds ? `&item_id=in.(${itemIds.join(',')})` : '';
  const listings = await api(
    '/rest/v1/listings?select=id,url,last_checked_at,stores!inner(server_fetch),items!inner(active)' +
    `&stores.server_fetch=eq.false&items.active=eq.true&status=neq.rejected${filter}`,
  );
  for (const listing of listings) {
    if (listing.last_checked_at && Date.now() - Date.parse(listing.last_checked_at) < RECHECK_AFTER_MS) continue;
    const product = await readProduct(tabId, listing.url);
    if (product) {
      await rpc('record_price', { p_listing_id: listing.id, p_price: product.price, p_in_stock: product.inStock });
      stats.checked++;
    } else {
      stats.failed++;
      console.warn('No price found', listing.url);
    }
    await sleep(BETWEEN_PAGES_MS);
  }
  return stats;
}

// Matches first, so new store listings arrive with prices; then refreshes the rest.
async function runAll({ itemIds } = {}) {
  if (running) return { skipped: 'already running' };
  if (!(await getSession())) return { skipped: 'not signed in' };
  running = true;
  let windowId;
  try {
    const win = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
    windowId = win.id;
    const tabId = win.tabs[0].id;
    await chrome.tabs.update(tabId, { muted: true });

    const matched = await matchItems(tabId, itemIds);
    const prices = await refreshPrices(tabId, itemIds);
    const stats = { ...matched, ...prices };
    await chrome.storage.local.set({ lastRefresh: { at: Date.now(), ...stats } });
    return stats;
  } finally {
    running = false;
    if (windowId) chrome.windows.remove(windowId).catch(() => {});
  }
}
