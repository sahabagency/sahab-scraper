import { auditLead as auditLeadV5 } from './auditV5.js';

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function roundNice(v){
  if(!Number.isFinite(v)||v<=0)return 0;
  const step=v>=20000?1000:v>=10000?500:v>=3000?250:v>=1000?100:v>=300?25:10;
  return Math.round(v/step)*step;
}
function asNum(v){ const n=Number(v); return Number.isFinite(n)?n:0; }

function normalizeBusinessModel(audit={}){
  const bi=audit.businessIntelligence||{};
  const f=bi.funnelSignals||{};
  const commerce=bi.commerce||{};
  const ecommerce=Boolean(commerce.ecommerce || f.cartDetected || f.checkoutDetected || /Salla|Shopify|WooCommerce/i.test(String(bi.platform?.name||bi.platform||'')));
  const b2b=Boolean(commerce.b2b || f.b2bDetected || f.b2bPageDetected || f.b2bSecondaryDetected || /b2b|project/i.test(String(bi.businessModel||'')));

  if(ecommerce){
    bi.primaryRevenueMotion='Direct ecommerce';
    bi.secondaryRevenueMotions=b2b?['B2B / project sales']:[];
    bi.businessModel=b2b?'Direct ecommerce (primary) + B2B/project sales (secondary)':'Direct ecommerce';
    bi.commerce={...commerce,ecommerce:true,b2b,businessModel:bi.businessModel};
  }
  audit.businessIntelligence=bi;
  if(audit.commercialProfile){
    audit.commercialProfile={...audit.commercialProfile,businessModel:bi.businessModel||audit.commercialProfile.businessModel};
  }
  return audit;
}

function businessBase(audit={}){
  const bi=audit.businessIntelligence||{};
  const profile=audit.commercialProfile||{};
  const price=bi.priceStats||profile.observedPriceStats||{};
  const demand=profile.monthlyLeadRange||{};
  const ticket=profile.averageTicketRange||{};
  const median=asNum(price.median)||Math.max(1,Math.round((asNum(ticket.low)+asNum(ticket.high))/2));
  const lowOrders=Math.max(4,asNum(demand.low)||8);
  const highOrders=Math.max(lowOrders,Math.min(asNum(demand.high)||30,60));

  // URL-only models can get very wide. Use the observed price midpoint and a bounded order envelope
  // to create a business-specific scenario band without pretending we know actual GMV.
  const low=Math.max(asNum(profile.monthlyCommercialValueRange?.low), median*lowOrders*0.75);
  const highCandidate=median*highOrders*1.20;
  const profileHigh=asNum(profile.monthlyCommercialValueRange?.high);
  const high=profileHigh>0?Math.min(profileHigh,Math.max(low,highCandidate)):Math.max(low,highCandidate);
  return {low:roundNice(low),high:roundNice(high),medianTicket:median,lowOrders,highOrders};
}

function lever(service,reason,lowRate,highRate,confidence,evidenceClass='modeled_business_growth'){
  return {service,reason,lowRate,highRate,confidence,evidenceClass,modeled:evidenceClass!=='verified_gap'};
}

