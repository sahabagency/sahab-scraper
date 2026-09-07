import { auditLead as auditLeadV3 } from './auditV3.js';

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function roundNice(value){
  if(!Number.isFinite(value)||value<=0)return 0;
  const step=value>=10000?500:value>=3000?250:value>=1000?100:value>=300?25:10;
  return Math.round(value/step)*step;
}

function normalizeProfileSources(audit={}, assumptions={}){
  const bi=audit.businessIntelligence||{};
  const profile=audit.commercialProfile||{};
  const next={...profile};
  if(!Number(assumptions.averageTicket) && bi.averageTicketSource){
    next.averageTicketSource=bi.averageTicketSource;
    next.averageTicketAnchor=Number(bi.averageTicketAnchor)||next.averageTicketAnchor||null;
  }
  if(!Number(assumptions.monthlyLeadEstimate) && bi.monthlyLeadSource){
    next.monthlyLeadSource=bi.monthlyLeadSource;
    next.monthlyLeadAnchor=Number(bi.monthlyLeadAnchor)||next.monthlyLeadAnchor||null;
  }
  audit.commercialProfile=next;
  if(audit.opportunity?.assumptions){
    audit.opportunity={...audit.opportunity,assumptions:{...audit.opportunity.assumptions,averageTicketSource:next.averageTicketSource||null,monthlyLeadSource:next.monthlyLeadSource||null}};
  }
  return audit;
}

function canModelHeadroom(audit={}){
  const bi=audit.businessIntelligence||{};
  const profile=audit.commercialProfile||{};
  const low=Number(profile.monthlyCommercialValueRange?.low)||0;
  const high=Number(profile.monthlyCommercialValueRange?.high)||0;
  const priceSamples=Number(bi.priceStats?.sampleCount||0);
  const commerce=String(bi.businessModel||'').includes('ecommerce');
  return Boolean(
    audit.website && commerce && Number(bi.confidence||0)>=65 && Number(profile.confidence||0)>=50 && low>0 && high>0 &&
    (priceSamples>=2 || Number(bi.averageTicketAnchor||0)>0)
  );
}

function addLever(list,{service,reason,lowRate,highRate,confidence=60}){
  if(highRate<=0)return;
  list.push({service,reason,lowRate,highRate,confidence,modeled:true});
}

function businessLevers(bi={}){
  const f=bi.funnelSignals||{};
  const p=bi.pageInventory||{};
  const ecommerce=String(bi.businessModel||'').includes('ecommerce');
  const b2b=Boolean(f.b2bDetected||f.b2bSecondaryDetected||f.b2bPageDetected||String(bi.businessModel||'').toLowerCase().includes('b2b'));
  const levers=[];

  if(ecommerce && Number(p.productLinks||0)>=3){
    addLever(levers,{service:'Product discovery & merchandising',reason:`متجر بكتالوج فعلي (${Number(p.productLinks||0)} روابط منتجات مرصودة)؛ النموذج يحسب مساحة تحسين محافظة للاكتشاف، ترتيب المنتجات، والـmerchandising وليس خللًا مثبتًا.`,lowRate:0.0015,highRate:0.0045,confidence:68});
  }
  if(ecommerce && Number(p.categoryLinks||0)>=2){
    addLever(levers,{service:'SEO & category demand capture',reason:`تم رصد ${Number(p.categoryLinks||0)} تصنيفات؛ يوجد مجال نمو نمذجي من صفحات التصنيفات والبحث العضوي بدون افتراض أن الـSEO الحالي ضعيف.`,lowRate:0.001,highRate:0.0035,confidence:62});
  }
  if(b2b){
    if(f.quoteRequestDetected||f.b2bConversionDetected){
      addLever(levers,{service:'B2B / project pipeline expansion',reason:'مسار المشاريع والشركات موجود ومعه مسار تحويل مرصود؛ لذلك نحسب فقط مساحة توسع محافظة في الـpipeline وليس تسريبًا من غياب المسار.',lowRate:0.0008,highRate:0.0025,confidence:67});
    }else{
      addLever(levers,{service:'B2B / project lead capture',reason:'طلب المشاريع/الشركات ظاهر علنًا لكن مسار طلب عرض سعر مخصص لم يتم التحقق منه في الصفحات التي تم فحصها.',lowRate:0.0035,highRate:0.010,confidence:76});
    }
  }
  if(ecommerce && f.reviewsDetected){
    addLever(levers,{service:'Product conversion optimization',reason:'التقييمات ومسار الشراء موجودان؛ النموذج لا يعتبرهما مفقودين، لكنه يحسب مساحة CRO صغيرة ومحافظة على صفحات المنتجات.',lowRate:0.0007,highRate:0.0022,confidence:58});
  }
  if(ecommerce && !f.reviewsDetected && Number(p.productLinks||0)>0){
    // auditV3 normally creates a verified issue before this layer. Keep this only as a fallback model.
    addLever(levers,{service:'Product social proof',reason:'صفحات منتجات موجودة لكن social proof على مستوى المنتج لم يتم التحقق منه.',lowRate:0.002,highRate:0.006,confidence:70});
  }
  if(f.loyaltyDetected){
    addLever(levers,{service:'Retention / loyalty optimization',reason:'برنامج ولاء ظاهر؛ لذلك نحسب فقط headroom محدود لتحسين التفعيل والعودة، ولا نعتبر الولاء مفقودًا.',lowRate:0.0005,highRate:0.0015,confidence:55});
  }
  return levers.slice(0,5);
}

