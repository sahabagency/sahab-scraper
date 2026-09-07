import { auditLead as auditLeadV4 } from './auditV4.js';
import { deepAuditSite } from './siteDeepAudit.js';

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function roundNice(v){if(!Number.isFinite(v)||v<=0)return 0;const s=v>=10000?500:v>=3000?250:v>=1000?100:v>=300?25:10;return Math.round(v/s)*s;}
function pct(v){return Number.isFinite(v)?Math.round(v*100):null;}
function rowFromRate({service,reason,lowRate,highRate,confidence,evidenceClass='verified_gap'},commercialLow,commercialHigh){const low=roundNice(commercialLow*lowRate),high=Math.max(low,roundNice(commercialHigh*highRate));return{service,issues:[reason],modeled:true,evidenceClass,confidence,monthlyRange:{low,high},annualRange:{low:low*12,high:high*12}};}

function verifiedRows(audit,deep){
  const bi=audit.businessIntelligence||{},f=bi.funnelSignals||{},profile=audit.commercialProfile||{},platform=bi.platform?.name||profile.platform||'';
  const low=Number(profile.monthlyCommercialValueRange?.low)||0,high=Number(profile.monthlyCommercialValueRange?.high)||0;if(!low||!high)return[];
  const rows=[],seo=deep.categorySeo||{},pq=deep.productQuality||{};

  if(Number(seo.sampleCount)>=2){
    const weak=[seo.missingMetaRate,seo.missingCanonicalRate,seo.missingH1Rate,seo.nonIndexableRate,seo.thinContentRate].filter(Number.isFinite);const severity=weak.length?Math.max(...weak):0;
    if(severity>=0.25)rows.push(rowFromRate({service:'SEO & category demand capture',reason:`فحص ${seo.sampleCount} صفحات تصنيف كشف ضعفًا مرصودًا؛ أعلى معدل ضعف ${pct(severity)}% في عناصر SEO/content depth.`,lowRate:.0025,highRate:severity>=.5?.012:.007,confidence:Math.round(68+Math.min(18,seo.sampleCount*3))},low,high));
  }

  if(Number(pq.sampleCount)>=2){
    // Hosted commerce platforms can hydrate CTA/schema/availability client-side. Do not treat those as missing unless independently observable.
    const hosted=/Salla|Shopify/i.test(platform);
    const candidates=[];
    const missingReviews=Number.isFinite(pq.reviewsRate)?1-pq.reviewsRate:null;if(Number.isFinite(missingReviews))candidates.push({key:'reviews',v:missingReviews});
    if(!hosted){const missingSchema=Number.isFinite(pq.schemaRate)?1-pq.schemaRate:null,missingAvailability=Number.isFinite(pq.availabilityRate)?1-pq.availabilityRate:null,missingCta=Number.isFinite(pq.ctaRate)?1-pq.ctaRate:null;if(Number.isFinite(missingSchema))candidates.push({key:'schema',v:missingSchema});if(Number.isFinite(missingAvailability))candidates.push({key:'availability',v:missingAvailability});if(Number.isFinite(missingCta))candidates.push({key:'cta',v:missingCta});}
    const severity=candidates.length?Math.max(...candidates.map(x=>x.v)):0;
    if(severity>=.35){const details=candidates.filter(x=>x.v>=.35).map(x=>`${x.key} غير مرصود في ${pct(x.v)}% من العينة`);rows.push(rowFromRate({service:'Product conversion optimization',reason:`فحص ${pq.sampleCount} صفحات منتجات كشف: ${details.join('، ')}. لا يتم احتساب إشارات JavaScript غير القابلة للرصد كفجوات مؤكدة.`,lowRate:.0015,highRate:severity>=.6?.008:.0055,confidence:Math.round(66+Math.min(18,pq.sampleCount*3))},low,high));}
  }

  const b2b=Boolean(f.b2bDetected||f.b2bPageDetected||String(bi.businessModel||'').toLowerCase().includes('b2b'));
  if(b2b&&Number(deep.b2bSampleCount||0)>0&&!f.quoteRequestDetected&&!f.b2bConversionDetected){rows.push(rowFromRate({service:'B2B / project lead capture',reason:`تم رصد مسار مشاريع/شركات وفحص ${deep.b2bSampleCount} صفحة B2B، لكن لم يظهر طلب عرض سعر/RFQ أو تحويل B2B مخصص في العينة.`,lowRate:.003,highRate:.01,confidence:82},low,high));}

  for(const risk of bi.contentRisks||[]){if(risk.type==='template_content_mismatch')rows.push(rowFromRate({service:'Content & trust quality',reason:`تم رصد محتوى قالب غير مرتبط بالنشاط: ${risk.evidence}. هذه فجوة جودة فعلية قد تقلل الثقة والوضوح.`,lowRate:.001,highRate:.0045,confidence:88},low,high));}
  return rows;
}

