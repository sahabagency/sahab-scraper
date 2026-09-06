function esc(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function rowsFromAudit(audit = {}) {
  return (audit.opportunityBreakdown || []).slice(0, 5).map(item => {
    const annual = item.annualRange || {};
    const monthlyLow = Math.round(Number(annual.low || 0) / 12);
    const monthlyHigh = Math.round(Number(annual.high || 0) / 12);
    const evidence = (item.issues || []).slice(0, 2).join(' · ');
    return `
      <tr>
        <td style="padding:16px 0;border-top:1px solid #37342c;vertical-align:top">
          <div style="font-weight:700;color:#f8f5ea;font-size:16px">${esc(item.service || 'Growth leak')}</div>
          <div style="color:#a8a293;font-size:13px;line-height:1.5;margin-top:4px">${esc(evidence)}</div>
        </td>
        <td align="right" style="padding:16px 0;border-top:1px solid #37342c;vertical-align:top;white-space:nowrap">
          <div style="font-size:18px;font-weight:800;color:#ff6f6f">−${money(monthlyHigh)} SAR</div>
          <div style="color:#9c9688;font-size:12px">${money(monthlyLow)}–${money(monthlyHigh)} / mo est.</div>
        </td>
      </tr>`;
  }).join('');
}

export function buildXrayEmailHtml({ name, website, audit = {}, body = '', bookingUrl = '', unsubscribeUrl = '' }) {
  const monthly = audit.opportunity?.monthlyRange || { low: 0, high: 0 };
  const rows = rowsFromAudit(audit);
  const summary = String(body || '').split('\n').filter(Boolean).slice(0, 5).join('<br>');
  const safeSummary = summary ? summary.replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;') : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5ecd2;font-family:Arial,Tahoma,sans-serif;color:#171713">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5ecd2;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px">
        <tr><td style="padding:0 6px 14px;text-align:left;direction:ltr;color:#8f721f;font-size:12px;letter-spacing:4px;font-weight:700">SAHAB XRAY · GROWTH LEAK SCAN</td></tr>
        <tr><td style="background:#151410;border:1px solid #39352a;border-radius:22px;padding:28px;box-shadow:0 14px 40px rgba(73,55,11,.16)">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="color:#f8f5ea;font-size:23px;font-weight:800;text-align:left;direction:ltr">${esc(name || 'Business')}</td>
              <td align="right" style="color:#d9bd5a;font-size:12px;letter-spacing:2px">PUBLIC-DATA AUDIT</td>
            </tr>
            ${website ? `<tr><td colspan="2" style="padding-top:5px;color:#8f897b;font-size:12px;text-align:left;direction:ltr">${esc(website)}</td></tr>` : ''}
          </table>

          <div style="margin:24px 0 20px;padding:24px;border:1px solid #7b3f3f;border-radius:16px;text-align:center;background:#1b1915">
            <div style="font-size:12px;letter-spacing:3px;color:#9f9888">ESTIMATED MONTHLY REVENUE LEAK</div>
            <div style="font-size:42px;line-height:1.1;font-weight:800;color:#ff6f6f;margin:9px 0">${money(monthly.high)} SAR</div>
            <div style="font-size:13px;color:#aaa394">estimated range ${money(monthly.low)}–${money(monthly.high)} SAR / month · assumption-based estimate</div>
          </div>

          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${rows || `<tr><td style="padding:16px 0;color:#eee">No major public-data leak detected in this scan.</td></tr>`}
          </table>

          <div style="margin-top:22px;padding-top:20px;border-top:1px solid #37342c;color:#d7d1c4;font-size:14px;line-height:1.75;text-align:right;direction:rtl">${safeSummary}</div>

          ${bookingUrl ? `<div style="margin-top:24px;text-align:center"><a href="${esc(bookingUrl)}" style="display:inline-block;background:#d9bd5a;color:#161511;text-decoration:none;font-weight:800;padding:13px 22px;border-radius:12px">شوف المراجعة كاملة</a></div>` : ''}

          <div style="margin-top:22px;color:#8e887b;font-size:11px;line-height:1.6;text-align:center">Live scan · public data only · figures are estimates, not verified lost revenue</div>
        </td></tr>
        <tr><td style="padding:14px 8px 0;color:#877c61;font-size:12px;text-align:center">محمد · Sahab Agency${unsubscribeUrl ? ` · <a href="${esc(unsubscribeUrl)}" style="color:#877c61;text-decoration:underline">إيقاف الرسائل</a>` : ''}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
