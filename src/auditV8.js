import { auditLead as auditLeadV7 } from './auditV7.js';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function roundNice(v){if(!Number.isFinite(v)||v<=0)return 0;const s=v>=20000?1000:v>=10000?500:v>=3000?250:v>=1000?100:v>=300?25:10;return Math.round(v/s)*s;}

function normalizeIndustryLabel(value=''){
  const s=String(value||'').trim();
  if(/water colors?/i.test(s)) return 'water coolers, water dispensers & storage solutions';
  return s;
}

function coreTicket(profile={},bi={}){
  const core=bi.coreProductPriceStats||{};
  if(n(core.sampleCount)>=2 && n(core.median)>0){
    const low=Math.max(10,roundNice((n(core.p25)||n(core.median))*0.95));
    const high=Math.max(low,roundNice((n(core.p75)||n(core.median))*1.12));
    return {low,high,median:n(core.median),source:'observed_core_product_prices',sampleCount:n(core.sampleCount)};
  }
  const range=profile.averageTicketRange||{};
  return {low:n(range.low),high:n(range.high),median:n(profile.observedMedianTicket)||Math.round((n(range.low)+n(range.high))/2),source:profile.averageTicketSource||'existing_model',sampleCount:n(bi.priceStats?.sampleCount)};
}

function adjustCommercialProfile(audit={}){
  const bi=audit.businessIntelligence||{};
  const profile={...(audit.commercialProfile||{})};
  const ticket=coreTicket(profile,bi);
  if(!ticket.low||!ticket.high)return audit;

  const volume=profile.monthlyLeadRange||{};
  const oldLow=n(profile.monthlyCommercialValueRange?.low);
  const oldHigh=n(profile.monthlyCommercialValueRange?.high);
  const newLow=roundNice(ticket.low*Math.max(1,n(volume.low)||1));
  const newHigh=roundNice(ticket.high*Math.max(n(volume.low)||1,n(volume.high)||1));

  profile.averageTicketRange={low:ticket.low,high:ticket.high};
  profile.averageTicketSource=ticket.source;
  profile.observedMedianTicket=ticket.median;
  profile.coreProductPriceSampleCount=ticket.sampleCount;
  profile.monthlyCommercialValueRange={low:newLow,high:newHigh};
  profile.evidence=[...(profile.evidence||[]).filter(x=>!String(x).startsWith('direct order-value range grounded in')),
    ticket.source==='observed_core_product_prices'?`core order-value range grounded in ${ticket.sampleCount} observed core-product price sample(s); median ${ticket.median} SAR`:`order-value model retained from ${ticket.source}`];
  profile.confidence=clamp(n(profile.confidence)+(ticket.source==='observed_core_product_prices'?4:0),30,92);
  audit.commercialProfile=profile;

  const opp=audit.opportunity||{};
  if(opp.displayEligible&&oldHigh>0&&newHigh>0&&Array.isArray(audit.opportunityBreakdown)){
    const lowScale=oldLow>0?clamp(newLow/oldLow,.65,1.55):1;
    const highScale=clamp(newHigh/oldHigh,.65,1.55);
    const rows=audit.opportunityBreakdown.map(row=>{
      const ml=roundNice(n(row.monthlyRange?.low)*lowScale);
      const mh=Math.max(ml,roundNice(n(row.monthlyRange?.high)*highScale));
      return {...row,monthlyRange:{low:ml,high:mh},annualRange:{low:ml*12,high:mh*12}};
    });
    const monthlyLow=roundNice(rows.reduce((s,x)=>s+n(x.monthlyRange?.low),0));
    const monthlyHigh=roundNice(rows.reduce((s,x)=>s+n(x.monthlyRange?.high),0));
    audit.opportunityBreakdown=rows;
    audit.opportunity={...opp,monthlyRange:{low:monthlyLow,high:monthlyHigh},annualRange:{low:monthlyLow*12,high:monthlyHigh*12},currency:'SAR',businessBaseline:{...(opp.businessBaseline||{}),coreMedianObservedTicket:ticket.median,coreProductPriceRange:{low:ticket.low,high:ticket.high},corePriceSamples:ticket.sampleCount},basis:`${opp.basis||''} Core-product pricing is separated from accessories/tanks when identifiable, so the direct-commerce value model reflects the primary products rather than mixing every SKU into one basket.`};
  }
  return audit;
}

function buildDossier(audit={}){
  const bi=audit.businessIntelligence||{};
  const profile=audit.commercialProfile||{};
  const f=bi.funnelSignals||{};
  const industry=normalizeIndustryLabel(bi.industry||profile.inferredIndustry||'');
  bi.industry=industry;
  const trackerStates={
    analytics: audit.signals?.hasAnalytics===true?'verified':audit.signals?.hasAnalytics===null?'unknown':'not_verified',
    metaPixel: audit.signals?.hasMetaPixel===true?'verified':audit.signals?.hasMetaPixel===null?'unknown':'not_verified',
    instagram: audit.signals?.hasInstagram===true?'verified':audit.signals?.hasInstagram===null?'unknown':'not_verified',
    facebook: audit.signals?.hasFacebook===true?'verified':audit.signals?.hasFacebook===null?'unknown':'not_verified'
  };
  audit.businessDossier={
    brandName:bi.brandName||null,
    industry,
    businessType:bi.businessModel||null,
    primaryRevenueMotion:bi.primaryRevenueMotion||null,
    secondaryRevenueMotions:bi.secondaryRevenueMotions||[],
    platform:bi.platform||null,
    currency:bi.currency||profile.currency||'SAR',
    productFamilies:bi.productFamilies||[],
    products:(bi.products||[]).slice(0,12),
    categories:(bi.categories||[]).slice(0,12),
    targetSegments:bi.targetSegments||[],
    valuePropositions:bi.valuePropositions||[],
    coreProductPricing:bi.coreProductPriceStats||null,
    allObservedPricing:bi.priceStats||null,
    funnel:{cart:f.cartDetected,checkout:f.checkoutDetected,b2b:f.b2bSecondaryDetected||f.b2bDetected,b2bPage:f.b2bPageDetected,quoteRequest:f.quoteRequestDetected,whatsapp:f.whatsappDetected,reviews:f.reviewsDetected,content:f.blogDetected,loyalty:f.loyaltyDetected,installments:f.installmentDetected,freeDelivery:f.freeDeliveryDetected},
    trackerStates,
    confidence:bi.confidence||null,
    note:'This dossier is inferred from the URL and sampled public pages. Verified facts and modeled commercial assumptions remain separate.'
  };
  audit.businessIntelligence=bi;
  return audit;
}

export async function auditLead(lead,assumptions={}){
  let audit=await auditLeadV7(lead,assumptions);
  audit=adjustCommercialProfile(audit);
  audit=buildDossier(audit);
  return audit;
}
