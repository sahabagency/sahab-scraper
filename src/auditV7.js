import { auditLead as auditLeadV5 } from './auditV5.js';

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function roundNice(v){if(!Number.isFinite(v)||v<=0)return 0;const s=v>=20000?1000:v>=10000?500:v>=3000?250:v>=1000?100:v>=300?25:10;return Math.round(v/s)*s;}

function normalizedModel(audit={}){
  const bi=audit.businessIntelligence||{};
  const f=bi.funnelSignals||{};
  const platform=String(bi.platform?.name||bi.platform||'').toLowerCase();
  const ecommerce=Boolean(bi.commerce?.ecommerce||f.cartDetected||f.checkoutDetected||/salla|shopify|woocommerce/.test(platform)||/ecommerce/.test(String(bi.businessModel||'').toLowerCase()));
  const b2b=Boolean(bi.commerce?.b2b||f.b2bDetected||f.b2bPageDetected||f.b2bSecondaryDetected||/b2b|project/.test(String(bi.businessModel||'').toLowerCase()));
  if(ecommerce){
    bi.primaryRevenueMotion='Direct ecommerce';
    bi.secondaryRevenueMotions=b2b?['B2B / project sales']:[];
    bi.businessModel=b2b?'Direct ecommerce (primary) + B2B/project sales (secondary)':'Direct ecommerce';
    bi.commerce={...(bi.commerce||{}),ecommerce:true,b2b,businessModel:bi.businessModel};
  }
  audit.businessIntelligence=bi;
  if(audit.commercialProfile) audit.commercialProfile={...audit.commercialProfile,businessModel:bi.businessModel||audit.commercialProfile.businessModel};
  return audit;
}

function baseline(audit={}){
  const bi=audit.businessIntelligence||{};
  const p=audit.commercialProfile||{};
  const price=bi.priceStats||p.observedPriceStats||{};
  const ticket=p.averageTicketRange||{};
  const demand=p.monthlyLeadRange||{};
  const median=n(price.median)||Math.max(1,Math.round((n(ticket.low)+n(ticket.high))/2));
  const lowOrders=Math.max(3,n(demand.low)||8);
  const highOrders=Math.max(lowOrders,Math.min(n(demand.high)||24,60));
  // Keep the commerce scenario anchored to the observed store price distribution.
  const low=Math.max(median*lowOrders*.85,n(p.monthlyCommercialValueRange?.low));
  const modelHigh=median*highOrders*1.15;
  const profileHigh=n(p.monthlyCommercialValueRange?.high);
  const high=profileHigh?Math.min(profileHigh,Math.max(low,modelHigh)):Math.max(low,modelHigh);
  return {low:roundNice(low),high:roundNice(high),medianTicket:median,lowOrders,highOrders};
}

