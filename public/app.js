const form = document.querySelector('#campaign-form');
const results = document.querySelector('#results');
const statusEl = document.querySelector('#run-status');
const countEl = document.querySelector('#count');
const configEl = document.querySelector('#config');
const scanForm = document.querySelector('#scan-form');
const scanStatus = document.querySelector('#scan-status');
const scanResult = document.querySelector('#scan-result');

function esc(value = '') { return String(value).replace(/[&<>'\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[c])); }
function money(n) { return Number(n || 0).toLocaleString('en-US'); }
function normalizeUrl(value='') { const trimmed = value.trim(); if (!trimmed) return ''; return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`; }
function nameFromUrl(value='') { try { return new URL(normalizeUrl(value)).hostname.replace(/^www\./,'').split('.')[0].replace(/[-_]+/g,' '); } catch { return value; } }
function qualificationBadge(q = {}) { const tier = q.tier || '—'; const label = q.label || 'Not qualified yet'; return `<span style="display:inline-flex;align-items:center;gap:8px;border:1px solid #d8c47e;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800">${esc(tier)} · ${esc(q.score ?? '—')}/100 · ${esc(label)}</span>`; }

function trackerStackHtml(bi = {}) {
  const trackers = bi.funnelSignals?.trackers || bi.marketingStack?.trackers || {};
  const labels = {googleTagManager:'Google Tag Manager',googleAnalytics:'Google Analytics',metaPixel:'Meta Pixel',tiktokPixel:'TikTok Pixel',snapchatPixel:'Snapchat Pixel',googleAds:'Google Ads'};
  return Object.entries(labels).map(([key,label]) => {
    const item = trackers[key] || {};
    const verified = item.state === 'verified';
    const color = verified ? '#c7e4b5' : '#e0c878';
    const state = verified ? 'مؤكد من كود الموقع' : 'لم يظهر علنًا — لا يعني أنه غير موجود';
    const evidence = (item.evidence || []).slice(0,2).join(' · ');
    return `<span style="display:inline-block;margin:3px 8px 3px 0;color:${color}" title="${esc(evidence || item.reason || state)}">${verified?'●':'◐'} ${label} · ${state}${evidence ? `<small style="display:block;color:#a89d78;margin-left:14px">${esc(evidence)}</small>` : ''}</span>`;
  }).join('');
}

async function loadConfig() {
  const config = await fetch('/api/config', { cache: 'no-store' }).then(r => r.json());
  const ready = [['Places', config.googlePlacesReady],['OpenAI', config.openAiReady],['Web', config.webDiscoveryReady],['Booking', config.bookingUrlReady],['DB', config.persistenceReady && !config.persistenceStats?.error]];
  const statusHtml = ready.map(([name, ok]) => `<span class="${ok ? 'ready' : ''}">${esc(name)} ${ok ? '●' : '○'}</span>`).join('');
  let gmailHtml = config.gmailOauthReady ? '<a href="/auth/google" style="display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border:1px solid #d7bd68;border-radius:999px;color:#f2d66d;text-decoration:none;font-weight:700">Connect Google ↗</a>' : '<span>Gmail ○</span>';
  let calendarHtml = '<span>Calendar ○</span>';
  if (config.gmailConnected) {
    try {
      const [gmailResponse, calendarResponse] = await Promise.all([fetch('/api/gmail/verify', { cache: 'no-store' }),fetch('/api/calendar/verify', { cache: 'no-store' })]);
      const gmail = await gmailResponse.json(); const calendar = await calendarResponse.json();
      gmailHtml = gmail.ok ? `<span class="ready" title="${esc(gmail.emailAddress || '')}">Gmail ●</span>` : '<span title="OAuth token needs attention">Gmail !</span>';
      calendarHtml = calendar.ok ? '<span class="ready">Calendar ●</span>' : '<span title="Calendar permission needs attention">Calendar !</span>';
    } catch { gmailHtml = '<span>Gmail ?</span>'; calendarHtml = '<span>Calendar ?</span>'; }
  }
  const outbound = config.outbound || {};
  const outboundHtml = outbound.enabled ? `<span class="ready" title="Daily limit ${esc(outbound.dailyLimit || 0)} · review ${outbound.requireReview ? 'required' : 'off'}">Send ●</span>` : '<span title="Sending is intentionally locked until the first batch is explicitly approved">Send 🔒</span>';
  configEl.innerHTML = `${statusHtml}${gmailHtml}${calendarHtml}${outboundHtml}`;
  if (config.bookingUrl && form && !form.bookingUrl.value) form.bookingUrl.value = config.bookingUrl;
}

function businessIntelBox(bi = {}) {
  const cats = (bi.categories || []).slice(0, 6).join(' · ');
  const products = (bi.products || []).slice(0, 6).join(' · ');
  const segments = (bi.targetSegments || []).slice(0, 5).join(' · ');
  const props = (bi.valuePropositions || []).slice(0, 5).join(' · ');
  const prices = (bi.priceSamples || []).slice(0, 8).map(x => `${money(x)} ريال`).join(' · ');
  const f = bi.funnelSignals || {};
  const funnel = [f.cartDetected?'سلة شراء':null,f.checkoutDetected?'Checkout':null,f.b2bSecondaryDetected||f.b2bDetected?'B2B/مشاريع':null,f.quoteRequestDetected?'طلب عرض سعر':null,f.whatsappDetected?'WhatsApp':null,f.reviewsDetected?'Reviews':null,f.blogDetected?'Content/Blog':null].filter(Boolean).join(' · ');
  return `<div class="leak-row"><div><h3>فهم المشروع من الرابط</h3><p><strong>${esc(bi.brandName || '')}</strong>${bi.brandName?' · ':''}<strong>${esc(bi.industry || 'غير محسوم')}</strong> · ${esc(bi.businessModel || '')}${bi.platform ? ` · منصة ${esc(bi.platform)}` : ''}${bi.currency ? ` · العملة ${esc(bi.currency)}` : ''}</p>${products ? `<p><strong>المنتجات:</strong> ${esc(products)}</p>` : ''}${cats ? `<p><strong>الأقسام:</strong> ${esc(cats)}</p>` : ''}${segments ? `<p><strong>العملاء المستهدفون:</strong> ${esc(segments)}</p>` : ''}${props ? `<p><strong>القيمة/التموضع:</strong> ${esc(props)}</p>` : ''}${funnel ? `<p><strong>مسار البيع المرصود:</strong> ${esc(funnel)}</p>` : ''}${prices ? `<p><strong>عينات أسعار عامة:</strong> ${esc(prices)}</p>` : ''}<p><strong>مصدر متوسط القيمة:</strong> ${esc(bi.averageTicketSource || 'غير محدد')} · <strong>مصدر حجم الطلب:</strong> ${esc(bi.monthlyLeadSource || 'غير محدد')}</p><p><strong>Marketing stack / التتبع المرصود:</strong><br>${trackerStackHtml(bi)}</p></div><div class="leak-value">${money(bi.confidence || 0)}%<small>business-context confidence</small></div></div>`;
}

function renderLiveScan(data) {
  const lead = data.lead || {}; const audit = data.audit || {}; const q = data.qualification || audit.qualification || {}; const profile = audit.commercialProfile || {}; const bi = audit.businessIntelligence || {}; const opportunity = audit.opportunity || {}; const monthly = opportunity.monthlyRange || { low: 0, high: 0 }; const annualBreakdown = audit.opportunityBreakdown || []; const route = lead.contactRoute || {}; const confidence = opportunity.confidence ?? route.confidence ?? (lead.contactEmail ? 95 : 70); const showMoney = opportunity.displayEligible === true; const siteEvidence = Boolean(bi.industry && !/^(unknown|general business)$/i.test(String(bi.industry)) && (bi.platform || (bi.products || []).length || (bi.categories || []).length || (bi.priceStats?.sampleCount || 0)));
  const rows = annualBreakdown.slice(0, 6).map(item => {
    const high = Math.round((item.annualRange?.high || 0) / 12); const low = Math.round((item.annualRange?.low || 0) / 12);
    return `<div class="leak-row"><div><h3>${esc(item.service)}</h3><p>${esc((item.issues || []).join(' · '))}</p></div><div class="leak-value">${showMoney ? `−${money(high)} ريال<small>${money(low)}–${money(high)} ريال / شهر تقديري</small>` : '<span style="color:#d7bd68">Verified finding</span><small>no defensible revenue amount assigned</small>'}</div></div>`;
  }).join('');
  const nonMonetized = (audit.issues || []).filter(i => i.monetizable === false).slice(0,6).map(i=>`<li><strong>${esc(i.title)}</strong> — ${esc(i.detail || '')}</li>`).join('');
  const unknowns = (audit.unknowns || []).filter(x => !/^(hasAnalytics|hasMetaPixel|hasTikTokPixel|hasSnapchatPixel|hasGoogleAds|hasGTM)$/.test(x.signalKey || '')).slice(0, 6).map(x => `<li><strong>${esc(x.label || x.signalKey)}</strong> — غير محسوم من الفحص العام؛ لا نعتبره مفقودًا.</li>`).join('');
  const moneyBox = showMoney
    ? `<div class="leak-box"><div class="label">ESTIMATED MONTHLY OPPORTUNITY</div><div class="amount">${money(monthly.high)} ريال</div><div class="range">نطاق تقديري ${money(monthly.low)} – ${money(monthly.high)} ريال / شهر · ${esc(opportunity.method || '')}</div></div>`
    : `<div class="leak-box"><div class="label">COMMERCIAL OPPORTUNITY STATUS</div><div class="amount" style="font-size:28px;color:#d7bd68">لا يوجد رقم مالي موثوق كفاية بعد</div><div class="range">${esc(opportunity.withheldReason || 'النظام فهم المشروع، لكن لن يربط أي ملاحظة برقم ريال إلا إذا كان تأثيرها التجاري قابلًا للدفاع عنه.')}</div></div>`;
  const profileBox = siteEvidence ? `<div class="leak-row"><div><h3>Commercial model</h3><p>متوسط قيمة modeled ${money(profile.averageTicketRange?.low)}–${money(profile.averageTicketRange?.high)} ريال · طلب/lead شهري modeled ${money(profile.monthlyLeadRange?.low)}–${money(profile.monthlyLeadRange?.high)} · ليست بيانات داخلية</p></div><div class="leak-value">${money(profile.confidence || 0)}%<small>commercial-model confidence</small></div></div>` : `<div class="leak-row"><div><h3>Public evidence could not verify this business</h3><p>لم يقدم النطاق دليلًا عامًا كافيًا يثبت النشاط أو المنتجات أو الأسعار. لا يتم عرض أي نموذج تجاري أو حجم عملاء أو تقدير نمو.</p></div></div>`;
  const emailPreview = data.emailHtml ? `<details class="outreach-preview" open><summary>Exact email design that will be sent</summary><p><strong>${esc(data.outreach?.subject || '')}</strong></p><iframe title="Email preview" style="width:100%;height:760px;border:1px solid #3a362d;border-radius:16px;background:#fff" sandbox="" srcdoc="${esc(data.emailHtml)}"></iframe><details><summary>Plain-text fallback</summary><pre>${esc(data.outreach?.body || '')}</pre></details></details>` : `<details class="outreach-preview"><summary>Exact outreach email preview</summary><p><strong>${esc(data.outreach?.subject || '')}</strong></p><pre>${esc(data.outreach?.body || '')}</pre></details>`;

  scanResult.innerHTML = `<div class="scan-result-card">
    <div class="business-line"><div><h2>${esc(lead.name || bi.brandName || nameFromUrl(lead.website || 'Business'))}</h2><div class="business-meta">${lead.website ? `<a href="${esc(lead.website)}" target="_blank" style="color:#d7bd68">${esc(lead.website)}</a>` : 'public business scan'}${route.channel ? ` · best contact: ${esc(route.channel)}` : ''}</div><div style="margin-top:10px">${qualificationBadge(q)}</div></div><div class="confidence">estimate confidence<b>${money(confidence)}%</b></div></div>
    ${businessIntelBox(bi)}${moneyBox}${profileBox}
    ${rows || '<div class="leak-row"><div><h3>No defensible monetizable gap detected</h3><p>الموقع قد يحتوي ملاحظات تحسين، لكن لا يوجد حاليًا Gap يمكن ربطه بمبلغ مالي بشكل مسؤول.</p></div><div class="leak-value">—<small>no invented loss figure</small></div></div>'}
    ${nonMonetized ? `<div class="leak-row"><div><h3>ملاحظات مؤكدة لا نحولها إلى خسارة مالية مباشرة</h3><ul style="margin:8px 0 0;padding-inline-start:20px">${nonMonetized}</ul></div><div class="leak-value">INFO<small>kept in analysis</small></div></div>` : ''}
    ${unknowns ? `<div class="leak-row"><div><h3>Integrations — غير محسوم، مو مفقود</h3><ul style="margin:8px 0 0;padding-inline-start:20px">${unknowns}</ul></div><div class="leak-value">NEUTRAL<small>excluded from opportunity model</small></div></div>` : ''}
    ${emailPreview}
  </div>`;
}

scanForm.addEventListener('submit', async event => {
  event.preventDefault(); const website = normalizeUrl(scanForm.website.value);
  scanStatus.textContent = 'Understanding the business, products, platform, pricing, customer segments, funnel, contacts and observable integrations…'; scanForm.querySelector('button').disabled = true; scanResult.innerHTML = '';
  try {
    const response = await fetch('/api/leads/audit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ lead: { name: nameFromUrl(website), website } }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Scan failed'); renderLiveScan(data); scanStatus.textContent = 'Business intelligence scan complete · public data only · figures are modeled estimates';
  } catch (error) { scanStatus.textContent = `Scan error: ${error.message}`; }
  finally { scanForm.querySelector('button').disabled = false; }
});

function renderCampaign(campaign) {
  const leads = campaign.leads || []; const summary = campaign.qualificationSummary || {};
  countEl.textContent = `${leads.length} leads · A ${summary.A || 0} · B ${summary.B || 0} · C ${summary.C || 0} · Reject ${summary.REJECT || 0}`;
  if (!leads.length) { results.className='results empty'; results.textContent='No leads found.'; return; }
  results.className='results';
  const persistenceNotice = campaign.persistence === 'memory_only' ? '<p class="fine" style="color:#d9a441">Results are available for review, but permanent saving is temporarily unavailable. Sending stays locked until database storage is restored.</p>' : '';
  results.innerHTML = persistenceNotice + leads.map((lead,index)=>{
    const audit=lead.audit||{}; const bi=audit.businessIntelligence||{}; const annual=audit.opportunity?.annualRange||{low:0,high:0}; const showMoney = audit.opportunity?.displayEligible === true; const q = lead.qualification || audit.qualification || {}; const profile = audit.commercialProfile || {};
    const issues=(audit.issues||[]).slice(0,5).map(i=>`<li><strong>${esc(i.severity)}</strong> — ${esc(i.title)}${i.monetizable===false?' · informational only':''}</li>`).join('');
    const breakdown=(audit.opportunityBreakdown||[]).slice(0,6).map(item=>`<tr><td>${esc(item.service)}</td><td>${showMoney ? `${money(item.annualRange?.low)}–${money(item.annualRange?.high)} ريال` : 'confidence gate'}</td><td>${esc((item.issues||[]).slice(0,2).join(', '))}</td></tr>`).join('');
    const route=lead.contactRoute||{}; const destination=route.destination||lead.contactEmail||lead.phone||'Research required'; const scoreHtml = audit.score === null || audit.score === undefined ? '<span>N/A</span>' : `<span>${esc(audit.score)}</span>/100`; const estimateConfidence = audit.opportunity?.confidence ?? '—'; const qReasons = (q.reasons || []).slice(0,3).map(r=>`<li>${esc(r)}</li>`).join(''); const qWarnings = (q.warnings || []).slice(0,3).map(r=>`<li>${esc(r)}</li>`).join('');
    return `<article class="lead-card"><div class="lead-top"><div><div class="kicker">#${index+1} · ${esc(lead.address||'')} · ${esc(lead.status||'')}</div><h3>${esc(lead.name || bi.brandName || '')}</h3><div style="margin:7px 0 9px">${qualificationBadge(q)}</div><div class="meta">${lead.rating?`★ ${esc(lead.rating)} (${esc(lead.reviewCount)})`:'No rating data'} · ${lead.website?`<a href="${esc(lead.website)}" target="_blank">website</a>`:'no verified website'}</div><div class="meta"><strong>Business:</strong> ${esc(bi.industry||'')} ${bi.platform?`· ${esc(bi.platform)}`:''}</div><div class="meta"><strong>Best contact:</strong> ${esc(route.channel||(lead.contactEmail?'email':'research_required'))} · ${esc(destination)}</div></div><div class="score">${scoreHtml}</div></div><div class="columns"><div><h4>Estimated opportunity</h4><p class="opportunity"><strong>${showMoney ? `${money(annual.low)}–${money(annual.high)} ريال / سنة` : 'No defensible SAR amount yet'}</strong></p><p class="fine">Estimate confidence: ${esc(estimateConfidence)}% · ${esc(audit.opportunity?.method || '')}</p><p class="fine">Commercial model: ticket ${money(profile.averageTicketRange?.low)}–${money(profile.averageTicketRange?.high)} ريال · monthly leads ${money(profile.monthlyLeadRange?.low)}–${money(profile.monthlyLeadRange?.high)} · confidence ${money(profile.confidence || 0)}%</p><table class="breakdown"><thead><tr><th>Area</th><th>Est. annual range</th><th>Evidence</th></tr></thead><tbody>${breakdown||'<tr><td colspan="3">No monetizable breakdown available.</td></tr>'}</tbody></table><h4>Top findings</h4><ul>${issues||'<li>No major issue detected in current checks.</li>'}</ul><h4>Qualification logic</h4><ul>${qReasons || '<li>No positive qualification evidence recorded.</li>'}</ul>${qWarnings ? `<p class="fine"><strong>Warnings</strong></p><ul>${qWarnings}</ul>` : ''}<p class="fine">${esc(audit.opportunity?.basis || '')}</p></div><div><h4>Exact outreach preview</h4><p><strong>${esc(lead.outreach?.subject||'')}</strong></p><pre>${esc(lead.outreach?.body||'')}</pre><p class="fine">${q.sendEligible ? 'Quality gate: SEND ELIGIBLE when outbound is later enabled and reviewed.' : 'Quality gate: NOT send-eligible yet. More evidence/review required.'}</p><p class="fine">Sending remains locked until the first batch is explicitly approved.</p>${q.sendEligible && lead.id ? '<button class="approve-send" data-lead-id="' + esc(lead.id) + '" type="button">Review & approve send</button>' : ''}</div></div></article>`;
  }).join('');
}

results.addEventListener('click', async event => {
  const button = event.target.closest('.approve-send');
  if (!button) return;
  const leadId = button.dataset.leadId;
  if (!leadId) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const response = await fetch('/api/leads/' + encodeURIComponent(leadId) + '/send', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ approved:true }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Send blocked');
    button.textContent = 'Sent ✓';
    button.classList.add('sent');
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    alert('Send was not completed: ' + error.message);
  }
});

if (form) form.addEventListener('submit', async event => {
  event.preventDefault(); const payload=Object.fromEntries(new FormData(form).entries()); payload.limit=Number(payload.limit); payload.averageTicket=Number(payload.averageTicket); payload.monthlyLeadEstimate=Number(payload.monthlyLeadEstimate); payload.language = document.querySelector('#language')?.value === 'en' ? 'en' : 'ar';
  statusEl.textContent='Discovering businesses, understanding business models/products, resolving official presence, auditing evidence, modeling commercial ranges, qualifying leads, and writing outreach…'; form.querySelector('button').disabled=true;
  try { const response=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const data=await response.json(); if(!response.ok) throw new Error(data.error||'Campaign failed'); renderCampaign(data); const s=data.qualificationSummary||{}; statusEl.textContent=`Done: ${data.leads.length} audited · A ${s.A||0} · B ${s.B||0} · C ${s.C||0} · Reject ${s.REJECT||0} · send-eligible ${s.sendEligible||0}.`; }
  catch(error){statusEl.textContent=`Error: ${error.message}`;} finally{form.querySelector('button').disabled=false;}
});

loadConfig().catch(()=>{configEl.textContent='Integration status unavailable';});
