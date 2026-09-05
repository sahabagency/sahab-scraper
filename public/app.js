const form = document.querySelector('#campaign-form');
const results = document.querySelector('#results');
const statusEl = document.querySelector('#run-status');
const countEl = document.querySelector('#count');
const configEl = document.querySelector('#config');

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function money(n) {
  return Number(n || 0).toLocaleString();
}

async function loadConfig() {
  const config = await fetch('/api/config').then(r => r.json());
  const ready = [
    ['Google Places', config.googlePlacesReady],
    ['OpenAI', config.openAiReady],
    ['Booking link', config.bookingUrlReady]
  ];
  configEl.innerHTML = ready.map(([name, ok]) => `<div><span class="dot ${ok ? 'ok' : 'warn'}"></span>${name}: ${ok ? 'ready' : 'not connected'}</div>`).join('');
  if (config.bookingUrl && !form.bookingUrl.value) form.bookingUrl.value = config.bookingUrl;
}

function renderCampaign(campaign) {
  countEl.textContent = `${campaign.leads.length} leads`;
  if (!campaign.leads.length) {
    results.className = 'results empty';
    results.textContent = 'No leads found.';
    return;
  }
  results.className = 'results';
  results.innerHTML = campaign.leads.map((lead, index) => {
    const audit = lead.audit || {};
    const annual = audit.opportunity?.annualRange || { low: 0, high: 0 };
    const issues = (audit.issues || []).slice(0, 4).map(i => `<li><strong>${esc(i.severity)}</strong> — ${esc(i.title)}</li>`).join('');
    return `<article class="lead-card">
      <div class="lead-top">
        <div>
          <div class="kicker">#${index + 1} · ${esc(lead.address || '')}</div>
          <h3>${esc(lead.name)}</h3>
          <div class="meta">${lead.rating ? `★ ${esc(lead.rating)} (${esc(lead.reviewCount)})` : 'No rating data'} · ${lead.website ? `<a href="${esc(lead.website)}" target="_blank">website</a>` : 'no website'}</div>
        </div>
        <div class="score"><span>${esc(audit.score ?? 0)}</span>/100</div>
      </div>
      <div class="columns">
        <div>
          <h4>Top gaps</h4>
          <ul>${issues || '<li>No major issue detected in current checks.</li>'}</ul>
          <p class="opportunity"><strong>Estimated annual opportunity:</strong> ${money(annual.low)}–${money(annual.high)}</p>
          <p class="fine">Estimate only; based on campaign assumptions and observable gaps, not verified lost revenue.</p>
        </div>
        <div>
          <h4>Outreach draft</h4>
          <p><strong>${esc(lead.outreach?.subject || '')}</strong></p>
          <pre>${esc(lead.outreach?.body || '')}</pre>
        </div>
      </div>
    </article>`;
  }).join('');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.limit = Number(payload.limit);
  payload.averageTicket = Number(payload.averageTicket);
  payload.monthlyLeadEstimate = Number(payload.monthlyLeadEstimate);
  statusEl.textContent = 'Discovering businesses, auditing websites, and writing outreach…';
  form.querySelector('button').disabled = true;
  try {
    const response = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Campaign failed');
    renderCampaign(data);
    statusEl.textContent = `Done: ${data.leads.length} leads audited.`;
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    form.querySelector('button').disabled = false;
  }
});

loadConfig().catch(() => { configEl.textContent = 'Could not load integration status.'; });
