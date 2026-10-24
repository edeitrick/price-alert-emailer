import { getSession, rpc } from './lib/supabase.js';
import { extractProduct, domainOf, canonicalUrl, parseSize } from './lib/extract.js';
import { WEB_APP_URL, DEFAULT_THRESHOLD_PCT, CATEGORIES, DEFAULT_CATEGORY_BY_DOMAIN } from './config.js';

const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of ['connect', 'loading', 'save', 'done']) $(s).hidden = s !== id; };

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = false;
}

function updateTargetPrice() {
  const price = parseFloat($('price').value);
  const pct = parseInt($('threshold').value, 10);
  $('target').textContent = price > 0 && pct > 0
    ? `You'll be emailed at $${(price * (1 - pct / 100)).toFixed(2)} or less.`
    : '';
}

async function showLastRefresh() {
  const { lastRefresh } = await chrome.storage.local.get('lastRefresh');
  $('last-refresh').textContent = lastRefresh
    ? `Last checked ${new Date(lastRefresh.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : '';
}

// Prices are refreshed every 6 hours in a minimized window; this runs it now.
function showRefreshFooter() {
  $('footer').hidden = false;
  showLastRefresh();
  $('refresh').onclick = async (e) => {
    e.preventDefault();
    $('refresh').textContent = 'Checking… (a minimized window opens)';
    const result = await chrome.runtime.sendMessage({ type: 'refresh-now' });
    $('refresh').textContent = result?.error
      ? `Couldn't check: ${result.error}`
      : result?.skipped ? `Already checking`
      : `Checked ${result.checked} price${result.checked === 1 ? '' : 's'}` +
        (result.matched ? `, found ${result.matched} at other stores` : '') +
        (result.failed ? `, ${result.failed} not found` : '');
    showLastRefresh();
  };
}

async function init() {
  const session = await getSession();
  if (!session) {
    show('connect');
    $('connect-btn').onclick = () =>
      chrome.tabs.create({ url: `${WEB_APP_URL}/connect?ext=${chrome.runtime.id}` });
    return;
  }

  showRefreshFooter();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('http')) {
    show('loading');
    $('loading').textContent = 'Open a product page to save it.';
    return;
  }

  const [{ result: html }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.documentElement.outerHTML,
  });
  const product = extractProduct(html, tab.url);
  const domain = domainOf(tab.url);
  const size = parseSize(product.size);

  $('title').textContent = product.title ?? tab.title;
  $('store').textContent = size ? `${domain} · ${size.label}` : domain;
  if (product.image) $('image').src = product.image; else $('image').hidden = true;
  $('price').value = product.price ?? '';
  $('threshold').value = DEFAULT_THRESHOLD_PCT;
  for (const c of CATEGORIES) $('category').add(new Option(c[0].toUpperCase() + c.slice(1), c));
  $('category').value = DEFAULT_CATEGORY_BY_DOMAIN[domain] ?? 'general';
  $('price').oninput = $('threshold').oninput = updateTargetPrice;
  updateTargetPrice();
  if (!product.price) showError("Couldn't read the price on this page — please enter it.");
  show('save');

  $('save').onsubmit = async (e) => {
    e.preventDefault();
    $('error').hidden = true;
    try {
      const itemId = await rpc('save_item', {
        p_url: canonicalUrl(tab.url),
        p_domain: domain,
        p_title: $('title').textContent,
        p_price: parseFloat($('price').value),
        p_threshold_pct: parseInt($('threshold').value, 10),
        p_category: $('category').value,
        p_brand: product.brand,
        p_gtin: product.gtin,
        p_image_url: product.image,
        p_size: size?.label ?? null,
        p_size_value: size?.value ?? null,
        p_pack: size?.pack ?? null,
        p_currency: product.currency,
      });
      $('email').textContent = session.email ?? 'you';
      $('dashboard').href = `${WEB_APP_URL}/dashboard`;
      show('done');
      // Look for the same item at the user's other stores (runs in a minimized window).
      chrome.runtime.sendMessage({ type: 'match-item', itemId });
    } catch (err) {
      showError(`Couldn't save: ${err.message}`);
    }
  };
}

init().catch((err) => showError(err.message));