function actionPlan(service, reason, evidenceClass) {
  const plans = {
    'Content & trust quality': {
      problem: 'محتوى غير مرتبط بالنشاط ظاهر في صفحة يراها العميل.',
      solution: 'حذف النص غير المرتبط، إعادة كتابة FAQ حسب المنتجات الفعلية، وربط كل إجابة بصفحة منتج أو فئة.',
      method: 'مراجعة كل FAQ والصفحات الأساسية، ثم اختبار الصلة والوضوح على الهاتف وسطح المكتب.',
      measurement: 'انخفاض الصفحات ذات المحتوى غير المرتبط، تحسن تفاعل FAQ والنقر إلى الفئات/المنتجات.'
    },
    'SEO & category demand capture': {
      problem: 'صفحات فئات محددة تفتقد عناصر SEO قابلة للفحص مثل العنوان أو الوصف أو H1 أو canonical.',
      solution: 'إكمال عناصر SEO لكل فئة، بناء قالب موحد، وربط الفئات بصفحات المنتجات والبحث الداخلي.',
      method: 'جدول فئات، قالب metadata، فحص Search Console، ومراجعة الفهرسة بعد النشر.',
      measurement: 'نسبة اكتمال عناصر الفئات، الصفحات المفهرسة، والنقرات العضوية لكل فئة.'
    },
    'SEO & category demand growth': {
      problem: 'هناك كتالوج وفئات فعلية، لكن تغطية البحث لكل نية شراء ليست مستغلة بالكامل.',
      solution: 'توسيع صفحات الفئات والـ landing pages حسب نية البحث والمنتج والاستخدام.',
      method: 'خريطة كلمات، صفحة لكل مجموعة طلب، روابط داخلية، ثم اختبار الظهور والنقر.',
      measurement: 'عدد الكلمات المؤهلة، الزيارات العضوية، ونقرات صفحات الفئات.'
    },
    'Product conversion & trust': {
      problem: 'عينة صفحات المنتجات لا تعرض social proof بشكل واضح كافٍ.',
      solution: 'إظهار التقييمات والمراجعات والصور والشحن والضمان قرب قرار الشراء.',
      method: 'اختبار A/B لترتيب عناصر الثقة ومقارنة صفحة قبل/بعد.',
      measurement: 'إضافة للسلة، بدء checkout، ومعدل التحويل لكل صفحة.'
    },
    'Product merchandising & CRO': {
      problem: 'الكتالوج ومسار الشراء موجودان، لكن ترتيب المنتجات والمقارنة والعروض يحتاج اختبارًا منظمًا.',
      solution: 'ترتيب المنتجات حسب الطلب والهامش، إضافة مقارنات وbundles، وتحسين CTA.',
      method: 'تحليل البحث الداخلي، خرائط النقر، وتجارب أسبوعية على الفئات والمنتجات.',
      measurement: 'CTR للمنتجات، add-to-cart، متوسط قيمة السلة، ومعدل التحويل.'
    },
    'B2B / project lead capture': {
      problem: 'صفحة المشاريع/الشركات موجودة، لكن طلب عرض سعر مخصص غير ظاهر في العينة.',
      solution: 'إضافة نموذج RFQ قصير مع نوع المشروع والكمية والموعد ووسيلة التواصل.',
      method: 'CTA واضح في صفحة B2B، نموذج مع tracking، وإشعار فوري للفريق.',
      measurement: 'عدد RFQs المؤهلة، زمن الرد، ونسبة التحول إلى اجتماع أو عرض.'
    }
  };
  return plans[service] || {
    problem: reason,
    solution: 'تحويل الملاحظة إلى تجربة محددة مرتبطة بصفحة أو خطوة في مسار العميل.',
    method: 'تحديد baseline، تنفيذ تغيير واحد، ثم مقارنة النتائج قبل/بعد.',
    measurement: 'مؤشر تحويل مرتبط مباشرة بالمشكلة، وليس رقمًا عامًا.'
  };
}
function row({service,reason,lowRate,highRate,confidence,evidenceClass='modeled_opportunity'},base){
  const low=roundNice(base.low*lowRate),high=Math.max(low,roundNice(base.high*highRate));
  const plan=actionPlan(service, reason, evidenceClass);
  return {service,issues:[reason],...plan,modeled:evidenceClass!=='verified_gap',evidenceClass,confidence,monthlyRange:{low,high},annualRange:{low:low*12,high:high*12}};
}