function applyBusinessContextHeadroom(audit={}){
  const opportunity=audit.opportunity||{};
  const currentHigh=Number(opportunity.monthlyRange?.high)||0;
  if(currentHigh>0 || !canModelHeadroom(audit)) return audit;

  const bi=audit.businessIntelligence||{};
  const profile=audit.commercialProfile||{};
  const commercialLow=Number(profile.monthlyCommercialValueRange?.low)||0;
  const commercialHigh=Number(profile.monthlyCommercialValueRange?.high)||0;
  const levers=businessLevers(bi);
  if(!levers.length)return audit;

  const rows=levers.map(x=>{
    const monthlyLow=roundNice(commercialLow*x.lowRate);
    const monthlyHigh=Math.max(monthlyLow,roundNice(commercialHigh*x.highRate));
    return {
      service:x.service,
      issues:[x.reason],
      modeled:true,
      confidence:x.confidence,
      monthlyRange:{low:monthlyLow,high:monthlyHigh},
      annualRange:{low:monthlyLow*12,high:monthlyHigh*12}
    };
  }).filter(x=>x.monthlyRange.high>0);

  const totalLow=roundNice(rows.reduce((s,x)=>s+x.monthlyRange.low,0));
  const totalHigh=roundNice(rows.reduce((s,x)=>s+x.monthlyRange.high,0));
  if(!totalHigh)return audit;

  const priceEvidence=Number(bi.priceStats?.sampleCount||0);
  const pageEvidence=Number(bi.evidence?.sampledPageCount||bi.sampledPages?.length||0);
  const confidence=Math.round(
    Number(bi.confidence||0)*0.45 + Number(profile.confidence||0)*0.35 + Math.min(20,priceEvidence*2+pageEvidence)
  );

  audit.opportunity={
    ...opportunity,
    monthlyRange:{low:totalLow,high:totalHigh},
    annualRange:{low:totalLow*12,high:totalHigh*12},
    currency:profile.currency||bi.currency||'SAR',
    displayEligible:true,
    confidence:clamp(confidence,50,86),
    evidenceConfidence:Number(bi.confidence||0),
    assumptionConfidence:Number(profile.confidence||0),
    method:'business_context_growth_headroom_v2',
    opportunityType:'growth_headroom',
    verifiedMonetizableIssueCount:0,
    verifiedMonetizableWeight:0,
    modeledLeverCount:rows.length,
    basis:'The range is built from this specific business: observed platform, product/catalog structure, public product pricing, B2C/B2B revenue paths, target segments and public activity proxies. Existing capabilities are not marked as missing; they receive only small optimization headroom. Unknown Pixel/social integrations are excluded from the money model.',
    disclaimer:'Modeled growth opportunity, not verified lost revenue. Product pricing and site structure are observed; order volume, traffic, ad spend and conversion uplift are modeled until first-party data is available.'
  };
  audit.opportunityBreakdown=rows;
  return audit;
}

export async function auditLead(lead,assumptions={}){
  let audit=await auditLeadV3(lead,assumptions);
  audit=normalizeProfileSources(audit,assumptions);
  return applyBusinessContextHeadroom(audit);
}
