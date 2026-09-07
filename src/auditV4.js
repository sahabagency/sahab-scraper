import { auditLead as auditLeadV3 } from './auditV3.js';

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function roundNice(value){
  if(!Number.isFinite(value)||value<=0)return 0;
  const step=value>=10000?500:value>=3000?250:value>=1000?100:50;
  return Math.round(value/step)*step;
}

function canModelHeadroom(audit={}){
  const bi=audit.businessIntelligence||{};
  const profile=audit.commercialProfile||{};
  const low=Number(profile.monthlyCommercialValueRange?.low)||0;
  const high=Number(profile.monthlyCommercialValueRange?.high)||0;
  const priceSamples=Number(bi.priceStats?.sampleCount||0);
  const commerce=String(bi.businessModel||'').includes('ecommerce');
  return Boolean(
    audit.website &&
    commerce &&
    Number(bi.confidence||0)>=65 &&
    Number(profile.confidence||0)>=50 &&
    low>0 && high>0 &&
    (priceSamples>=2 || Number(bi.averageTicketAnchor||0)>0)
  );
}

function applyBusinessContextHeadroom(audit={}){
  const opportunity=audit.opportunity||{};
  const currentHigh=Number(opportunity.monthlyRange?.high)||0;
  if(currentHigh>0 || !canModelHeadroom(audit)) return audit;

  const bi=audit.businessIntelligence||{};
  const profile=audit.commercialProfile||{};
  const commercialLow=Number(profile.monthlyCommercialValueRange?.low)||0;
  const commercialHigh=Number(profile.monthlyCommercialValueRange?.high)||0;

  // This is intentionally modest. It is growth headroom, not a claim of current loss.
  // The band widens slightly only when the site shows both ecommerce and a B2B/project motion.
  const b2b=Boolean(bi.funnelSignals?.b2bDetected || bi.funnelSignals?.b2bPageDetected || bi.funnelSignals?.b2bSecondaryDetected);
  const lowRate=b2b?0.006:0.004;
  const highRate=b2b?0.018:0.012;
  const low=roundNice(commercialLow*lowRate);
  const high=Math.max(low,roundNice(commercialHigh*highRate));
  const confidence=Math.round((Number(bi.confidence||0)*0.55)+(Number(profile.confidence||0)*0.45));

  audit.opportunity={
    ...opportunity,
    monthlyRange:{low,high},
    annualRange:{low:low*12,high:high*12},
    displayEligible:true,
    confidence:clamp(confidence,45,82),
    evidenceConfidence:Number(bi.confidence||0),
    assumptionConfidence:Number(profile.confidence||0),
    method:'business_context_growth_headroom_v1',
    opportunityType:'growth_headroom',
    verifiedMonetizableIssueCount:0,
    verifiedMonetizableWeight:0,
    basis:'No major verified conversion leak was found. This range is a conservative modeled growth-headroom band derived from the observed ecommerce model, public product pricing, customer segments and sales paths. It is not a claim that the business is currently losing this amount.',
    disclaimer:'Modeled growth opportunity, not verified lost revenue. Public pricing and site structure are observed; demand and conversion uplift are modeled assumptions.'
  };
  audit.opportunityBreakdown=[];
  return audit;
}

export async function auditLead(lead,assumptions={}){
  const audit=await auditLeadV3(lead,assumptions);
  return applyBusinessContextHeadroom(audit);
}
