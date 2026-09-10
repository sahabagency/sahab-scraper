import * as cheerio from 'cheerio';

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function uniq(arr=[]){return [...new Set(arr.filter(Boolean))];}
function cleanText(s=''){return String(s).replace(/\s+/g,' ').trim();}
function hostOf(url=''){try{return new URL(url).hostname.replace(/^www\./,'').toLowerCase();}catch{return '';}}

async function fetchPage(url){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; SahabBusinessIntel/2.0; +https://sahab.agency)'},signal:AbortSignal.timeout(12000)});
    if(!r.ok)return null; const ct=r.headers.get('content-type')||''; if(!ct.includes('text/html'))return null;
    return {url:r.url,html:await r.text()};
  }catch{return null;}
}

function detectPlatform(html=''){
  const t=html.toLowerCase();
  if(t.includes('salla.sa')||t.includes('cdn.salla.sa')||t.includes('منصة سلة')||t.includes('salla-apps')) return {name:'Salla',confidence:99};
  if(t.includes('cdn.shopify.com')||t.includes('shopify-section')||t.includes('myshopify.com')) return {name:'Shopify',confidence:98};
  if(t.includes('woocommerce')||t.includes('wp-content/plugins/woocommerce')) return {name:'WooCommerce',confidence:96};
  return {name:'Custom/Unknown',confidence:40};
}

function detectCurrency(text=''){
  const hits={SAR:0,USD:0,AED:0,KWD:0,BHD:0,QAR:0,TRY:0};
  const patterns={SAR:[/ر\.\s?س/g,/ريال(?:\s+سعودي)?/g,/\bSAR\b/gi],USD:[/\$/g,/دولار/g,/\bUSD\b/gi],AED:[/د\.\s?إ/g,/درهم(?:\s+إماراتي)?/g,/\bAED\b/gi],KWD:[/د\.\s?ك/g,/دينار\s+كويتي/g,/\bKWD\b/gi],BHD:[/د\.\s?ب/g,/دينار\s+بحريني/g,/\bBHD\b/gi],QAR:[/ر\.\s?ق/g,/ريال\s+قطري/g,/\bQAR\b/gi],TRY:[/₺/g,/ليرة\s+تركية/g,/\bTRY\b/gi]};
  for(const [k,regs] of Object.entries(patterns)) for(const re of regs) hits[k]+=(text.match(re)||[]).length;
  const [currency,count]=Object.entries(hits).sort((a,b)=>b[1]-a[1])[0];
  return count?{currency,confidence:clamp(65+count*4,65,99)}:{currency:'SAR',confidence:30};
}

function extractJsonLd(html=''){
  const $=cheerio.load(html),items=[];
  $('script[type="application/ld+json"]').each((_,s)=>{try{const d=JSON.parse($(s).html()||'null'); const push=x=>{if(Array.isArray(x))x.forEach(push);else if(x&&typeof x==='object'){items.push(x); if(x['@graph'])push(x['@graph']);}}; push(d);}catch{}});
  return items;
}

function parsePrices(html='',currency='SAR'){
  const vals=[]; const text=cleanText(cheerio.load(html).text());
  for(const item of extractJsonLd(html)){
    const offers=Array.isArray(item.offers)?item.offers:[item.offers].filter(Boolean);
    for(const o of offers){const n=Number(o?.price||o?.lowPrice||o?.highPrice);if(Number.isFinite(n)&&n>=5&&n<=200000)vals.push(n);}
  }
  const patterns=[/(?:SAR|ر\.\s?س|ريال)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:SAR|ر\.\s?س|ريال)/gi];
  if(currency==='USD')patterns.push(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g);
  for(const re of patterns){let m;while((m=re.exec(text))){const n=Number(String(m[1]).replace(/,/g,''));if(Number.isFinite(n)&&n>=5&&n<=200000)vals.push(n);}}
  const a=uniq(vals).sort((x,y)=>x-y); if(!a.length)return{samples:[],sampleCount:0,median:null,p25:null,p75:null,min:null,max:null};
  const q=p=>a[Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p)))];
  return{samples:a.slice(0,40),sampleCount:a.length,median:q(.5),p25:q(.25),p75:q(.75),min:a[0],max:a[a.length-1]};
}

