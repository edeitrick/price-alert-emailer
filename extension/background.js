// Service worker: receives the session from the web app and, every 6 hours,
// refreshes prices for stores that block the cloud checker (e.g. Amazon).
import { api, rpc, setSession, clearSession, getSession } from './lib/supabase.js';
import { extractProduct } from './lib/extract.js';

const ALARM = 'refresh-prices';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 360, delayInMinutes: 1 });
});

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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) refreshBrowserOnlyListings().catch(console.error);
});

async function refreshBrowserOnlyListings() {
  if (!(await getSession())) return;
  const listings = await api(
    '/rest/v1/listings?select=id,url,stores!inner(server_fetch),items!inner(active)' +
    '&stores.server_fetch=eq.false&items.active=eq.true&status=neq.rejected',
  );
  for (const listing of listings) {
    try {
      const res = await fetch(listing.url, { credentials: 'omit' });
      if (!res.ok) continue;
      const product = extractProduct(await res.text(), listing.url);
      if (product.price) {
        await rpc('record_price', { p_listing_id: listing.id, p_price: product.price, p_in_stock: product.inStock });
      }
    } catch (err) {
      console.warn('Price refresh failed', listing.url, err);
    }
    await new Promise((r) => setTimeout(r, 3000)); // be gentle with the store
  }
}
