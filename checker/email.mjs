// Sends the price-drop email through Resend's HTTP API.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendAlertEmail({ to, item, listing, storeName, pctOff }) {
  const price = `$${Number(listing.last_price).toFixed(2)}`;
  const was = `$${Number(item.baseline_price).toFixed(2)}`;
  const dashboard = `${process.env.WEB_APP_URL}/dashboard`;

  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#1a1a1a">
    <h2 style="color:#0f766e;margin-bottom:4px">${pctOff}% off at ${esc(storeName)}</h2>
    <p style="margin-top:0">An item on your alert list dropped below your ${item.threshold_pct}% target.</p>
    <table cellpadding="0" cellspacing="0"><tr>
      ${item.image_url ? `<td style="padding-right:14px"><img src="${esc(item.image_url)}" width="88" alt=""></td>` : ''}
      <td>
        <strong>${esc(item.title)}</strong><br>
        <span style="font-size:20px;font-weight:700">${price}</span>
        <span style="color:#666;text-decoration:line-through;margin-left:6px">${was}</span>
      </td>
    </tr></table>
    <p><a href="${esc(listing.url)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">View at ${esc(storeName)}</a></p>
    <p style="color:#666;font-size:12px">Prices change quickly — check the store before buying.
      <a href="${dashboard}">Manage your alerts</a></p>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Price Alert Emailer <onboarding@resend.dev>',
      to,
      subject: `Price drop: ${item.title.slice(0, 60)} is now ${price} (${pctOff}% off)`,
      html,
      text: `${item.title} is now ${price} at ${storeName} (was ${was}, ${pctOff}% off).\n${listing.url}\n\nManage alerts: ${dashboard}`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

const money = (n) => `$${Number(n).toFixed(2)}`;

// What to do to get the deal, in plain words.
function dealHowTo({ deal, result }) {
  const code = deal.code ? ` with code ${deal.code}` : '';
  if (deal.kind === 'sitewide') return `${deal.pct}% off everything${code || ' at checkout'}`;
  if (deal.kind === 'coupon') return `Clip the coupon on the product page${code}`;
  if (deal.kind === 'spend') return `Buy ${result.qty} to reach $${deal.spend} and get a $${deal.off} gift card${code}`;
  return `Buy ${result.qty}${code}`;
}

// One email listing every item a current deal pushes past its target.
export async function sendDealDigestEmail({ to, entries }) {
  const dashboard = `${process.env.WEB_APP_URL}/dashboard`;
  const rows = entries.map((e) => {
    const pct = Math.round((1 - e.result.unit / e.item.baseline_price) * 100);
    const each = e.result.qty > 1 ? `${money(e.result.unit)} each (${money(e.result.total)} for ${e.result.qty})` : money(e.result.unit);
    return {
      pct,
      html: `
      <tr><td style="padding:12px 0;border-top:1px solid #e5e5e5">
        <strong>${esc(e.item.title)}</strong><br>
        <span style="color:#0f766e;font-weight:700">${esc(each)}</span>
        <span style="color:#666"> · ${pct}% below the ${money(e.item.baseline_price)} you saved it at (target ${money(e.target)})</span><br>
        <span>${esc(e.storeName)}: “${esc(e.deal.text)}”</span><br>
        <span style="color:#666">${esc(dealHowTo(e))}</span><br>
        <a href="${esc(e.listing.url)}" style="color:#0f766e;font-weight:600">View at ${esc(e.storeName)}</a>
      </td></tr>`,
      text: `${e.item.title}\n  ${each}, ${pct}% below ${money(e.item.baseline_price)} (target ${money(e.target)})\n  ${e.storeName}: "${e.deal.text}"\n  ${dealHowTo(e)}\n  ${e.listing.url}`,
    };
  });
  const sitewide = entries.find((e) => e.deal.kind === 'sitewide');
  const subject = sitewide
    ? `Sale alert: ${sitewide.deal.pct}% off everything at ${sitewide.storeName}${entries.length > 1 ? ` + ${entries.length - 1} more deal${entries.length > 2 ? 's' : ''}` : ''}`
    : `Deal alert: ${entries.length === 1 ? entries[0].item.title.slice(0, 50) : `${entries.length} items`} can beat your target`;

  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#1a1a1a">
    <h2 style="color:#0f766e;margin-bottom:4px">A deal can get ${entries.length === 1 ? 'an item' : `${entries.length} items`} below your target</h2>
    <p style="margin-top:0">The price itself hasn't dropped enough, but a current sale or bundle would.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%">${rows.map((r) => r.html).join('')}</table>
    <p style="color:#666;font-size:12px">Sales and bundles often exclude some brands or items, and bundle prices assume you buy the
      quantity shown. Check the deal at checkout before buying. <a href="${dashboard}">Manage your alerts</a></p>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Price Alert Emailer <onboarding@resend.dev>',
      to,
      subject,
      html,
      text: `A current sale or bundle can get these below your target:\n\n${rows.map((r) => r.text).join('\n\n')}\n\nExclusions may apply; bundle prices assume you buy the quantity shown. Check at checkout.\nManage alerts: ${dashboard}`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
