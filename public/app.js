const form = document.querySelector('#campaign-form');
const results = document.querySelector('#results');
const statusEl = document.querySelector('#run-status');
const countEl = document.querySelector('#count');
const configEl = document.querySelector('#config');
const scanForm = document.querySelector('#scan-form');
const scanStatus = document.querySelector('#scan-status');
const scanResult = document.querySelector('#scan-result');

function esc(value = '') {
  return String(value).replace(/[&<>'\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[c]));
}

function money(n) { return Number(n || 0).toLocaleString('en-US'); }
function normalizeUrl(value='') {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
function nameFromUrl(value='') {
  try { return new URL(normalizeUrl(value)).hostname.replace(/^www\./,'').split('.')[0].replace(/[-_]+/g,' '); }
  catch { return value; }
}

function qualificationBadge(q = {}) {
  const tier = q.tier || '—';
  const label = q.label || 'Not qualified yet';
  return `<span style="display:inline-flex;align-items:center;gap:8px;border:1px solid #d8c47e;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800">${esc(tier)} · ${esc(q.score ?? '—')}/100 · ${esc(label)}</span>`;
}

async function loadConfig() {
  const config = await fetch('/api/config', { cache: 'no-store' }).then(r => r.json());
  const ready = [
    ['Places', config.googlePlacesReady],
    ['OpenAI', config.openAiReady],
    ['Web', config.webDiscoveryReady],
    ['Booking', config.bookingUrlReady],
    ['DB', config.persistenceReady && !config.persistenceStats?.error]
  ];
  const statusHtml = ready.map(([name, ok]) => `<span class="${ok ? 'ready' : ''}">${esc(name)} ${ok ? '●' : '○'}</span>`).join('');
  let gmailHtml = config.gmailOauthReady ? '<a href="/auth/google" style="display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border:1px solid #d7bd68;border-radius:999px;color:#f2d66d;text-decoration:none;font-weight:700">Connect Google ↗</a>' : '<span>Gmail ○</span>';
  let calendarHtml = '<span>Calendar ○</span>';

  if (config.gmailConnected) {
    try {
      const [gmailResponse, calendarResponse] = await Promise.all([
        fetch('/api/gmail/verify', { cache: 'no-store' }),
        fetch('/api/calendar/verify', { cache: 'no-store' })
      ]);
      const gmail = await gmailResponse.json();
      const calendar = await calendarResponse.json();
      gmailHtml = gmail.ok ? `<span class="ready" title="${esc(gmail.emailAddress || '')}">Gmail ●</span>` : '<span title="OAuth token needs attention">Gmail !</span>';
      calendarHtml = calendar.ok ? '<span class="ready">Calendar ●</span>' : '<span title="Calendar permission needs attention">Calendar !</span>';
    } catch {
      gmailHtml = '<span>Gmail ?</span>';
      calendarHtml = '<span>Calendar ?</span>';
    }
  }

  const outbound = config.outbound || {};
  const outboundHtml = outbound.enabled
    ? `<span class="ready" title="Daily limit ${esc(outbound.dailyLimit || 0)} · review ${outbound.requireReview ? 'required' : 'off'}">Send ●</span>`
    : '<span title="Sending is intentionally locked until the first batch is explicitly approved">Send 🔒</span>';

  configEl.innerHTML = `${statusHtml}${gmailHtml}${calendarHtml}${outboundHtml}`;
  if (config.bookingUrl && form && !form.bookingUrl.value) form.bookingUrl.value = config.bookingUrl;
}

function renderLiveScan(data) {
  const lead = data.lead || {};
  const audit = data.audit || {};
  const q = data.qualification || audit.qualification || {};
  const profile = audit.commercialProfile || {};
  const monthly = audit.opportunity?.monthlyRange || { low: 0, high: 0 };
  const annualBreakdown = audit.opportunityBreakdown || [];
  const route = lead.contactRoute || {};
  const confidence = audit.opportunity?.confidence ?? route.confidence ?? (lead.contactEmail ? 95 : 70);
  const rows = annualBreakdown.slice(0, 6).map(item => {
    const high = Math.round((item.annualRange?.high || 0) / 12);
    const low = Math.round((item.annualRange?.low || 0) / 12);
    return `<div class="leak-row"><div><h3>${esc(item.service)}</h3><p>${esc((item.issues || []).join(' · '))}</p></div><div class="leak-value">−${money(high)}<small>${money(low)}–${money(high)} /mo est.</small></div></div>`;
  }).join('');
  const emailPreview = data.emailHtml
    ? `<details class="outreach-preview" open><summary>Exact email design that will be sent</summary><p><strong>${esc(data.outreach?.subject || '')}</strong></p><iframe title="Email preview" style="width:100%;height:760px;border:1px solid #3a362d;border-radius:16px;background:#fff" sandbox="" srcdoc="${esc(data.emailHtml)}"></iframe><details><summary>Plain-text fallback</summary><pre>${esc(data.outreach?.body || '')}</pre></details></details>`
    : `<details class="outreach-preview"><summary>Exact outreach email preview</summary><p><strong>${esc(data.outreach?.subject || '')}</strong></p><pre>${esc(data.outreach?.body || '')}</pre></details>`;

  scanResult.innerHTML = `<div class="scan-result-card">
    <div class="business-line"><div><h2>${esc(lead.name || nameFromUrl(lead.website || 'Business'))}</h2><div class="business-meta">${lead.website ? `<a href="${esc(lead.website)}" target="_blank" style="color:#d7bd68">${esc(lead.website)}</a>` : 'public business scan'}${route.channel ? ` · best contact: ${esc(route.channel)}` : ''}</div><div style="margin-top:10px">${qualificationBadge(q)}</div></div><div class="confidence">estimate confidence<b>${money(confidence)}%</b></div></div>
    <div class="leak-box"><div class="label">ESTIMATED MONTHLY REVENUE LEAK</div><div class="amount">${money(monthly.high)}</div><div class="range">est. range ${money(monthly.low)} – ${money(monthly.high)} / mo · ${esc(audit.opportunity?.method || 'assumption-based estimate')}</div></div>
    <div class="leak-row"><div><h3>Commercial assumption profile</h3><p>Ticket ${money(profile.averageTicketRange?.low)}–${money(profile.averageTicketRange?.high)} SAR · modeled monthly leads ${money(profile.monthlyLeadRange?.low)}–${money(profile.monthlyLeadRange?.high)} · not verified CRM data</p></div><div class="leak-value">${money(profile.confidence || 0)}%<small>assumption confidence</small></div></div>
    ${rows || '<div class="leak-row"><div><h3>No major leak detected</h3><p>The current public checks did not produce a service breakdown.</p></div><div class="leak-value">0<small>/mo est.</small></div></div>'}
    ${emailPreview}
  </div>`;
}

scanForm.addEventListener('submit', async event => {
  event.preventDefault();
  const website = normalizeUrl(scanForm.website.value);
  scanStatus.textContent = 'Scanning website, tracking setup, conversion path, public contact data and revenue opportunity…';
  scanForm.querySelector('button').disabled = true;
  scanResult.innerHTML = '';
  try {
    const response = await fetch('/api/leads/audit', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ lead: { name: nameFromUrl(website), website }, assumptions: { averageTicket: 2500, monthlyLeadEstimate: 40 } })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Scan failed');
    renderLiveScan(data);
    scanStatus.textContent = 'Live scan complete · public data only · figures are estimates';
  } catch (error) {
    scanStatus.textContent = `Scan error: ${error.message}`;
  } finally { scanForm.querySelector('button').disabled = false; }
});

function renderCampaign(campaign) {
  const leads = campaign.leads || [];
  const summary = campaign.qualificationSummary || {};
  countEl.textContent = `${leads.length} leads · A ${summary.A || 0} · B ${summary.B || 0} · C ${summary.C || 0} · Reject ${summary.REJECT || 0}`;
  if (!leads.length) { results.className='results empty'; results.textContent='No leads found.'; return; }
  results.className='results';
  results.innerHTML = leads.map((lead,index)=>{
    const audit=lead.audit||{}; const annual=audit.opportunity?.annualRange||{low:0,high:0};
    const q = lead.qualification || audit.qualification || {};
    const profile = audit.commercialProfile || {};
    const issues=(audit.issues||[]).slice(0,4).map(i=>`<li><strong>${esc(i.severity)}</strong> — ${esc(i.title)}</li>`).join('');
    const breakdown=(audit.opportunityBreakdown||[]).slice(0,6).map(item=>`<tr><td>${esc(item.service)}</td><td>${money(item.annualRange?.low)}–${money(item.annualRange?.high)}</td><td>${esc((item.issues||[]).slice(0,2).join(', '))}</td></tr>`).join('');
    const route=lead.contactRoute||{}; const destination=route.destination||lead.contactEmail||lead.phone||'Research required';
    const scoreHtml = audit.score === null || audit.score === undefined ? '<span>N/A</span>' : `<span>${esc(audit.score)}</span>/100`;
    const estimateConfidence = audit.opportunity?.confidence ?? '—';
    const qReasons = (q.reasons || []).slice(0,3).map(r=>`<li>${esc(r)}</li>`).join('');
    const qWarnings = (q.warnings || []).slice(0,3).map(r=>`<li>${esc(r)}</li>`).join('');
    return `<article class="lead-card"><div class="lead-top"><div><div class="kicker">#${index+1} · ${esc(lead.address||'')} · ${esc(lead.status||'')}</div><h3>${esc(lead.name)}</h3><div style="margin:7px 0 9px">${qualificationBadge(q)}</div><div class="meta">${lead.rating?`★ ${esc(lead.rating)} (${esc(lead.reviewCount)})`:'No rating data'} · ${lead.website?`<a href="${esc(lead.website)}" target="_blank">website</a>`:'no verified website'}</div><div class="meta"><strong>Best contact:</strong> ${esc(route.channel||(lead.contactEmail?'email':'research_required'))} · ${esc(destination)}</div></div><div class="score">${scoreHtml}</div></div><div class="columns"><div><h4>Estimated missed opportunity</h4><p class="opportunity"><strong>${money(annual.low)}–${money(annual.high)} / year</strong></p><p class="fine">Estimate confidence: ${esc(estimateConfidence)}% · ${esc(audit.opportunity?.method || '')}</p><p class="fine">Commercial model: ticket ${money(profile.averageTicketRange?.low)}–${money(profile.averageTicketRange?.high)} SAR · monthly leads ${money(profile.monthlyLeadRange?.low)}–${money(profile.monthlyLeadRange?.high)} · confidence ${money(profile.confidence || 0)}%</p><table class="breakdown"><thead><tr><th>Area</th><th>Est. annual range</th><th>Evidence</th></tr></thead><tbody>${breakdown||'<tr><td colspan="3">No breakdown available.</td></tr>'}</tbody></table><h4>Top gaps</h4><ul>${issues||'<li>No major issue detected in current checks.</li>'}</ul><h4>Qualification logic</h4><ul>${qReasons || '<li>No positive qualification evidence recorded.</li>'}</ul>${qWarnings ? `<p class="fine"><strong>Warnings</strong></p><ul>${qWarnings}</ul>` : ''}<p class="fine">${esc(audit.opportunity?.basis || 'Estimate only; based on campaign assumptions and observable gaps, not verified lost revenue.')}</p></div><div><h4>Exact outreach preview</h4><p><strong>${esc(lead.outreach?.subject||'')}</strong></p><pre>${esc(lead.outreach?.body||'')}</pre><p class="fine">${q.sendEligible ? 'Quality gate: SEND ELIGIBLE when outbound is later enabled and reviewed.' : 'Quality gate: NOT send-eligible yet. More evidence/review required.'}</p><p class="fine">Sending remains locked until the first batch is explicitly approved.</p></div></div></article>`;
  }).join('');
}

if (form) form.addEventListener('submit', async event => {
  event.preventDefault(); const payload=Object.fromEntries(new FormData(form).entries());
  payload.limit=Number(payload.limit); payload.averageTicket=Number(payload.averageTicket); payload.monthlyLeadEstimate=Number(payload.monthlyLeadEstimate);
  statusEl.textContent='Discovering businesses, resolving official presence, auditing evidence, modeling commercial ranges, qualifying leads, and writing outreach…'; form.querySelector('button').disabled=true;
  try { const response=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const data=await response.json(); if(!response.ok) throw new Error(data.error||'Campaign failed'); renderCampaign(data); const s=data.qualificationSummary||{}; statusEl.textContent=`Done: ${data.leads.length} audited · A ${s.A||0} · B ${s.B||0} · C ${s.C||0} · Reject ${s.REJECT||0} · send-eligible ${s.sendEligible||0}.`; }
  catch(error){statusEl.textContent=`Error: ${error.message}`;} finally{form.querySelector('button').disabled=false;}
});

loadConfig().catch(()=>{configEl.textContent='Integration status unavailable';});