function buildLevers(audit={}){
  const bi=audit.businessIntelligence||{};
  const f=bi.funnelSignals||{};
  const deep=bi.deepAudit||{};
  const catalog=bi.catalog||{};
  const products=asNum(catalog.productCount||deep.inventory?.productUrlCount||bi.pageInventory?.productLinks);
  const categories=asNum(catalog.categoryCount||deep.inventory?.categoryUrlCount||bi.pageInventory?.categoryLinks);
  const ecommerce=Boolean(bi.commerce?.ecommerce || f.cartDetected || f.checkoutDetected);
  const b2b=Boolean(bi.commerce?.b2b || f.b2bDetected || f.b2bPageDetected || f.b2bSecondaryDetected);
  const levers=[];

  const seo=deep.categorySeo||{};
  const seoWeak=[seo.missingMetaRate,seo.missingCanonicalRate,seo.missingH1Rate,seo.nonIndexableRate,seo.thinContentRate].filter(Number.isFinite);
  const seoSeverity=seoWeak.length?Math.max(...seoWeak):0;
  if(ecommerce && asNum(seo.sampleCount)>=2 && seoSeverity>=0.25){
    levers.push(lever('SEO & category demand capture',`تم فحص ${seo.sampleCount} صفحات تصنيف وظهر ضعف فعلي يصل إلى ${Math.round(seoSeverity*100)}% في بعض عناصر SEO/content depth.`,0.012,seoSeverity>=0.5?0.050:0.035,86,'verified_gap'));
  } else if(ecommerce && categories>=3){
    levers.push(lever('Search & category demand growth',`المتجر يملك ${categories} تصنيفات على الأقل؛ نحسب مساحة نمو محافظة من توسيع الطلب العضوي وتحسين صفحات التصنيفات، بدون افتراض أن الـSEO الحالي ضعيف.`,0.008,0.030,66));
  }

  const pq=deep.productQuality||{};
  if(ecommerce && asNum(pq.sampleCount)>=2){
    const missingReviews=Number.isFinite(pq.reviewsRate)?1-pq.reviewsRate:0;
    if(missingReviews>=0.35){
      levers.push(lever('Product conversion & trust',`عينة من ${pq.sampleCount} صفحات منتجات أظهرت ضعفًا فعليًا في ظهور التقييمات/social proof بنسبة تقارب ${Math.round(missingReviews*100)}%.`,0.010,missingReviews>=0.6?0.040:0.028,82,'verified_gap'));
    } else if(products>=5){
      levers.push(lever('Product merchandising & CRO',`تم رصد كتالوج فعلي (${products} منتج تقريبًا) مع مسار شراء قائم؛ نحسب فقط مساحة تحسين محافظة في ترتيب المنتجات، المقارنة، والعرض والتحويل.`,0.006,0.022,63));
    }
  } else if(ecommerce && products>=5){
    levers.push(lever('Product merchandising & CRO',`تم رصد كتالوج فعلي (${products} منتج تقريبًا) ومسار شراء مباشر؛ النموذج يحسب headroom لتحسين الاكتشاف والتحويل وليس خللًا مثبتًا.`,0.006,0.022,60));
  }

  if(ecommerce && f.loyaltyDetected){
    levers.push(lever('Retention & repeat purchase',`برنامج الولاء ظاهر في المتجر؛ توجد مساحة نمو محدودة في التفعيل والعودة والـrepeat purchase بدون اعتبار الولاء مفقودًا.`,0.003,0.015,58));
  }

  if(b2b){
    if(f.quoteRequestDetected || f.b2bConversionDetected){
      levers.push(lever('B2B / project pipeline expansion','مسار المشاريع والشركات موجود ومعه تحويل علني؛ نحسب توسعًا محافظًا في pipeline المشاريع كمسار ثانوي، وليس باعتباره مصدر الإيراد الرئيسي.',0.004,0.018,65));
    } else if(f.b2bPageDetected || asNum(catalog.b2bPageCount)>0){
      levers.push(lever('B2B / project lead capture','مسار المشاريع والشركات ظاهر، لكن لم يتم التحقق من RFQ/طلب عرض سعر مخصص في العينة؛ هذه فجوة قابلة للتحسين مع إبقاء التجارة المباشرة كمسار الإيراد الأساسي.',0.010,0.040,82,'verified_gap'));
    }
  }

  for(const risk of bi.contentRisks||[]){
    if(risk.type==='template_content_mismatch'){
      levers.push(lever('Content & trust quality',`تم رصد محتوى غير مرتبط بالنشاط داخل الصفحة: ${risk.evidence}. نعالجه كفجوة ثقة وجودة، لكن لا نعطيه وحده نسبة مالية كبيرة.`,0.001,0.006,92,'verified_gap'));
    }
  }

  return levers.slice(0,5);
}

