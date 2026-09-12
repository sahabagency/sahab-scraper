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
    ['water coolers, water dispensers & storage solutions', /براد|برادات|تبريد المياه|خزان ماء|خزانات ميا|water cooler|water dispenser|water tank|سبيل/],
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
  const generic=/^(home|الرئيسية|متجر|store|logo|الشعار|image|صورة|brand|site logo|website logo)$/i;
  const titleRaw=norm($('title').text());
  const titleCandidates=titleRaw.split(/[|–—]/).map(norm).filter(Boolean);
  const candidates=[$('meta[property="og:site_name"]').attr('content'),$('meta[name="application-name"]').attr('content'),...titleCandidates,$('meta[property="og:title"]').attr('content'),$('header img[alt]').first().attr('alt')].map(norm).filter(Boolean);
  const chosen=candidates.find(x=>x.length>=3&&x.length<=100&&!generic.test(x)&&!/^(https?:|www\.)/i.test(x));
  if(chosen)return chosen.replace(/\s*[-|–—]\s*(الرئيسية|home).*$/i,'').trim();
  try{return new URL(url).hostname.replace(/^www\./,'').split('.')[0].replace(/[-_]+/g,' ');}catch{return null;}
}

function extractJsonLdProducts($){
  const prices=[]; const names=[]; const currencies=[]; const pairs=[];
  $('script[type="application/ld+json"]').each((_,el)=>{ try{ const parsed=JSON.parse($(el).html()||'{}'); const walk=node=>{ if(!node||typeof node!=='object')return; const type=Array.isArray(node['@type'])?node['@type'].join(' '):String(node['@type']||''); if(/product/i.test(type)){ const name=node.name?norm(node.name):null; if(name)names.push(name); const offers=Array.isArray(node.offers)?node.offers:[node.offers].filter(Boolean); for(const offer of offers){ const value=offer?.price||offer?.lowPrice||offer?.highPrice; const n=Number(latinDigits(String(value||'')).replace(/,/g,'')); if(Number.isFinite(n)&&n>=10&&n<=500000){prices.push(n); if(name)pairs.push({name,price:n});} if(offer?.priceCurrency)currencies.push(String(offer.priceCurrency).toUpperCase()); }} for(const value of Object.values(node)){ if(Array.isArray(value))value.forEach(walk); else if(value&&typeof value==='object')walk(value); }}; (Array.isArray(parsed)?parsed:[parsed]).forEach(walk); }catch{} });
  return {prices,names,currencies,pairs};
}

function extractPagePrices($, raw=''){
  const out=[]; const push=v=>{const n=Number(latinDigits(String(v||'')).replace(/[^0-9.]/g,'')); if(Number.isFinite(n)&&n>=10&&n<=500000)out.push(n);};
  ['meta[property="product:price:amount"]','meta[itemprop="price"]','[itemprop="price"]','[data-price]'].forEach(sel=>$(sel).each((_,el)=>push($(el).attr('content')||$(el).attr('data-price')||$(el).text())));
  const text=latinDigits(norm($('body').text()));
  for(const re of [/(?:السعر|price)\s*[:：]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,/(?:ر\.?\s?س|ريال(?: سعودي)?|sar)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:ر\.?\s?س|ريال(?: سعودي)?|sar)/gi]){let m;while((m=re.exec(text))){push(m[1]);if(out.length>80)break;}}
  (String(raw).match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/gi)||[]).forEach(s=>push((s.match(/[0-9]+(?:\.[0-9]+)?/)||[])[0])); return uniq(out);
}

