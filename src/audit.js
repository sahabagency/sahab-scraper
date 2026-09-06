import * as cheerio from 'cheerio';
import { buildCommercialProfile } from './commercialProfile.js';

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

function midpoint(range, fallback) {
  const low = Number(range?.low);
  const high = Number(range?.high);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0) return fallback;
  return Math.round((low + high) / 2);
}

function opportunityEstimate(score, assumptions = {}, context = {}) {
  const averageTicket = Number(assumptions.averageTicket) || 2500;
  const monthlyLeadEstimate = Number(assumptions.monthlyLeadEstimate) || 40;
  const profile = assumptions.commercialProfile || null;

  const monthlyCommercialLow = Number(profile?.monthlyCommercialValueRange?.low) || (averageTicket * monthlyLeadEstimate);
  const monthlyCommercialHigh = Number(profile?.monthlyCommercialValueRange?.high) || (averageTicket * monthlyLeadEstimate);

  let lowRate; let highRate; let evidenceConfidence; let method;
  if (context.noWebsite) {
    lowRate = 0.04; highRate = 0.10; evidenceConfidence = 35; method = 'benchmark_no_website';
  } else if (context.unreachableWebsite) {
    lowRate = 0.05; highRate = 0.12; evidenceConfidence = 40; method = 'benchmark_unreachable_website';
  } else {
    const gap = Math.max(0, 100 - score) / 100;
    lowRate = Math.min(0.16, gap * 0.16);
    highRate = Math.min(0.30, gap * 0.30);
    evidenceConfidence = Math.max(55, Math.min(92, 95 - Math.round(gap * 35)));
    method = 'observed_site_gap_model';
  }

  const low = Math.round(monthlyCommercialLow * lowRate);
  const high = Math.round(monthlyCommercialHigh * highRate);
  const assumptionConfidence = Number(profile?.confidence) || 35;
  const confidence = Math.round((evidenceConfidence * 0.65) + (assumptionConfidence * 0.35));

  return {
    monthlyRange: { low, high },
    annualRange: { low: low * 12, high: high * 12 },
    assumptions: {
      averageTicket,
      monthlyLeadEstimate,
      averageTicketRange: profile?.averageTicketRange || null,
      monthlyLeadRange: profile?.monthlyLeadRange || null,
      monthlyCommercialValueRange: profile?.monthlyCommercialValueRange || null
    },
    confidence,
    evidenceConfidence,
    assumptionConfidence,
    method,
    basis: context.noWebsite
      ? 'No verified website was found. The opportunity range uses a conservative leak-rate band over a per-lead public-footprint commercial assumption range.'
      : context.unreachableWebsite
        ? 'The linked website could not be loaded. The opportunity range uses a conservative leak-rate band over a per-lead public-footprint commercial assumption range.'
        : 'Opportunity range combines observable public-site gaps with a per-lead commercial assumption profile derived from public footprint and campaign anchors.',
    disclaimer: 'Estimated missed opportunity, not verified lost revenue. Commercial inputs are modeled assumptions, not CRM or accounting data.'
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
    entry.issues.push(issue.title.replace('Missing or weak: ', '').replace('Not detected publicly: ', ''));
  }
  if (!grouped.size || !totalWeight) return [];
  return [...grouped.values()].map(entry => ({
    service: entry.service,
    issues: entry.issues,
    annualRange: { low: Math.round(annual.low * (entry.weight / totalWeight)), high: Math.round(annual.high * (entry.weight / totalWeight)) }
  })).sort((a, b) => b.annualRange.high - a.annualRange.high);
}

async function braveCorroboration(lead, website) {
  if (!process.env.BRAVE_SEARCH_API_KEY || !website) return null;
  let host = '';
  try { host = new URL(website).hostname.replace(/^www\./, ''); } catch { return null; }
  const q = `site:${host} \"${lead.name}\" احجز موعد book appointment whatsapp instagram facebook`;
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', q);
  url.searchParams.set('count', '8');
  url.searchParams.set('extra_snippets', 'true');
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const rows = data.web?.results || [];
    const text = rows.map(r => `${r.title || ''} ${r.description || ''} ${(r.extra_snippets || []).join(' ')} ${r.url || ''}`).join(' ').toLowerCase();
    if (!text) return null;
    return {
      hasPrimaryCta: containsAny(text, ['احجز', 'موعد', 'book now', 'book appointment', 'schedule']),
      hasBooking: containsAny(text, ['احجز', 'موعد', 'booking', 'appointment', 'schedule']),
      hasPhoneOrWhatsApp: containsAny(text, ['whatsapp', 'واتساب', 'wa.me', '+966']),
      hasInstagram: text.includes('instagram.com'),
      hasFacebook: text.includes('facebook.com'),
      evidenceUrls: rows.slice(0, 5).map(r => r.url)
    };
  } catch { return null; }
}

