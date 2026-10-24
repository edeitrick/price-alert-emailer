import { getSession, rpc } from './lib/supabase.js';
import { extractProduct, domainOf, canonicalUrl } from './lib/extract.js';
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

async function init() {
  const session = await getSession();
  if (!session) {
    show('connect');
    $('connect-btn').onclick = () =>
      chrome.tabs.create({ url: `${WEB_APP_URL}/connect?ext=${chrome.runtime.id}` });
    return;
  }

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

  $('title').textContent = product.title ?? tab.title;
  $('store').textContent = domain;
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
      await rpc('save_item', {
        p_url: canonicalUrl(tab.url),
        p_domain: domain,
        p_title: $('title').textContent,
        p_price: parseFloat($('price').value),
        p_threshold_pct: parseInt($('threshold').value, 10),
        p_category: $('category').value,
        p_brand: product.brand,
        p_gtin: product.gtin,
        p_image_url: product.image,
        p_currency: product.currency,
      });
      $('email').textContent = session.email ?? 'you';
      $('dashboard').href = `${WEB_APP_URL}/dashboard`;
      show('done');
    } catch (err) {
      showError(`Couldn't save: ${err.message}`);
    }
  };
}

init().catch((err) => showError(err.message));
