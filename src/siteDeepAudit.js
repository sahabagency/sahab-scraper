import * as cheerio from 'cheerio';

function uniq(xs=[]){ return [...new Set(xs.filter(Boolean))]; }
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function norm(s=''){ return String(s||'').replace(/\s+/g,' ').trim(); }

async function fetchText(url, timeout=10000){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; SahabDeepAudit/1.0; +https://sahab.agency)'},signal:AbortSignal.timeout(timeout)});
    if(!r.ok)return null;
    return {url:r.url,text:await r.text(),status:r.status,contentType:r.headers.get('content-type')||''};
  }catch{return null;}
}

function xmlLocs(xml=''){
  return [...String(xml).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m=>m[1].replace(/&amp;/g,'&').trim()).filter(Boolean);
}

function classifyUrl(url=''){
  let p='';try{p=decodeURIComponent(new URL(url).pathname).toLowerCase();}catch{return'other';}
  if(/\/p\d+(?:\/|$)|\/product(?:s)?\/|\/products?\//.test(p))return'product';
  if(/\/c\d+(?:\/|$)|\/categor(?:y|ies)\/|\/product-category\/|\/collections?\//.test(p))return'category';
  if(/مشاريع|الشركات|توريد|quote|rfq|business|b2b/.test(p))return'b2b';
  if(/\/blog\/|\/article|\/post\/|مقال|مدونة/.test(p))return'blog';
  return'other';
}

async function discoverSitemapUrls(baseUrl){
  let origin;try{origin=new URL(baseUrl).origin;}catch{return{urls:[],sitemaps:[]};}
  const candidates=[];
  const robots=await fetchText(`${origin}/robots.txt`,7000);
  if(robots?.text){
    for(const m of robots.text.matchAll(/^\s*Sitemap:\s*(\S+)/gim))candidates.push(m[1].trim());
  }
  candidates.push(`${origin}/sitemap.xml`,`${origin}/sitemap_index.xml`);
  const queue=uniq(candidates),seen=new Set(),urls=[];
  while(queue.length&&seen.size<12&&urls.length<5000){
    const s=queue.shift();if(seen.has(s))continue;seen.add(s);
    const r=await fetchText(s,9000);if(!r?.text)continue;
    const locs=xmlLocs(r.text);
    const isIndex=/<sitemapindex\b/i.test(r.text) || locs.some(x=>/sitemap.*\.xml/i.test(x));
    if(isIndex){ for(const x of locs.slice(0,20)) if(!seen.has(x))queue.push(x); }
    else urls.push(...locs);
  }
  return{urls:uniq(urls).slice(0,5000),sitemaps:[...seen]};
}

function analyzePage(html='',url='',type='other'){
  const $=cheerio.load(html),body=norm($('body').text()),title=norm($('title').text()),meta=norm($('meta[name="description"]').attr('content')||''),canonical=$('link[rel="canonical"]').attr('href')||null,robots=String($('meta[name="robots"]').attr('content')||'').toLowerCase(),h1=norm($('h1').first().text()),hrefs=$('a[href]').map((_,a)=>$(a).attr('href')||'').get().join(' '),scripts=$('script').map((_,s)=>$(s).html()||'').get().join(' '),text=`${body} ${hrefs} ${scripts}`.toLowerCase();
  const hasPrice=/(?:ر\.?\s?س|ريال|sar|price)/i.test(body)||Boolean($('[itemprop="price"],[data-price],meta[property="product:price:amount"]').length);
  const hasCta=/أضف إلى السلة|أضف للسلة|شراء الآن|اطلب الآن|add to cart|buy now|checkout/i.test(`${body} ${hrefs}`);
  const hasReviews=/تقييم|آراء العملاء|اراء العملاء|review|rating/i.test(body)||/aggregateRating|reviewCount/i.test(scripts);
  const hasAvailability=/متوفر|نفدت|غير متوفر|in stock|out of stock|availability/i.test(text);
  const hasSchema=/"@type"\s*:\s*"Product"|schema\.org\/Product/i.test(scripts);
  const wordCount=body?body.split(/\s+/).length:0;
  return{url,type,title,metaDescription:meta,canonical,h1,indexable:!robots.includes('noindex'),wordCount,hasPrice,hasCta,hasReviews,hasAvailability,hasProductSchema:hasSchema};
}

function ratio(rows,key){ if(!rows.length)return null; return rows.filter(x=>Boolean(x[key])).length/rows.length; }
function missingRatio(rows,key){ const r=ratio(rows,key); return r==null?null:1-r; }

export async function deepAuditSite({url,bi={}}={}){
  const map=await discoverSitemapUrls(url);
  const classified=map.urls.map(u=>({url:u,type:classifyUrl(u)}));
  const products=classified.filter(x=>x.type==='product').map(x=>x.url);
  const categories=classified.filter(x=>x.type==='category').map(x=>x.url);
  const b2b=classified.filter(x=>x.type==='b2b').map(x=>x.url);
  const blogs=classified.filter(x=>x.type==='blog').map(x=>x.url);

  const fallback=(bi.sampledPages||[]).map(u=>({url:u,type:classifyUrl(u)}));
  const sampleSet=uniq([
    ...products.slice(0,5),...categories.slice(0,4),...b2b.slice(0,2),
    ...fallback.filter(x=>x.type==='product').slice(0,3).map(x=>x.url),
    ...fallback.filter(x=>x.type==='category').slice(0,2).map(x=>x.url),
    ...fallback.filter(x=>x.type==='b2b').slice(0,2).map(x=>x.url)
  ]).slice(0,12);

  const fetched=await Promise.all(sampleSet.map(u=>fetchText(u,10000)));
  const pages=[];
  fetched.forEach((r,i)=>{if(r?.text)pages.push(analyzePage(r.text,r.url||sampleSet[i],classifyUrl(sampleSet[i])));});
  const productPages=pages.filter(x=>x.type==='product');
  const categoryPages=pages.filter(x=>x.type==='category');
  const b2bPages=pages.filter(x=>x.type==='b2b');

  const categorySeo={
    sampleCount:categoryPages.length,
    missingTitleRate:missingRatio(categoryPages,'title'),
    missingMetaRate:missingRatio(categoryPages,'metaDescription'),
    missingCanonicalRate:missingRatio(categoryPages,'canonical'),
    missingH1Rate:missingRatio(categoryPages,'h1'),
    nonIndexableRate:missingRatio(categoryPages,'indexable'),
    thinContentRate:categoryPages.length?categoryPages.filter(x=>x.wordCount<120).length/categoryPages.length:null
  };
  const productQuality={
    sampleCount:productPages.length,
    ctaRate:ratio(productPages,'hasCta'),
    priceRate:ratio(productPages,'hasPrice'),
    reviewsRate:ratio(productPages,'hasReviews'),
    availabilityRate:ratio(productPages,'hasAvailability'),
    schemaRate:ratio(productPages,'hasProductSchema'),
    missingMetaRate:missingRatio(productPages,'metaDescription')
  };
  const evidenceStrength=clamp(30 + Math.min(25,map.urls.length/10) + Math.min(25,pages.length*3) + (productPages.length?10:0) + (categoryPages.length?10:0),30,95);
  return{
    sitemap:{found:map.urls.length>0,sitemapCount:map.sitemaps.length,urlCount:map.urls.length},
    inventory:{productUrlCount:products.length,categoryUrlCount:categories.length,b2bUrlCount:b2b.length,blogUrlCount:blogs.length,countSource:map.urls.length?'sitemap':'sampled_pages'},
    categorySeo,productQuality,b2bSampleCount:b2bPages.length,pages,evidenceStrength
  };
}
