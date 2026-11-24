// Per-store site access. The extension ships with access to a few big stores;
// any other store (Hoka, Dick's, ...) needs the user's OK once, which Chrome
// only lets us ask for from a click in the popup.
import { domainOf } from './extract.js';

// The origins to ask for so every page of a store's site can be read.
export function storeOrigins(url) {
  const domain = domainOf(url);
  return [`https://${domain}/*`, `https://*.${domain}/*`];
}

// Whether the extension may read this page.
export async function canRead(url) {
  try {
    return await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] });
  } catch {
    return false;
  }
}

// Asks for access to these stores. Must be called straight from a click.
export function requestAccess(urls) {
  const origins = [...new Set(urls.flatMap(storeOrigins))];
  return chrome.permissions.request({ origins });
}
