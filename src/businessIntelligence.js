import * as cheerio from 'cheerio';

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function median(nums=[]){ const a=nums.filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null; const m=Math.floor(a.length/2); return a.length%2?a[m]:Math.round((a[m-1]+a[m])/2); }
function percentile(nums=[],p=.5){ const a=nums.filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null; const i=Math.max(0,Math.min(a.length-1,Math.round((a.length-1)*p))); return a[i]; }
function uniq(arr=[]){ return [...new Set(arr.filter(Boolean))]; }
function norm(s=''){ return String(s).replace(/\s+/g,' ').trim(); }

function detectPlatform(html=''){
  const t=html.toLowerCase();
  if (t.includes('salla.network') || t.includes('cdn.salla.sa') || t.includes('salla.sa') || t.includes('platform.salla') || t.includes('salla.com')) return 'salla';
  if (t.includes('cdn.shopify.com') || t.includes('shopify-section') || t.includes('shopify.theme')) return 'shopify';
  if (t.includes('woocommerce') || t.includes('wp-content/plugins/woocommerce')) return 'woocommerce';
  return null;
}

function inferIndustry(text=''){
  const t=text.toLowerCase();
  const rules=[
    ['water coolers, tanks & water solutions', /براد|برادات|تبريد المياه|خزان ماء|خزانات مياة|water cooler|water tank|سبيل/],
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

function extractJsonLdProducts($){
  const prices=[]; const names=[]; const currencies=[];
  $('script[type="application/ld+json"]').each((_,el)=>{
    try{
      const raw=$(el).html(); if(!raw)return;
      const parsed=JSON.parse(raw);
      const nodes=Array.isArray(parsed)?parsed:[parsed];
      const walk=(node)=>{
        if(!node||typeof node!=='object')return;
        const type=Array.isArray(node['@type'])?node['@type'].join(' '):String(node['@type']||'');
        if(/product/i.test(type)){
          if(node.name) names.push(norm(node.name));
          const offers=Array.isArray(node.offers)?node.offers:[node.offers].filter(Boolean);
          for(const offer of offers){
            const n=Number(String(offer?.price||offer?.lowPrice||'').replace(/,/g,''));
            if(Number.isFinite(n)&&n>=5&&n<=500000)prices.push(n);
            if(offer?.priceCurrency)currencies.push(String(offer.priceCurrency).toUpperCase());
          }
        }
        for(const value of Object.values(node)){
          if(Array.isArray(value)) value.forEach(walk); else if(value&&typeof value==='object') walk(value);
        }
      };
      nodes.forEach(walk);
    }catch{}
  });
  return {prices,names,currencies};
}

function extractPrices(text=''){
  const out=[];
  const patterns=[/(?:ر\.?س|ريال(?: سعودي)?|sar)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:ر\.?س|ريال(?: سعودي)?|sar)/gi];
  for(const re of patterns){ let m; while((m=re.exec(text))){ const n=Number(m[1].replace(/,/g,'')); if(n>=5 && n<=500000) out.push(n); if(out.length>=80) break; } }
  return out;
}

function extractCurrency(text='',jsonCurrencies=[]){
  if(jsonCurrencies.includes('SAR')||/(?:ر\.?س|ريال سعودي|\bSAR\b)/i.test(text))return 'SAR';
  if(/(?:د\.إ|AED)/i.test(text))return 'AED';
  if(/\$|USD/i.test(text))return 'USD';
  return null;
}

function extractCategories($){
  const values=[];
  $('a,h1,h2,h3,h4').each((_,el)=>{
    const s=norm($(el).text());
    if(s.length>=3 && s.length<=80 && /براد|خزان|شبك|منتج|قسم|category|collection|clinic|عطر|قهوة|ملابس|حلول المشاريع|الشركات/i.test(s)) values.push(s);
  });
  return uniq(values).slice(0,16);
}

function inferSegments(text=''){
  const t=text.toLowerCase(); const out=[];
  const rules=[
    ['B2B / projects',/حلول المشاريع|الشركات|المؤسسات|مشاريع|توريد|مدارس|مساجد|جهات/],
    ['Homes / consumers',/البيت|المنزل|الفلل|العائلة|الأطفال|الاستراحة/],
    ['Schools / education',/مدرسة|مدارس|طلاب|تعليم/],
    ['Mosques / charity',/مسجد|مساجد|صدقة جارية|سبيل/],
    ['Farms / outdoor',/مزرعة|مزارع|موقع مكشوف|الشارع/]
  ];
  for(const [label,re] of rules) if(re.test(t))out.push(label);
  return out;
}

function extractValueProps(text=''){
  const t=text.toLowerCase(); const out=[];
  const rules=[
    ['Saudi patented product',/براءة اختراع سعودية|sa\s*19086/],
    ['Free delivery',/توصيل سريع ومجاني|شحن مجاني/],
    ['Warranty',/ضمان سنتين|ضمان|استعادة الأموال/],
    ['Loyalty program',/برامج الولاء|نقاط الولاء/],
    ['24/7 support',/دعم فني على مدار الساعة|24\/7/],
    ['Made for Saudi climate',/شمس السعودية|حرارة الصيف|الحرارة القاسية/]
  ];
  for(const [label,re] of rules) if(re.test(t))out.push(label);
  return out;
}

function productCandidates($,baseUrl){
  let host=''; try{host=new URL(baseUrl).host;}catch{return[]}
  const scored=[];
  $('a[href]').each((_,a)=>{
    const href=$(a).attr('href'); if(!href)return;
    let u; try{u=new URL(href,baseUrl);}catch{return}
    if(u.host!==host)return;
    const p=u.pathname.toLowerCase();
    let score=0;
    if(/\/product|\/products|\/p\d|\/item/.test(p)) score+=7;
    if(/\/category|\/categories|\/collection|\/c\d/.test(p)) score+=5;
    const txt=norm($(a).text()); if(/براد|خزان|شبك|منتج|product|حلول المشاريع/i.test(txt)) score+=3;
    if(score) scored.push({url:u.href,score});
  });
  return uniq(scored.sort((a,b)=>b.score-a.score).map(x=>x.url)).slice(0,8);
}

async function fetchText(url){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; SahabBusinessIntelligence/2.0; +https://sahab.agency)'},signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null; return await r.text();
  }catch{return null}
}

