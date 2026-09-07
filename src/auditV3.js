import * as cheerio from 'cheerio';
import { buildCommercialProfile } from './commercialProfile.js';
import { inferBusinessIntelligence } from './businessIntelligence.js';

const CORE_SIGNALS = [
  { key:'hasTitle', label:'SEO title', weight:8, service:'SEO & Search Visibility' },
  { key:'hasMetaDescription', label:'Meta description', weight:8, service:'SEO & Search Visibility' },
  { key:'hasViewport', label:'Mobile viewport', weight:8, service:'Website Experience' },
  { key:'hasPrimaryCta', label:'Primary CTA', weight:14, service:'Conversion & Landing Experience' },
  { key:'hasConversionPath', label:'Conversion / checkout path', weight:14, service:'Conversion Path' },
  { key:'hasContact', label:'Phone / WhatsApp contact', weight:10, service:'Lead Capture' },
  { key:'usesHttps', label:'HTTPS', weight:6, service:'Website Trust & Technical' },
  { key:'loads', label:'Website reachable', weight:6, service:'Website Trust & Technical' }
];
const CORE_MAX = CORE_SIGNALS.reduce((s,x)=>s+x.weight,0);

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function containsAny(text, words){ const h=String(text||'').toLowerCase(); return words.some(w=>h.includes(String(w).toLowerCase())); }
function midpoint(range,fallback=0){ const l=Number(range?.low),h=Number(range?.high); return Number.isFinite(l)&&Number.isFinite(h)&&l>0&&h>0?Math.round((l+h)/2):fallback; }
function moneyIssueWeight(issue){ return issue?.monetizable===false?0:Math.max(1,Number(issue?.weight)||5); }

async function bravePositiveCorroboration(lead, website){
  if(!process.env.BRAVE_SEARCH_API_KEY||!website)return null;
  let host='';try{host=new URL(website).hostname.replace(/^www\./,'');}catch{return null;}
  const u=new URL('https://api.search.brave.com/res/v1/web/search');
  u.searchParams.set('q',`site:${host} "${lead.name||host}" شراء سلة checkout واتساب instagram facebook`);
  u.searchParams.set('count','8');u.searchParams.set('extra_snippets','true');
  try{
    const r=await fetch(u,{headers:{Accept:'application/json','X-Subscription-Token':process.env.BRAVE_SEARCH_API_KEY},signal:AbortSignal.timeout(12000)});
    if(!r.ok)return null;const d=await r.json();const rows=d.web?.results||[];
    const t=rows.map(x=>`${x.title||''} ${x.description||''} ${(x.extra_snippets||[]).join(' ')} ${x.url||''}`).join(' ').toLowerCase();
    return {cta:containsAny(t,['شراء','تسوق','أضف للسلة','add to cart','buy now','احجز','اطلب']),conversion:containsAny(t,['checkout','cart','سلة','شراء','احجز','appointment']),contact:containsAny(t,['whatsapp','واتساب','wa.me','+966']),instagram:t.includes('instagram.com'),facebook:t.includes('facebook.com'),urls:rows.slice(0,5).map(x=>x.url)};
  }catch{return null;}
}

function profileIntelFromBi(bi={}){
  return {confidence:bi.confidence,industry:bi.industry,businessType:bi.businessModel,commerce:{ecommerce:String(bi.businessModel||'').includes('ecommerce'),b2b:String(bi.businessModel||'').toLowerCase().includes('b2b'),businessModel:bi.businessModel},platform:bi.platform?{name:bi.platform==='salla'?'Salla':bi.platform==='shopify'?'Shopify':bi.platform==='woocommerce'?'WooCommerce':bi.platform,confidence:95}:null,currency:{currency:bi.currency||'SAR',confidence:bi.currency&&bi.currency!=='unknown'?90:40},priceStats:bi.priceStats?{...bi.priceStats,samples:bi.priceStats.samples||bi.priceSamples||[]}:null,pagesScanned:bi.sampledPages||[]};
}

