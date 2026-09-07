import * as cheerio from 'cheerio';

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function median(nums=[]){ const a=nums.filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null; const m=Math.floor(a.length/2); return a.length%2?a[m]:Math.round((a[m-1]+a[m])/2); }
function percentile(nums=[],p=.5){ const a=nums.filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null; const i=Math.max(0,Math.min(a.length-1,Math.round((a.length-1)*p))); return a[i]; }
function uniq(arr=[]){ return [...new Set(arr.filter(Boolean))]; }
function norm(s=''){ return String(s).replace(/\s+/g,' ').trim(); }
function latinDigits(s=''){ const map={'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9','٬':',','٫':'.'}; return String(s).replace(/[٠-٩۰-۹٬٫]/g,c=>map[c]||c); }

function detectPlatform(html=''){
  const t=String(html).toLowerCase();
  if (t.includes('salla.network') || t.includes('cdn.salla.sa') || t.includes('salla.sa') || t.includes('salla.com') || t.includes('منصة سلة')) return 'salla';
  if (t.includes('cdn.shopify.com') || t.includes('shopify-section') || t.includes('shopify.theme')) return 'shopify';
  if (t.includes('woocommerce') || t.includes('wp-content/plugins/woocommerce')) return 'woocommerce';
  return null;
}

function inferIndustry(text=''){
  const t=String(text).toLowerCase();
  const rules=[
    ['water coolers, tanks & water solutions', /براد|برادات|تبريد المياه|خزان ماء|خزانات ميا|water cooler|water tank|سبيل/],
    ['aesthetic clinic', /عيادة تجميل|aesthetic|derma|ليزر|بوتكس|فيلر/],
    ['dental clinic', /أسنان|اسنان|dental|orthodont/],
    ['restaurant & cafe', /مطعم|كافيه|قهوة|coffee|restaurant|menu/],
    ['perfume & oud', /عطر|عطور|عود|perfume|fragrance/],
    ['fashion retail', /عباية|ملابس|فساتين|fashion|apparel/],
    ['general ecommerce', /سلة المشتريات|متابعة التسوق|add to cart|checkout|product/]
  ];
  for(const [name,re] of rules) if(re.test(t)) return name;
  return 'general business';
}

function extractBrandName($, url=''){
  const candidates=[
    $('meta[property="og:site_name"]').attr('content'),
    $('meta[name="application-name"]').attr('content'),
    $('header img[alt]').first().attr('alt'),
    $('title').text().split(/[|–—-]/)[0]
  ].map(norm).filter(Boolean);
  const bad=/^(home|الرئيسية|متجر|store)$/i;
  const chosen=candidates.find(x=>x.length>=3&&x.length<=90&&!bad.test(x));
  if(chosen) return chosen;
  try { return new URL(url).hostname.replace(/^www\./,'').split('.')[0].replace(/[-_]+/g,' '); } catch { return null; }
}

function extractJsonLdProducts($){
  const prices=[]; const names=[]; const currencies=[];
  $('script[type="application/ld+json"]').each((_,el)=>{
    try{
      const parsed=JSON.parse($(el).html()||'{}');
      const walk=node=>{
        if(!node||typeof node!=='object')return;
        const type=Array.isArray(node['@type'])?node['@type'].join(' '):String(node['@type']||'');
        if(/product/i.test(type)){
          if(node.name) names.push(norm(node.name));
          const offers=Array.isArray(node.offers)?node.offers:[node.offers].filter(Boolean);
          for(const offer of offers){
            const n=Number(latinDigits(String(offer?.price||offer?.lowPrice||'')).replace(/,/g,''));
            if(Number.isFinite(n)&&n>=10&&n<=500000)prices.push(n);
            if(offer?.priceCurrency)currencies.push(String(offer.priceCurrency).toUpperCase());
          }
        }
        for(const value of Object.values(node)){
          if(Array.isArray(value)) value.forEach(walk); else if(value&&typeof value==='object') walk(value);
        }
      };
      (Array.isArray(parsed)?parsed:[parsed]).forEach(walk);
    }catch{}
  });
  return {prices,names,currencies};
}

function extractPagePrices($, raw=''){
  const out=[];
  const push=v=>{ const n=Number(latinDigits(String(v||'')).replace(/[^0-9.]/g,'')); if(Number.isFinite(n)&&n>=10&&n<=500000)out.push(n); };
  ['meta[property="product:price:amount"]','meta[itemprop="price"]','[itemprop="price"]','[data-price]'].forEach(sel=>{
    $(sel).each((_,el)=>push($(el).attr('content')||$(el).attr('data-price')||$(el).text()));
  });
  const text=latinDigits(norm($('body').text()));
  const patterns=[
    /(?:السعر|price)\s*[:：]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,
    /(?:ر\.?\s?س|ريال(?: سعودي)?|sar)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,
    /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:ر\.?\s?س|ريال(?: سعودي)?|sar)/gi
  ];
  for(const re of patterns){ let m; while((m=re.exec(text))){ push(m[1]); if(out.length>80)break; } }
  const rawMatches=String(raw).match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/gi)||[];
  rawMatches.forEach(s=>push((s.match(/[0-9]+(?:\.[0-9]+)?/)||[])[0]));
  return uniq(out);
}

