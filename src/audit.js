import * as cheerio from 'cheerio';
import { buildCommercialProfile } from './commercialProfile.js';
import { inferBusinessIntelligence } from './businessIntelligence.js';

const signals = [
  { key: 'hasTitle', label: 'SEO title', weight: 8, service: 'SEO & Search Visibility', scoreEligible: true, negativeEligible: true },
  { key: 'hasMetaDescription', label: 'Meta description', weight: 8, service: 'SEO & Search Visibility', scoreEligible: true, negativeEligible: true },
  { key: 'hasViewport', label: 'Mobile viewport', weight: 8, service: 'Website Experience', scoreEligible: true, negativeEligible: true },
  { key: 'hasPrimaryCta', label: 'Primary CTA', weight: 14, service: 'Conversion & Landing Experience', scoreEligible: true, negativeEligible: true },
  { key: 'hasBooking', label: 'Conversion / checkout path', weight: 14, service: 'Conversion Path', scoreEligible: true, negativeEligible: true },
  { key: 'hasPhoneOrWhatsApp', label: 'Phone / WhatsApp contact', weight: 10, service: 'Lead Capture', scoreEligible: true, negativeEligible: true },
  { key: 'usesHttps', label: 'HTTPS', weight: 6, service: 'Website Trust & Technical', scoreEligible: true, negativeEligible: true },
  { key: 'loads', label: 'Website reachable', weight: 6, service: 'Website Trust & Technical', scoreEligible: true, negativeEligible: true },
  { key: 'hasAnalytics', label: 'Analytics / tag manager detected', weight: 0, service: 'Analytics & Attribution', scoreEligible: false, negativeEligible: false },
  { key: 'hasMetaPixel', label: 'Meta Pixel directly detected', weight: 0, service: 'Paid Ads Tracking', scoreEligible: false, negativeEligible: false },
  { key: 'hasInstagram', label: 'Instagram link detected', weight: 0, service: 'Social Presence', scoreEligible: false, negativeEligible: false },
  { key: 'hasFacebook', label: 'Facebook link detected', weight: 0, service: 'Social Presence', scoreEligible: false, negativeEligible: false }
];

const SCORE_SIGNALS = signals.filter(s => s.scoreEligible);
const SCORE_MAX = SCORE_SIGNALS.reduce((sum, s) => sum + s.weight, 0);

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
  const averageTicket = Number(assumptions.averageTicket) || 0;
  const monthlyLeadEstimate = Number(assumptions.monthlyLeadEstimate) || 0;
  const profile = assumptions.commercialProfile || null;
  const bi = assumptions.businessIntelligence || null;
  const commercialContextProvided = assumptions.commercialContextProvided === true || Boolean(
    (averageTicket > 0 && monthlyLeadEstimate > 0) && (assumptions.industry || bi?.industry) && Number(bi?.confidence || 0) >= 55
  );

  const monthlyCommercialLow = Number(profile?.monthlyCommercialValueRange?.low) || (averageTicket * monthlyLeadEstimate);
  const monthlyCommercialHigh = Number(profile?.monthlyCommercialValueRange?.high) || (averageTicket * monthlyLeadEstimate);

  let lowRate; let highRate; let evidenceConfidence; let method;
  if (context.noWebsite) {
    lowRate = 0.03; highRate = 0.08; evidenceConfidence = 32; method = 'benchmark_no_website';
  } else if (context.unreachableWebsite) {
    lowRate = 0.04; highRate = 0.10; evidenceConfidence = 38; method = 'benchmark_unreachable_website';
  } else {
    const gap = Math.max(0, 100 - Number(score || 0)) / 100;
    lowRate = Math.min(0.10, gap * 0.10);
    highRate = Math.min(0.18, gap * 0.18);
    evidenceConfidence = Math.max(55, Math.min(92, 95 - Math.round(gap * 35)));
    method = 'observed_customer_facing_gap_model';
  }

  const low = Math.round(monthlyCommercialLow * lowRate);
  const high = Math.round(monthlyCommercialHigh * highRate);
  const assumptionConfidence = Number(profile?.confidence) || Number(bi?.confidence) || 30;
  const confidence = Math.round((evidenceConfidence * 0.60) + (assumptionConfidence * 0.40));
  const displayEligible = Boolean(commercialContextProvided && Number(bi?.confidence || 0) >= 55 && assumptionConfidence >= 45 && high > 0);

  return {
    monthlyRange: { low, high },
    annualRange: { low: low * 12, high: high * 12 },
    currency: 'SAR',
    displayEligible,
    withheldReason: displayEligible ? null : 'Commercial context is still too weak for a defensible public-data estimate.',
    assumptions: {
      averageTicket,
      monthlyLeadEstimate,
      averageTicketRange: profile?.averageTicketRange || null,
      monthlyLeadRange: profile?.monthlyLeadRange || null,
      monthlyCommercialValueRange: profile?.monthlyCommercialValueRange || null,
      averageTicketSource: bi?.averageTicketSource || null,
      monthlyLeadSource: bi?.monthlyLeadSource || null,
      commercialContextProvided
    },
    confidence, evidenceConfidence, assumptionConfidence, method,
    basis: context.noWebsite
      ? 'No verified website was found. The internal estimate uses a conservative benchmark over public business context.'
      : context.unreachableWebsite
        ? 'The linked website could not be loaded. The internal estimate uses a conservative benchmark over public business context.'
        : 'Opportunity range combines verified customer-facing gaps with business type, public products/categories, observed public prices when available, platform signals, and bounded demand proxies.',
    disclaimer: 'Estimated opportunity, not verified lost revenue. Public product, pricing and demand signals are modeled and are not internal CRM/accounting data.'
  };
}