function buildProfile(lead, assumptions, bi){
  const leadForProfile={...lead,siteIntelligence:profileIntelFromBi(bi)};
  return buildCommercialProfile({lead:leadForProfile,industry:assumptions.industry||bi?.industry||'',averageTicketAnchor:Number(assumptions.averageTicket)||Number(bi?.averageTicketAnchor)||null,monthlyLeadAnchor:Number(assumptions.monthlyLeadEstimate)||Number(bi?.monthlyLeadAnchor)||null});
}

function verifiedBusinessIssues(bi={}, bodyText=''){
  const out=[];const f=bi.funnelSignals||{};const ecommerce=String(bi.businessModel||'').includes('ecommerce');
  if(ecommerce&&(f.b2bDetected||f.b2bSecondaryDetected)&&f.b2bPageDetected&&!f.quoteRequestDetected&&!f.b2bConversionDetected){
    out.push({severity:'medium',weight:10,service:'B2B Conversion',monetizable:true,title:'Project/B2B demand is visible, but a dedicated quote-request path was not verified',detail:'A separate RFQ/quote path was not verified on the sampled public B2B pages.'});
  }
  if(ecommerce&&Number(bi.pageInventory?.productLinks||0)>0&&!f.reviewsDetected){
    out.push({severity:'medium',weight:7,service:'Product Conversion',monetizable:true,title:'Product-level social proof was not verified on sampled product pages',detail:'The sampled product pages did not expose clear product-review evidence.'});
  }
  const t=String(bodyText||'').toLowerCase();
  if(/water coolers|tanks/i.test(String(bi.industry||''))&&/صيحات الموضة|fashion trends|مجلات الموضة/.test(t)){
    out.push({severity:'medium',weight:8,service:'Content Quality',monetizable:false,title:'Irrelevant fashion content is visible in a customer-facing FAQ',detail:'This is a verified content-quality issue. It should be fixed, but the system does not assign a revenue-loss amount to it by itself.'});
  }
  return out;
}

function buildOpportunity({issues,profile,bi,noWebsite=false,unreachable=false}){
  const monetizable=(issues||[]).filter(x=>x.monetizable!==false);
  const weight=monetizable.reduce((s,x)=>s+moneyIssueWeight(x),0);
  const lowBase=Number(profile?.monthlyCommercialValueRange?.low)||0;
  const highBase=Number(profile?.monthlyCommercialValueRange?.high)||0;
  const assumptionConfidence=Number(profile?.confidence)||Number(bi?.confidence)||30;
  let evidenceConfidence=80,method='verified_gap_impact_model_v3';
  if(noWebsite){evidenceConfidence=34;method='benchmark_no_website';}
  if(unreachable){evidenceConfidence=40;method='benchmark_unreachable_website';}
  let lowRate=0,highRate=0;
  if(weight>0){
    const normalized=clamp(weight/45,0.08,1);
    lowRate=0.008+(normalized*0.022);
    highRate=0.02+(normalized*0.06);
    if(noWebsite){lowRate=0.02;highRate=0.06;}
    if(unreachable){lowRate=0.025;highRate=0.07;}
  }
  const low=Math.round(lowBase*lowRate),high=Math.round(highBase*highRate);
  const confidence=Math.round(evidenceConfidence*0.62+assumptionConfidence*0.38);
  const displayEligible=Boolean(weight>0&&high>0&&Number(bi?.confidence||0)>=55&&assumptionConfidence>=45);
  return {monthlyRange:{low,high},annualRange:{low:low*12,high:high*12},currency:profile?.currency||bi?.currency||'SAR',displayEligible,withheldReason:displayEligible?null:weight===0?'No verified monetizable gap was found.':'Commercial evidence is not strong enough to publish a money estimate.',confidence,evidenceConfidence,assumptionConfidence,method,verifiedMonetizableIssueCount:monetizable.length,verifiedMonetizableWeight:weight,assumptions:{averageTicketRange:profile?.averageTicketRange||null,monthlyLeadRange:profile?.monthlyLeadRange||null,monthlyCommercialValueRange:profile?.monthlyCommercialValueRange||null,averageTicketSource:profile?.averageTicketSource||null,monthlyLeadSource:profile?.monthlyLeadSource||null},basis:'Money estimates are generated only from verified monetizable gaps. Unknown dynamic integrations and non-monetizable content findings do not create fake revenue loss.',disclaimer:'Estimated opportunity, not verified lost revenue. Public product pricing may be observed; demand and conversion impact remain modeled until first-party data is available.'};
}

