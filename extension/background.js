// Service worker: receives the session from the web app and, every 6 hours,
// (1) searches the user's other stores for each item and (2) refreshes prices.
// Both load pages in a hidden (minimized) Chrome window, the same way a person
// would see them: stores block or don't render prices for the cloud checker.
import { api, rpc, setSession, clearSession, getSession } from './lib/supabase.js';
import {
  extractProduct, extractSearchLinks, extractSizeOptions, matchScore, searchQuery, canonicalUrl,
  parseSize, sameSize, MIN_MATCH_SCORE,
} from './lib/extract.js';

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
// Answers at once and lets the run continue: Chrome stops a service worker
// whose single message stays open longer than 5 minutes, which cut runs short.
// The popup follows progress through `refreshStatus` in storage instead.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'refresh-now') {
    sendResponse({ started: !running });
    runAll().catch(console.error);
  }
  if (msg?.type === 'match-item' && msg.itemId) {
    // The new item first, then any other items still waiting to be searched.
    sendResponse({ started: !running });
    runAll({ firstItemId: msg.itemId }).catch(console.error);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) runAll().catch(console.error);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const setStatus = (text) =>
  chrome.storage.local.set({ refreshStatus: { running: true, text, at: Date.now() } });

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

// `preferSize` picks the right shade/size on pages that list several. Some pages
// (Target) show no price until a size is picked; for those this returns the
// product with price null and its size buttons, once the wait runs out.
async function readProduct(tabId, url, preferSize) {
  let partial = null;
  const found = await loadAndRead(tabId, url, (html, pageUrl) => {
    const product = { ...extractProduct(html, pageUrl, { preferSize }), sizeOptions: extractSizeOptions(html, pageUrl) };
    if (product.price) return product;
    if (product.sizeOptions.length) partial = product;
    return null;
  });
  return found ?? partial;
}

// Reads a candidate; if it's a different size from the item but the page links
// to the item's size (e.g. Ulta's size buttons), reads that size instead.
async function readCandidate(tabId, url, itemSize) {
  const product = await readProduct(tabId, url, itemSize);
  if (!product) return null;
  const wrongSize = itemSize && sameSize(parseSize(product.size), itemSize) === false;
  if (product.price && !wrongSize) return { url, product };
  const option = itemSize && product.sizeOptions.find((o) => sameSize(o.size, itemSize));
  if (!option) return product.price ? { url, product } : null;
  await sleep(BETWEEN_PAGES_MS);
  const sized = await readProduct(tabId, option.url, itemSize);
  if (sized?.price) return { url: canonicalUrl(option.url), product: sized };
  return product.price ? { url, product } : null;
}

const readSearchResults = (tabId, url) =>
  loadAndRead(tabId, url, (html) => {
    const links = extractSearchLinks(html, url, CANDIDATES_PER_STORE);
    return links.length ? links : null;
  });

// --- Cross-store matching ------------------------------------------------------

async function matchItems(tabId, firstItemId) {
  const stats = { searched: 0, matched: 0 };
  const items = (await api(
    '/rest/v1/items?select=id,title,brand,gtin,size,category,matched_at,listings(store_id,url,status)&active=eq.true',
  )).sort((a, b) => (b.id === firstItemId) - (a.id === firstItemId));
  const userStores = (await api('/rest/v1/user_stores?select=stores(id,name,categories,search_url)'))
    .map((us) => us.stores)
    .filter((s) => s?.search_url);

  for (const item of items) {
    if (item.id !== firstItemId && item.matched_at && Date.now() - Date.parse(item.matched_at) < REMATCH_AFTER_MS) continue;
    try {
      await searchOtherStores(tabId, item, userStores, stats);
    } catch (err) {
      console.warn('Search failed for', item.title, err); // try again next run
      continue;
    }
    await api(`/rest/v1/items?id=eq.${item.id}`, { method: 'PATCH', body: { matched_at: new Date().toISOString() } });
  }
  return stats;
}

async function searchOtherStores(tabId, item, userStores, stats) {
  const listedStores = new Set(item.listings.map((l) => l.store_id));
  const rejected = new Set(item.listings.filter((l) => l.status === 'rejected').map((l) => l.url));
  // Only stores this user has saved from or added a link for, in the item's category.
  const targets = userStores.filter((s) => !listedStores.has(s.id) && s.categories.includes(item.category));
  const itemSize = parseSize(item.size) ?? parseSize(item.title);

  for (const store of targets) {
    stats.searched++;
    await setStatus(`Looking for “${item.title.slice(0, 40)}” at ${store.name}`);
    const searchUrl = store.search_url.replace('{q}', encodeURIComponent(searchQuery(item)));
    const links = ((await readSearchResults(tabId, searchUrl)) ?? [])
      .map(canonicalUrl)
      .filter((u) => !rejected.has(u));

    let best = null;
    for (const link of links) {
      await sleep(BETWEEN_PAGES_MS);
      const candidate = await readCandidate(tabId, link, itemSize);
      if (!candidate) continue;
      const score = matchScore(item, candidate.product);
      if (!best || score > best.score) best = { ...candidate, score };
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
          size: best.product.size,
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
}

// --- Price refresh -------------------------------------------------------------

async function refreshPrices(tabId) {
  const stats = { checked: 0, failed: 0 };
  const listings = await api(
    '/rest/v1/listings?select=id,url,size,last_checked_at,stores!inner(server_fetch),items!inner(active,size,title)' +
    '&stores.server_fetch=eq.false&items.active=eq.true&status=neq.rejected',
  );
  const due = listings.filter((l) => !l.last_checked_at || Date.now() - Date.parse(l.last_checked_at) >= RECHECK_AFTER_MS);
  for (const [i, listing] of due.entries()) {
    await setStatus(`Checking prices (${i + 1} of ${due.length}): ${new URL(listing.url).hostname.replace(/^www\./, '')}`);
    try {
      const size = parseSize(listing.size) ?? parseSize(listing.items.size) ?? parseSize(listing.items.title);
      const product = await readProduct(tabId, listing.url, size);
      if (product?.price) {
        await rpc('record_price', { p_listing_id: listing.id, p_price: product.price, p_in_stock: product.inStock });
        stats.checked++;
      } else {
        stats.failed++;
        console.warn('No price found', listing.url);
      }
    } catch (err) {
      stats.failed++;
      console.warn('Price check failed', listing.url, err);
    }
    await sleep(BETWEEN_PAGES_MS);
  }
  return stats;
}

// Matches first, so new store listings arrive with prices; then refreshes the rest.
async function runAll({ firstItemId } = {}) {
  if (running) return { skipped: 'already running' };
  if (!(await getSession())) return { skipped: 'not signed in' };
  running = true;
  await setStatus('Starting…');
  let windowId;
  try {
    const win = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
    windowId = win.id;
    const tabId = win.tabs[0].id;
    await chrome.tabs.update(tabId, { muted: true });

    const matched = await matchItems(tabId, firstItemId);
    const prices = await refreshPrices(tabId);
    const stats = { ...matched, ...prices };
    await chrome.storage.local.set({ lastRefresh: { at: Date.now(), ...stats } });
    return stats;
  } catch (err) {
    await chrome.storage.local.set({ lastRefresh: { at: Date.now(), error: err.message } });
    throw err;
  } finally {
    running = false;
    await chrome.storage.local.set({ refreshStatus: { running: false, at: Date.now() } });
    if (windowId) chrome.windows.remove(windowId).catch(() => {});
  }
}