function extractCurrency(text='',jsonCurrencies=[]){ const t=latinDigits(text); if(jsonCurrencies.includes('SAR')||/(?:ر\.?\s?س|ريال سعودي|\bSAR\b)/i.test(t))return'SAR'; if(/(?:د\.إ|AED)/i.test(t))return'AED'; if(/\$|USD/i.test(t))return'USD'; return null; }
function extractCategories($){const v=[];$('nav a,header a,a,h1,h2,h3,h4').each((_,el)=>{const s=norm($(el).text());if(s.length>=3&&s.length<=90&&/براد|خزان|شبك|منتج|قسم|category|collection|clinic|عطر|قهوة|ملابس|حلول المشاريع|الشركات/i.test(s))v.push(s);});return uniq(v).slice(0,24);}
function inferSegments(text=''){const t=String(text).toLowerCase(),out=[];for(const [l,r] of [['Consumers / homes',/البيت|المنزل|الفلل|العائلة|الأطفال|الاستراحة|صدقة جارية/],['Projects / companies',/حلول المشاريع|الشركات|المؤسسات|مشاريع|توريد|مقاول|مقاولين|جهات/],['Schools / education',/مدرسة|مدارس|طلاب|تعليم/],['Mosques / charity',/مسجد|مساجد|صدقة جارية|سبيل/],['Farms / outdoor',/مزرعة|مزارع|موقع مكشوف|الشارع/]])if(r.test(t))out.push(l);return out;}
function extractValueProps(text=''){const t=String(text).toLowerCase(),out=[];for(const [l,r] of [['Saudi patented product',/براءة اختراع سعودية|sa\s*19086/],['Saudi-made positioning',/منتج سعودي|صنع في السعودية|سعودي 100/],['Free delivery',/توصيل سريع ومجاني|شحن مجاني|توصيل مجاني/],['Warranty',/ضمان سنتين|ضمان|استعادة الأموال/],['Loyalty program',/برامج الولاء|نقاط الولاء/],['Made for Saudi climate',/شمس السعودية|حرارة الصيف|الحرارة القاسية/]])if(r.test(t))out.push(l);return out;}

function canonicalProductFamilies(text='',industry=''){
  const t=String(text).toLowerCase(),out=[];
  if(/water cooler|water dispenser|براد|برادات|سبيل/.test(`${industry} ${t}`)){
    if(/بلاستيك|بولي.?إيثيلين|\bpe\b/.test(t))out.push('PE / polyethylene water coolers');
    if(/ستانلس|stainless/.test(t))out.push('Stainless-steel water coolers');
    if(/صاج مجلفن|galvanized/.test(t))out.push('Galvanized-steel water coolers');
    if(/خزان|tank/.test(t))out.push('Water tanks');
    if(/شبك|حامل|حماية|accessor/.test(t))out.push('Protective cages / accessories');
  }
  return out;
}