function evidenceBasedHeadroom(audit,deep){
  const bi=audit.businessIntelligence||{},profile=audit.commercialProfile||{},low=Number(profile.monthlyCommercialValueRange?.low)||0,high=Number(profile.monthlyCommercialValueRange?.high)||0;if(!low||!high)return[];
  const rows=[],productCount=Number(deep.inventory?.productUrlCount||bi.pageInventory?.productLinks||0),categoryCount=Number(deep.inventory?.categoryUrlCount||bi.pageInventory?.categoryLinks||0),f=bi.funnelSignals||{};
  // Only add a modeled lever when there is concrete business structure behind it; existing capabilities are never described as missing.
  if(categoryCount>=3&&Number(deep.categorySeo?.sampleCount||0)<2)rows.push(rowFromRate({service:'Category demand expansion',reason:`تم رصد ${categoryCount} تصنيفات لكن عينة SEO غير كافية للحكم على الضعف؛ نحسب مساحة توسع صغيرة فقط، وليست مشكلة مثبتة.`,lowRate:.0004,highRate:.0015,confidence:50,evidenceClass:'modeled_expansion'},low,high));
  if(productCount>=5&&Number(deep.productQuality?.sampleCount||0)<2)rows.push(rowFromRate({service:'Product discovery expansion',reason:`تم رصد كتالوج منتجات (${productCount}) لكن العينة غير كافية للحكم على CRO؛ هذا headroom صغير وليس خللًا مثبتًا.`,lowRate:.0004,highRate:.0015,confidence:50,evidenceClass:'modeled_expansion'},low,high));
  if(f.b2bConversionDetected)rows.push(rowFromRate({service:'B2B pipeline expansion',reason:'مسار B2B موجود ويعمل علنًا؛ نحسب مساحة توسع محدودة فقط في التقاط طلب المشاريع، وليس خسارة من غياب المسار.',lowRate:.0004,highRate:.0015,confidence:54,evidenceClass:'modeled_expansion'},low,high));
  return rows.slice(0,2);
}

export async function auditLead(lead,assumptions={}){
  const audit=await auditLeadV4(lead,assumptions);if(!audit.website)return audit;
  let deep=null;try{deep=await deepAuditSite({url:audit.website,bi:audit.businessIntelligence||{}});}catch{} if(!deep)return audit;
  const bi=audit.businessIntelligence||{};bi.deepAudit=deep;bi.catalog={productCount:deep.inventory?.productUrlCount||null,categoryCount:deep.inventory?.categoryUrlCount||null,b2bPageCount:deep.inventory?.b2bUrlCount||null,blogPageCount:deep.inventory?.blogUrlCount||null,countSource:deep.inventory?.countSource||'sampled_pages'};audit.businessIntelligence=bi;

  const verified=verifiedRows(audit,deep),modeled=evidenceBasedHeadroom(audit,deep);let rows=verified.length?[...verified,...modeled.slice(0,1)]:modeled;
  rows=rows.filter(x=>Number(x.monthlyRange?.high||0)>0).slice(0,5);
  if(!rows.length){audit.opportunity={...(audit.opportunity||{}),monthlyRange:{low:0,high:0},annualRange:{low:0,high:0},displayEligible:false,confidence:Math.max(45,Number(deep.evidenceStrength||45)),method:'insufficient_verified_growth_gap_v6',opportunityType:'no_supported_money_claim',basis:'Business type and products were inferred from the URL, but no sufficiently strong monetizable gap was verified. Existing social, tracking, loyalty or commerce capabilities are not converted into a loss claim.',disclaimer:'No monetary loss is claimed without a verified or clearly modeled business lever.'};audit.opportunityBreakdown=[];return audit;}

  const monthlyLow=roundNice(rows.reduce((s,x)=>s+Number(x.monthlyRange?.low||0),0)),monthlyHigh=roundNice(rows.reduce((s,x)=>s+Number(x.monthlyRange?.high||0),0));
  const verifiedCount=rows.filter(x=>x.evidenceClass==='verified_gap').length,deepConfidence=Number(deep.evidenceStrength||50),biConfidence=Number(bi.confidence||60),confidence=clamp(Math.round(deepConfidence*.45+biConfidence*.35+(verifiedCount?18:6)),48,92);
  audit.opportunity={...(audit.opportunity||{}),monthlyRange:{low:monthlyLow,high:monthlyHigh},annualRange:{low:monthlyLow*12,high:monthlyHigh*12},currency:audit.commercialProfile?.currency||bi.currency?.currency||'SAR',displayEligible:monthlyHigh>0,confidence,method:verifiedCount?'deep_business_evidence_model_v6':'business_structure_headroom_v6',opportunityType:verifiedCount?'verified_plus_modeled':'modeled_growth_headroom',verifiedDeepLeverCount:verifiedCount,modeledLeverCount:rows.length-verifiedCount,basis:'The URL is used to infer the actual business, products, platform, pricing, B2C/B2B paths and sampled pages. Money is attached only to verified gaps or tightly bounded business-structure headroom. Existing Pixel/social/loyalty capabilities are never counted as missing.',disclaimer:'Estimated growth opportunity in the site currency (SAR for this store), not verified lost revenue. Public structure/pricing are observed; traffic, orders, ad spend and uplift remain modeled until first-party data is connected.'};
  audit.opportunityBreakdown=rows;audit.evidence={...(audit.evidence||{}),deepAudit:{evidenceStrength:deep.evidenceStrength,sitemap:deep.sitemap,inventory:deep.inventory,categorySeo:deep.categorySeo,productQuality:deep.productQuality}};return audit;
}