function verifiedRows(audit={},base){
  const bi=audit.businessIntelligence||{},deep=bi.deepAudit||{},f=bi.funnelSignals||{},rows=[];
  const seo=deep.categorySeo||{};
  const weak=[seo.missingMetaRate,seo.missingCanonicalRate,seo.missingH1Rate,seo.nonIndexableRate,seo.thinContentRate].filter(Number.isFinite);
  const seoSeverity=weak.length?Math.max(...weak):0;
  if(n(seo.sampleCount)>=2&&seoSeverity>=.25){
    rows.push(row({service:'SEO & category demand capture',reason:`فحص ${seo.sampleCount} صفحات تصنيف كشف ضعفًا مرصودًا يصل إلى ${Math.round(seoSeverity*100)}% في بعض عناصر SEO/content depth.`,lowRate:.003,highRate:seoSeverity>=.5?.014:.009,confidence:84,evidenceClass:'verified_gap'},base));
  }

  const pq=deep.productQuality||{};
  if(n(pq.sampleCount)>=2){
    const missReviews=Number.isFinite(pq.reviewsRate)?1-pq.reviewsRate:0;
    if(missReviews>=.35) rows.push(row({service:'Product conversion & trust',reason:`عينة من ${pq.sampleCount} صفحات منتجات أظهرت ضعفًا مرصودًا في ظهور التقييمات/social proof بنسبة تقارب ${Math.round(missReviews*100)}%.`,lowRate:.002,highRate:missReviews>=.6?.009:.006,confidence:80,evidenceClass:'verified_gap'},base));
  }

  const b2b=Boolean(f.b2bDetected||f.b2bPageDetected||f.b2bSecondaryDetected||bi.commerce?.b2b);
  if(b2b&&n(deep.b2bSampleCount)>0&&!f.quoteRequestDetected&&!f.b2bConversionDetected){
    rows.push(row({service:'B2B / project lead capture',reason:`مسار المشاريع والشركات ظاهر وتم فحص ${deep.b2bSampleCount} صفحة B2B، لكن لم يظهر RFQ/طلب عرض سعر مخصص في العينة العامة.`,lowRate:.003,highRate:.012,confidence:84,evidenceClass:'verified_gap'},base));
  }

  const risks=[...(bi.contentRisks||[]),...(bi.contentQuality||[])];
  const seen=new Set();
  for(const risk of risks){
    const key=`${risk.type}:${risk.evidence}`; if(seen.has(key)) continue; seen.add(key);
    if(['template_content_mismatch','irrelevant_faq'].includes(risk.type)){
      rows.push(row({service:'Content & trust quality',reason:`تم رصد محتوى غير مرتبط بالنشاط داخل الصفحة: ${risk.evidence}. هذه فجوة فعلية في جودة المحتوى والثقة، وليست افتراضًا.`,lowRate:.001,highRate:.0045,confidence:94,evidenceClass:'verified_gap'},base));
    }
  }
  return rows;
}

function modeledRows(audit={},base){
  const bi=audit.businessIntelligence||{},deep=bi.deepAudit||{},f=bi.funnelSignals||{},rows=[];
  const productCount=n(bi.catalog?.productCount||deep.inventory?.productUrlCount||bi.pageInventory?.productLinks||bi.products?.length);
  const categoryCount=n(bi.catalog?.categoryCount||deep.inventory?.categoryUrlCount||bi.pageInventory?.categoryLinks||bi.categories?.length);

  // Modeled rows are strategic upside supported by this exact site's structure. They are never presented as missing features.
  if(categoryCount>=4){
    rows.push(row({service:'Search & category demand growth',reason:`تم رصد ${categoryCount} تصنيفات فعلية؛ نحسب مساحة نمو محافظة من توسيع تغطية البحث وصفحات الفئات، بدون افتراض أن الـSEO الحالي ضعيف.`,lowRate:.002,highRate:.010,confidence:64},base));
  }
  if(productCount>=8){
    rows.push(row({service:'Product merchandising & CRO',reason:`تم رصد كتالوج فعلي (${productCount} منتج تقريبًا) ومسار شراء مباشر؛ هذا headroom لاختبار ترتيب المنتجات والمقارنة والعروض، وليس خللًا مثبتًا.`,lowRate:.0015,highRate:.008,confidence:61},base));
  }
  if(f.loyaltyDetected){
    rows.push(row({service:'Retention & loyalty activation',reason:'برنامج الولاء موجود بالفعل؛ نحسب فقط مساحة تحسين محدودة في التفعيل والعودة والشراء المتكرر، ولا نعامل الولاء كميزة مفقودة.',lowRate:.001,highRate:.005,confidence:57},base));
  }
  if(bi.commerce?.b2b&&(f.quoteRequestDetected||f.b2bConversionDetected)){
    rows.push(row({service:'B2B / project pipeline expansion',reason:'مسار المشاريع والشركات موجود ومعه تحويل علني؛ نحسب توسعًا محدودًا في pipeline كمسار ثانوي منفصل عن مبيعات المتجر المباشرة.',lowRate:.001,highRate:.006,confidence:60},base));
  }
  return rows;
}

