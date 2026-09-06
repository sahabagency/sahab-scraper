const form = document.querySelector('#campaign-form');
const results = document.querySelector('#results');
const statusEl = document.querySelector('#run-status');
const countEl = document.querySelector('#count');
const configEl = document.querySelector('#config');
const scanForm = document.querySelector('#scan-form');
const scanStatus = document.querySelector('#scan-status');
const scanResult = document.querySelector('#scan-result');

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
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

async function loadConfig() {
  const config = await fetch('/api/config').then(r => r.json());
  const ready = [
    ['Places', config.googlePlacesReady],
    ['OpenAI', config.openAiReady],
    ['Web', config.webDiscoveryReady],
    ['Booking', config.bookingUrlReady]
  ];
  configEl.innerHTML = ready.map(([name, ok]) => `<span class="${ok ? 'ready' : ''}">${esc(name)} ${ok ? '●' : '○'}</span>`).join('');
  if (config.bookingUrl && form && !form.bookingUrl.value) form.bookingUrl.value = config.bookingUrl;
}

function renderLiveScan(data) {
  const lead = data.lead || {};
  const audit = data.audit || {};
  const monthly = audit.opportunity?.monthlyRange || { low: 0, high: 0 };
  const annualBreakdown = audit.opportunityBreakdown || [];
  const route = lead.contactRoute || {};
  const confidence = route.confidence || (lead.contactEmail ? 95 : 70);
  const rows = annualBreakdown.slice(0, 6).map(item => {
    const high = Math.round((item.annualRange?.high || 0) / 12);
    const low = Math.round((item.annualRange?.low || 0) / 12);
    return `<div class="leak-row"><div><h3>${esc(item.service)}</h3><p>${esc((item.issues || []).join(' · '))}</p></div><div class="leak-value">−${money(high)}<small>${money(low)}–${money(high)} /mo est.</small></div></div>`;
  }).join('');
  scanResult.innerHTML = `<div class="scan-result-card">
    <div class="business-line"><div><h2>${esc(lead.name || nameFromUrl(lead.website || 'Business'))}</h2><div class="business-meta">${lead.website ? `<a href="${esc(lead.website)}" target="_blank" style="color:#d7bd68">${esc(lead.website)}</a>` : 'public business scan'}${route.channel ? ` · best contact: ${esc(route.channel)}` : ''}</div></div><div class="confidence">estimate confidence<b>${money(confidence)}%</b></div></div>
    <div class="leak-box"><div class="label">ESTIMATED MONTHLY REVENUE LEAK</div><div class="amount">${money(monthly.high)}</div><div class="range">est. range ${money(monthly.low)} – ${money(monthly.high)} / mo · assumption-based estimate</div></div>
    ${rows || '<div class="leak-row"><div><h3>No major leak detected</h3><p>The current public checks did not produce a service breakdown.</p></div><div class="leak-value">0<small>/mo est.</small></div></div>'}
    <details class="outreach-preview"><summary>Exact outreach email preview</summary><p><strong>${esc(data.outreach?.subject || '')}</strong></p><pre>${esc(data.outreach?.body || '')}</pre></details>
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
      body: JSON.stringify({
        lead: { name: nameFromUrl(website), website },
        assumptions: { averageTicket: 2500, monthlyLeadEstimate: 40 }
      })
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
  countEl.textContent = `${campaign.leads.length} leads`;
  if (!campaign.leads.length) { results.className='results empty'; results.textContent='No leads found.'; return; }
  results.className='results';
  results.innerHTML = campaign.leads.map((lead,index)=>{
    const audit=lead.audit||{}; const annual=audit.opportunity?.annualRange||{low:0,high:0};
    const issues=(audit.issues||[]).slice(0,4).map(i=>`<li><strong>${esc(i.severity)}</strong> — ${esc(i.title)}</li>`).join('');
    const breakdown=(audit.opportunityBreakdown||[]).slice(0,6).map(item=>`<tr><td>${esc(item.service)}</td><td>${money(item.annualRange?.low)}–${money(item.annualRange?.high)}</td><td>${esc((item.issues||[]).slice(0,2).join(', '))}</td></tr>`).join('');
    const route=lead.contactRoute||{}; const destination=route.destination||lead.contactEmail||lead.phone||'Research required';
    return `<article class="lead-card"><div class="lead-top"><div><div class="kicker">#${index+1} · ${esc(lead.address||'')}</div><h3>${esc(lead.name)}</h3><div class="meta">${lead.rating?`★ ${esc(lead.rating)} (${esc(lead.reviewCount)})`:'No rating data'} · ${lead.website?`<a href="${esc(lead.website)}" target="_blank">website</a>`:'no website'}</div><div class="meta"><strong>Best contact:</strong> ${esc(route.channel||(lead.contactEmail?'email':'research_required'))} · ${esc(destination)}</div></div><div class="score"><span>${esc(audit.score??0)}</span>/100</div></div><div class="columns"><div><h4>Estimated missed opportunity</h4><p class="opportunity"><strong>${money(annual.low)}–${money(annual.high)} / year</strong></p><table class="breakdown"><thead><tr><th>Area</th><th>Est. annual range</th><th>Evidence</th></tr></thead><tbody>${breakdown||'<tr><td colspan="3">No breakdown available.</td></tr>'}</tbody></table><h4>Top gaps</h4><ul>${issues||'<li>No major issue detected in current checks.</li>'}</ul><p class="fine">Estimate only; based on campaign assumptions and observable gaps, not verified lost revenue.</p></div><div><h4>Exact outreach preview</h4><p><strong>${esc(lead.outreach?.subject||'')}</strong></p><pre>${esc(lead.outreach?.body||'')}</pre></div></div></article>`;
  }).join('');
}

if (form) form.addEventListener('submit', async event => {
  event.preventDefault(); const payload=Object.fromEntries(new FormData(form).entries());
  payload.limit=Number(payload.limit); payload.averageTicket=Number(payload.averageTicket); payload.monthlyLeadEstimate=Number(payload.monthlyLeadEstimate);
  statusEl.textContent='Discovering businesses, enriching contacts, auditing gaps, and writing outreach…'; form.querySelector('button').disabled=true;
  try { const response=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const data=await response.json(); if(!response.ok) throw new Error(data.error||'Campaign failed'); renderCampaign(data); statusEl.textContent=`Done: ${data.leads.length} leads audited.`; }
  catch(error){statusEl.textContent=`Error: ${error.message}`;} finally{form.querySelector('button').disabled=false;}
});

loadConfig().catch(()=>{configEl.textContent='Integration status unavailable';});