function linkType(url=''){
  let p='';try{p=decodeURIComponent(new URL(url).pathname).toLowerCase();}catch{return'other';}
  if(/\/p\d+(?:\/|$)|\/products?\//.test(p))return'product';
  if(/\/c\d+(?:\/|$)|\/categor|\/collections?\//.test(p))return'category';
  if(/مشاريع|الشركات|توريد|quote|rfq|business|b2b/.test(p))return'b2b';
  if(/about|من-نحن|من_نحن/.test(p))return'about';
  if(/blog|article|post|مقال|مدونة/.test(p))return'content';
  return'other';
}

function selectInternalLinks(html,baseUrl){
  const $=cheerio.load(html),host=hostOf(baseUrl),scored=[];
  $('a[href]').each((_,a)=>{try{const u=new URL($(a).attr('href'),baseUrl);if(hostOf(u.toString())!==host)return;const type=linkType(u.toString());const score={b2b:10,about:9,product:8,category:7,content:5,other:1}[type];scored.push({url:u.toString().split('#')[0],type,score});}catch{}});
  return uniq(scored.sort((a,b)=>b.score-a.score).map(x=>x.url)).slice(0,14);
}

function classifyIndustry(text=''){
  const t=text.toLowerCase();
  const rules=[{industry:'Water coolers & water storage equipment',re:/براد|برادة|تبريد المياه|خزان ماء|ستانلس|صاج مجلفن|بولي.?إيثيلين|water cooler|water tank/},{industry:'Perfume & fragrance retail',re:/عطر|عطور|عود|بخور|perfume|fragrance|oud/},{industry:'Honey & specialty food',re:/عسل|سدر|طلح|honey/},{industry:'Aesthetic / medical clinic',re:/عياد|clinic|derma|aesthetic|medical center/},{industry:'Fashion & apparel',re:/ملابس|عبا|fashion|apparel|shirt|dress/},{industry:'Beauty & cosmetics retail',re:/مكياج|تجميل|cosmetic|beauty|skincare/}];
  return rules.find(x=>x.re.test(t))?.industry||'E-commerce / retail business';
}

function extractNamedProducts(html=''){
  const $=cheerio.load(html),out=[];
  for(const item of extractJsonLd(html)){if(/product/i.test(String(item['@type']||''))&&item.name)out.push(cleanText(item.name));}
  $('h1,h2,h3,h4,a').each((_,el)=>{const tx=cleanText($(el).text());if(tx.length<3||tx.length>90)return;if(/أضف للسلة|عرض الكل|تسوق|اقرأ المزيد|الرئيسية|من نحن|سياسة|تواصل/i.test(tx))return;if(/براد|خزان|ستانلس|صاج|بلاستيك|PE|عسل|عطر|عود|بخور|منتج|product/i.test(tx))out.push(tx);});
  return uniq(out).slice(0,15);
}

function factsFromText(text=''){
  const facts=[]; const t=text;
  if(/براءة اختراع[^.\n]{0,80}SA\s*19086/i.test(t))facts.push('Saudi patent SA 19086 referenced publicly');
  const founded=t.match(/تأسيس[^.\n]{0,40}(\d{3,4})هـ/);if(founded)facts.push(`Founded/history reference: ${founded[1]} AH`);
  if(/الدمام/.test(t))facts.push('Public location reference: Dammam');
  if(/توصيل سريع ومجاني|شحن مجاني/.test(t))facts.push('Free/fast delivery claim shown');
  if(/برامج الولاء|برنامج الولاء/.test(t))facts.push('Loyalty program shown');
  if(/دعم فني على مدار الساعة|24\/7/.test(t))facts.push('24/7 support claim shown');
  return facts;
}

function buildSignals({html,text,pages}){
  const lower=(text+' '+html).toLowerCase();
  const profileLinks={instagram:/instagram\.com\//i.test(html),facebook:/facebook\.com\//i.test(html),linkedin:/linkedin\.com\//i.test(html),tiktok:/tiktok\.com\//i.test(html),x:/(?:x\.com|twitter\.com)\//i.test(html)};
  const b2bPageDetected=pages.some(p=>linkType(p.url)==='b2b');
  const trackers={
    googleTagManager:{state:/googletagmanager\.com\/gtm\.js|gtm-[a-z0-9]+/i.test(html)?'verified':'unknown',evidence:((html.match(/GTM-[A-Z0-9]+/ig)||[]).slice(0,3))},
    googleAnalytics:{state:/gtag\\s*\\(|google-analytics\.com|googletagmanager/i.test(html)?'verified':'unknown',evidence:[]},
    metaPixel:{state:/connect\\.facebook\\.net|fbq\\s*\\(|facebook\\.com\\/tr/i.test(html)?'verified':'unknown',evidence:[]},
    tiktokPixel:{state:/analytics\\.tiktok\\.com|ttq\\s*\\.|ttq\\s*\\(/i.test(html)?'verified':'unknown',evidence:[]},
    snapchatPixel:{state:/sc-static\\.snapchat\.com|snaptr\\s*\\(/i.test(html)?'verified':'unknown',evidence:[]},
    googleAds:{state:/googleadservices\\.com|AW-[0-9]+|gtag\\s*\\([^)]*config/i.test(html)?'verified':'unknown',evidence:[]}
  };
  return {
    cartDetected:/أضف للسلة|add to cart|checkout|سلة التسوق/i.test(lower),
    checkoutDetected:/checkout|إتمام الطلب|الدفع|تمارا|تابي|apple pay|stc pay/i.test(lower),
    b2bDetected:/حلول المشاريع|الشركات|الجملة|توريد|مقاول|wholesale|corporate|b2b/i.test(lower),
    b2bPageDetected,
    quoteRequestDetected:/طلب عرض سعر|احصل على عرض|quotation|request a quote|rfq/i.test(lower),
    b2bConversionDetected:/طلب عرض سعر|quotation|rfq|نموذج.*مشروع|تواصل.*مشروع/i.test(lower),
    loyaltyDetected:/برنامج الولاء|برامج الولاء|loyalty/i.test(lower),
    reviewsDetected:/آراء العملاء|اراء العملاء|تقييم|review|rating/i.test(lower),
    shippingDetected:/شحن|توصيل|shipping|delivery/i.test(lower),
    whatsappDetected:/wa\.me|whatsapp|واتساب/i.test(lower),
    profileLinks,
    trackers
  };
}

function contentRisks(text='',industry=''){
  const risks=[];
  if(/water cooler|water storage/i.test(industry)&&/أحدث صيحات الموضة|مدونات الأزياء|مجلات الموضة/.test(text))risks.push({type:'template_content_mismatch',severity:'high',evidence:'FAQ contains fashion-related template copy unrelated to water-cooling products'});
  return risks;
}

async function aiClassify(ctx){
  if(!process.env.OPENAI_API_KEY)return null;
  const payload={model:process.env.OPENAI_MODEL||'gpt-5-mini',input:[{role:'system',content:'Analyze the supplied public website evidence as a commercial analyst. Return strict JSON only with businessType, industry, businessModel, products(max 10), audiences(max 6), geography, valueProposition, revenuePaths(max 5), confidence(0-100), evidence(max 10). Distinguish B2C ecommerce from B2B/project sales. Do not invent revenue, traffic, ad spend, integrations or sales.'},{role:'user',content:JSON.stringify(ctx)}]};
  try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});if(!r.ok)return null;const d=await r.json();const raw=d.output_text||d.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!raw)return null;return JSON.parse(raw.trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim());}catch{return null;}
}

export async function analyzeBusinessWebsite({name='',website=''}={}){
  if(!website)return null; const root=await fetchPage(website); if(!root)return null;
  const pages=[root]; for(const link of selectInternalLinks(root.html,root.url).slice(0,10)){const p=await fetchPage(link);if(p)pages.push(p);}
  const html=pages.map(p=>p.html).join('\n'); const text=cleanText(cheerio.load(html).text()).slice(0,60000);
  const platform=detectPlatform(html),currency=detectCurrency(text+' '+html),priceStats=parsePrices(html,currency.currency),industry0=classifyIndustry(text),signals=buildSignals({html,text,pages}),products=extractNamedProducts(html),risks=contentRisks(text,industry0);
  const pageInventory={productLinks:pages.filter(p=>linkType(p.url)==='product').length,categoryLinks:pages.filter(p=>linkType(p.url)==='category').length,b2bLinks:pages.filter(p=>linkType(p.url)==='b2b').length,aboutLinks:pages.filter(p=>linkType(p.url)==='about').length};
  const ecommerce=signals.cartDetected||platform.name==='Salla'||platform.name==='Shopify'||platform.name==='WooCommerce'; const b2b=signals.b2bDetected||signals.b2bPageDetected;
  const ai=await aiClassify({name,website:root.url,platform,currency:currency.currency,priceStats,industry0,signals,pageInventory,products,siteText:text.slice(0,18000)});
  const industry=ai?.industry||industry0; const businessModel=ai?.businessModel||(ecommerce?(b2b?'E-commerce + B2B/project sales':'E-commerce retail'):'Lead-generation / informational');
  const revenuePaths=uniq([...(ai?.revenuePaths||[]),ecommerce?'Direct ecommerce':null,b2b?'B2B / project sales':null]);
  return {source:'public_website_intelligence_v2',website:root.url,pagesScanned:pages.map(p=>p.url),sampledPages:pages.map(p=>p.url),platform,currency,commerce:{ecommerce,b2b,shipping:signals.shippingDetected,businessModel},businessModel,industry,businessType:ai?.businessType||(ecommerce?'Online store':'Business website'),products:uniq([...(ai?.products||[]),...products]).slice(0,12),audiences:ai?.audiences||[],geography:ai?.geography||null,valueProposition:ai?.valueProposition||null,revenuePaths,priceStats,pageInventory,funnelSignals:signals,marketingStack:{gtm:/googletagmanager|gtm-[a-z0-9]+/i.test(html),analytics:/gtag\(|google-analytics|googletagmanager/i.test(html),metaPixel:/connect\.facebook\.net|fbq\(/i.test(html)?'detected':'not_observable',socialProfiles:signals.profileLinks},contentRisks:risks,confidence:clamp(Number(ai?.confidence)||82,55,98),evidence:uniq([...(ai?.evidence||[]),...factsFromText(text),`Platform: ${platform.name}`,`Currency: ${currency.currency}`,ecommerce?'E-commerce path detected':null,b2b?'B2B/project-sales path detected':null,priceStats.sampleCount?`${priceStats.sampleCount} public price points observed`:null]).slice(0,16)};
}
