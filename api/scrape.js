// api/scrape.js

const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const pageUrl = req.query.url;
  if (!pageUrl) {
    return res.status(400).json({
      success: false,
      message: '❌ يرجى تمرير رابط الموقع عبر ?url='
    });
  }

  try {
    // 1) نجلب HTML الصفحة الأولى
    const { data: html } = await axios.get(pageUrl, { timeout: 10000 });
    const $ = cheerio.load(html);

    // 2) نجمّع كل روابط المنتجات (URL) اللي فيها "/p/"
    const productLinks = new Set();
    $('a[href*="/p/"]').each((_, a) => {
      let href = $(a).attr('href');
      // نبني رابط مطلق إذا كان نسبي
      if (href && href.startsWith('/')) {
        href = new URL(href, pageUrl).href;
      }
      if (href && href.startsWith('http')) {
        productLinks.add(href);
      }
    });

    // 3) نمرّ على كل رابط منتج ونستخرج البيانات
    const products = [];
    for (const link of productLinks) {
      try {
        const { data: prodHtml } = await axios.get(link, { timeout: 10000 });
        const $$ = cheerio.load(prodHtml);

        // اسم المنتج
        const name = $$('h1.text-xl, h1.text-2xl, .product-title')
          .first()
          .text()
          .trim();

        // وصف المنتج
        const description = $$('.product-single-top-description article, .description')
          .first()
          .text()
          .trim();

        // سعر المنتج
        let price = $$('h2.text-store-text-primary, .price, .product-price')
          .first()
          .text()
          .trim();
        // ممكن تحتاج تنظيف إضافي (مثل إزالة رموز العملة)

        // صورة رئيسية
        let img = $$('img')
          .first()
          .attr('src') || '';
        if (img.startsWith('/')) {
          img = new URL(img, link).href;
        }

        // تصنيفات المنتج (Breadcrumb)
        const categories = [];
        $$('.breadcrumb a').each((_, b) => {
          const txt = $$(b).text().trim();
          if (txt) categories.push(txt);
        });

        products.push({ link, name, description, price, img, categories });

      } catch (prodErr) {
        console.warn(`⚠️ خطأ بجلب بيانات المنتج ${link}:`, prodErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      count: products.length,
      products
    });

  } catch (err) {
    console.error('❌ خطأ عام في الـ scraper:', err);
    return res.status(500).json({
      success: false,
      message: `خطأ أثناء جلب الصفحة أو تحليلها: ${err.message}`
    });
  }
};
