// api/scrape.js

const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // نقرأ الرابط من باراميتر ?url=
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({
      success: false,
      message: '❌ يرجى تمرير رابط الموقع عبر ?url='
    });
  }

  try {
    // نجلب محتوى الصفحة
    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);

    // معلومات عامة عن الصفحة
    const title       = $('title').text().trim() || '';
    const description = $('meta[name="description"]').attr('content') || '';
    const keywords    = $('meta[name="keywords"]').attr('content') || '';

    // نجمع كل المنتجات
    const products = [];
    $('.product-single').each((_, el) => {
      const $el = $(el);

      // اسم المنتج
      const name = $el
        .find('h1.text-xl, h1.text-2xl, .product-title')
        .first()
        .text()
        .trim();

      // وصف المنتج
      const desc = $el
        .find('.product-single-top-description, .description, .product-desc')
        .first()
        .text()
        .trim();

      // سعر المنتج
      const price = $el
        .find('h2.text-store-text-primary, .price, .product-price')
        .first()
        .text()
        .trim();

      // صورة المنتج
      let img = $el.find('img').first().attr('src') || '';
      // إذا كان الـ src نسبيّ، يمكن تكوينه بناءً على رابط الـ url
      if (img && img.startsWith('/')) {
        const base = new URL(url).origin;
        img = base + img;
      }

      // نضيف المنتج إلى المصفوفة
      if (name || desc || price || img) {
        products.push({ name, description: desc, price, img });
      }
    });

    // نرجّع النتيجة
    res.status(200).json({
      success: true,
      title,
      description,
      keywords,
      products
    });

  } catch (error) {
    console.error('Scraper error:', error);
    res.status(500).json({
      success: false,
      message: `💥 خطأ أثناء جلب البيانات: ${error.message}`
    });
  }
};
