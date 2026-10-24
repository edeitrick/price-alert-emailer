// Service worker: receives the session from the web app and, every 6 hours,
// refreshes prices by loading each product page in a hidden (minimized) Chrome
// window, the same way a person would see it. Stores block or don't render
// prices for the cloud checker, so the browser does the reading.
import { api, rpc, setSession, clearSession, getSession } from './lib/supabase.js';
import { extractProduct } from './lib/extract.js';

const ALARM = 'refresh-prices';
const PAGE_TIMEOUT_MS = 20_000; // give up on a page that never shows a price
const BETWEEN_PAGES_MS = 3_000; // be gentle with the stores

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

// From the popup's "Check prices now" link.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'refresh-now') {
    refreshAllListings().then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) refreshAllListings().catch(console.error);
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

// Loads the page in the hidden tab and polls until a price shows up (Target
// renders it a few seconds after load) or the timeout passes.
async function readPrice(tabId, url) {
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
      const product = extractProduct(html, tab.url || url);
      if (product.price) return product;
    } catch { /* page still navigating; try again */ }
    await sleep(1500);
  }
  return null;
}

export async function refreshAllListings() {
  if (running) return { skipped: 'already running' };
  if (!(await getSession())) return { skipped: 'not signed in' };
  running = true;
  const stats = { checked: 0, failed: 0 };
  let windowId;
  try {
    const listings = await api(
      '/rest/v1/listings?select=id,url,stores!inner(server_fetch),items!inner(active)' +
      '&stores.server_fetch=eq.false&items.active=eq.true&status=neq.rejected',
    );
    if (!listings.length) return stats;

    const win = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
    windowId = win.id;
    const tabId = win.tabs[0].id;
    await chrome.tabs.update(tabId, { muted: true });

    for (const listing of listings) {
      const product = await readPrice(tabId, listing.url);
      if (product) {
        await rpc('record_price', { p_listing_id: listing.id, p_price: product.price, p_in_stock: product.inStock });
        stats.checked++;
      } else {
        stats.failed++;
        console.warn('No price found', listing.url);
      }
      await sleep(BETWEEN_PAGES_MS);
    }
    await chrome.storage.local.set({ lastRefresh: { at: Date.now(), ...stats } });
    return stats;
  } finally {
    running = false;
    if (windowId) chrome.windows.remove(windowId).catch(() => {});
  }
}
