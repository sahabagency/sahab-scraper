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
    const p25 = Number(p.p25 || p.median);
    const p75 = Number(p.p75 || p.median);
    const ecommerce = Boolean(intel.commerce?.ecommerce);
    // Direct ecommerce AOV should stay grounded in the store's observed product-price distribution.
    // A B2B/project path is modeled separately and must not inflate the consumer order value.
    const basketHighFactor = ecommerce ? 1.18 : 1.30;
    return {
      low: roundNice(Math.max(10, p25 * 0.90)),
      high: roundNice(Math.max(p25, p75 * basketHighFactor)),
      source: 'observed_site_prices',
      observedSamples: Number(p.sampleCount) || (p.samples || []).length,
      observedMedian: Number(p.median) || null
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
  const ecommerce = Boolean(intel?.commerce?.ecommerce);
  const b2b = Boolean(intel?.commerce?.b2b);

  if (Number(monthlyLeadAnchor) > 0) {
    let mid = Number(monthlyLeadAnchor);
    if (activityProxy) mid = mid * 0.65 + activityProxy * 0.35;
    return {
      low: clamp(roundNice(mid * 0.55), 5, 250),
      high: clamp(roundNice(mid * 1.45), 10, 320),
      source: 'campaign_anchor_plus_public_activity',
      unit: ecommerce ? 'orders' : 'leads'
    };
  }

  // URL-only scan: this is a scenario envelope, not a measured order/lead count.
  // Do not reduce the direct ecommerce order envelope merely because a secondary B2B path exists.
  let mid = activityProxy || (ecommerce ? 18 : 14);
  if (ecommerce) mid *= 1.15;
  if (!ecommerce && b2b) mid *= 0.75;
  if ((intel?.pagesScanned || []).length >= 4) mid *= 1.08;
  return {
    low: clamp(roundNice(mid * 0.45), 4, 160),
    high: clamp(roundNice(mid * 1.45), 10, 220),
    source: activityProxy ? 'public_activity_demand_envelope' : 'business_model_prior',
    unit: ecommerce ? 'orders' : 'leads'
  };
}

function b2bScenario(intel = {}, directTicket = {}) {
  if (!intel?.commerce?.b2b) return null;
  const f = intel.funnelSignals || {};
  const median = Number(intel.priceStats?.median) || Math.round(((Number(directTicket.low) || 0) + (Number(directTicket.high) || 0)) / 2) || null;
  // Keep this deliberately separate from direct ecommerce AOV. We only expose a scenario, never verified pipeline value.
  const multiplierLow = f.quoteRequestDetected || f.b2bConversionDetected ? 1.5 : 1.2;
  const multiplierHigh = f.quoteRequestDetected || f.b2bConversionDetected ? 4.0 : 2.5;
  return median ? {
    opportunityValueRange: { low: roundNice(median * multiplierLow), high: roundNice(median * multiplierHigh) },
    modeledMonthlyOpportunityCount: { low: 1, high: (f.quoteRequestDetected || f.b2bConversionDetected) ? 4 : 2 },
    source: 'secondary_b2b_project_scenario',
    confidence: f.quoteRequestDetected || f.b2bConversionDetected ? 58 : 42,
    disclaimer: 'Secondary B2B/project scenario inferred from the public project path. It is not verified quotation volume, win rate or contract value.'
  } : null;
}

export function buildCommercialProfile({ lead = {}, industry = '', averageTicketAnchor = null, monthlyLeadAnchor = null } = {}) {
  const intel = lead.siteIntelligence || {};
  const inferredIndustry = intel.industry || industry || '';
  const ticket = ticketFromObservedPricing(intel, inferredIndustry, averageTicketAnchor);
  const demand = commerceDemandBand({ lead, intel, monthlyLeadAnchor });
  const activityProxy = reviewActivityProxy(lead.reviewCount);
  const ecommerce = Boolean(intel?.commerce?.ecommerce);

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
    evidence.push(`direct ${ecommerce ? 'order-value' : 'ticket'} range grounded in ${ticket.observedSamples || 0} public site price sample(s); observed median ${ticket.observedMedian || 'n/a'}`);
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
  if (intel?.commerce?.b2b) evidence.push('project/B2B path detected and modeled separately from direct ecommerce order value');

  const monthlyCommercialLow = ticket.low * demand.low;
  const monthlyCommercialHigh = ticket.high * demand.high;
  const detectedCurrency = intel?.currency?.currency || 'SAR';
  const currency = detectedCurrency === 'SAR' ? 'SAR' : detectedCurrency;
  const b2b = b2bScenario(intel, ticket);

  return {
    method: 'business_intelligence_commercial_model_v3',
    confidence: clamp(confidence, 30, 88),
    currency,
    inferredIndustry,
    businessModel: intel?.commerce?.businessModel || null,
    platform: intel?.platform?.name || null,
    averageTicketAnchor: Number(averageTicketAnchor) || null,
    monthlyLeadAnchor: Number(monthlyLeadAnchor) || null,
    averageTicketRange: { low: ticket.low, high: ticket.high },
    averageTicketSource: ticket.source,
    observedMedianTicket: ticket.observedMedian || null,
    monthlyLeadRange: { low: demand.low, high: demand.high },
    monthlyLeadSource: demand.source,
    volumeUnit: demand.unit,
    monthlyCommercialValueRange: { low: roundNice(monthlyCommercialLow), high: roundNice(monthlyCommercialHigh) },
    directEcommerceScenario: ecommerce ? {
      orderValueRange: { low: ticket.low, high: ticket.high },
      orderCountRange: { low: demand.low, high: demand.high },
      monthlyCommerceScenarioRange: { low: roundNice(monthlyCommercialLow), high: roundNice(monthlyCommercialHigh) }
    } : null,
    secondaryB2BScenario: b2b,
    observedPriceStats: intel?.priceStats || null,
    activityProxy: activityProxy ? { type: 'google_review_volume', value: activityProxy } : null,
    evidence,
    disclaimer: ecommerce
      ? 'Direct ecommerce scenario is built from observed store prices and a conservative order-count envelope. Secondary B2B/project sales are modeled separately. These are not verified orders, GMV, ad spend or accounting data.'
      : 'Commercial ranges are modeled from the business type, public pricing when extractable, and public footprint. They are not verified CRM, traffic, ad-spend, order, or accounting data.'
  };
}
