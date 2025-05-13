// api/scrape.js
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // رابط المتجر يمرر بـ ?url= (أو ?s= كبديل)
  const url = req.query.url || req.query.s;
  if (!url) {
    return res.status(400).json({
      success: false,
      message: 'يرجى تمرير رابط المتجر عبر ?url='
    });
  }

  try {
    // 1) نجلب HTML
    const { data: html } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(html);

    let products = [];

    // 2) نحاول نقرأ JSON-LD أولاً
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html().trim());
        const entries = Array.isArray(json) ? json : (json['@graph'] || [json]);
        entries.forEach(item => {
          if (item['@type'] === 'Product') {
            products.push(parseProductLD(item));
          }
        });
      } catch (e) {
        // تجاهل JSON غير صالح
      }
    });

    // 3) إذا لم نجد منتجات في JSON-LD، ننزل على الكلاسات مباشرة
    if (products.length === 0) {
      $('.product-single-top-description').each((_, card) => {
        const $card = $(card);
        const name = $card
          .siblings('h1.text-xl, h1.text-store-text-primary')
          .first()
          .text()
          .trim();
        const description = $card.find('article').text().trim();
        const price = $card
          .siblings('h2.text-store-text-primary')
          .first()
          .text()
          .trim();
        const img = $card
          .closest('.product')
          .find('img')
          .first()
          .attr('src') || '';
        if (name) {
          products.push({
            name,
            description,
            price,
            image: img
          });
        }
      });
    }

    // 4) نزيل التكرار (حسب الاسم أو الـ URL)
    products = dedupe(products);

    return res.status(200).json({
      success: true,
      storefront: url,
      count: products.length,
      products
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `خطأ أثناء جلب أو تحليل البيانات: ${error.message}`
    });
  }
};

/**
 * يحول عنصر JSON-LD إلى كائن منتج مبسط
 */
function parseProductLD(item) {
  const offer = item.offers || {};
  return {
    id: item.sku || item['@id'] || '',
    name: item.name || '',
    description: item.description || '',
    price: offer.price || '',
    priceCurrency: offer.priceCurrency || '',
    url: offer.url || item.url || '',
    image: Array.isArray(item.image) ? item.image : (item.image ? [item.image] : []),
    category: item.category || ''
  };
}

/**
 * يزيل المنتجات المكررة (حسب الاسم أو الرابط)
 */
function dedupe(arr) {
  const seen = new Set();
  return arr.filter(p => {
    const key = (p.name || p.url || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
