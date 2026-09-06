function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundNice(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step = value >= 10000 ? 500 : value >= 3000 ? 250 : value >= 1000 ? 100 : 50;
  return Math.round(value / step) * step;
}

function normalizedIndustry(industry = '') {
  return String(industry).toLowerCase();
}

function ticketBand(anchor, industry) {
  const key = normalizedIndustry(industry);
  let lowFactor = 0.6;
  let highFactor = 1.25;

  if (/aesthetic|cosmetic|derma|plastic|dental|clinic|medical|عياد|تجميل|اسنان|أسنان/.test(key)) {
    lowFactor = 0.55;
    highFactor = 1.35;
  } else if (/restaurant|cafe|coffee|food|مطعم|كاف/.test(key)) {
    lowFactor = 0.5;
    highFactor = 1.15;
  } else if (/real estate|property|law|legal|consult|عقار|محام|استشار/.test(key)) {
    lowFactor = 0.65;
    highFactor = 1.5;
  } else if (/ecommerce|store|retail|shop|متجر|تجزئ/.test(key)) {
    lowFactor = 0.55;
    highFactor = 1.3;
  }

  return {
    low: roundNice(anchor * lowFactor),
    high: roundNice(anchor * highFactor)
  };
}

function reviewActivityProxy(reviewCount = 0) {
  const reviews = Math.max(0, Number(reviewCount) || 0);
  if (!reviews) return null;
  // Reviews are not leads. This is only a bounded public activity proxy used to widen/narrow the assumption band.
  return clamp(Math.round(Math.sqrt(reviews) * 2.4), 12, 120);
}

export function buildCommercialProfile({ lead = {}, industry = '', averageTicketAnchor = 2500, monthlyLeadAnchor = 40 } = {}) {
  const ticketAnchor = Math.max(1, Number(averageTicketAnchor) || 2500);
  const leadAnchor = Math.max(1, Number(monthlyLeadAnchor) || 40);
  const ticket = ticketBand(ticketAnchor, industry);
  const activityProxy = reviewActivityProxy(lead.reviewCount);

  let modeledLeadMid = leadAnchor;
  const evidence = ['campaign ticket/lead values used as model anchors, not verified business data'];
  let confidence = 35;

  if (activityProxy) {
    modeledLeadMid = (leadAnchor * 0.65) + (activityProxy * 0.35);
    confidence += 10;
    evidence.push(`Google review volume (${Number(lead.reviewCount).toLocaleString('en-US')}) used only as a bounded activity proxy`);
  }
  if (lead.rating != null) {
    confidence += 5;
    evidence.push(`Google rating (${lead.rating}) observed`);
  }
  if (lead.website) {
    confidence += 10;
    evidence.push('verified public website available');
  }
  if (lead.contactEmail) {
    confidence += 5;
    evidence.push('public business email discovered');
  }
  if (lead.contactRoute?.channel && !['research_required', 'phone'].includes(lead.contactRoute.channel)) {
    confidence += 5;
    evidence.push(`direct public contact route: ${lead.contactRoute.channel}`);
  }

  const footprintFactor = lead.website ? 1 : 0.85;
  const leadLow = clamp(roundNice(modeledLeadMid * 0.6 * footprintFactor), 5, 250);
  const leadHigh = clamp(roundNice(modeledLeadMid * 1.45), Math.max(leadLow + 5, 10), 300);

  const commercialLow = ticket.low * leadLow;
  const commercialHigh = ticket.high * leadHigh;

  return {
    method: 'public_footprint_assumption_model_v1',
    confidence: clamp(confidence, 30, 75),
    currency: 'SAR',
    averageTicketAnchor: ticketAnchor,
    monthlyLeadAnchor: leadAnchor,
    averageTicketRange: ticket,
    monthlyLeadRange: { low: leadLow, high: leadHigh },
    monthlyCommercialValueRange: {
      low: roundNice(commercialLow),
      high: roundNice(commercialHigh)
    },
    activityProxy: activityProxy ? { type: 'google_review_volume', value: activityProxy } : null,
    evidence,
    disclaimer: 'Commercial assumptions are modeled from public footprint plus campaign anchors. They are not verified CRM, traffic, ad-spend, booking, or revenue data.'
  };
}
