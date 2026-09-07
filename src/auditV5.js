import { auditLead as auditLeadV4 } from './auditV4.js';
import { deepAuditSite } from './siteDeepAudit.js';

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function roundNice(v){if(!Number.isFinite(v)||v<=0)return 0;const s=v>=10000?500:v>=3000?250:v>=1000?100:v>=300?25:10;return Math.round(v/s)*s;}
function pct(v){return Number.isFinite(v)?Math.round(v*100):null;}

function rowFromRate({service,reason,lowRate,highRate,confidence,evidenceClass},commercialLow,commercialHigh){
  const low=roundNice(commercialLow*lowRate),high=Math.max(low,roundNice(commercialHigh*highRate));
  return{service,issues:[reason],modeled:true,evidenceClass,confidence,monthlyRange:{low,high},annualRange:{low:low*12,high:high*12}};
}

function verifiedRows(audit,deep){
  const bi=audit.businessIntelligence||{},f=bi.funnelSignals||{},profile=audit.commercialProfile||{};
  const low=Number(profile.monthlyCommercialValueRange?.low)||0,high=Number(profile.monthlyCommercialValueRange?.high)||0;
  if(!low||!high)return[];
  const rows=[];
  const seo=deep.categorySeo||{},pq=deep.productQuality||{};
  if(Number(seo.sampleCount)>=2){
    const weak=[seo.missingMetaRate,seo.missingCanonicalRate,seo.missingH1Rate,seo.nonIndexableRate,seo.thinContentRate].filter(Number.isFinite);
    const severity=weak.length?Math.max(...weak):0;
    if(severity>=0.25){
      rows.push(rowFromRate({service:'SEO & category demand capture',reason:`فحص ${seo.sampleCount} صفحات تصنيف كشف فجوة SEO قابلة للرصد: أعلى معدل ضعف ${pct(severity)}% بين الوصف/Canonical/H1/indexability/content depth.`,lowRate:0.0025,highRate:severity>=0.5?0.012:0.007,confidence:Math.round(65+Math.min(20,seo.sampleCount*3)),evidenceClass:'verified_gap'},low,high));
    }
  }
  if(Number(pq.sampleCount)>=2){
    const missingReviews=Number.isFinite(pq.reviewsRate)?1-pq.reviewsRate:0;
    const missingSchema=Number.isFinite(pq.schemaRate)?1-pq.schemaRate:0;
    const missingAvailability=Number.isFinite(pq.availabilityRate)?1-pq.availabilityRate:0;
    const missingCta=Number.isFinite(pq.ctaRate)?1-pq.ctaRate:0;
    const severity=Math.max(missingReviews,missingSchema,missingAvailability,missingCta);
    if(severity>=0.30){
      const details=[];if(missingReviews>=0.3)details.push(`reviews غير مرصودة في ${pct(missingReviews)}%`);if(missingSchema>=0.3)details.push(`Product schema غير مرصود في ${pct(missingSchema)}%`);if(missingAvailability>=0.3)details.push(`availability غير واضحة في ${pct(missingAvailability)}%`);if(missingCta>=0.3)details.push(`CTA غير واضح في ${pct(missingCta)}%`);
      rows.push(rowFromRate({service:'Product conversion optimization',reason:`فحص ${pq.sampleCount} صفحات منتجات: ${details.join('، ')}. هذه فجوات مرصودة على العينة وليست افتراضًا عامًا.`,lowRate:0.0015,highRate:severity>=0.6?0.010:0.006,confidence:Math.round(65+Math.min(20,pq.sampleCount*3)),evidenceClass:'verified_gap'},low,high));
    }
  }
  const b2b=Boolean(f.b2bDetected||f.b2bSecondaryDetected||f.b2bPageDetected||String(bi.businessModel||'').toLowerCase().includes('b2b'));
  if(b2b&&!f.quoteRequestDetected&&!f.b2bConversionDetected){
    rows.push(rowFromRate({service:'B2B / project lead capture',reason:'مسار المشاريع والشركات ظاهر في المشروع، لكن لم يتم التحقق من RFQ/طلب عرض سعر مخصص أو مسار تحويل B2B واضح في الصفحات المفحوصة.',lowRate:0.003,highRate:0.012,confidence:78,evidenceClass:'verified_gap'},low,high));
  }
  return rows;
}

