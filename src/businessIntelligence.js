import * as cheerio from 'cheerio';

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function median(nums=[]){ const a=nums.filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null; const m=Math.floor(a.length/2); return a.length%2?a[m]:Math.round((a[m-1]+a[m])/2); }
function uniq(arr=[]){ return [...new Set(arr.filter(Boolean))]; }

function detectPlatform(html=''){
  const t=html.toLowerCase();
  if (t.includes('salla.network') || t.includes('salla.sa') || t.includes('platform.salla') || t.includes('salla.com')) return 'salla';
  if (t.includes('cdn.shopify.com') || t.includes('shopify-section')) return 'shopify';
  if (t.includes('woocommerce') || t.includes('wp-content/plugins/woocommerce')) return 'woocommerce';
  return null;
}

function inferIndustry(text=''){
  const t=text.toLowerCase();
  const rules=[
    ['water coolers & tanks', /براد|برادات|تبريد المياه|خزان ماء|water cooler|water tank/],
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

function extractPrices(text=''){
  const out=[];
  const patterns=[/(?:ر\.س|ريال|sar)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:ر\.س|ريال|sar)/gi];
  for(const re of patterns){ let m; while((m=re.exec(text))){ const n=Number(m[1].replace(/,/g,'')); if(n>=10 && n<=250000) out.push(n); if(out.length>=40) break; } }
  return uniq(out).slice(0,40);
}

function extractCategories($){
  const values=[];
  $('a,h1,h2,h3,h4').each((_,el)=>{
    const s=$(el).text().replace(/\s+/g,' ').trim();
    if(s.length>=3 && s.length<=70 && /براد|خزان|منتج|قسم|category|collection|clinic|عطر|قهوة|ملابس/i.test(s)) values.push(s);
  });
  return uniq(values).slice(0,12);
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
    if(/\/p\d|\/product|\/products|\/item|\/c\d|\/category|\/collection/.test(p)) score+=4;
    const txt=$(a).text().trim(); if(/براد|خزان|منتج|product/i.test(txt)) score+=2;
    if(score) scored.push({url:u.href,score});
  });
  return uniq(scored.sort((a,b)=>b.score-a.score).map(x=>x.url)).slice(0,6);
}

async function fetchText(url){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; SahabBusinessIntelligence/1.0; +https://sahab.agency)'},signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null; return await r.text();
  }catch{return null}
}

export async function inferBusinessIntelligence({html='',url='',lead={},assumptions={}}={}){
  const $=cheerio.load(html||'');
  const body=$('body').text().replace(/\s+/g,' ').trim();
  const title=$('title').text().trim();
  const meta=($('meta[name="description"]').attr('content')||'').trim();
  const platform=detectPlatform(html);
  const categories=extractCategories($);
  const industry=inferIndustry(`${title} ${meta} ${body} ${categories.join(' ')}`);
  let priceSamples=extractPrices(`${body} ${html}`);
  const sampledPages=[];

  if(priceSamples.length<4 && url){
    for(const candidate of productCandidates($,url).slice(0,4)){
      const page=await fetchText(candidate); if(!page)continue;
      sampledPages.push(candidate);
      priceSamples=uniq([...priceSamples,...extractPrices(page)]).slice(0,40);
      if(priceSamples.length>=10)break;
    }
  }

  const priceMedian=median(priceSamples);
  const ecommerce=Boolean(platform || /سلة المشتريات|متابعة التسوق|add to cart|checkout/i.test(body));
  let inferredTicket=Number(assumptions.averageTicket)||null;
  let ticketSource=assumptions.averageTicket?'campaign_anchor':null;
  if(priceMedian){
    inferredTicket=Math.round(priceMedian);
    ticketSource='observed_public_prices';
  } else if(!inferredTicket && ecommerce){
    if(industry==='water coolers & tanks') inferredTicket=1800;
    else inferredTicket=350;
    ticketSource='industry_prior';
  }

  let inferredMonthlyLeads=Number(assumptions.monthlyLeadEstimate)||null;
  let leadSource=assumptions.monthlyLeadEstimate?'campaign_anchor':null;
  if(!inferredMonthlyLeads){
    const reviews=Math.max(0,Number(lead.reviewCount)||0);
    inferredMonthlyLeads=reviews?clamp(Math.round(Math.sqrt(reviews)*2),10,100):(ecommerce?30:20);
    leadSource=reviews?'review_volume_proxy':'industry_prior';
  }

  let confidence=35;
  if(industry!=='general business')confidence+=15;
  if(platform)confidence+=10;
  if(categories.length>=2)confidence+=8;
  if(priceSamples.length>=3)confidence+=18;
  else if(priceSamples.length)confidence+=8;
  if(sampledPages.length)confidence+=5;
  confidence=clamp(confidence,30,90);

  return {
    industry,
    businessModel:ecommerce?'ecommerce':'lead_generation_or_info',
    platform,
    categories,
    priceSamples:priceSamples.slice(0,12),
    averageTicketAnchor:inferredTicket,
    averageTicketSource:ticketSource,
    monthlyLeadAnchor:inferredMonthlyLeads,
    monthlyLeadSource:leadSource,
    confidence,
    sampledPages,
    evidence:{title,metaDescription:meta,categoryCount:categories.length,priceSampleCount:priceSamples.length},
    disclaimer:'Business type, products, prices and demand are inferred from publicly accessible website data. They are not verified internal sales or CRM data.'
  };
}
