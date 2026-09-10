function esc(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(value) { return Number(value || 0).toLocaleString('en-US'); }

function rowsFromAudit(audit = {}, showMoney = false, language = 'ar') {
  const english = language === 'en';
  return (audit.opportunityBreakdown || []).slice(0, 5).map(item => {
    const annual = item.annualRange || {};
    const monthlyLow = Math.round(Number(annual.low || 0) / 12);
    const monthlyHigh = Math.round(Number(annual.high || 0) / 12);
    const evidence = english ? (item.problemEn || item.issues || []).toString() : (item.issues || []).slice(0, 2).join(' · ');
    const evidenceLabel = item.evidenceClass === 'verified_gap' ? (english ? 'Verified finding' : 'فجوة مثبتة') : (english ? 'Modeled growth opportunity' : 'فرصة نمو نمذجية');
    return `
      <tr>
        <td style="padding:16px 0;border-top:1px solid #37342c;vertical-align:top">
          <div style="font-weight:700;color:#f8f5ea;font-size:16px">${esc(item.service || 'Growth opportunity')}</div>
          <div style="color:#a8a293;font-size:13px;line-height:1.5;margin-top:4px">${esc(evidence)}</div>
          <div style="color:#cdbb72;font-size:11px;margin-top:5px">${esc(evidenceLabel)}${item.confidence ? ` · ثقة ${money(item.confidence)}%` : ''}</div>
        </td>
        <td align="right" style="padding:16px 0;border-top:1px solid #37342c;vertical-align:top;white-space:nowrap">
          ${showMoney
            ? `<div style="font-size:18px;font-weight:800;color:#ff6f6f">${money(monthlyHigh)} ريال</div><div style="color:#9c9688;font-size:12px">${money(monthlyLow)}–${money(monthlyHigh)} ريال / شهر تقديري</div>`
            : `<div style="font-size:15px;font-weight:800;color:#d9bd5a">PUBLIC EVIDENCE</div><div style="color:#9c9688;font-size:12px">بدون ادعاء مالي غير موثوق</div>`}
        </td>
      </tr>`;
  }).join('');
}

export function buildXrayEmailHtml({ name, website, audit = {}, body = '', bookingUrl = '', unsubscribeUrl = '', language = 'ar' }) {
  const english = language === 'en';
  const opportunity = audit.opportunity || {};
  const monthly = opportunity.monthlyRange || { low: 0, high: 0 };
  const showMoney = opportunity.displayEligible === true;
  const rows = rowsFromAudit(audit, showMoney, language);
  const summary = String(body || '').split('\n').filter(Boolean).slice(0, 6).join('<br>');
  const safeSummary = summary ? summary.replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;') : '';
  const baseline = opportunity.businessBaseline?.monthlyCommerceScenarioRange;
  const uplift = opportunity.combinedUpliftRange;

  return `<!doctype html>
<html lang="${english ? 'en' : 'ar'}" dir="${english ? 'ltr' : 'rtl'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5ecd2;font-family:Arial,Tahoma,sans-serif;color:#171713">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5ecd2;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px">
        <tr><td style="padding:0 6px 14px;text-align:left;direction:ltr;color:#8f721f;font-size:12px;letter-spacing:4px;font-weight:700">SAHAB XRAY · GROWTH SCAN</td></tr>
        <tr><td style="background:#151410;border:1px solid #39352a;border-radius:22px;padding:28px;box-shadow:0 14px 40px rgba(73,55,11,.16)">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr><td style="color:#f8f5ea;font-size:23px;font-weight:800;text-align:left;direction:ltr">${esc(name || 'Business')}</td><td align="right" style="color:#d9bd5a;font-size:12px;letter-spacing:2px">PUBLIC-DATA AUDIT</td></tr>
            ${website ? `<tr><td colspan="2" style="padding-top:5px;color:#8f897b;font-size:12px;text-align:left;direction:ltr">${esc(website)}</td></tr>` : ''}
          </table>

          ${showMoney ? `
          <div style="margin:24px 0 20px;padding:24px;border:1px solid #7b3f3f;border-radius:16px;text-align:center;background:#1b1915">
            <div style="font-size:12px;letter-spacing:3px;color:#9f9888">ESTIMATED MONTHLY GROWTH OPPORTUNITY</div>
            <div style="font-size:42px;line-height:1.1;font-weight:800;color:#ff6f6f;margin:9px 0">${money(monthly.high)} ريال</div>
            <div style="font-size:13px;color:#aaa394">${english ? 'Modeled range ' : 'نطاق تقديري '}${money(monthly.low)}–${money(monthly.high)} ريال / شهر · ${english ? 'growth opportunity, not verified loss' : 'فرصة نمو وليست خسارة محققة'}</div>
            ${baseline ? `<div style="font-size:11px;color:#7f796d;margin-top:8px">سيناريو قيمة النشاط الشهري المستخدم: ${money(baseline.low)}–${money(baseline.high)} ريال${uplift ? ` · تحسين مجمع ${money(uplift.low)}%–${money(uplift.high)}%` : ''}</div>` : ''}
          </div>` : `
          <div style="margin:24px 0 20px;padding:24px;border:1px solid #6a5d31;border-radius:16px;text-align:center;background:#1b1915">
            <div style="font-size:12px;letter-spacing:3px;color:#9f9888">COMMERCIAL ESTIMATE WITHHELD</div>
            <div style="font-size:26px;line-height:1.25;font-weight:800;color:#d9bd5a;margin:9px 0">${english ? 'Only verified findings are included' : 'نشارك الفجوات المؤكدة فقط'}</div>
            <div style="font-size:13px;color:#aaa394">${english ? 'The public evidence is not strong enough to defend a financial estimate.' : 'ما عندنا سياق تجاري كافي لنضع رقمًا بالريال بشكل مهني، لذلك حجبنا التقدير المالي.'}</div>
          </div>`}

          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows || `<tr><td style="padding:16px 0;color:#eee">لم يظهر Gap مؤكد أو lever تجاري مدعوم بما يكفي من البيانات العامة الحالية.</td></tr>`}</table>
          <div style="margin-top:22px;padding-top:20px;border-top:1px solid #37342c;color:#d7d1c4;font-size:14px;line-height:1.75;text-align:right;direction:rtl">${safeSummary}</div>
          ${bookingUrl ? `<div style="margin-top:24px;text-align:center"><a href="${esc(bookingUrl)}" style="display:inline-block;background:#d9bd5a;color:#161511;text-decoration:none;font-weight:800;padding:13px 22px;border-radius:12px">${english ? 'Review the full audit' : 'شوف المراجعة كاملة'}</a></div>` : ''}
          <div style="margin-top:22px;color:#8e887b;font-size:11px;line-height:1.6;text-align:center">${english ? 'Public data only · tracking capabilities are marked missing only when positively disproven' : 'Public data only · existing ecommerce/social/tracking capabilities are not counted as missing unless positively verified otherwise'}</div>
        </td></tr>
        <tr><td style="padding:14px 8px 0;color:#877c61;font-size:12px;text-align:center">محمد · Sahab Agency${unsubscribeUrl ? ` · <a href="${esc(unsubscribeUrl)}" style="color:#877c61;text-decoration:underline">${english ? 'Unsubscribe' : 'إيقاف الرسائل'}</a>` : ''}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