function breakdown(issues,opportunity){
  const usable=(issues||[]).filter(x=>x.monetizable!==false);const total=usable.reduce((s,x)=>s+moneyIssueWeight(x),0);if(!total)return[];
  const grouped=new Map();for(const i of usable){const w=moneyIssueWeight(i),k=i.service||'Digital Growth';if(!grouped.has(k))grouped.set(k,{service:k,weight:0,issues:[]});const g=grouped.get(k);g.weight+=w;g.issues.push(i.title);}
  return [...grouped.values()].map(g=>({service:g.service,issues:g.issues,annualRange:{low:Math.round(opportunity.annualRange.low*g.weight/total),high:Math.round(opportunity.annualRange.high*g.weight/total)}})).sort((a,b)=>b.annualRange.high-a.annualRange.high);
}

export async function auditLead(lead,assumptions={}){
  const result={website:lead.website||null,checkedAt:new Date().toISOString(),score:null,signals:{},issues:[],wins:[],unknowns:[],opportunity:null,opportunityBreakdown:[],evidence:{},auditMode:lead.website?'website':'presence_only',commercialProfile:null,businessIntelligence:null};
  if(!lead.website){
    const bi={industry:assumptions.industry||'unknown',confidence:30,currency:'SAR',businessModel:'unknown'};const profile=buildProfile(lead,assumptions,bi);result.commercialProfile=profile;result.businessIntelligence=bi;
    result.issues.push({severity:'high',weight:12,service:'Website & Conversion',monetizable:true,title:'No verified website found',detail:'Current public discovery did not return a verified business website.'});
    result.opportunity=buildOpportunity({issues:result.issues,profile,bi,noWebsite:true});result.opportunityBreakdown=breakdown(result.issues,result.opportunity);return result;
  }
  let response,html='';try{response=await fetch(lead.website,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; SahabAudit/3.0; +https://sahab.agency)'},signal:AbortSignal.timeout(12000)});html=await response.text();}catch(error){
    const bi={industry:assumptions.industry||'unknown',confidence:35,currency:'SAR',businessModel:'unknown'};const profile=buildProfile(lead,assumptions,bi);result.commercialProfile=profile;result.businessIntelligence=bi;result.issues.push({severity:'high',weight:12,service:'Website Trust & Technical',monetizable:true,title:'Website could not be loaded',detail:error.message});result.opportunity=buildOpportunity({issues:result.issues,profile,bi,unreachable:true});result.opportunityBreakdown=breakdown(result.issues,result.opportunity);return result;
  }
  const bi=await inferBusinessIntelligence({html,url:response.url||lead.website,lead,assumptions});const profile=buildProfile(lead,assumptions,bi);result.businessIntelligence=bi;result.commercialProfile=profile;
  const $=cheerio.load(html),bodyText=$('body').text().replace(/\s+/g,' ').trim(),hrefs=$('a[href]').map((_,a)=>$(a).attr('href')||'').get().join(' '),scripts=$('script').map((_,s)=>$(s).html()||$(s).attr('src')||'').get().join(' '),interactive=$('a,button,input[type="submit"],[role="button"]').map((_,el)=>`${$(el).text()} ${$(el).attr('aria-label')||''} ${$(el).attr('value')||''} ${$(el).attr('href')||''}`).get().join(' '),technical=`${html} ${scripts}`;
  const ecommerce=String(bi.businessModel||'').includes('ecommerce'),hasGtm=containsAny(technical,['googletagmanager.com','gtm.js','gtag(']);
  const checks={loads:response.ok,usesHttps:String(response.url||lead.website).startsWith('https://'),hasTitle:Boolean($('title').text().trim()),hasMetaDescription:Boolean($('meta[name="description"]').attr('content')?.trim()),hasViewport:Boolean($('meta[name="viewport"]').attr('content')),hasPrimaryCta:containsAny(`${bodyText} ${interactive}`,ecommerce?['أضف للسلة','أضف إلى السلة','شراء','تسوق','متابعة التسوق','اطلب','add to cart','buy now','shop now']:['book now','book appointment','schedule','get quote','contact us','احجز','موعد','تواصل','اطلب موعد']),hasConversionPath:containsAny(`${hrefs} ${bodyText} ${interactive}`,ecommerce?['checkout','cart','سلة المشتريات','متابعة التسوق','شراء','add to cart','أضف إلى السلة','أضف للسلة']:['calendly','book','booking','appointment','schedule','احجز','موعد','اطلب موعد']),hasContact:containsAny(`${hrefs} ${bodyText} ${interactive}`,['tel:','wa.me','whatsapp','واتساب','+966','+1 '])||Boolean(lead.socials?.whatsapp)};
  const corroboration=await bravePositiveCorroboration(lead,lead.website);if(corroboration){if(!checks.hasPrimaryCta&&corroboration.cta)checks.hasPrimaryCta=true;if(!checks.hasConversionPath&&corroboration.conversion)checks.hasConversionPath=true;if(!checks.hasContact&&corroboration.contact)checks.hasContact=true;}
  let earned=0;for(const s of CORE_SIGNALS){const pass=Boolean(checks[s.key]);result.signals[s.key]=pass;if(pass){earned+=s.weight;result.wins.push(s.label);}else{result.issues.push({severity:s.weight>=14?'high':s.weight>=8?'medium':'low',signalKey:s.key,weight:s.weight,service:s.service,monetizable:true,title:`Missing or weak: ${s.label}`,detail:`The public page and corroboration did not verify ${s.label.toLowerCase()}.`});}}
  const dynamic={hasAnalytics:hasGtm||containsAny(technical,['google-analytics.com']),hasMetaPixel:containsAny(technical,['connect.facebook.net','fbq(','facebook.com/tr']),hasInstagram:containsAny(hrefs,['instagram.com'])||Boolean(lead.socials?.instagram)||Boolean(corroboration?.instagram),hasFacebook:containsAny(hrefs,['facebook.com'])||Boolean(lead.socials?.facebook)||Boolean(corroboration?.facebook)};
  for(const [k,v] of Object.entries(dynamic)){result.signals[k]=v?true:null;if(v)result.wins.push(k==='hasAnalytics'?'Analytics / tag manager detected':k==='hasMetaPixel'?'Meta Pixel directly detected':k==='hasInstagram'?'Instagram presence detected':'Facebook presence detected');else result.unknowns.push({signalKey:k,label:k,detail:k==='hasMetaPixel'&&hasGtm?'Google Tag Manager is present; Meta/ads tags may be injected dynamically, so absence cannot be concluded.':'Dynamic/client-side integration not verified; treated as unknown, not missing.'});}
  result.issues.push(...verifiedBusinessIssues(bi,bodyText));
  const nonMoneyPenalty=result.issues.filter(x=>x.monetizable===false).reduce((s,x)=>s+Math.round((x.weight||0)*0.25),0);const moneyPenalty=result.issues.filter(x=>x.monetizable!==false).reduce((s,x)=>s+Math.round((x.weight||0)*0.65),0);const base=CORE_MAX?Math.round(earned/CORE_MAX*100):null;result.score=base==null?null:clamp(base-moneyPenalty-nonMoneyPenalty,0,100);
  result.opportunity=buildOpportunity({issues:result.issues,profile,bi});result.opportunityBreakdown=breakdown(result.issues,result.opportunity);
  result.evidence={finalUrl:response.url,status:response.status,title:$('title').text().trim().slice(0,180),metaDescription:($('meta[name="description"]').attr('content')||'').trim().slice(0,280),htmlTextLength:bodyText.length,platform:bi.platform,inferredIndustry:bi.industry,businessModel:bi.businessModel,brandName:bi.brandName,categories:bi.categories,products:bi.products,targetSegments:bi.targetSegments,valuePropositions:bi.valuePropositions,funnelSignals:bi.funnelSignals,publicPriceSamples:bi.priceSamples,priceStats:bi.priceStats,businessIntelligenceConfidence:bi.confidence,tagManagerDetected:hasGtm,socialPresence:lead.socials||{},dynamicIntegrationPolicy:'Tracking, ad and social integrations use positive-only evidence. Non-detection is unknown, never a negative revenue gap.',indexedCorroboration:corroboration?{used:true,evidenceUrls:corroboration.urls||[]}:{used:false}};
  return result;
}