function classifyInternalLinks($,baseUrl){let host='';try{host=new URL(baseUrl).host;}catch{return{products:[],categories:[],b2b:[],blog:[]};}const g={products:[],categories:[],b2b:[],blog:[]};$('a[href]').each((_,a)=>{const href=$(a).attr('href');if(!href)return;let u;try{u=new URL(href,baseUrl);}catch{return}if(u.host!==host)return;const p=u.pathname.toLowerCase(),txt=norm($(a).text()).toLowerCase(),decoded=(()=>{try{return decodeURIComponent(p);}catch{return p;}})();if(/\/p\d+\/?$|\/product|\/products|\/item/.test(p))g.products.push(u.href);if(/\/c\d+\/?$|\/category|\/categories|\/collection/.test(p))g.categories.push(u.href);if(/حلول المشاريع|الشركات|توريد|مشاريع|request.*quote|quote|rfq/.test(`${txt} ${decoded}`))g.b2b.push(u.href);if(/\/blog|مقال|المدونة/.test(`${txt} ${decoded}`))g.blog.push(u.href);});for(const k of Object.keys(g))g[k]=uniq(g[k]);return g;}
async function fetchText(url){try{const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; SahabBusinessIntelligence/3.5; +https://sahab.agency)'},signal:AbortSignal.timeout(10000)});if(!r.ok)return null;return{html:await r.text(),finalUrl:r.url};}catch{return null;}}
function detectTrackers(html=''){
  const rules={
    googleTagManager:[/googletagmanager\.com\/gtm\.js/i,/GTM-[A-Z0-9]+/ig,/'gtm\.start'/i],
    googleAnalytics:[/googletagmanager\.com\/gtag\/js/i,/google-analytics\.com/i,/\bgtag\s*\(/i,/\bG-[A-Z0-9]{6,}\b/ig],
    metaPixel:[/connect\.facebook\.net/i,/fbevents\.js/i,/\bfbq\s*\(/i,/facebook\.com\/tr/i],
    tiktokPixel:[/analytics\.tiktok\.com/i,/\bttq\s*\./i,/\bttq\s*\(/i,/_ttp\b/i],
    snapchatPixel:[/sc-static\.net/i,/snaptr\s*\(/i,/snapchat\.com/i,/_scid\b/i],
    googleAds:[/googleadservices\.com/i,/\bAW-[0-9]+\b/ig,/conversion_linker/i,/gtag\s*\([^)]*config[^)]*AW-/i]
  };
  const out={};
  for(const [key,patterns] of Object.entries(rules)){
    const evidence=[];
    for(const re of patterns){
      const rx=new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g');let m,count=0;
      while((m=rx.exec(String(html||'')))&&count<4){evidence.push(String(m[0]).replace(/\s+/g,' ').slice(0,90));count++;}
    }
    const hits=uniq(evidence).slice(0,6);
    out[key]={state:hits.length?'verified':'unknown',evidence:hits,confidence:hits.length?96:35,reason:hits.length?'Public marker observed in fetched page source':'No public marker in fetched page source; not proof of absence'};
  }
  return out;
}

function pageSignals(html='',url=''){const $=cheerio.load(html),body=norm($('body').text()),hrefs=$('a[href]').map((_,a)=>$(a).attr('href')||'').get().join(' '),text=`${body} ${hrefs} ${html}`.toLowerCase();return{url,cart:/أضف إلى السلة|أضف للسلة|add to cart|buy now|سلة المشتريات/.test(text),checkout:/checkout|إتمام الطلب|اتمام الطلب|الدفع|cart/.test(text),quote:/اطلب عرض سعر|طلب عرض سعر|عرض سعر|request a quote|rfq|get quote/.test(text),contact:/whatsapp|واتساب|wa\.me|tel:|تواصل|contact/.test(text),booking:/احجز|حجز موعد|موعد|booking|appointment|book now|schedule/i.test(text),form:$('form').length>0,reviews:/تقييمات المنتج|آراء العملاء|اراء العملاء|reviews|rating/.test(text),title:norm($('h1').first().text()||$('title').text()),soldCounts:[...body.matchAll(/تم\s+شراؤه\s+([0-9٠-٩۰-۹]+)\s*مر/gi)].map(m=>Number(latinDigits(m[1]))).filter(Number.isFinite)};}
function ticketFromPrices(prices,industry){if(!prices.length)return null;const med=median(prices);if(!med)return null;return Math.round(med*(/perfume|fashion|general ecommerce/i.test(industry)?1.15:1));}
function stats(nums=[]){const a=uniq(nums).filter(Number.isFinite).sort((x,y)=>x-y);return a.length?{min:a[0],p25:percentile(a,.25),median:median(a),p75:percentile(a,.75),max:a[a.length-1],sampleCount:a.length,samples:a.slice(0,40)}:null;}
function isCoreProduct(name='',industry=''){const n=String(name).toLowerCase();if(/water cooler|water dispenser/.test(industry))return /براد|برادة|cooler|dispenser|سبيل/.test(n)&&!/خزان|tank|شبك|حامل|accessor|اكسسوار/.test(n);return true;}

export async function inferBusinessIntelligence({html='',url='',lead={},assumptions={}}={}){
  const $=cheerio.load(html||''),body=norm($('body').text()),title=norm($('title').text()),meta=norm($('meta[name="description"]').attr('content')||'');
  const brandName=extractBrandName($,url),platform=detectPlatform(html);let categories=extractCategories($),combinedText=`${title} ${meta} ${body} ${categories.join(' ')}`;let industry=inferIndustry(combinedText);
  const jsonLd=extractJsonLdProducts($);let priceSamples=uniq([...jsonLd.prices,...extractPagePrices($,html)]).filter(n=>n>=10&&n<=500000),productNames=uniq(jsonLd.names),productPricePairs=[...(jsonLd.pairs||[])],currencies=[...jsonLd.currencies];
  const links=classifyInternalLinks($,url),sampledPages=[],sampledSignals=[],sampleUrls=uniq([...links.products.slice(0,7),...links.categories.slice(0,3),...links.b2b.slice(0,2),...links.blog.slice(0,2)]).slice(0,14),fetched=await Promise.all(sampleUrls.map(fetchText));
  fetched.forEach((page,i)=>{if(!page)return;const candidate=sampleUrls[i];sampledPages.push(page.finalUrl||candidate);const p$=cheerio.load(page.html),pBody=norm(p$('body').text()),pJson=extractJsonLdProducts(p$);priceSamples=uniq([...priceSamples,...pJson.prices,...extractPagePrices(p$,page.html)]).filter(n=>n>=10&&n<=500000).slice(0,180);productNames=uniq([...productNames,...pJson.names,/\/p\d+\/?$/i.test(new URL(candidate).pathname)?norm(p$('h1').first().text()):null]).slice(0,50);productPricePairs.push(...(pJson.pairs||[]));currencies=uniq([...currencies,...pJson.currencies]);categories=uniq([...categories,...extractCategories(p$)]).slice(0,36);combinedText+=` ${pBody.slice(0,12000)}`;sampledSignals.push({...pageSignals(page.html,page.finalUrl||candidate),type:links.b2b.includes(candidate)?'b2b':links.products.includes(candidate)?'product':links.blog.includes(candidate)?'blog':'category'});});
  industry=inferIndustry(combinedText);const home=pageSignals(html,url),directCommerce=Boolean(platform||home.cart||home.checkout||links.products.length>=2),b2bMention=/حلول المشاريع|الشركات|توريد|مقاول|مقاولين|مشاريع/.test(combinedText.toLowerCase()),b2bSignals=sampledSignals.filter(x=>x.type==='b2b'),productSignals=sampledSignals.filter(x=>x.type==='product');
  const b2bPageDetected=links.b2b.length>0,b2bConversionDetected=b2bSignals.some(x=>x.quote||x.contact||x.form),quoteRequestDetected=b2bSignals.some(x=>x.quote)||home.quote,cartDetected=home.cart||productSignals.some(x=>x.cart),checkoutDetected=home.checkout||productSignals.some(x=>x.checkout)||directCommerce,reviewsDetected=home.reviews||productSignals.some(x=>x.reviews),bookingDetected=home.booking||sampledSignals.some(x=>x.booking),soldCounts=sampledSignals.flatMap(x=>x.soldCounts||[]);
  const trackers=detectTrackers(html);
  const primaryRevenueMotion=directCommerce?'direct ecommerce':b2bMention?'lead generation / projects':'lead generation / information',secondaryRevenueMotions=[];if(directCommerce&&b2bMention)secondaryRevenueMotions.push('projects / B2B supply');
  const businessModel=directCommerce?(b2bMention?'ecommerce + B2B/project sales':'ecommerce'):b2bMention?'projects/B2B lead generation':'lead_generation_or_info';
  const currency=extractCurrency(`${combinedText} ${html}`,currencies)||(url&&/\.sa(?:\/|$)/i.test(url)?'SAR':null),targetSegments=inferSegments(combinedText),valuePropositions=extractValueProps(combinedText),cleanPrices=uniq(priceSamples).filter(n=>n>=10&&n<=500000),priceStats=stats(cleanPrices);
  const canonicalFamilies=canonicalProductFamilies(combinedText,industry);
  const corePairs=uniq(productPricePairs.map(x=>`${norm(x.name)}|||${Number(x.price)}`)).map(s=>{const [name,price]=s.split('|||');return{name,price:Number(price)};}).filter(x=>isCoreProduct(x.name,industry)&&Number.isFinite(x.price));
  const corePriceStats=stats(corePairs.map(x=>x.price));
  let inferredTicket=Number(assumptions.averageTicket)||null,ticketSource=assumptions.averageTicket?'campaign_anchor':null;const observedTicket=ticketFromPrices(corePriceStats?.samples?.length?corePriceStats.samples:cleanPrices,industry);if(observedTicket){inferredTicket=observedTicket;ticketSource=corePriceStats?.sampleCount>=2?'observed_core_product_prices':'observed_public_product_prices';}else if(!inferredTicket&&directCommerce){inferredTicket=/water coolers|water dispensers|tanks/i.test(industry)?2700:/perfume/i.test(industry)?350:450;ticketSource='industry_prior';}
  let inferredMonthlyLeads=Number(assumptions.monthlyLeadEstimate)||null,leadSource=assumptions.monthlyLeadEstimate?'campaign_anchor':null;if(!inferredMonthlyLeads){const reviews=Math.max(0,Number(lead.reviewCount)||0);if(reviews){inferredMonthlyLeads=clamp(Math.round(Math.sqrt(reviews)*2),8,100);leadSource='bounded_review_activity_proxy';}else if(soldCounts.length){const signal=Math.max(...soldCounts);inferredMonthlyLeads=clamp(Math.round(10+Math.sqrt(signal)*5),10,55);leadSource='public_purchase_counter_activity_envelope';}else{const breadth=Math.min(12,Math.round((links.products.length+links.categories.length)/2));inferredMonthlyLeads=directCommerce?18+breadth:12;leadSource='business_model_and_catalog_prior';}}
  const contentQuality=[];if(/water coolers|water dispensers|tanks/i.test(industry)&&/صيحات الموضة|fashion trends|مجلات الموضة/i.test(combinedText))contentQuality.push({type:'irrelevant_faq',severity:'medium',evidence:'Fashion-trend FAQ text appears on a water-cooler/tank storefront.'});
  let confidence=32;if(industry!=='general business')confidence+=12;if(platform)confidence+=10;if(productNames.length>=2)confidence+=10;if(cleanPrices.length>=3)confidence+=12;if(corePriceStats?.sampleCount>=2)confidence+=6;if(categories.length>=2)confidence+=6;if(sampledPages.length>=3)confidence+=7;if(currency)confidence+=3;if(primaryRevenueMotion)confidence+=4;confidence=clamp(confidence,30,96);
  return{brandName,industry,businessModel,primaryRevenueMotion,secondaryRevenueMotions,platform,currency:currency||'unknown',categories,productFamilies:canonicalFamilies,products:productNames,targetSegments,valuePropositions,funnelSignals:{cartDetected,checkoutDetected,b2bDetected:!directCommerce&&b2bMention,b2bSecondaryDetected:directCommerce&&b2bMention,b2bPageDetected,b2bConversionDetected,quoteRequestDetected,whatsappDetected:/واتساب|whatsapp|wa\.me/i.test(combinedText),phoneDetected:/tel:|\+966|05[0-9]{8}/i.test(combinedText),reviewsDetected,blogDetected:links.blog.length>0||/\/blog|المدونة|مقالات/i.test(combinedText),loyaltyDetected:/برامج الولاء|نقاط الولاء/i.test(combinedText),installmentDetected:/تمارا|تابي|tamara|tabby|mispay/i.test(combinedText),freeDeliveryDetected:/توصيل سريع ومجاني|شحن مجاني|توصيل مجاني/i.test(combinedText),bookingDetected,trackers},pageInventory:{productLinks:links.products.length,categoryLinks:links.categories.length,b2bLinks:links.b2b.length,blogLinks:links.blog.length},publicSalesSignals:{purchaseCounters:soldCounts,note:soldCounts.length?'Public purchase counters were observed and used only as a bounded activity signal, never as monthly orders.':'No reliable public order volume was found.'},contentQuality,priceSamples:cleanPrices.slice(0,30),priceStats,coreProductPriceStats:corePriceStats,averageTicketAnchor:inferredTicket,averageTicketSource:ticketSource,monthlyLeadAnchor:inferredMonthlyLeads,monthlyLeadSource:leadSource,confidence,sampledPages,evidence:{title,metaDescription:meta,categoryCount:categories.length,productCount:productNames.length,productFamilyCount:canonicalFamilies.length,priceSampleCount:cleanPrices.length,corePriceSampleCount:corePriceStats?.sampleCount||0,sampledPageCount:sampledPages.length,brandName,primaryRevenueMotion},disclaimer:'Business type, product mix, public pricing, platform, funnel and target segments are inferred from publicly accessible pages. Core-product pricing is separated from tanks/accessories when identifiable. Public purchase counters are activity signals only; demand and conversion impact remain modeled until first-party analytics/order data is available.'};
}
