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