function extractCurrency(text='',jsonCurrencies=[]){
  const t=latinDigits(text);
  if(jsonCurrencies.includes('SAR')||/(?:ر\.?\s?س|ريال سعودي|\bSAR\b)/i.test(t))return 'SAR';
  if(/(?:د\.إ|AED)/i.test(t))return 'AED';
  if(/\$|USD/i.test(t))return 'USD';
  return null;
}

function extractCategories($){
  const values=[];
  $('nav a,header a,a,h1,h2,h3,h4').each((_,el)=>{
    const s=norm($(el).text());
    if(s.length>=3&&s.length<=90&&/براد|خزان|شبك|منتج|قسم|category|collection|clinic|عطر|قهوة|ملابس|حلول المشاريع|الشركات/i.test(s)) values.push(s);
  });
  return uniq(values).slice(0,24);
}

function inferSegments(text=''){
  const t=String(text).toLowerCase(); const out=[];
  const rules=[
    ['Consumers / homes',/البيت|المنزل|الفلل|العائلة|الأطفال|الاستراحة|صدقة جارية/],
    ['Projects / companies',/حلول المشاريع|الشركات|المؤسسات|مشاريع|توريد|مقاول|مقاولين|جهات/],
    ['Schools / education',/مدرسة|مدارس|طلاب|تعليم/],
    ['Mosques / charity',/مسجد|مساجد|صدقة جارية|سبيل/],
    ['Farms / outdoor',/مزرعة|مزارع|موقع مكشوف|الشارع/]
  ];
  for(const [label,re] of rules) if(re.test(t))out.push(label);
  return out;
}

function extractValueProps(text=''){
  const t=String(text).toLowerCase(); const out=[];
  const rules=[
    ['Saudi patented product',/براءة اختراع سعودية|sa\s*19086/],
    ['Saudi-made positioning',/منتج سعودي|صنع في السعودية|سعودي 100/],
    ['Free delivery',/توصيل سريع ومجاني|شحن مجاني|توصيل مجاني/],
    ['Warranty',/ضمان سنتين|ضمان|استعادة الأموال/],
    ['Loyalty program',/برامج الولاء|نقاط الولاء/],
    ['Made for Saudi climate',/شمس السعودية|حرارة الصيف|الحرارة القاسية/]
  ];
  for(const [label,re] of rules) if(re.test(t))out.push(label);
  return out;
}

function classifyInternalLinks($,baseUrl){
  let host=''; try{host=new URL(baseUrl).host;}catch{return {products:[],categories:[],b2b:[],blog:[]};}
  const groups={products:[],categories:[],b2b:[],blog:[]};
  $('a[href]').each((_,a)=>{
    const href=$(a).attr('href'); if(!href)return;
    let u; try{u=new URL(href,baseUrl);}catch{return}
    if(u.host!==host)return;
    const p=u.pathname.toLowerCase(); const txt=norm($(a).text()).toLowerCase();
    if(/\/p\d+\/?$|\/product|\/products|\/item/.test(p)) groups.products.push(u.href);
    if(/\/c\d+\/?$|\/category|\/categories|\/collection/.test(p)) groups.categories.push(u.href);
    if(/حلول المشاريع|الشركات|توريد|مشاريع|request.*quote|quote|rfq/.test(`${txt} ${decodeURIComponent(p)}`)) groups.b2b.push(u.href);
    if(/\/blog|مقال|المدونة/.test(`${txt} ${decodeURIComponent(p)}`)) groups.blog.push(u.href);
  });
  for(const k of Object.keys(groups))groups[k]=uniq(groups[k]);
  return groups;
}

async function fetchText(url){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; SahabBusinessIntelligence/3.0; +https://sahab.agency)'},signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null; return {html:await r.text(),finalUrl:r.url};
  }catch{return null}
}

