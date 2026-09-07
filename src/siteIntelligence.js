import * as cheerio from 'cheerio';

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function uniq(arr=[]){return [...new Set(arr.filter(Boolean))];}
function cleanText(s=''){return String(s).replace(/\s+/g,' ').trim();}
function hostOf(url=''){try{return new URL(url).hostname.replace(/^www\./,'').toLowerCase();}catch{return '';}}

async function fetchPage(url){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; SahabBusinessIntel/1.0; +https://sahab.agency)'},signal:AbortSignal.timeout(12000)});
    if(!r.ok)return null;
    const ct=r.headers.get('content-type')||'';
    if(!ct.includes('text/html'))return null;
    return {url:r.url,html:await r.text()};
  }catch{return null;}
}

function detectPlatform(html=''){
  const t=html.toLowerCase();
  if(t.includes('salla.sa')||t.includes('cdn.salla.sa')||t.includes('منصة سلة')||t.includes('salla-apps')) return {name:'Salla',confidence:98};
  if(t.includes('cdn.shopify.com')||t.includes('shopify-section')||t.includes('myshopify.com')) return {name:'Shopify',confidence:98};
  if(t.includes('woocommerce')||t.includes('wp-content/plugins/woocommerce')) return {name:'WooCommerce',confidence:96};
  return {name:'Custom/Unknown',confidence:40};
}

function detectCurrency(text=''){
  const t=text;
  const hits={SAR:0,USD:0,AED:0,KWD:0,BHD:0,QAR:0,TRY:0};
  const patterns={
    SAR:[/ر\.\s?س/g,/ريال(?:\s+سعودي)?/g,/\bSAR\b/gi],
    USD:[/\$/g,/دولار/g,/\bUSD\b/gi],
    AED:[/د\.\s?إ/g,/درهم(?:\s+إماراتي)?/g,/\bAED\b/gi],
    KWD:[/د\.\s?ك/g,/دينار\s+كويتي/g,/\bKWD\b/gi],
    BHD:[/د\.\s?ب/g,/دينار\s+بحريني/g,/\bBHD\b/gi],
    QAR:[/ر\.\s?ق/g,/ريال\s+قطري/g,/\bQAR\b/gi],
    TRY:[/₺/g,/ليرة\s+تركية/g,/\bTRY\b/gi]
  };
  for(const [k,regs] of Object.entries(patterns)) for(const re of regs) hits[k]+=(t.match(re)||[]).length;
  const [currency,count]=Object.entries(hits).sort((a,b)=>b[1]-a[1])[0];
  return count?{currency,confidence:clamp(60+count*5,60,98)}:{currency:'SAR',confidence:35};
}

function parsePrices(text='',currency='SAR'){
  const vals=[];
  const patterns=[
    /(?:SAR|ر\.\s?س|ريال)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,
    /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:SAR|ر\.\s?س|ريال)/gi
  ];
  if(currency==='USD') patterns.push(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g);
  for(const re of patterns){let m; while((m=re.exec(text))){const n=Number(String(m[1]).replace(/,/g,'')); if(Number.isFinite(n)&&n>=5&&n<=200000) vals.push(n);}}
  const a=uniq(vals).sort((x,y)=>x-y);
  if(!a.length)return {samples:[],median:null,p25:null,p75:null,min:null,max:null};
  const q=p=>a[Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p)))];
  return {samples:a.slice(0,30),median:q(.5),p25:q(.25),p75:q(.75),min:a[0],max:a[a.length-1]};
}

