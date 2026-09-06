function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(value, max) {
  return max ? clamp(Number(value) / max, 0, 1) : 0;
}

const UNCERTAIN_TRACKING_SIGNALS = new Set(['hasAnalytics', 'hasMetaPixel']);

function actionableIssues(audit = {}) {
  return (audit.issues || []).filter(issue => !UNCERTAIN_TRACKING_SIGNALS.has(issue.signalKey));
}

export function qualifyLead({ lead = {}, audit = {} } = {}) {
  const reasons = [];
  const warnings = [];
  const route = lead.contactRoute || {};
  const profile = audit.commercialProfile || {};
  const opportunity = audit.opportunity || {};
  const issues = audit.issues || [];
  const actionable = actionableIssues(audit);
  const reviewCount = Math.max(0, Number(lead.reviewCount) || 0);

  if (String(lead.businessStatus || '').toUpperCase() === 'CLOSED_PERMANENTLY') {
    return {
      score: 0,
      tier: 'REJECT',
      label: 'Do not contact',
      sendEligible: false,
      reasonCode: 'closed_permanently',
      reasons: ['Google business status indicates the location is permanently closed.'],
      warnings: []
    };
  }

  let identity = 0;
  if (lead.placeId) identity += 6;
  if (lead.name) identity += 3;
  if (lead.address) identity += 3;
  if (lead.website) identity += 5;
  if (lead.discovery?.sourceType === 'discovered_official_website' || lead.discovery?.websiteMatch?.confidence >= 85) identity += 3;
  identity = clamp(identity, 0, 20);
  if (identity >= 15) reasons.push('Strong business identity match from Google/public web evidence.');
  else warnings.push('Business identity evidence is incomplete.');

  let contactability = 0;
  const emailConfidence = Number(lead.contactEmailConfidence) || (lead.contactEmail ? 80 : 0);
  if (lead.contactEmail && emailConfidence >= 90) contactability = 25;
  else if (lead.contactEmail && emailConfidence >= 75) contactability = 21;
  else if (route.channel === 'linkedin' && Number(route.confidence) >= 80) contactability = 15;
  else if (route.channel === 'instagram' && Number(route.confidence) >= 80) contactability = 13;
  else if (route.channel === 'whatsapp' && Number(route.confidence) >= 80) contactability = 12;
  else if (lead.phone) contactability = 8;
  if (lead.contactEmail) reasons.push(`Public business email found (${emailConfidence}% confidence).`);
  else warnings.push(`No qualified public business email yet; best route is ${route.channel || 'research_required'}.`);

  let evidence = 0;
  if (audit.auditMode === 'website' && audit.score != null) evidence += 7;
  evidence += Math.round(pct(opportunity.confidence, 100) * 7);
  if (audit.evidence?.indexedCorroboration?.used) evidence += 3;
  if (actionable.length) evidence += 3;
  evidence = clamp(evidence, 0, 20);
  if (actionable.length) reasons.push(`${actionable.length} actionable public gap(s) supported by the audit.`);
  if (!actionable.length && issues.length) warnings.push('Only uncertain/measurement signals were found; no strong customer-facing gap yet.');

  let commercial = 0;
  const profileConfidence = Number(profile.confidence) || 0;
  commercial += Math.round(pct(profileConfidence, 75) * 8);
  if (reviewCount >= 50) commercial += 2;
  if (reviewCount >= 200) commercial += 2;
  if (reviewCount >= 800) commercial += 2;
  const annualHigh = Number(opportunity.annualRange?.high) || 0;
  if (annualHigh >= 24000) commercial += 2;
  if (annualHigh >= 60000) commercial += 2;
  if (lead.rating != null) commercial += 2;
  commercial = clamp(commercial, 0, 20);

  let riskPenalty = 0;
  if (!lead.website) riskPenalty += 5;
  if (!lead.contactEmail) riskPenalty += 4;
  if ((Number(route.confidence) || 0) < 70 && route.destination) riskPenalty += 4;
  if (audit.auditMode === 'presence_only') riskPenalty += 4;
  if (opportunity.confidence != null && Number(opportunity.confidence) < 45) riskPenalty += 4;
  if (!actionable.length) riskPenalty += 5;
  riskPenalty = clamp(riskPenalty, 0, 20);

  const score = clamp(identity + contactability + evidence + commercial - riskPenalty, 0, 100);

  let tier = 'REJECT';
  if (score >= 80 && lead.contactEmail && emailConfidence >= 85 && Number(opportunity.confidence || 0) >= 55 && actionable.length >= 1) tier = 'A';
  else if (score >= 64 && (lead.contactEmail || ['linkedin','instagram','whatsapp'].includes(route.channel)) && actionable.length >= 1) tier = 'B';
  else if (score >= 42 && (route.destination || lead.phone || lead.website)) tier = 'C';

  const sendEligible = tier === 'A' && Boolean(lead.contactEmail);
  const label = tier === 'A'
    ? 'High fit · send eligible'
    : tier === 'B'
      ? 'Good fit · review first'
      : tier === 'C'
        ? 'Weak/partial evidence · research'
        : 'Do not contact';

  if (tier === 'A') reasons.push('Evidence, contact confidence and commercial relevance clear the automatic-send quality gate.');
  if (tier === 'B') warnings.push('Useful lead, but at least one quality gate needs human review before email send.');
  if (tier === 'C') warnings.push('Do more contact/evidence research before outreach.');
  if (tier === 'REJECT') warnings.push('Insufficient evidence/contact quality for outreach.');

  return {
    score,
    tier,
    label,
    sendEligible,
    components: { identity, contactability, evidence, commercial, riskPenalty },
    gates: {
      verifiedEmail: Boolean(lead.contactEmail && emailConfidence >= 85),
      sufficientOpportunityConfidence: Number(opportunity.confidence || 0) >= 55,
      actionableGap: actionable.length >= 1,
      websiteAudit: audit.auditMode === 'website' && audit.score != null
    },
    reasons,
    warnings
  };
}

export function statusForQualification(lead, qualification) {
  if (qualification?.tier === 'REJECT') return 'rejected';
  if (qualification?.tier === 'A' && lead.contactEmail) return 'ready_to_send';
  if (qualification?.tier === 'B') return 'needs_review';
  if (qualification?.tier === 'C') return 'research_required';
  return lead.contactEmail ? 'needs_review' : 'needs_contact';
}