function buildServiceBreakdown(issues, opportunity) {
  const annual = opportunity?.annualRange || { low: 0, high: 0 };
  const grouped = new Map();
  let totalWeight = 0;
  for (const issue of issues || []) {
    const signal = signals.find(s => issue.signalKey === s.key);
    if (signal && signal.negativeEligible === false) continue;
    const service = signal?.service || issue.service || 'Digital Growth';
    const weight = Math.max(1, issue.weight || signal?.weight || 5);
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
    annualRange: {
      low: Math.round(annual.low * (entry.weight / totalWeight)),
      high: Math.round(annual.high * (entry.weight / totalWeight))
    }
  })).sort((a, b) => b.annualRange.high - a.annualRange.high);
}

async function braveCorroboration(lead, website) {
  if (!process.env.BRAVE_SEARCH_API_KEY || !website) return null;
  let host = '';
  try { host = new URL(website).hostname.replace(/^www\./, ''); } catch { return null; }
  const q = `site:${host} \"${lead.name}\" احجز شراء سلة checkout whatsapp instagram facebook`;
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', q); url.searchParams.set('count', '8'); url.searchParams.set('extra_snippets', 'true');
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return null;
    const data = await response.json();
    const rows = data.web?.results || [];
    const text = rows.map(r => `${r.title || ''} ${r.description || ''} ${(r.extra_snippets || []).join(' ')} ${r.url || ''}`).join(' ').toLowerCase();
    if (!text) return null;
    return {
      hasPrimaryCta: containsAny(text, ['احجز','موعد','book now','اطلب','شراء','تسوق']),
      hasBooking: containsAny(text, ['احجز','موعد','booking','appointment','checkout','cart','سلة','شراء']),
      hasPhoneOrWhatsApp: containsAny(text, ['whatsapp','واتساب','wa.me','+966']),
      hasInstagram: text.includes('instagram.com'),
      hasFacebook: text.includes('facebook.com'),
      evidenceUrls: rows.slice(0, 5).map(r => r.url)
    };
  } catch { return null; }
}

function contentRelevanceIssues(bodyText, bi) {
  const issues = [];
  const t = String(bodyText || '').toLowerCase();
  if (bi?.industry === 'water coolers & tanks' && /صيحات الموضة|fashion trends|مجلات الموضة/.test(t)) {
    issues.push({
      severity: 'medium', weight: 8, service: 'Content & Conversion',
      title: 'Irrelevant content detected in customer-facing FAQ',
      detail: 'A fashion-related FAQ appears on a water-cooler/tank store. This can weaken relevance, trust and search clarity.'
    });
  }
  return issues;
}

function buildProfile({ lead, assumptions, bi }) {
  const ticketAnchor = Number(assumptions.averageTicket) || Number(bi?.averageTicketAnchor) || 2500;
  const leadAnchor = Number(assumptions.monthlyLeadEstimate) || Number(bi?.monthlyLeadAnchor) || 40;
  return buildCommercialProfile({
    lead,
    industry: assumptions.industry || bi?.industry || '',
    averageTicketAnchor: ticketAnchor,
    monthlyLeadAnchor: leadAnchor
  });
}