function applyBusinessSpecificOpportunity(audit={}){
  const bi=audit.businessIntelligence||{};
  const profile=audit.commercialProfile||{};
  const ecommerce=Boolean(bi.commerce?.ecommerce || bi.funnelSignals?.cartDetected || bi.funnelSignals?.checkoutDetected);
  if(!ecommerce || asNum(bi.confidence)<55 || asNum(profile.confidence)<45) return audit;

  const base=businessBase(audit);
  if(!base.low || !base.high) return audit;
  const levers=buildLevers(audit);
  if(!levers.length) return audit;

  // Cap the combined uplift so multiple modeled levers do not double-count the same revenue path.
  const rawLow=levers.reduce((s,x)=>s+x.lowRate,0);
  const rawHigh=levers.reduce((s,x)=>s+x.highRate,0);
  const combinedLow=clamp(rawLow,0.015,0.060);
  const combinedHigh=clamp(rawHigh,Math.max(combinedLow,0.035),0.120);
  const lowScale=rawLow?combinedLow/rawLow:1;
  const highScale=rawHigh?combinedHigh/rawHigh:1;

  const rows=levers.map(x=>{
    const monthlyLow=roundNice(base.low*x.lowRate*lowScale);
    const monthlyHigh=Math.max(monthlyLow,roundNice(base.high*x.highRate*highScale));
    return {
      service:x.service,
      issues:[x.reason],
      modeled:x.modeled,
      evidenceClass:x.evidenceClass,
      confidence:x.confidence,
      monthlyRange:{low:monthlyLow,high:monthlyHigh},
      annualRange:{low:monthlyLow*12,high:monthlyHigh*12}
    };
  }).filter(x=>x.monthlyRange.high>0);

  const monthlyLow=roundNice(rows.reduce((s,x)=>s+asNum(x.monthlyRange.low),0));
  const monthlyHigh=roundNice(rows.reduce((s,x)=>s+asNum(x.monthlyRange.high),0));
  if(!monthlyHigh) return audit;

  const verified=rows.filter(x=>x.evidenceClass==='verified_gap').length;
  const confidence=clamp(Math.round(asNum(bi.confidence)*0.42+asNum(profile.confidence)*0.33+(verified?18:10)),55,90);

  audit.opportunity={
    ...(audit.opportunity||{}),
    monthlyRange:{low:monthlyLow,high:monthlyHigh},
    annualRange:{low:monthlyLow*12,high:monthlyHigh*12},
    currency:'SAR',
    displayEligible:true,
    confidence,
    method:'business_specific_commerce_opportunity_v7',
    opportunityType:verified?'verified_plus_modeled_growth':'modeled_business_growth',
    primaryRevenueMotion:'Direct ecommerce',
    secondaryRevenueMotions:bi.secondaryRevenueMotions||[],
    businessBaseline:{monthlyCommerceScenarioRange:{low:base.low,high:base.high},medianObservedTicket:base.medianTicket,modeledOrderRange:{low:base.lowOrders,high:base.highOrders}},
    combinedUpliftRange:{low:Math.round(combinedLow*1000)/10,high:Math.round(combinedHigh*1000)/10},
    verifiedLeverCount:verified,
    modeledLeverCount:rows.length-verified,
    basis:'The amount is rebuilt from this specific store: observed product prices, catalog/category structure, direct ecommerce flow, public B2B/project path, loyalty/review signals and deep sampled-page evidence. Direct ecommerce stays the primary revenue motion; B2B is modeled separately as a secondary path. Existing Pixel/social capabilities are never counted as missing.',
    disclaimer:'Estimated business growth opportunity in Saudi riyals, not verified lost revenue. Product prices and site structure are observed; actual traffic, orders, ad spend and realized uplift remain unknown until first-party data is connected.'
  };
  audit.opportunityBreakdown=rows;
  return audit;
}

export async function auditLead(lead,assumptions={}){
  let audit=await auditLeadV5(lead,assumptions);
  audit=normalizeBusinessModel(audit);
  audit=applyBusinessSpecificOpportunity(audit);
  return audit;
}