function pageSignals(html='',url=''){
  const $=cheerio.load(html); const body=norm($('body').text()); const hrefs=$('a[href]').map((_,a)=>$(a).attr('href')||'').get().join(' ');
  const text=`${body} ${hrefs} ${html}`.toLowerCase();
  return {
    url,
    cart:/أضف إلى السلة|أضف للسلة|add to cart|buy now|سلة المشتريات/.test(text),
    checkout:/checkout|إتمام الطلب|اتمام الطلب|الدفع|cart/.test(text),
    quote:/اطلب عرض سعر|طلب عرض سعر|عرض سعر|request a quote|rfq|get quote/.test(text),
    contact:/whatsapp|واتساب|wa\.me|tel:|تواصل|contact/.test(text),
    form:$('form').length>0,
    reviews:/تقييمات المنتج|آراء العملاء|اراء العملاء|reviews|rating/.test(text),
    title:norm($('h1').first().text()||$('title').text()),
    soldCounts:[...body.matchAll(/تم\s+شراؤه\s+([0-9٠-٩۰-۹]+)\s*مر/gi)].map(m=>Number(latinDigits(m[1]))).filter(Number.isFinite)
  };
}

function ticketFromPrices(prices,industry){
  if(!prices.length)return null; const med=median(prices); if(!med)return null;
  const multiplier=/perfume|fashion|general ecommerce/i.test(industry)?1.15:1;
  return Math.round(med*multiplier);
}

