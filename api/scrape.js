// api/scrape.js
const axios   = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const storefront = req.query.url;
  if (!storefront) {
    return res
      .status(400)
      .json({ success: false, message: '❌ رجاءً مرّر رابط المتجر عبر ?url=' });
  }

  try {
    // جلب الـ HTML
    const { data: html } = await axios.get(storefront);
    const $ = cheerio.load(html);

    // 1) حاول تجيب JSON-LD للمنتجات
    let products = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const obj = JSON.parse($(el).contents().text());
        // إذا هو مصفوفة
        const items = Array.isArray(obj) ? obj : [obj];
        items.forEach(item => {
          if (item['@type'] === 'Product') {
            products.push({
              name:        item.name || '',
              description: item.description || '',
              price:       item.offers?.price || '',
              currency:    item.offers?.priceCurrency || '',
              img:         Array.isArray(item.image) ? item.image[0] : item.image || '',
              url:         item.url || storefront
            });
          }
        });
      } catch (e) {
        // إذا فشل JSON.parse نتجاهل
      }
    });

    // 2) لو ما لقينا شيء في LD-JSON، ننقّب في الـ DOM
    if (products.length === 0) {
      // مثال بسيط للـ selectors في Salla
      $('.salla-product-card').each((i, el) => {
        if (products.length >= 20) return false; // حد أقصى
        const name  = $(el).find('.product-card__name').text().trim();
        const desc  = $(el).find('.product-card__excerpt').text().trim();
        const price = $(el).find('.product-card__price').text().trim();
        const img   = $(el).find('img').attr('src') || '';
        const url   = new URL($(el).find('a').attr('href'), storefront).href;
        products.push({ name, desc, price, img, url });
      });
    }

    return res.status(200).json({
      success:    true,
      storefront,
      count:      products.length,
      products
    });

  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: `خطأ في جلب أو تحليل المتجر: ${err.message}` });
  }
};