function expansionRows(audit,deep){
  const bi=audit.businessIntelligence||{},profile=audit.commercialProfile||{},f=bi.funnelSignals||{};
  const low=Number(profile.monthlyCommercialValueRange?.low)||0,high=Number(profile.monthlyCommercialValueRange?.high)||0;
  if(!low||!high)return[];
  const rows=[];
  const productCount=Number(deep.inventory?.productUrlCount||bi.pageInventory?.productLinks||0),categoryCount=Number(deep.inventory?.categoryUrlCount||bi.pageInventory?.categoryLinks||0);
  if(categoryCount>=3){rows.push(rowFromRate({service:'Category/search expansion',reason:`المتجر لديه كتالوج فعلي (${productCount||'عدة'} منتج و${categoryCount} تصنيفات مرصودة). هذا ليس خللًا مثبتًا؛ هو headroom محافظ لتوسيع صفحات الطلب والبحث طويل الذيل.`,lowRate:0.0006,highRate:0.0025,confidence:58,evidenceClass:'modeled_expansion'},low,high));}
  if(String(bi.businessModel||'').toLowerCase().includes('b2b')&&f.b2bConversionDetected){rows.push(rowFromRate({service:'B2B pipeline expansion',reason:'مسار B2B موجود ويعمل علنًا؛ نحسب فقط مساحة توسع محافظة في التقاط الطلب، وليس خسارة بسبب غياب المسار.',lowRate:0.0005,highRate:0.002,confidence:55,evidenceClass:'modeled_expansion'},low,high));}
  if(f.loyaltyDetected){rows.push(rowFromRate({service:'Retention / loyalty optimization',reason:'برنامج الولاء ظاهر بالفعل؛ المبلغ يمثل فقط headroom محدود لرفع التفعيل والعودة، وليس لأن الولاء مفقود.',lowRate:0.0004,highRate:0.0012,confidence:52,evidenceClass:'modeled_expansion'},low,high));}
  return rows.slice(0,3);
}

export async function auditLead(lead,assumptions={}){
  const audit=await auditLeadV4(lead,assumptions);
  if(!audit.website)return audit;
  let deep=null;try{deep=await deepAuditSite({url:audit.website,bi:audit.businessIntelligence||{}});}catch{}
  if(!deep)return audit;
  const bi=audit.businessIntelligence||{};bi.deepAudit=deep;bi.catalog={productCount:deep.inventory?.productUrlCount||null,categoryCount:deep.inventory?.categoryUrlCount||null,b2bPageCount:deep.inventory?.b2bUrlCount||null,blogPageCount:deep.inventory?.blogUrlCount||null,countSource:deep.inventory?.countSource||'sampled_pages'};audit.businessIntelligence=bi;

  const verified=verifiedRows(audit,deep),expansion=expansionRows(audit,deep);
  let rows=[];
  if(verified.length) rows=[...verified,...expansion.slice(0,2)];
  else rows=expansion.length?expansion:(audit.opportunityBreakdown||[]).map(x=>({...x,evidenceClass:x.evidenceClass||'modeled_expansion',confidence:Math.min(Number(x.confidence||55),58)}));
  rows=rows.filter(x=>Number(x.monthlyRange?.high||Math.round(Number(x.annualRange?.high||0)/12))>0).slice(0,5);
  if(!rows.length)return audit;
  rows=rows.map(x=>x.monthlyRange?x:{...x,monthlyRange:{low:Math.round(Number(x.annualRange?.low||0)/12),high:Math.round(Number(x.annualRange?.high||0)/12)}});
  const monthlyLow=roundNice(rows.reduce((s,x)=>s+Number(x.monthlyRange?.low||0),0)),monthlyHigh=roundNice(rows.reduce((s,x)=>s+Number(x.monthlyRange?.high||0),0));
  const verifiedCount=rows.filter(x=>x.evidenceClass==='verified_gap').length;
  const deepConfidence=Number(deep.evidenceStrength||50),baseConfidence=Number(audit.opportunity?.confidence||55);
  const confidence=clamp(Math.round(baseConfidence*0.45+deepConfidence*0.35+(verifiedCount?18:8)),45,90);
  audit.opportunity={...(audit.opportunity||{}),monthlyRange:{low:monthlyLow,high:monthlyHigh},annualRange:{low:monthlyLow*12,high:monthlyHigh*12},displayEligible:monthlyHigh>0,confidence,method:verifiedCount?'deep_business_evidence_model_v5':'deep_business_headroom_model_v5',opportunityType:verifiedCount?'verified_plus_modeled':'modeled_growth_headroom',verifiedDeepLeverCount:verifiedCount,modeledLeverCount:rows.length-verifiedCount,basis:'The business is inferred from the URL, then catalog/product/category/B2B pages are sampled. Verified page weaknesses receive stronger weight; existing capabilities can contribute only small labeled expansion headroom. Unknown Pixel/social/ad integrations are excluded from the money model.',disclaimer:'Estimated growth opportunity in SAR, not verified lost revenue. Public catalog, pricing and page evidence are observed; order volume, ad spend and actual conversion uplift remain modeled until first-party data is connected.'};
  audit.opportunityBreakdown=rows;
  audit.evidence={...(audit.evidence||{}),deepAudit:{evidenceStrength:deep.evidenceStrength,sitemap:deep.sitemap,inventory:deep.inventory,categorySeo:deep.categorySeo,productQuality:deep.productQuality}};
  return audit;
}
