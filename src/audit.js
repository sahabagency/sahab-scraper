import * as cheerio from 'cheerio';

const signals = [
  { key: 'hasTitle', label: 'SEO title', weight: 8 },
  { key: 'hasMetaDescription', label: 'Meta description', weight: 8 },
  { key: 'hasViewport', label: 'Mobile viewport', weight: 8 },
  { key: 'hasPrimaryCta', label: 'Primary CTA', weight: 14 },
  { key: 'hasBooking', label: 'Booking / appointment path', weight: 14 },
  { key: 'hasPhoneOrWhatsApp', label: 'Phone / WhatsApp contact', weight: 10 },
  { key: 'hasAnalytics', label: 'Analytics tracking', weight: 8 },
  { key: 'hasMetaPixel', label: 'Meta Pixel', weight: 8 },
  { key: 'hasInstagram', label: 'Instagram link', weight: 6 },
  { key: 'hasFacebook', label: 'Facebook link', weight: 4 },
  { key: 'usesHttps', label: 'HTTPS', weight: 6 },
  { key: 'loads', label: 'Website reachable', weight: 6 }
];

function containsAny(text, words) {
  const haystack = (text || '').toLowerCase();
  return words.some(word => haystack.includes(word));
}

function opportunityEstimate(score, assumptions = {}) {
  const averageTicket = Number(assumptions.averageTicket) || 2500;
  const monthlyLeadEstimate = Number(assumptions.monthlyLeadEstimate) || 40;
  const gap = Math.max(0, 100 - score) / 100;
  const recoverableRateLow = Math.min(0.18, gap * 0.16);
  const recoverableRateHigh = Math.min(0.35, gap * 0.30);
  const low = Math.round(monthlyLeadEstimate * recoverableRateLow * averageTicket);
  const high = Math.round(monthlyLeadEstimate * recoverableRateHigh * averageTicket);
  return {
    monthlyRange: { low, high },
    annualRange: { low: low * 12, high: high * 12 },
    assumptions: { averageTicket, monthlyLeadEstimate },
    disclaimer: 'Opportunity estimate, not a verified loss figure. It is derived from stated commercial assumptions and observable conversion gaps.'
  };
}

export async function auditLead(lead, assumptions = {}) {
  const result = {
    website: lead.website || null,
    checkedAt: new Date().toISOString(),
    score: 0,
    signals: {},
    issues: [],
    wins: [],
    opportunity: null,
    evidence: {}
  };

  if (!lead.website) {
    result.issues.push({ severity: 'high', title: 'No website found', detail: 'Google Places did not return a website for this business.' });
    result.opportunity = opportunityEstimate(20, assumptions);
    return result;
  }

  let html = '';
  let response;
  try {
    response = await fetch(lead.website, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; SahabAudit/1.0; +https://sahab.agency)' },
      signal: AbortSignal.timeout(12000)
    });
    html = await response.text();
  } catch (error) {
    result.issues.push({ severity: 'high', title: 'Website could not be loaded', detail: error.message });
    result.signals.loads = false;
    result.opportunity = opportunityEstimate(10, assumptions);
    return result;
  }

  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const hrefs = $('a').map((_, a) => $(a).attr('href') || '').get().join(' ');
  const scripts = $('script').map((_, s) => $(s).html() || $(s).attr('src') || '').get().join(' ');

  const checks = {
    loads: response.ok,
    usesHttps: String(response.url || lead.website).startsWith('https://'),
    hasTitle: Boolean($('title').text().trim()),
    hasMetaDescription: Boolean($('meta[name="description"]').attr('content')?.trim()),
    hasViewport: Boolean($('meta[name="viewport"]').attr('content')),
    hasPrimaryCta: containsAny(bodyText, ['book now', 'book appointment', 'schedule', 'get quote', 'contact us', 'احجز', 'احجزي', 'موعد', 'تواصل']),
    hasBooking: containsAny(`${hrefs} ${bodyText}`, ['calendly', 'book', 'booking', 'appointment', 'schedule', 'احجز', 'موعد']),
    hasPhoneOrWhatsApp: containsAny(`${hrefs} ${bodyText}`, ['tel:', 'wa.me', 'whatsapp', 'واتساب', '+966', '+1 ']),
    hasAnalytics: containsAny(`${html} ${scripts}`, ['googletagmanager', 'gtag(', 'google-analytics.com']),
    hasMetaPixel: containsAny(`${html} ${scripts}`, ['connect.facebook.net', 'fbq(']),
    hasInstagram: containsAny(hrefs, ['instagram.com']),
    hasFacebook: containsAny(hrefs, ['facebook.com'])
  };

  let score = 0;
  for (const signal of signals) {
    const passed = Boolean(checks[signal.key]);
    result.signals[signal.key] = passed;
    if (passed) {
      score += signal.weight;
      result.wins.push(signal.label);
    } else {
      const severity = signal.weight >= 14 ? 'high' : signal.weight >= 8 ? 'medium' : 'low';
      result.issues.push({ severity, title: `Missing or weak: ${signal.label}`, detail: `Audit did not detect ${signal.label.toLowerCase()} on the public website.` });
    }
  }

  result.score = Math.min(100, score);
  result.opportunity = opportunityEstimate(result.score, assumptions);
  result.evidence = {
    finalUrl: response.url,
    status: response.status,
    title: $('title').text().trim().slice(0, 180),
    metaDescription: ($('meta[name="description"]').attr('content') || '').trim().slice(0, 280)
  };

  return result;
}
