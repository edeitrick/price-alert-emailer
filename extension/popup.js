import { getSession, rpc } from './lib/supabase.js';
import { extractProduct, domainOf, canonicalUrl, parseSize, discoverSearchUrl } from './lib/extract.js';
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

function summary(r) {
  if (!r) return '';
  if (r.error) return `Last check stopped: ${r.error}`;
  const when = new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const parts = [`${r.checked ?? 0} price${r.checked === 1 ? '' : 's'} updated`];
  if (r.matched) parts.push(`${r.matched} found at other stores`);
  if (r.failed) parts.push(`${r.failed} couldn't be read`);
  return `Last checked ${when}: ${parts.join(', ')}`;
}

// Shows the running check's progress (from the background worker), or the last result.
async function showStatus() {
  const { refreshStatus, lastRefresh } = await chrome.storage.local.get(['refreshStatus', 'lastRefresh']);
  // A status older than 2 minutes means the run was interrupted (e.g. Chrome closed).
  const live = refreshStatus?.running && Date.now() - refreshStatus.at < 2 * 60 * 1000;
  $('refresh').hidden = live;
  $('last-refresh').textContent = live ? `Checking… ${refreshStatus.text}` : summary(lastRefresh);
  const details = !live && lastRefresh?.details?.length ? lastRefresh.details : [];
  $('refresh-details').hidden = !details.length;
  $('refresh-list').replaceChildren(...details.map((d) => {
    const li = document.createElement('li');
    li.textContent = `${d.ok ? '✓' : '✗'} ${d.text}`;
    if (!d.ok) li.className = 'bad';
    return li;
  }));
  return live;
}

// Prices are refreshed every 6 hours in a minimized window; this runs it now.
function showRefreshFooter() {
  $('footer').hidden = false;
  const version = chrome.runtime.getManifest().version;
  getSession().then((sess) => {
    $('account').textContent = `${sess?.email ? `Signed in as ${sess.email} · ` : ''}version ${version}`;
  });
  const poll = async () => { if (await showStatus()) setTimeout(poll, 1500); };
  poll();
  $('refresh').onclick = async (e) => {
    e.preventDefault();
    await chrome.runtime.sendMessage({ type: 'refresh-now' });
    setTimeout(poll, 300);
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
        p_search_url: discoverSearchUrl(html, tab.url),
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