function ticketFromPrices(prices,industry){
  if(!prices.length)return null;
  const med=median(prices); if(!med)return null;
  // Durable/high-ticket products are typically a one-product basket; consumables can have multi-item baskets.
  let multiplier=1.0;
  if(/perfume|fashion|general ecommerce/i.test(industry))multiplier=1.18;
  return Math.round(med*multiplier);
}

export async function inferBusinessIntelligence({html='',url='',lead={},assumptions={}}={}){
  const $=cheerio.load(html||'');
  const body=norm($('body').text());
  const title=norm($('title').text());
  const meta=norm($('meta[name="description"]').attr('content')||'');
  const platform=detectPlatform(html);
  let categories=extractCategories($);
  let combinedText=`${title} ${meta} ${body} ${categories.join(' ')}`;
  let industry=inferIndustry(combinedText);
  const jsonLd=extractJsonLdProducts($);
  let priceSamples=uniq([...jsonLd.prices,...extractPrices(`${body} ${html}`)]).filter(n=>n>=5&&n<=500000).slice(0,80);
  let productNames=uniq(jsonLd.names).slice(0,20);
  let currencies=[...jsonLd.currencies];
  const sampledPages=[];

  if(url){
    for(const candidate of productCandidates($,url).slice(0,6)){
      const page=await fetchText(candidate); if(!page)continue;
      sampledPages.push(candidate);
      const p$=cheerio.load(page);
      const pBody=norm(p$('body').text());
      const pJson=extractJsonLdProducts(p$);
      priceSamples=uniq([...priceSamples,...pJson.prices,...extractPrices(`${pBody} ${page}`)]).filter(n=>n>=5&&n<=500000).slice(0,100);
      productNames=uniq([...productNames,...pJson.names]).slice(0,30);
      currencies=uniq([...currencies,...pJson.currencies]);
      categories=uniq([...categories,...extractCategories(p$)]).slice(0,20);
      combinedText+=` ${pBody.slice(0,6000)}`;
    }
  }

  industry=inferIndustry(combinedText);
  const ecommerce=Boolean(platform || /سلة المشتريات|متابعة التسوق|add to cart|checkout|أضف للسلة|اضف للسلة/i.test(combinedText));
  const currency=extractCurrency(`${combinedText} ${html}`,currencies) || (url&&/\.sa(?:\/|$)/i.test(url)?'SAR':null);
  const segments=inferSegments(combinedText);
  const valueProps=extractValueProps(combinedText);

  const cleanPrices=priceSamples.filter(n=>n>=10);
  const priceStats=cleanPrices.length?{
    min:Math.min(...cleanPrices),
    p25:percentile(cleanPrices,.25),
    median:median(cleanPrices),
    p75:percentile(cleanPrices,.75),
    max:Math.max(...cleanPrices),
    sampleCount:cleanPrices.length
  }:null;

  let inferredTicket=Number(assumptions.averageTicket)||null;
  let ticketSource=assumptions.averageTicket?'campaign_anchor':null;
  const observedTicket=ticketFromPrices(cleanPrices,industry);
  if(observedTicket){ inferredTicket=observedTicket; ticketSource='observed_public_product_prices'; }
  else if(!inferredTicket && ecommerce){
    if(/water coolers|tanks/i.test(industry)) inferredTicket=1800;
    else if(/perfume/i.test(industry)) inferredTicket=350;
    else inferredTicket=400;
    ticketSource='industry_prior';
  }

  let inferredMonthlyLeads=Number(assumptions.monthlyLeadEstimate)||null;
  let leadSource=assumptions.monthlyLeadEstimate?'campaign_anchor':null;
  if(!inferredMonthlyLeads){
    const reviews=Math.max(0,Number(lead.reviewCount)||0);
    inferredMonthlyLeads=reviews?clamp(Math.round(Math.sqrt(reviews)*2),10,100):(ecommerce?30:20);
    leadSource=reviews?'bounded_review_activity_proxy':'industry_prior';
  }

  let confidence=30;
  if(industry!=='general business')confidence+=14;
  if(platform)confidence+=10;
  if(categories.length>=2)confidence+=8;
  if(productNames.length>=2)confidence+=8;
  if(cleanPrices.length>=5)confidence+=16; else if(cleanPrices.length)confidence+=8;
  if(sampledPages.length>=2)confidence+=6;
  if(currency)confidence+=3;
  if(segments.length)confidence+=3;
  confidence=clamp(confidence,30,92);

  return {
    industry,
    businessModel:ecommerce?(segments.includes('B2B / projects')?'ecommerce + projects/B2B':'ecommerce'):'lead_generation_or_info',
    platform,
    currency:currency||'unknown',
    categories,
    products:productNames,
    targetSegments:segments,
    valuePropositions:valueProps,
    priceSamples:cleanPrices.slice(0,15),
    priceStats,
    averageTicketAnchor:inferredTicket,
    averageTicketSource:ticketSource,
    monthlyLeadAnchor:inferredMonthlyLeads,
    monthlyLeadSource:leadSource,
    confidence,
    sampledPages,
    evidence:{title,metaDescription:meta,categoryCount:categories.length,productCount:productNames.length,priceSampleCount:cleanPrices.length,sampledPageCount:sampledPages.length},
    disclaimer:'Business type, product mix, public pricing and target segments are inferred from publicly accessible website pages. Demand remains a bounded model unless verified first-party data is available.'
  };
}
