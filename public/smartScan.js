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
  const platformName = bi => typeof bi.platform === 'string' ? bi.platform : (bi.platform?.name || '');

  async function scan(payload) {
    const response = await fetch('/api/leads/audit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Scan failed');
    return data;
  }

  function chip(text) { return `<span style="display:inline-block;padding:5px 9px;border:1px solid #5a5136;border-radius:999px;margin:3px 4px 3px 0;font-size:12px;color:#d9c880">${esc(text)}</span>`; }
  function sourceLabel(value='') {
    const map = {
      observed_site_prices:'أسعار المنتجات المرصودة فعليًا من المتجر', observed_public_product_prices:'أسعار المنتجات المرصودة فعليًا من المتجر',
      bounded_review_activity_proxy:'نشاط عام محدود من التقييمات', public_purchase_counter_activity_envelope:'مؤشرات شراء عامة من صفحات المنتجات',
      business_model_prior:'سيناريو محافظ حسب نموذج النشاط', category_demand_envelope:'تقدير محافظ حسب نوع النشاط', public_activity_demand_envelope:'نشاط عام + بصمة المتجر',
      campaign_anchor:'قيمة مدخلة في الحملة', campaign_anchor_plus_public_activity:'قيمة حملة + نشاط عام', secondary_b2b_project_scenario:'سيناريو مستقل لمسار المشاريع B2B'
    };
    return map[value] || value || 'استدلال من بيانات المشروع العامة';
  }
  function tri(label, value) {
    const yes = value === true, unknown = value == null;
    const color = yes ? '#c7e4b5' : unknown ? '#e0c878' : '#d7a0a0';
    const symbol = yes ? '●' : unknown ? '◐' : '○';
    const suffix = yes ? 'مؤكد' : unknown ? 'غير محسوم' : 'غير مرصود';
    return `<span style="display:inline-block;margin:4px 10px 4px 0;font-size:12px;color:${color}">${symbol} ${esc(label)} · ${suffix}</span>`;
  }

  function render(data) {
    const lead = data.lead || {}, audit = data.audit || {}, bi = audit.businessIntelligence || {}, profile = audit.commercialProfile || {};
    const q = data.qualification || audit.qualification || {}, opportunity = audit.opportunity || {}, monthly = opportunity.monthlyRange || {low:0,high:0};
    const breakdown = audit.opportunityBreakdown || [], confidence = opportunity.confidence || bi.confidence || 0;
    const priceStats = bi.priceStats || profile.observedPriceStats || {}, categories = (bi.categories || []).slice(0,10), products = (bi.products || []).slice(0,10);
    const segments = (bi.targetSegments || bi.audiences || []).slice(0,8), values = (bi.valuePropositions || []).slice(0,8), funnel = bi.funnelSignals || {};
    const pageInv = bi.pageInventory || {}, catalog = bi.catalog || {}, pName = platformName(bi), baseline = opportunity.businessBaseline || {};
    const primary = opportunity.primaryRevenueMotion || bi.primaryRevenueMotion || (bi.commerce?.ecommerce ? 'Direct ecommerce' : '');
    const secondary = opportunity.secondaryRevenueMotions || bi.secondaryRevenueMotions || [];
    const unitLabel = profile.volumeUnit === 'orders' ? 'طلبات شراء' : 'فرص/Leads';
    const b2bScenario = profile.secondaryB2BScenario || null;

    const rows = breakdown.slice(0,6).map(item => {
      const hi = Math.round(Number(item.annualRange?.high || 0)/12), lo = Math.round(Number(item.annualRange?.low || 0)/12);
      const evidenceTag = item.evidenceClass === 'verified_gap' ? 'فجوة مثبتة' : 'فرصة نمو نمذجية';
      return `<div class="leak-row"><div><h3>${esc(item.service)}</h3><p>${esc((item.issues || []).join(' · '))}</p><p style="font-size:11px;color:#c9b76e">${esc(evidenceTag)} · ثقة ${money(item.confidence || 0)}%</p></div><div class="leak-value">${money(hi)}<small>${money(lo)}–${money(hi)} ريال / شهر تقديري</small></div></div>`;
    }).join('');

    const known = [
      pName ? `المنصة: ${/salla/i.test(pName)?'سلة':pName}` : null,
      bi.industry ? `النشاط: ${bi.industry}` : null,
      bi.businessModel ? `النموذج: ${bi.businessModel}` : null,
      primary ? `الإيراد الأساسي: ${primary}` : null,
      secondary.length ? `مسار ثانوي: ${secondary.join(' + ')}` : null,
      (catalog.productCount || pageInv.productLinks) ? `المنتجات: ${catalog.productCount || pageInv.productLinks}` : null,
      (catalog.categoryCount || pageInv.categoryLinks) ? `التصنيفات: ${catalog.categoryCount || pageInv.categoryLinks}` : null,
      priceStats.sampleCount ? `أسعار مرصودة: ${priceStats.sampleCount} عينة` : null,
      priceStats.median ? `وسيط السعر: ${ri(priceStats.median)}` : null,
      priceStats.min && priceStats.max ? `نطاق الأسعار: ${ri(priceStats.min)}–${ri(priceStats.max)}` : null
    ].filter(Boolean).map(chip).join('');

    const funnelRows = [
      ['سلة/شراء', funnel.cartDetected || funnel.checkoutDetected], ['مشاريع وشركات', funnel.b2bPageDetected || funnel.b2bSecondaryDetected || funnel.b2bDetected],
      ['طلب عرض سعر', funnel.quoteRequestDetected || funnel.b2bConversionDetected], ['واتساب', funnel.whatsappDetected], ['تقييمات', funnel.reviewsDetected], ['ولاء', funnel.loyaltyDetected], ['تقسيط', funnel.installmentDetected], ['توصيل', funnel.shippingDetected || funnel.freeDeliveryDetected]
    ].map(([label,yes]) => `<span style="display:inline-block;margin:4px 8px 4px 0;font-size:12px;color:${yes?'#c7e4b5':'#9d9789'}">${yes?'●':'○'} ${esc(label)}</span>`).join('');

    const stackRows = [tri('Analytics / GTM', audit.signals?.hasAnalytics), tri('Meta Pixel', audit.signals?.hasMetaPixel), tri('Instagram', audit.signals?.hasInstagram), tri('Facebook', audit.signals?.hasFacebook)].join('');
    const email = data.emailHtml ? `<details class="outreach-preview" open><summary>Exact email design that will be sent</summary><p><strong>${esc(data.outreach?.subject || '')}</strong></p><iframe title="Email preview" style="width:100%;height:760px;border:1px solid #3a362d;border-radius:16px;background:#fff" sandbox="" srcdoc="${esc(data.emailHtml)}"></iframe><details><summary>Plain-text fallback</summary><pre>${esc(data.outreach?.body || '')}</pre></details></details>` : '';

    const baselineHtml = baseline.monthlyCommerceScenarioRange ? `<p><strong>سيناريو التجارة المباشرة قبل التحسين:</strong> ${ri(baseline.monthlyCommerceScenarioRange.low)}–${ri(baseline.monthlyCommerceScenarioRange.high)} شهريًا · مبني على وسيط سعر مرصود ${ri(baseline.medianObservedTicket)} ونطاق ${money(baseline.modeledOrderRange?.low)}–${money(baseline.modeledOrderRange?.high)} طلب شراء شهريًا كنموذج وليس رقم مبيعات فعلي.</p>` : '';
    const upliftHtml = opportunity.combinedUpliftRange ? `<p><strong>نسبة التحسين المجمعة المستخدمة:</strong> ${money(opportunity.combinedUpliftRange.low)}%–${money(opportunity.combinedUpliftRange.high)}% بعد منع double-counting بين القنوات.</p>` : '';
    const b2bHtml = b2bScenario ? `<p><strong>مسار المشاريع B2B محسوب منفصلًا:</strong> قيمة فرصة نموذجية ${ri(b2bScenario.opportunityValueRange?.low)}–${ri(b2bScenario.opportunityValueRange?.high)} × ${money(b2bScenario.modeledMonthlyOpportunityCount?.low)}–${money(b2bScenario.modeledMonthlyOpportunityCount?.high)} فرص محتملة بالشهر · ثقة ${money(b2bScenario.confidence)}% · ليس هذا متوسط طلب المتجر ولا إيرادًا مؤكدًا.</p>` : '';

    result.innerHTML = `<div class="scan-result-card">
      <div class="business-line"><div><h2>${esc(bi.brandName || lead.name || nameFromUrl(lead.website || 'Business'))}</h2><div class="business-meta">${lead.website ? `<a href="${esc(lead.website)}" target="_blank" style="color:#d7bd68">${esc(lead.website)}</a>` : ''}${lead.contactRoute?.channel ? ` · best contact: ${esc(lead.contactRoute.channel)}` : ''}</div><div style="margin-top:8px">${q.tier ? chip(`${q.tier} · ${q.score}/100 · ${q.label || ''}`) : ''}</div></div><div class="confidence">estimate confidence<b>${money(confidence)}%</b></div></div>

      <div class="leak-row" style="display:block"><h3>Business intelligence from the URL</h3><p>التحليل يبدأ من المشروع نفسه قبل أي رقم: النشاط الحقيقي، المنصة، الكتالوج، الأسعار، مسار الشراء الأساسي، المسارات الثانوية، الشرائح، والـmarketing stack.</p><div>${known}</div><div style="margin-top:6px">${funnelRows}</div>${categories.length?`<p style="margin-top:10px"><strong>التصنيفات:</strong> ${esc(categories.join('، '))}</p>`:''}${products.length?`<p><strong>منتجات مرصودة:</strong> ${esc(products.join('، '))}</p>`:''}${segments.length?`<p><strong>شرائح العملاء:</strong> ${esc(segments.join('، '))}</p>`:''}${values.length?`<p><strong>عناصر القوة:</strong> ${esc(values.join('، '))}</p>`:''}<div style="margin-top:9px"><strong>Marketing stack:</strong> ${stackRows}</div></div>

      <div class="leak-box"><div class="label">ESTIMATED MONTHLY GROWTH OPPORTUNITY</div><div class="amount">${money(monthly.high)} <span style="font-size:.42em">ريال</span></div><div class="range">النطاق التقديري ${money(monthly.low)}–${money(monthly.high)} ريال / شهر · ليس خسارة محققة</div></div>

      <div class="leak-row" style="display:block"><h3>Commercial model built from this business</h3><p>قيمة الطلب المباشر ${ri(profile.averageTicketRange?.low)}–${ri(profile.averageTicketRange?.high)} · سيناريو الحجم الشهري ${money(profile.monthlyLeadRange?.low)}–${money(profile.monthlyLeadRange?.high)} ${esc(unitLabel)} · مصدر القيمة: ${esc(sourceLabel(profile.averageTicketSource || bi.averageTicketSource))} · مصدر الحجم: ${esc(sourceLabel(profile.monthlyLeadSource || bi.monthlyLeadSource))}</p>${baselineHtml}${b2bHtml}${upliftHtml}<p style="color:#9d9789">التجارة المباشرة هي الأساس إذا المتجر يبيع أونلاين. B2B لا يرفع متوسط طلب المتجر؛ يُنمذج كمسار مستقل. Pixel أو السوشيال لا يدخلان كفجوات إذا لم نقدر نثبت غيابهما.</p></div>
      ${rows || `<div class="leak-row"><div><h3>لا توجد فرصة مالية مدعومة بما يكفي في العينة الحالية</h3><p>يظل تحليل النشاط والمنتجات والأسعار ظاهرًا، لكن ما نرفع رقمًا بدون lever قابل للدفاع عنه.</p></div></div>`}
      ${email}
    </div>`;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const website = normalizeUrl(form.website.value), button = form.querySelector('button'); button.disabled = true; result.innerHTML = '';
    status.textContent = 'أحلل المشروع من الرابط: النشاط، المنصة، المنتجات، الأسعار، مسار الإيراد الأساسي والثانوي، العملاء، والـmarketing stack ثم أبني التقدير…';
    try { const data = await scan({ lead:{ name:nameFromUrl(website), website }, assumptions:{} }); render(data); status.textContent = 'Live scan complete · business inferred directly from URL · public data only · figures are estimates'; }
    catch (error) { status.textContent = `Scan error: ${error.message}`; }
    finally { button.disabled = false; }
  }, true);
})();