export async function inferBusinessIntelligence({html='',url='',lead={},assumptions={}}={}){
  const $=cheerio.load(html||'');
  const body=norm($('body').text()); const title=norm($('title').text()); const meta=norm($('meta[name="description"]').attr('content')||'');
  const brandName=extractBrandName($,url); const platform=detectPlatform(html);
  let categories=extractCategories($); let combinedText=`${title} ${meta} ${body} ${categories.join(' ')}`;
  let industry=inferIndustry(combinedText);
  const jsonLd=extractJsonLdProducts($);
  let priceSamples=uniq([...jsonLd.prices,...extractPagePrices($,html)]).filter(n=>n>=10&&n<=500000);
  let productNames=uniq(jsonLd.names); let currencies=[...jsonLd.currencies];
  const links=classifyInternalLinks($,url); const sampledPages=[]; const sampledSignals=[];

  const sampleUrls=uniq([...links.products.slice(0,6),...links.categories.slice(0,2),...links.b2b.slice(0,2)]).slice(0,10);
  const fetched=await Promise.all(sampleUrls.map(fetchText));
  fetched.forEach((page,i)=>{
    if(!page)return; const candidate=sampleUrls[i]; sampledPages.push(page.finalUrl||candidate);
    const p$=cheerio.load(page.html); const pBody=norm(p$('body').text()); const pJson=extractJsonLdProducts(p$);
    priceSamples=uniq([...priceSamples,...pJson.prices,...extractPagePrices(p$,page.html)]).filter(n=>n>=10&&n<=500000).slice(0,160);
    productNames=uniq([...productNames,...pJson.names,/\/p\d+\/?$/i.test(new URL(candidate).pathname)?norm(p$('h1').first().text()):null]).slice(0,40);
    currencies=uniq([...currencies,...pJson.currencies]); categories=uniq([...categories,...extractCategories(p$)]).slice(0,30);
    combinedText+=` ${pBody.slice(0,10000)}`;
    sampledSignals.push({...pageSignals(page.html,page.finalUrl||candidate),type:links.b2b.includes(candidate)?'b2b':links.products.includes(candidate)?'product':'category'});
  });

  industry=inferIndustry(combinedText);
  const homeSignals=pageSignals(html,url);
  const directCommerce=Boolean(platform||homeSignals.cart||homeSignals.checkout||links.products.length>=2);
  const b2bMention=/حلول المشاريع|الشركات|توريد|مقاول|مقاولين|مشاريع/.test(combinedText.toLowerCase());
  const b2bPageDetected=links.b2b.length>0;
  const b2bSignals=sampledSignals.filter(x=>x.type==='b2b');
  const b2bConversionDetected=b2bSignals.some(x=>x.quote||x.contact||x.form);
  const quoteRequestDetected=b2bSignals.some(x=>x.quote) || homeSignals.quote;
  const productSignals=sampledSignals.filter(x=>x.type==='product');
  const cartDetected=homeSignals.cart||productSignals.some(x=>x.cart);
  const checkoutDetected=homeSignals.checkout||productSignals.some(x=>x.checkout)||directCommerce;
  const reviewsDetected=homeSignals.reviews||productSignals.some(x=>x.reviews);
  const soldCounts=sampledSignals.flatMap(x=>x.soldCounts||[]);

  const primaryRevenueMotion=directCommerce?'direct ecommerce':b2bMention?'lead generation / projects':'lead generation / information';
  const secondaryRevenueMotions=[]; if(directCommerce&&b2bMention)secondaryRevenueMotions.push('projects / B2B supply');
  const businessModel=directCommerce?(b2bMention?'ecommerce primary + B2B secondary':'ecommerce'):(b2bMention?'projects/B2B lead generation':'lead_generation_or_info');
  const currency=extractCurrency(`${combinedText} ${html}`,currencies)||(url&&/\.sa(?:\/|$)/i.test(url)?'SAR':null);
  const targetSegments=inferSegments(combinedText); const valuePropositions=extractValueProps(combinedText);
  const cleanPrices=uniq(priceSamples).filter(n=>n>=10&&n<=500000);
  const priceStats=cleanPrices.length?{min:Math.min(...cleanPrices),p25:percentile(cleanPrices,.25),median:median(cleanPrices),p75:percentile(cleanPrices,.75),max:Math.max(...cleanPrices),sampleCount:cleanPrices.length,samples:cleanPrices.slice(0,40)}:null;

  let inferredTicket=Number(assumptions.averageTicket)||null; let ticketSource=assumptions.averageTicket?'campaign_anchor':null;
  const observedTicket=ticketFromPrices(cleanPrices,industry);
  if(observedTicket){ inferredTicket=observedTicket; ticketSource='observed_public_product_prices'; }
  else if(!inferredTicket&&directCommerce){ inferredTicket=/water coolers|tanks/i.test(industry)?2500:/perfume/i.test(industry)?350:450; ticketSource='industry_prior'; }

  let inferredMonthlyLeads=Number(assumptions.monthlyLeadEstimate)||null; let leadSource=assumptions.monthlyLeadEstimate?'campaign_anchor':null;
  if(!inferredMonthlyLeads){
    const reviews=Math.max(0,Number(lead.reviewCount)||0);
    if(reviews){ inferredMonthlyLeads=clamp(Math.round(Math.sqrt(reviews)*2),8,100); leadSource='bounded_review_activity_proxy'; }
    else if(soldCounts.length){ inferredMonthlyLeads=clamp(Math.max(...soldCounts)*2,8,35); leadSource='public_purchase_counter_activity_envelope'; }
    else { inferredMonthlyLeads=directCommerce?18:12; leadSource='business_model_prior'; }
  }

  const contentQuality=[];
  if(/water coolers|tanks/i.test(industry)&&/صيحات الموضة|fashion trends|مجلات الموضة/i.test(combinedText)) contentQuality.push({type:'irrelevant_faq',severity:'medium',evidence:'Fashion-trend FAQ text appears on a water-cooler/tank storefront.'});

  let confidence=32;
  if(industry!=='general business')confidence+=12; if(platform)confidence+=10; if(productNames.length>=2)confidence+=10; if(cleanPrices.length>=3)confidence+=16; else if(cleanPrices.length)confidence+=8;
  if(categories.length>=2)confidence+=6; if(sampledPages.length>=3)confidence+=7; if(currency)confidence+=3; if(primaryRevenueMotion)confidence+=4;
  confidence=clamp(confidence,30,95);

  return {
    brandName, industry, businessModel, primaryRevenueMotion, secondaryRevenueMotions, platform, currency:currency||'unknown', categories,
    products:productNames, targetSegments, valuePropositions,
    funnelSignals:{
      cartDetected, checkoutDetected, b2bDetected:b2bMention, b2bPageDetected, b2bConversionDetected, quoteRequestDetected,
      whatsappDetected:/واتساب|whatsapp|wa\.me/i.test(combinedText), phoneDetected:/tel:|\+966|05[0-9]{8}/i.test(combinedText),
      reviewsDetected, blogDetected:links.blog.length>0||/\/blog|المدونة|مقالات/i.test(combinedText),
      loyaltyDetected:/برامج الولاء|نقاط الولاء/i.test(combinedText), installmentDetected:/تمارا|تابي|tamara|tabby|mispay/i.test(combinedText),
      freeDeliveryDetected:/توصيل سريع ومجاني|شحن مجاني|توصيل مجاني/i.test(combinedText)
    },
    pageInventory:{productLinks:links.products.length,categoryLinks:links.categories.length,b2bLinks:links.b2b.length,blogLinks:links.blog.length},
    publicSalesSignals:{purchaseCounters:soldCounts, note:soldCounts.length?'Public purchase counters were observed, but are not treated as monthly orders.':'No reliable public order volume was found.'},
    contentQuality,
    priceSamples:cleanPrices.slice(0,30), priceStats,
    averageTicketAnchor:inferredTicket, averageTicketSource:ticketSource, monthlyLeadAnchor:inferredMonthlyLeads, monthlyLeadSource:leadSource,
    confidence, sampledPages,
    evidence:{title,metaDescription:meta,categoryCount:categories.length,productCount:productNames.length,priceSampleCount:cleanPrices.length,sampledPageCount:sampledPages.length,brandName,primaryRevenueMotion},
    disclaimer:'Business type, product mix, public pricing, platform, funnel and target segments are inferred from publicly accessible pages. Public purchase counters are activity signals only; demand and conversion impact remain modeled until first-party analytics/order data is available.'
  };
}
