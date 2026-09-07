(() => {
  const form = document.querySelector('#scan-form');
  const status = document.querySelector('#scan-status');
  const result = document.querySelector('#scan-result');
  if (!form || !status || !result) return;

  const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => Number(n || 0).toLocaleString('en-US');
  const normalizeUrl = value => /^https?:\/\//i.test(String(value || '').trim()) ? String(value).trim() : `https://${String(value || '').trim()}`;
  const nameFromUrl = value => { try { return new URL(normalizeUrl(value)).hostname.replace(/^www\./,'').split('.')[0].replace(/[-_]+/g,' '); } catch { return value; } };
  const ri = n => `${money(n)} ريال`;

  async function scan(payload) {
    const response = await fetch('/api/leads/audit', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Scan failed');
    return data;
  }

  function chip(text) { return `<span style="display:inline-block;padding:5px 9px;border:1px solid #5a5136;border-radius:999px;margin:3px 4px 3px 0;font-size:12px;color:#d9c880">${esc(text)}</span>`; }
  function sourceLabel(value='') {
    const map = {
      observed_site_prices:'أسعار المنتجات المرصودة من المتجر',
      observed_public_product_prices:'أسعار المنتجات المرصودة من المتجر',
      bounded_review_activity_proxy:'نشاط عام محدود من التقييمات',
      public_purchase_counter_activity_envelope:'مؤشرات شراء عامة من صفحات المنتجات',
      business_model_prior:'تقدير محافظ حسب نموذج النشاط',
      category_demand_envelope:'تقدير محافظ حسب نوع النشاط',
      public_activity_demand_envelope:'نشاط عام + بصمة المتجر',
      campaign_anchor:'قيمة مدخلة في الحملة',
      campaign_anchor_plus_public_activity:'قيمة حملة + نشاط عام'
    };
    return map[value] || value || 'استدلال من بيانات المشروع العامة';
  }
  function tri(label, value) {
    const yes = value === true;
    const unknown = value == null;
    const color = yes ? '#c7e4b5' : unknown ? '#e0c878' : '#d7a0a0';
    const symbol = yes ? '●' : unknown ? '◐' : '○';
    const suffix = yes ? 'مؤكد' : unknown ? 'غير محسوم' : 'غير مرصود';
    return `<span style="display:inline-block;margin:4px 10px 4px 0;font-size:12px;color:${color}">${symbol} ${esc(label)} · ${suffix}</span>`;
  }

  function render(data) {
    const lead = data.lead || {};
    const audit = data.audit || {};
    const bi = audit.businessIntelligence || {};
    const profile = audit.commercialProfile || {};
    const q = data.qualification || audit.qualification || {};
    const opportunity = audit.opportunity || {};
    const monthly = opportunity.monthlyRange || {low:0,high:0};
    const breakdown = audit.opportunityBreakdown || [];
    const confidence = opportunity.confidence || bi.confidence || 0;
    const currencyLabel = (opportunity.currency || bi.currency) === 'SAR' ? 'ريال' : (opportunity.currency || bi.currency || 'ريال');
    const priceStats = bi.priceStats || profile.observedPriceStats || {};
    const categories = (bi.categories || []).slice(0,10);
    const products = (bi.products || []).slice(0,10);
    const segments = (bi.targetSegments || []).slice(0,8);
    const values = (bi.valuePropositions || []).slice(0,8);
    const funnel = bi.funnelSignals || {};
    const pageInv = bi.pageInventory || {};
    const monthlyTitle = opportunity.opportunityType === 'growth_headroom' ? 'MODELED MONTHLY GROWTH OPPORTUNITY' : 'ESTIMATED MONTHLY REVENUE OPPORTUNITY';

    const rows = breakdown.slice(0,6).map(item => {
      const hi = Math.round(Number(item.annualRange?.high || 0)/12);
      const lo = Math.round(Number(item.annualRange?.low || 0)/12);
      const sign = item.modeled ? '' : '−';
      return `<div class="leak-row"><div><h3>${esc(item.service)}</h3><p>${esc((item.issues || []).join(' · '))}</p></div><div class="leak-value">${sign}${money(hi)}<small>${money(lo)}–${money(hi)} ريال / شهر تقديري${item.modeled?' · modeled lever':''}</small></div></div>`;
    }).join('');

    const known = [
      bi.platform ? `المنصة: ${bi.platform === 'salla' ? 'سلة' : bi.platform}` : null,
      bi.industry ? `النشاط: ${bi.industry}` : null,
      bi.businessModel ? `النموذج: ${bi.businessModel}` : null,
      bi.primaryRevenueMotion ? `مسار الإيراد: ${bi.primaryRevenueMotion}` : null,
      pageInv.productLinks ? `روابط منتجات: ${pageInv.productLinks}` : null,
      pageInv.categoryLinks ? `تصنيفات: ${pageInv.categoryLinks}` : null,
      priceStats.sampleCount ? `أسعار مرصودة: ${priceStats.sampleCount} عينة` : null,
      priceStats.median ? `وسيط السعر: ${ri(priceStats.median)}` : null,
      priceStats.min && priceStats.max ? `نطاق الأسعار: ${ri(priceStats.min)}–${ri(priceStats.max)}` : null
    ].filter(Boolean).map(chip).join('');

    const funnelRows = [
      ['سلة/شراء', funnel.cartDetected || funnel.checkoutDetected],
      ['مشاريع وشركات', funnel.b2bPageDetected || funnel.b2bSecondaryDetected || funnel.b2bDetected],
      ['طلب عرض سعر', funnel.quoteRequestDetected || funnel.b2bConversionDetected],
      ['واتساب', funnel.whatsappDetected],
      ['تقييمات', funnel.reviewsDetected],
      ['ولاء', funnel.loyaltyDetected],
      ['تقسيط', funnel.installmentDetected],
      ['توصيل مجاني', funnel.freeDeliveryDetected]
    ].map(([label,yes]) => `<span style="display:inline-block;margin:4px 8px 4px 0;font-size:12px;color:${yes?'#c7e4b5':'#9d9789'}">${yes?'●':'○'} ${esc(label)}</span>`).join('');

    const stackRows = [
      tri('Analytics / GTM', audit.signals?.hasAnalytics),
      tri('Meta Pixel', audit.signals?.hasMetaPixel),
      tri('Instagram', audit.signals?.hasInstagram),
      tri('Facebook', audit.signals?.hasFacebook)
    ].join('');

    const email = data.emailHtml ? `<details class="outreach-preview" open><summary>Exact email design that will be sent</summary><p><strong>${esc(data.outreach?.subject || '')}</strong></p><iframe title="Email preview" style="width:100%;height:760px;border:1px solid #3a362d;border-radius:16px;background:#fff" sandbox="" srcdoc="${esc(data.emailHtml)}"></iframe><details><summary>Plain-text fallback</summary><pre>${esc(data.outreach?.body || '')}</pre></details></details>` : '';

    result.innerHTML = `<div class="scan-result-card">
      <div class="business-line"><div><h2>${esc(bi.brandName || lead.name || nameFromUrl(lead.website || 'Business'))}</h2><div class="business-meta">${lead.website ? `<a href="${esc(lead.website)}" target="_blank" style="color:#d7bd68">${esc(lead.website)}</a>` : ''}${lead.contactRoute?.channel ? ` · best contact: ${esc(lead.contactRoute.channel)}` : ''}</div><div style="margin-top:8px">${q.tier ? chip(`${q.tier} · ${q.score}/100 · ${q.label || ''}`) : ''}</div></div><div class="confidence">estimate confidence<b>${money(confidence)}%</b></div></div>

      <div class="leak-row" style="display:block"><h3>Business intelligence from the URL</h3><p>التحليل يبدأ من المشروع نفسه: المنصة، نوع النشاط، المنتجات، الأسعار، الشرائح، مسارات B2C/B2B، ومسار الشراء قبل أي رقم مالي.</p><div>${known}</div><div style="margin-top:6px">${funnelRows}</div>${categories.length?`<p style="margin-top:10px"><strong>التصنيفات:</strong> ${esc(categories.join('، '))}</p>`:''}${products.length?`<p><strong>منتجات مرصودة:</strong> ${esc(products.join('، '))}</p>`:''}${segments.length?`<p><strong>شرائح العملاء:</strong> ${esc(segments.join('، '))}</p>`:''}${values.length?`<p><strong>عناصر القوة:</strong> ${esc(values.join('، '))}</p>`:''}<div style="margin-top:9px"><strong>Marketing stack:</strong> ${stackRows}</div></div>

      <div class="leak-box"><div class="label">${monthlyTitle}</div><div class="amount">${money(monthly.high)} <span style="font-size:.42em">${esc(currencyLabel)}</span></div><div class="range">النطاق التقديري ${money(monthly.low)}–${money(monthly.high)} ${esc(currencyLabel)} / شهر · ${esc(opportunity.method || '')}</div></div>

      <div class="leak-row"><div><h3>Commercial model built from this business</h3><p>متوسط قيمة الطلب/الفرصة ${money(profile.averageTicketRange?.low)}–${money(profile.averageTicketRange?.high)} ريال · الطلب/الفرص الشهرية المقدر ${money(profile.monthlyLeadRange?.low)}–${money(profile.monthlyLeadRange?.high)} · مصدر قيمة الطلب: ${esc(sourceLabel(profile.averageTicketSource || bi.averageTicketSource))} · مصدر الطلب: ${esc(sourceLabel(profile.monthlyLeadSource || bi.monthlyLeadSource))}</p></div><div class="leak-value">${money(profile.confidence || 0)}%<small>ثقة النموذج التجاري</small></div></div>
      ${rows || `<div class="leak-row"><div><h3>النظام لم يثبت فجوة تحويل مباشرة، لكنه يبني فرصة النمو من هيكل النشاط نفسه</h3><p>أي Pixel أو منصة اجتماعية لا يمكن إثبات غيابها تبقى «غير محسومة» ولا تتحول إلى فجوة. أما النموذج المالي فيعتمد على المنتجات والأسعار ومسارات البيع والشرائح العامة للنشاط.</p></div></div>`}
      ${email}
    </div>`;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const website = normalizeUrl(form.website.value);
    const button = form.querySelector('button');
    button.disabled = true;
    result.innerHTML = '';
    status.textContent = 'أحلل المشروع من الرابط: النشاط، المنصة، المنتجات، الأسعار، العملاء، مسارات البيع والـmarketing stack ثم أبني التقدير…';
    try {
      // Single source of truth: one URL-driven audit. The backend infers the commercial context itself.
      const data = await scan({ lead:{ name:nameFromUrl(website), website }, assumptions:{} });
      render(data);
      status.textContent = 'Live scan complete · business inferred directly from URL · public data only · figures are estimates';
    } catch (error) {
      status.textContent = `Scan error: ${error.message}`;
    } finally { button.disabled = false; }
  }, true);
})();
