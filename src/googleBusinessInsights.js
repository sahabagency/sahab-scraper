const THEMES = [
  ['booking_wait', /موعد|حجز|انتظار|تأخير|وقت|appointment|booking|wait|delay/i],
  ['service_staff', /موظف|موظفين|استقبال|تعامل|خدمة|staff|service|reception/i],
  ['quality_result', /نتيجة|جودة|علاج|جلسة|منتج|quality|result|treatment|product/i],
  ['price_value', /سعر|أسعار|غالي|قيمة|price|expensive|value/i],
  ['cleanliness', /نظافة|نظيف|clean|hygiene/i],
  ['delivery_availability', /توصيل|شحن|متوفر|مخزون|delivery|shipping|available|stock/i],
  ['response_support', /رد|تواصل|واتساب|اتصال|support|response|contact|whatsapp/i],
  ['hours_location', /موقع|فرع|ساعات|مواقف|location|branch|hours|parking/i]
];
const LABELS = {
  booking_wait: ['مواعيد وانتظار', 'Booking and waiting'], service_staff: ['الخدمة والموظفون', 'Staff and service'],
  quality_result: ['الجودة والنتيجة', 'Quality and results'], price_value: ['السعر والقيمة', 'Price and value'],
  cleanliness: ['النظافة', 'Cleanliness'], delivery_availability: ['التوصيل والتوفر', 'Delivery and availability'],
  response_support: ['الرد والدعم', 'Response and support'], hours_location: ['الموقع والساعات', 'Location and hours']
};
function clean(v=''){ return String(v).replace(/\s+/g,' ').trim(); }
export function analyzeGoogleBusiness({ rating=null, reviewCount=0, reviews=[], mapsUrl=null, status=null, types=[] }={}) {
  const items=(reviews||[]).map(r=>({rating:Number(r.rating)||null,text:clean(r.text),time:r.relativeTimeDescription||null})).filter(r=>r.text);
  const themes=[];
  for(const [key,re] of THEMES){
    const matches=items.filter(x=>re.test(x.text));
    const negatives=matches.filter(x=>Number(x.rating)<=3);
    if(matches.length>=2 || negatives.length){
      const label=LABELS[key]||[key,key];
      themes.push({key,labelAr:label[0],labelEn:label[1],reviewCount:matches.length,negativeCount:negatives.length,
        evidence:matches.slice(0,2).map(x=>x.text.slice(0,220)),
        priority:negatives.length>=2?'high':negatives.length?'medium':'watch'});
    }
  }
  const negative=items.filter(x=>Number(x.rating)<=3).length, positive=items.filter(x=>Number(x.rating)>=4).length;
  return {rating:rating==null?null:Number(rating),reviewCount:Number(reviewCount)||0,mapsUrl,status,types,
    reviewSampleCount:items.length,sentiment:{positive,negative,neutral:Math.max(0,items.length-positive-negative)},themes,
    reviews:items.slice(0,5),limitations:items.length?'Themes are based only on the sampled public review text.':'Review text was not available from connected Google data; no complaint theme was inferred.'};
}