export async function auditLead(lead, assumptions = {}) {
  const commercialProfile = buildCommercialProfile({
    lead,
    industry: assumptions.industry || '',
    averageTicketAnchor: assumptions.averageTicket,
    monthlyLeadAnchor: assumptions.monthlyLeadEstimate
  });
  const smartAssumptions = {
    ...assumptions,
    averageTicket: midpoint(commercialProfile.averageTicketRange, Number(assumptions.averageTicket) || 2500),
    monthlyLeadEstimate: midpoint(commercialProfile.monthlyLeadRange, Number(assumptions.monthlyLeadEstimate) || 40),
    commercialProfile
  };

  const result = {
    website: lead.website || null, checkedAt: new Date().toISOString(), score: null, signals: {}, issues: [], wins: [],
    opportunity: null, opportunityBreakdown: [], evidence: {}, auditMode: lead.website ? 'website' : 'presence_only', commercialProfile
  };

  if (!lead.website) {
    result.issues.push({ severity: 'high', title: 'No website found', detail: 'Google Places and current public discovery did not return a verified business website.', service: 'Website & Conversion' });
    result.opportunity = opportunityEstimate(null, smartAssumptions, { noWebsite: true });
    result.opportunityBreakdown = [{ service: 'Website & Conversion', issues: ['No verified website found'], annualRange: result.opportunity.annualRange }];
    result.evidence = { googleRating: lead.rating || null, reviewCount: lead.reviewCount || null, contactRoute: lead.contactRoute || null };
    return result;
  }

  let html = ''; let response;
  try {
    response = await fetch(lead.website, {
      redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; SahabAudit/1.0; +https://sahab.agency)' }, signal: AbortSignal.timeout(12000)
    });
    html = await response.text();
  } catch (error) {
    result.issues.push({ severity: 'high', title: 'Website could not be loaded', detail: error.message, service: 'Website Trust & Technical' });
    result.signals.loads = false;
    result.opportunity = opportunityEstimate(null, smartAssumptions, { unreachableWebsite: true });
    result.opportunityBreakdown = [{ service: 'Website Trust & Technical', issues: ['Website could not be loaded'], annualRange: result.opportunity.annualRange }];
    return result;
  }

  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const hrefs = $('a').map((_, a) => $(a).attr('href') || '').get().join(' ');
  const scripts = $('script').map((_, s) => $(s).html() || $(s).attr('src') || '').get().join(' ');
  const interactiveText = $('a,button,input[type="submit"],[role="button"]').map((_, el) => `${$(el).text()} ${$(el).attr('aria-label') || ''} ${$(el).attr('value') || ''} ${$(el).attr('href') || ''}`).get().join(' ');

  const checks = {
    loads: response.ok,
    usesHttps: String(response.url || lead.website).startsWith('https://'),
    hasTitle: Boolean($('title').text().trim()),
    hasMetaDescription: Boolean($('meta[name="description"]').attr('content')?.trim()),
    hasViewport: Boolean($('meta[name="viewport"]').attr('content')),
    hasPrimaryCta: containsAny(`${bodyText} ${interactiveText}`, ['book now', 'book appointment', 'schedule', 'get quote', 'contact us', 'احجز', 'احجزي', 'موعد', 'تواصل', 'اطلب موعد']),
    hasBooking: containsAny(`${hrefs} ${bodyText} ${interactiveText}`, ['calendly', 'book', 'booking', 'appointment', 'schedule', 'احجز', 'موعد', 'اطلب موعد']),
    hasPhoneOrWhatsApp: containsAny(`${hrefs} ${bodyText} ${interactiveText}`, ['tel:', 'wa.me', 'whatsapp', 'واتساب', '+966', '+1 ']),
    hasAnalytics: containsAny(`${html} ${scripts}`, ['googletagmanager', 'gtag(', 'google-analytics.com']),
    hasMetaPixel: containsAny(`${html} ${scripts}`, ['connect.facebook.net', 'fbq(']),
    hasInstagram: containsAny(hrefs, ['instagram.com']),
    hasFacebook: containsAny(hrefs, ['facebook.com'])
  };

  const preliminaryScore = signals.reduce((sum, signal) => sum + (checks[signal.key] ? signal.weight : 0), 0);
  let corroboration = null;
  if (preliminaryScore < 70 || bodyText.length < 600) {
    corroboration = await braveCorroboration(lead, lead.website);
    if (corroboration) {
      for (const key of ['hasPrimaryCta','hasBooking','hasPhoneOrWhatsApp','hasInstagram','hasFacebook']) {
        if (!checks[key] && corroboration[key]) checks[key] = true;
      }
    }
  }

  let score = 0;
  for (const signal of signals) {
    const passed = Boolean(checks[signal.key]);
    result.signals[signal.key] = passed;
    if (passed) {
      score += signal.weight;
      result.wins.push(signal.label);
    } else {
      const severity = signal.weight >= 14 ? 'high' : signal.weight >= 8 ? 'medium' : 'low';
      const uncertain = ['hasAnalytics','hasMetaPixel'].includes(signal.key);
      result.issues.push({
        severity, signalKey: signal.key, service: signal.service,
        title: `${uncertain ? 'Not detected publicly' : 'Missing or weak'}: ${signal.label}`,
        detail: uncertain
          ? `The public scan did not detect ${signal.label.toLowerCase()}; this is not proof that it is absent.`
          : `Audit did not detect ${signal.label.toLowerCase()} on the public website.`
      });
    }
  }

  result.score = Math.min(100, score);
  result.opportunity = opportunityEstimate(result.score, smartAssumptions);
  result.opportunityBreakdown = buildServiceBreakdown(result.issues, result.opportunity);
  result.evidence = {
    finalUrl: response.url, status: response.status, title: $('title').text().trim().slice(0, 180),
    metaDescription: ($('meta[name="description"]').attr('content') || '').trim().slice(0, 280),
    htmlTextLength: bodyText.length,
    indexedCorroboration: corroboration ? { used: true, evidenceUrls: corroboration.evidenceUrls || [] } : { used: false }
  };
  return result;
}
