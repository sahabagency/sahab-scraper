function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundNice(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step = value >= 10000 ? 500 : value >= 3000 ? 250 : value >= 1000 ? 100 : value >= 300 ? 25 : 10;
  return Math.round(value / step) * step;
}

function normalizedIndustry(industry = '') {
  return String(industry).toLowerCase();
}

function categoryTicketBenchmark(industry = '') {
  const key = normalizedIndustry(industry);
  if (/water cooler|water storage|براد|خزان|industrial|equipment/.test(key)) return { low: 900, high: 6500, source: 'category_benchmark_equipment' };
  if (/aesthetic|cosmetic|derma|plastic|dental|clinic|medical|عياد|تجميل|اسنان|أسنان/.test(key)) return { low: 350, high: 3500, source: 'category_benchmark_clinic' };
  if (/restaurant|cafe|coffee|food|مطعم|كاف/.test(key)) return { low: 35, high: 180, source: 'category_benchmark_food' };
  if (/perfume|fragrance|oud|عطر|عطور|عود|بخور/.test(key)) return { low: 120, high: 750, source: 'category_benchmark_fragrance' };
  if (/honey|specialty food|عسل/.test(key)) return { low: 90, high: 450, source: 'category_benchmark_specialty_food' };
  if (/beauty|cosmetic|skincare|مكياج/.test(key)) return { low: 80, high: 500, source: 'category_benchmark_beauty_retail' };
  if (/real estate|property|law|legal|consult|عقار|محام|استشار/.test(key)) return { low: 1200, high: 8000, source: 'category_benchmark_professional_services' };
  return { low: 120, high: 1500, source: 'category_benchmark_general_commerce' };
}

function ticketFromObservedPricing(intel = {}, fallbackIndustry = '', anchor = null) {
  const p = intel.priceStats || {};
  if (Number(p.median) > 0) {
    const lowBase = Number(p.p25 || p.median);
    const highBase = Number(p.p75 || p.median);
    const b2bFactor = intel.commerce?.b2b ? 1.8 : 1.35;
    return {
      low: roundNice(Math.max(10, lowBase * 0.9)),
      high: roundNice(Math.max(lowBase, highBase * b2bFactor)),
      source: 'observed_site_prices',
      observedSamples: (p.samples || []).length
    };
  }
  if (Number(anchor) > 0) {
    return { low: roundNice(Number(anchor) * 0.65), high: roundNice(Number(anchor) * 1.35), source: 'campaign_anchor' };
  }
  return categoryTicketBenchmark(intel.industry || fallbackIndustry);
}

function reviewActivityProxy(reviewCount = 0) {
  const reviews = Math.max(0, Number(reviewCount) || 0);
  if (!reviews) return null;
  return clamp(Math.round(Math.sqrt(reviews) * 2.2), 8, 120);
}

function commerceDemandBand({ lead, intel, monthlyLeadAnchor }) {
  const activityProxy = reviewActivityProxy(lead.reviewCount);
  if (Number(monthlyLeadAnchor) > 0) {
    let mid = Number(monthlyLeadAnchor);
    if (activityProxy) mid = mid * 0.65 + activityProxy * 0.35;
    return { low: clamp(roundNice(mid * 0.55), 5, 250), high: clamp(roundNice(mid * 1.45), 10, 320), source: 'campaign_anchor_plus_public_activity' };
  }

  // URL-only scan: infer a conservative demand envelope from public business footprint, not a claimed traffic/lead count.
  let mid = activityProxy || 18;
  if (intel?.commerce?.ecommerce) mid *= 1.25;
  if (intel?.commerce?.b2b) mid *= 0.8; // fewer but higher-value opportunities for project/B2B businesses.
  if ((intel?.pagesScanned || []).length >= 4) mid *= 1.1;
  return {
    low: clamp(roundNice(mid * 0.45), 4, 160),
    high: clamp(roundNice(mid * 1.6), 12, 240),
    source: activityProxy ? 'public_activity_demand_envelope' : 'category_demand_envelope'
  };
}

export function buildCommercialProfile({ lead = {}, industry = '', averageTicketAnchor = null, monthlyLeadAnchor = null } = {}) {
  const intel = lead.siteIntelligence || {};
  const inferredIndustry = intel.industry || industry || '';
  const ticket = ticketFromObservedPricing(intel, inferredIndustry, averageTicketAnchor);
  const demand = commerceDemandBand({ lead, intel, monthlyLeadAnchor });
  const activityProxy = reviewActivityProxy(lead.reviewCount);

  const evidence = [];
  let confidence = 32;

  if (intel?.confidence) {
    confidence += Math.round(Number(intel.confidence) * 0.18);
    evidence.push(`website business intelligence: ${intel.businessType || 'business'} / ${intel.industry || 'unclassified'} (${intel.confidence}% confidence)`);
  }
  if (intel?.platform?.name && intel.platform.name !== 'Custom/Unknown') {
    confidence += 6;
    evidence.push(`commerce platform detected: ${intel.platform.name}`);
  }
  if (intel?.currency?.currency) evidence.push(`site currency detected: ${intel.currency.currency}`);
  if (ticket.source === 'observed_site_prices') {
    confidence += 18;
    evidence.push(`ticket range grounded in ${ticket.observedSamples || 0} public site price sample(s)`);
  } else if (ticket.source === 'campaign_anchor') {
    confidence += 8;
    evidence.push('campaign average-ticket value used as an anchor');
  } else {
    confidence += 3;
    evidence.push(`ticket range uses ${ticket.source} because public product prices were not reliably extractable`);
  }
  if (activityProxy) {
    confidence += 8;
    evidence.push(`Google review volume (${Number(lead.reviewCount).toLocaleString('en-US')}) used only as a bounded demand/activity proxy`);
  }
  if (lead.website) confidence += 6;
  if (lead.contactEmail) confidence += 3;
  if (intel?.commerce?.b2b) evidence.push('project/B2B sales path detected; model uses lower-volume, higher-value opportunity shape');

  const monthlyCommercialLow = ticket.low * demand.low;
  const monthlyCommercialHigh = ticket.high * demand.high;
  const currency = intel?.currency?.currency || 'SAR';

  return {
    method: 'business_intelligence_commercial_model_v2',
    confidence: clamp(confidence, 30, 88),
    currency,
    inferredIndustry,
    businessModel: intel?.commerce?.businessModel || null,
    platform: intel?.platform?.name || null,
    averageTicketAnchor: Number(averageTicketAnchor) || null,
    monthlyLeadAnchor: Number(monthlyLeadAnchor) || null,
    averageTicketRange: { low: ticket.low, high: ticket.high },
    averageTicketSource: ticket.source,
    monthlyLeadRange: { low: demand.low, high: demand.high },
    monthlyLeadSource: demand.source,
    monthlyCommercialValueRange: { low: roundNice(monthlyCommercialLow), high: roundNice(monthlyCommercialHigh) },
    observedPriceStats: intel?.priceStats || null,
    activityProxy: activityProxy ? { type: 'google_review_volume', value: activityProxy } : null,
    evidence,
    disclaimer: 'Commercial ranges are modeled from the business type, platform, public product pricing when extractable, and public footprint. They are not verified CRM, traffic, ad-spend, order, or accounting data.'
  };
}