function rebuildOpportunity(audit={}){
  const bi=audit.businessIntelligence||{},profile=audit.commercialProfile||{};
  const ecommerce=Boolean(bi.commerce?.ecommerce||bi.funnelSignals?.cartDetected||bi.funnelSignals?.checkoutDetected);
  if(!ecommerce||n(bi.confidence)<55||n(profile.confidence)<45) return audit;
  const base=baseline(audit); if(!base.low||!base.high) return audit;

  const verified=verifiedRows(audit,base);
  const modeled=modeledRows(audit,base);
  // Verified gaps always lead. Add at most 3 modeled opportunities so the output remains specific rather than a generic agency checklist.
  let rows=[...verified,...modeled.slice(0,verified.length?2:3)].filter(x=>n(x.monthlyRange?.high)>0).slice(0,5);
  if(!rows.length) return audit;

  // Prevent double counting across overlapping growth levers. Modeled-only scenarios are capped more tightly than verified evidence.
  const verifiedCount=rows.filter(x=>x.evidenceClass==='verified_gap').length;
  const rawHigh=rows.reduce((s,x)=>s+(n(x.monthlyRange?.high)/Math.max(base.high,1)),0);
  const highCap=verifiedCount?0.075:0.045;
  const scale=rawHigh>highCap?highCap/rawHigh:1;
  if(scale<1){
    rows=rows.map(x=>{
      const low=roundNice(n(x.monthlyRange.low)*scale),high=Math.max(low,roundNice(n(x.monthlyRange.high)*scale));
      return {...x,monthlyRange:{low,high},annualRange:{low:low*12,high:high*12}};
    });
  }

  const monthlyLow=roundNice(rows.reduce((s,x)=>s+n(x.monthlyRange.low),0));
  const monthlyHigh=roundNice(rows.reduce((s,x)=>s+n(x.monthlyRange.high),0));
  const evidenceConfidence=n(bi.deepAudit?.evidenceStrength)||n(bi.confidence)||55;
  const confidence=clamp(Math.round(n(bi.confidence)*.35+n(profile.confidence)*.30+evidenceConfidence*.20+(verifiedCount?13:5)),52,verifiedCount?88:68);

  const modeledCurrency=String(bi.currency||profile.currency||'SAR').toUpperCase();
  audit.opportunity={...(audit.opportunity||{}),monthlyRange:{low:monthlyLow,high:monthlyHigh},annualRange:{low:monthlyLow*12,high:monthlyHigh*12},currency:modeledCurrency,displayEligible:monthlyHigh>0,confidence,method:'business_specific_evidence_model_v8',opportunityType:verifiedCount?'verified_plus_modeled_growth':'modeled_business_growth',primaryRevenueMotion:bi.primaryRevenueMotion||'Direct ecommerce',secondaryRevenueMotions:bi.secondaryRevenueMotions||[],businessBaseline:{monthlyCommerceScenarioRange:{low:base.low,high:base.high},medianObservedTicket:base.medianTicket,modeledOrderRange:{low:base.lowOrders,high:base.highOrders}},verifiedLeverCount:verifiedCount,modeledLeverCount:rows.length-verifiedCount,basis:'The model is rebuilt from this exact store: observed product prices, product/category structure, direct ecommerce flow, B2B/project path, loyalty, sampled SEO/product evidence and verified content risks. Existing social, Pixel, analytics or loyalty capabilities are never counted as missing. Modeled upside is capped to reduce double counting.',disclaimer:'Estimated growth opportunity in the detected site currency, not verified lost revenue. Store structure and any observed prices are separated from modeled assumptions; traffic, monthly orders, ad spend, conversion rate and realized uplift remain unknown until first-party data is connected.'};
  audit.opportunityBreakdown=rows;
  return audit;
}

export async function auditLead(lead,assumptions={}){
  let audit=await auditLeadV5(lead,assumptions);
  audit=normalizedModel(audit);
  audit=rebuildOpportunity(audit);
  return audit;
}

