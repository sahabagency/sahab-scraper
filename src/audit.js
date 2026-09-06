import * as cheerio from 'cheerio';

const signals = [
  { key: 'hasTitle', label: 'SEO title', weight: 8, service: 'SEO & Search Visibility' },
  { key: 'hasMetaDescription', label: 'Meta description', weight: 8, service: 'SEO & Search Visibility' },
  { key: 'hasViewport', label: 'Mobile viewport', weight: 8, service: 'Website Experience' },
  { key: 'hasPrimaryCta', label: 'Primary CTA', weight: 14, service: 'Conversion & Landing Experience' },
  { key: 'hasBooking', label: 'Booking / appointment path', weight: 14, service: 'Conversion & Booking' },
  { key: 'hasPhoneOrWhatsApp', label: 'Phone / WhatsApp contact', weight: 10, service: 'Lead Capture' },
  { key: 'hasAnalytics', label: 'Analytics tracking', weight: 8, service: 'Analytics & Attribution' },
  { key: 'hasMetaPixel', label: 'Meta Pixel', weight: 8, service: 'Paid Ads Tracking' },
  { key: 'hasInstagram', label: 'Instagram link', weight: 6, service: 'Social Presence' },
  { key: 'hasFacebook', label: 'Facebook link', weight: 4, service: 'Social Presence' },
  { key: 'usesHttps', label: 'HTTPS', weight: 6, service: 'Website Trust & Technical' },
  { key: 'loads', label: 'Website reachable', weight: 6, service: 'Website Trust & Technical' }
];

function containsAny(text, words) {
  const haystack = (text || '').toLowerCase();
  return words.some(word => haystack.includes(word));
}

function opportunityEstimate(score, assumptions = {}, context = {}) {
  const averageTicket = Number(assumptions.averageTicket) || 2500;
  const monthlyLeadEstimate = Number(assumptions.monthlyLeadEstimate) || 40;
  const monthlyCommercialValue = averageTicket * monthlyLeadEstimate;

  let lowRate;
  let highRate;
  let confidence;
  let method;

  if (context.noWebsite) {
    lowRate = 0.04;
    highRate = 0.10;
    confidence = 35;
    method = 'benchmark_no_website';
  } else if (context.unreachableWebsite) {
    lowRate = 0.05;
    highRate = 0.12;
    confidence = 40;
    method = 'benchmark_unreachable_website';
  } else {
    const gap = Math.max(0, 100 - score) / 100;
    lowRate = Math.min(0.16, gap * 0.16);
    highRate = Math.min(0.30, gap * 0.30);
    confidence = Math.max(55, Math.min(92, 95 - Math.round(gap * 35)));
    method = 'observed_site_gap_model';
  }

  const low = Math.round(monthlyCommercialValue * lowRate);
  const high = Math.round(monthlyCommercialValue * highRate);
  return {
    monthlyRange: { low, high },
    annualRange: { low: low * 12, high: high * 12 },
    assumptions: { averageTicket, monthlyLeadEstimate },
    confidence,
    method,
    basis: context.noWebsite
      ? 'No website was found in Google Places or public discovery. The estimate uses a conservative benchmark band against the stated monthly lead value.'
      : context.unreachableWebsite
        ? 'The linked website could not be loaded. The estimate uses a conservative benchmark band against the stated monthly lead value.'
        : 'Estimate derived from observable public-site gaps and the stated average ticket and monthly lead assumptions.',
    disclaimer: 'Estimated missed opportunity, not verified lost revenue.'
  };
}

function buildServiceBreakdown(issues, opportunity) {
  const annual = opportunity?.annualRange || { low: 0, high: 0 };
  const grouped = new Map();
  let totalWeight = 0;

  for (const issue of issues || []) {
    const signal = signals.find(s => issue.signalKey === s.key);
    const service = signal?.service || issue.service || 'Digital Growth';
    const weight = signal?.weight || 5;
    totalWeight += weight;
    if (!grouped.has(service)) grouped.set(service, { service, weight: 0, issues: [] });
    const entry = grouped.get(service);
    entry.weight += weight;
    entry.issues.push(issue.title.replace('Missing or weak: ', ''));
  }

  if (!grouped.size || !totalWeight) return [];
  return [...grouped.values()]
    .map(entry => ({
      service: entry.service,
      issues: entry.issues,
      annualRange: {
        low: Math.round(annual.low * (entry.weight / totalWeight)),
        high: Math.round(annual.high * (entry.weight / totalWeight))
      }
    }))
    .sort((a, b) => b.annualRange.high - a.annualRange.high);
}

export async function auditLead(lead, assumptions = {}) {
  const result = {
    website: lead.website || null,
    checkedAt: new Date().toISOString(),
    score: null,
    signals: {},
    issues: [],
    wins: [],
    opportunity: null,
    opportunityBreakdown: [],
    evidence: {},
    auditMode: lead.website ? 'website' : 'presence_only'
  };

  if (!lead.website) {
    result.issues.push({ severity: 'high', title: 'No website found', detail: 'Google Places and current public discovery did not return a verified business website.', service: 'Website & Conversion' });
    result.opportunity = opportunityEstimate(null, assumptions, { noWebsite: true });
    result.opportunityBreakdown = [{
      service: 'Website & Conversion',
      issues: ['No verified website found'],
      annualRange: result.opportunity.annualRange
    }];
    result.evidence = {
      googleRating: lead.rating || null,
      reviewCount: lead.reviewCount || null,
      contactRoute: lead.contactRoute || null
    };
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
    result.issues.push({ severity: 'high', title: 'Website could not be loaded', detail: error.message, service: 'Website Trust & Technical' });
    result.signals.loads = false;
    result.opportunity = opportunityEstimate(null, assumptions, { unreachableWebsite: true });
    result.opportunityBreakdown = [{
      service: 'Website Trust & Technical',
      issues: ['Website could not be loaded'],
      annualRange: result.opportunity.annualRange
    }];
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
      result.issues.push({ severity, signalKey: signal.key, service: signal.service, title: `Missing or weak: ${signal.label}`, detail: `Audit did not detect ${signal.label.toLowerCase()} on the public website.` });
    }
  }

  result.score = Math.min(100, score);
  result.opportunity = opportunityEstimate(result.score, assumptions);
  result.opportunityBreakdown = buildServiceBreakdown(result.issues, result.opportunity);
  result.evidence = {
    finalUrl: response.url,
    status: response.status,
    title: $('title').text().trim().slice(0, 180),
    metaDescription: ($('meta[name="description"]').attr('content') || '').trim().slice(0, 280)
  };

  return result;
}
