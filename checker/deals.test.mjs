// Deal parser tests on page-shaped text (multi-line, as the extension collects it).
// Run: node --test checker/deals.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSitewideDeals, parseProductDeals, dealUnitPrice, extractProduct } from '../extension/lib/extract.js';

test('Ulta size page: priced product next to an unpriced size group', () => {
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const html = ld({ '@type': 'Product', name: 'Toleriane Hydrating Gentle Face Cleanser', brand: { name: 'La Roche-Posay' }, Size: '13.52 oz (Refill)',
    offers: { '@type': 'Offer', availability: 'InStock', price: 19.99, priceCurrency: 'USD' } })
    + ld({ '@type': 'ProductGroup', name: 'Toleriane Hydrating Gentle Face Cleanser', brand: { name: 'La Roche-Posay' },
      hasVariant: [{ '@type': 'Product', sku: '2606177', size: '1.6 oz' }, { '@type': 'Product', sku: '2625722', size: '13.52 oz (Refill)' }] });
  const p = extractProduct(html, 'https://www.ulta.com/p/x-xlsImpprod15321285?sku=2625722');
  assert.equal(p.price, 19.99);
  assert.equal(p.brand, 'La Roche-Posay');
});

const TARGET_URL = 'https://www.target.com/p/la-roche-posay-cleanser-13-5-fl-oz/-/A-51195474';
const cdui = '<div data-test="module-product-detail-price-v2"><div><div data-test="price-cdui"><div data-test="price-cdui-row"><div data-test="text-quill">'
  + '<span data-test="text-quill-insert-0">$19.99</span><span data-test="text-quill-insert-1"> ($1.48/fluid ounce)</span></div></div></div></div></div>';

test('Target: new price block, no product-price element', () => {
  assert.equal(extractProduct(`<html>${cdui}</html>`, TARGET_URL).price, 19.99);
});

test('Target: empty product-price element is skipped, unit price ignored', () => {
  const html = `<span data-test="product-price"></span><span> ($1.48/fluid ounce)</span>${cdui}`;
  assert.equal(extractProduct(html, TARGET_URL).price, 19.99);
});

test('Target: old product-price element still read', () => {
  assert.equal(extractProduct('<span data-test="product-price">$17.99</span>', TARGET_URL).price, 17.99);
});

// Shaped like the Ulta header the extension captured (one line per element).
const ulta = (extra) => [
  'SKIP TO MAIN', 'SKIP TO FOOTER', 'Beauty in 2 hours or less—order online, pick up in store.',
  'Join / Sign in', 'Track an Order', 'Community', 'Ulta Beauty Rewards®', 'Find a Store', extra,
  'Gift Cards', 'Shop', 'New', 'Brands', 'Deals', 'Early Black Friday Deals', 'Sign In', 'Bag',
].join('\n');

test('site-wide: "prices as marked" is ignored even with "Bag" elsewhere in the header', () => {
  assert.deepEqual(parseSitewideDeals(ulta('40% off everything, prices as marked')), []);
});

test('site-wide: code sale is found next to "Gift Cards"', () => {
  const [d] = parseSitewideDeals(ulta('30% off everything with code SAVE30'));
  assert.equal(d?.pct, 30);
  assert.equal(d?.code, 'SAVE30');
  assert.equal(d?.text, '30% off everything with code SAVE30');
});

test('site-wide: ignores "up to", "select", sign-up and plain header text', () => {
  assert.deepEqual(parseSitewideDeals(ulta('Up to 50% off everything with code BIG')), []);
  assert.deepEqual(parseSitewideDeals(ulta('30% off select styles with code SAVE30')), []);
  assert.deepEqual(parseSitewideDeals(ulta('20% off your entire order when you sign up, code WELCOME')), []);
  assert.deepEqual(parseSitewideDeals(ulta('Free shipping on orders $35+')), []);
});

test('site-wide: "applied at checkout" counts without a code', () => {
  assert.equal(parseSitewideDeals('Extra 25% off sitewide, applied at checkout')[0]?.pct, 25);
});

test('bundle: Target buy box with a Circle Card line nearby', () => {
  const box = ['$8.99', 'Buy 2, get 1 free select personal care items', 'Save 5% every day', 'With Target Circle Card (restrictions apply)'].join('\n');
  const deals = parseProductDeals(box);
  assert.equal(deals.length, 1);
  assert.equal(deals[0].kind, 'bundle');
  assert.equal(deals[0].text, 'Buy 2, get 1 free select personal care items');
  assert.deepEqual(dealUnitPrice(deals[0], 12), { qty: 3, unit: 8, total: 24 });
});

test('card-only and Subscribe & Save offers are ignored', () => {
  assert.deepEqual(parseProductDeals('Save 5% every day With Target Circle Card'), []);
  assert.deepEqual(parseProductDeals('Save 15% with Subscribe & Save'), []);
});

test('spend offer with "gift card" spelled with a space', () => {
  const [d] = parseProductDeals('Spend $40, get a $10 gift card');
  assert.equal(d?.kind, 'spend');
  assert.deepEqual(dealUnitPrice(d, 12), { qty: 4, unit: 9.5, total: 38 });
});

test('BOGO 50% without "off" is half off, not free', () => {
  const [d] = parseProductDeals('BOGO 50% select minis');
  assert.equal(d?.getPct, 50);
});

test('over-long lines are dropped, not chunked', () => {
  const blob = `Details ${'lorem ipsum '.repeat(40)} Buy 2, get 1 free`;
  assert.deepEqual(parseProductDeals(blob), []);
});

test('other offer kinds', () => {
  assert.equal(parseProductDeals('Save 10% on 2 select item(s)')[0]?.kind, 'multibuy');
  assert.equal(parseProductDeals('2 for $15')[0]?.kind, 'multiprice');
  assert.equal(parseProductDeals('Apply 20% coupon')[0]?.kind, 'coupon');
  assert.equal(parseProductDeals('Buy one, get one free')[0]?.getPct, 100);
});