export async function auditLead(lead, assumptions = {}) {
  let commercialProfile = buildProfile({ lead, assumptions, bi: null });
  let smartAssumptions = {
    ...assumptions,
    averageTicket: midpoint(commercialProfile.averageTicketRange, Number(assumptions.averageTicket) || 2500),
    monthlyLeadEstimate: midpoint(commercialProfile.monthlyLeadRange, Number(assumptions.monthlyLeadEstimate) || 40),
    commercialProfile,
    businessIntelligence: null
  };
  const result = {
    website: lead.website || null, checkedAt: new Date().toISOString(), score: null,
    signals: {}, issues: [], wins: [], unknowns: [], opportunity: null, opportunityBreakdown: [],
    evidence: {}, auditMode: lead.website ? 'website' : 'presence_only', commercialProfile, businessIntelligence: null
  };

  if (!lead.website) {
    result.issues.push({ severity: 'high', title: 'No verified website found', detail: 'Current public discovery did not return a verified business website.', service: 'Website & Conversion' });
    result.opportunity = opportunityEstimate(null, smartAssumptions, { noWebsite: true });
    result.opportunityBreakdown = [{ service: 'Website & Conversion', issues: ['No verified website found'], annualRange: result.opportunity.annualRange }];
    result.evidence = { googleRating: lead.rating || null, reviewCount: lead.reviewCount || null, contactRoute: lead.contactRoute || null };
    return result;
  }

  let html = ''; let response;
  try {
    response = await fetch(lead.website, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; SahabAudit/2.0; +https://sahab.agency)' }, signal: AbortSignal.timeout(12000) });
    html = await response.text();
  } catch (error) {
    result.issues.push({ severity: 'high', title: 'Website could not be loaded', detail: error.message, service: 'Website Trust & Technical' });
    result.signals.loads = false;
    result.opportunity = opportunityEstimate(null, smartAssumptions, { unreachableWebsite: true });
    result.opportunityBreakdown = [{ service: 'Website Trust & Technical', issues: ['Website could not be loaded'], annualRange: result.opportunity.annualRange }];
    return result;
  }

  const bi = await inferBusinessIntelligence({ html, url: response.url || lead.website, lead, assumptions });
  commercialProfile = buildProfile({ lead, assumptions, bi });
  smartAssumptions = {
    ...assumptions,
    industry: assumptions.industry || bi.industry,
    averageTicket: midpoint(commercialProfile.averageTicketRange, Number(assumptions.averageTicket) || Number(bi.averageTicketAnchor) || 2500),
    monthlyLeadEstimate: midpoint(commercialProfile.monthlyLeadRange, Number(assumptions.monthlyLeadEstimate) || Number(bi.monthlyLeadAnchor) || 40),
    commercialProfile,
    businessIntelligence: bi,
    commercialContextProvided: assumptions.commercialContextProvided === true || Number(bi.confidence || 0) >= 55
  };
  result.businessIntelligence = bi;
  result.commercialProfile = commercialProfile;

  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const hrefs = $('a').map((_, a) => $(a).attr('href') || '').get().join(' ');
  const scripts = $('script').map((_, s) => $(s).html() || $(s).attr('src') || '').get().join(' ');
  const interactiveText = $('a,button,input[type="submit"],[role="button"]').map((_, el) => `${$(el).text()} ${$(el).attr('aria-label') || ''} ${$(el).attr('value') || ''} ${$(el).attr('href') || ''}`).get().join(' ');
  const technicalText = `${html} ${scripts}`;
  const isEcommerce = bi.businessModel === 'ecommerce';
  const isSalla = bi.platform === 'salla';
  const hasTagManager = containsAny(technicalText, ['googletagmanager.com','gtm.js','gtag(']);

  const checks = {
    loads: response.ok,
    usesHttps: String(response.url || lead.website).startsWith('https://'),
    hasTitle: Boolean($('title').text().trim()),
    hasMetaDescription: Boolean($('meta[name="description"]').attr('content')?.trim()),
    hasViewport: Boolean($('meta[name="viewport"]').attr('content')),
    hasPrimaryCta: containsAny(`${bodyText} ${interactiveText}`, isEcommerce
      ? ['أضف للسلة','اضف للسلة','شراء','تسوق','متابعة التسوق','اطلب','add to cart','buy now','shop now']
      : ['book now','book appointment','schedule','get quote','contact us','احجز','احجزي','موعد','تواصل','اطلب موعد']),
    hasBooking: containsAny(`${hrefs} ${bodyText} ${interactiveText}`, isEcommerce
      ? ['checkout','cart','سلة المشتريات','متابعة التسوق','شراء','add to cart']
      : ['calendly','book','booking','appointment','schedule','احجز','موعد','اطلب موعد']),
    hasPhoneOrWhatsApp: containsAny(`${hrefs} ${bodyText} ${interactiveText}`, ['tel:','wa.me','whatsapp','واتساب','+966','+1 ']),
    hasAnalytics: hasTagManager || containsAny(technicalText, ['google-analytics.com']),
    hasMetaPixel: containsAny(technicalText, ['connect.facebook.net','fbq(','facebook.com/tr']),
    hasInstagram: containsAny(hrefs, ['instagram.com']) || Boolean(lead.socials?.instagram),
    hasFacebook: containsAny(hrefs, ['facebook.com']) || Boolean(lead.socials?.facebook)
  };

  const preliminaryEarned = SCORE_SIGNALS.reduce((sum, signal) => sum + (checks[signal.key] ? signal.weight : 0), 0);
  const preliminaryScore = SCORE_MAX ? Math.round((preliminaryEarned / SCORE_MAX) * 100) : 0;
  let corroboration = null;
  if (preliminaryScore < 85 || bodyText.length < 600 || isSalla) {
    corroboration = await braveCorroboration(lead, lead.website);
    if (corroboration) {
      for (const key of ['hasPrimaryCta','hasBooking','hasPhoneOrWhatsApp','hasInstagram','hasFacebook']) {
        if (!checks[key] && corroboration[key]) checks[key] = true;
      }
    }
  }

  let earned = 0;
  for (const signal of signals) {
    const passed = Boolean(checks[signal.key]);
    if (!signal.negativeEligible && !passed) {
      result.signals[signal.key] = null;
      result.unknowns.push({
        signalKey: signal.key,
        label: signal.label,
        detail: signal.key === 'hasMetaPixel' && hasTagManager
          ? 'Google Tag Manager is present. Meta/ads tags may be injected dynamically, so absence cannot be concluded from raw HTML.'
          : 'This integration can be injected dynamically or rendered client-side. Public scanning cannot reliably prove absence.'
      });
      continue;
    }
    result.signals[signal.key] = passed;
    if (passed) {
      if (signal.scoreEligible) earned += signal.weight;
      result.wins.push(signal.label);
    } else if (signal.negativeEligible) {
      const severity = signal.weight >= 14 ? 'high' : signal.weight >= 8 ? 'medium' : 'low';
      result.issues.push({
        severity, signalKey: signal.key, service: signal.service,
        title: `Missing or weak: ${isEcommerce && signal.key === 'hasBooking' ? 'Cart / checkout path' : signal.label}`,
        detail: `The public page and indexed corroboration did not surface ${signal.label.toLowerCase()}.`
      });
    }
  }

  const relevanceIssues = contentRelevanceIssues(bodyText, bi);
  result.issues.push(...relevanceIssues);
  const relevancePenalty = relevanceIssues.reduce((s, i) => s + Number(i.weight || 0), 0);

  const baseScore = SCORE_MAX ? Math.min(100, Math.round((earned / SCORE_MAX) * 100)) : null;
  result.score = baseScore == null ? null : Math.max(0, baseScore - relevancePenalty);
  result.opportunity = opportunityEstimate(result.score, smartAssumptions);
  result.opportunityBreakdown = buildServiceBreakdown(result.issues, result.opportunity);
  result.evidence = {
    finalUrl: response.url,
    status: response.status,
    title: $('title').text().trim().slice(0, 180),
    metaDescription: ($('meta[name="description"]').attr('content') || '').trim().slice(0, 280),
    htmlTextLength: bodyText.length,
    platform: bi.platform,
    inferredIndustry: bi.industry,
    businessModel: bi.businessModel,
    categories: bi.categories,
    publicPriceSamples: bi.priceSamples,
    businessIntelligenceConfidence: bi.confidence,
    tagManagerDetected: hasTagManager,
    dynamicIntegrationPolicy: 'Tracking and social integrations use positive-only evidence; non-detection is unknown, not missing.',
    indexedCorroboration: corroboration ? { used: true, evidenceUrls: corroboration.evidenceUrls || [] } : { used: false }
  };
  return result;
}