function selectInternalLinks(html,baseUrl){
  const $=cheerio.load(html); const host=hostOf(baseUrl); const links=[];
  $('a[href]').each((_,a)=>{try{const u=new URL($(a).attr('href'),baseUrl); if(hostOf(u.toString())!==host)return; const p=u.pathname.toLowerCase(); if(/product|products|category|categories|collections|blog|about|من-نحن|مشاريع|شركات|حلول|shop|store|p\//.test(p)) links.push(u.toString());}catch{}});
  return uniq(links).slice(0,6);
}

function deterministicClassification(text=''){
  const t=text.toLowerCase();
  const rules=[
    {industry:'Water coolers & water storage equipment',re:/براد|برادة|تبريد المياه|خزان ماء|ستانلس|صاج مجلفن|بولي.?إيثيلين|water cooler|water tank/},
    {industry:'Perfume & fragrance retail',re:/عطر|عطور|عود|بخور|perfume|fragrance|oud/},
    {industry:'Honey & specialty food',re:/عسل|سدر|طلح|honey/},
    {industry:'Aesthetic / medical clinic',re:/عياد|clinic|derma|aesthetic|medical center/},
    {industry:'Fashion & apparel',re:/ملابس|عبا|fashion|apparel|shirt|dress/},
    {industry:'Beauty & cosmetics retail',re:/مكياج|تجميل|cosmetic|beauty|skincare/}
  ];
  return rules.find(x=>x.re.test(t))?.industry||'E-commerce / retail business';
}

function extractProductsAndCategories(html=''){
  const $=cheerio.load(html); const out=[];
  $('h1,h2,h3,h4,a').each((_,el)=>{const tx=cleanText($(el).text()); if(tx.length<3||tx.length>80)return; if(/أضف للسلة|عرض الكل|تسوق|اقرأ المزيد|الرئيسية|من نحن|سياسة|تواصل|login|account/i.test(tx))return; if(/براد|خزان|ستانلس|صاج|بلاستيك|PE|عسل|عطر|عود|بخور|منتج|product|collection|category/i.test(tx)) out.push(tx);});
  return uniq(out).slice(0,12);
}

async function aiClassify({name,website,text,platform,currency,priceStats,deterministicIndustry}){
  if(!process.env.OPENAI_API_KEY)return null;
  const payload={model:process.env.OPENAI_MODEL||'gpt-5-mini',input:[
    {role:'system',content:'Analyze a business website from supplied public text only. Return strict JSON with: businessType, industry, businessModel, products (max 8), audiences (max 4), geography, confidence (0-100), evidence (max 8 short facts). Do not invent revenue, traffic, ad spend, sales or platform integrations not in the evidence.'},
    {role:'user',content:JSON.stringify({name,website,platform,currency,priceStats,deterministicIndustry,siteText:text.slice(0,10000)})}
  ]};
  try{
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
    if(!r.ok)return null; const d=await r.json(); const raw=d.output_text||d.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text; if(!raw)return null;
    return JSON.parse(raw.trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim());
  }catch{return null;}
}

export async function analyzeBusinessWebsite({name='',website=''}={}){
  if(!website)return null;
  const root=await fetchPage(website); if(!root)return null;
  const pages=[root];
  for(const link of selectInternalLinks(root.html,root.url).slice(0,4)){const p=await fetchPage(link); if(p)pages.push(p);}
  const html=pages.map(p=>p.html).join('\n');
  const text=cleanText(cheerio.load(html).text()).slice(0,30000);
  const platform=detectPlatform(html);
  const currency=detectCurrency(text+' '+html);
  const prices=parsePrices(text+' '+html,currency.currency);
  const ecommerce=/أضف للسلة|add to cart|checkout|cart|سلة التسوق|تمارا|تابي|apple pay|stc pay/i.test(text+' '+html);
  const b2b=/حلول المشاريع|الشركات|الجملة|مقاول|مقاولين|مشاريع|wholesale|corporate|b2b/i.test(text);
  const shipping=/شحن|توصيل|shipping|delivery/i.test(text);
  const deterministicIndustry=deterministicClassification(text);
  const products=extractProductsAndCategories(html);
  const ai=await aiClassify({name,website:root.url,text,platform,currency:currency.currency,priceStats:prices,deterministicIndustry});
  const industry=ai?.industry||deterministicIndustry;
  const businessModel=ai?.businessModel||(ecommerce?(b2b?'E-commerce + B2B/project sales':'E-commerce retail'):'Lead-generation / informational');
  return {
    source:'public_website_intelligence_v1',
    website:root.url,
    pagesScanned:pages.map(p=>p.url),
    platform,
    currency,
    commerce:{ecommerce,b2b,shipping,businessModel},
    industry,
    businessType:ai?.businessType||(ecommerce?'Online store':'Business website'),
    products:uniq([...(ai?.products||[]),...products]).slice(0,10),
    audiences:ai?.audiences||[],
    geography:ai?.geography||null,
    priceStats:prices,
    confidence:clamp(Number(ai?.confidence)||70,40,98),
    evidence:uniq([...(ai?.evidence||[]),platform.name!=='Custom/Unknown'?`Platform detected: ${platform.name}`:null,currency.currency?`Currency detected: ${currency.currency}`:null,ecommerce?'E-commerce/cart signals detected':null,b2b?'B2B/project-sales signals detected':null]).slice(0,12)
  };
}
