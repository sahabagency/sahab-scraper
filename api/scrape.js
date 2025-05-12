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
    // 1) أولاً نحاول جلب sitemap.xml
    const sitemapUrl = new URL('/sitemap.xml', pageUrl).href;
    const { data: sitemapXml } = await axios.get(sitemapUrl, { timeout: 10000 });
    const $s = cheerio.load(sitemapXml, { xmlMode: true });

    // 2) نجمّع كل الروابط اللي فيها "/p/" من <loc>
    const productLinks = new Set();
    $s('url > loc').each((_, loc) => {
      const u = $s(loc).text().trim();
      if (u.includes('/p/')) productLinks.add(u);
    });

    // إذا ما لاقينا أي لينكات، نبطي fallback على البحث اليدوي
    if (productLinks.size === 0) {
      const { data: html } = await axios.get(pageUrl, { timeout: 10000 });
      const $ = cheerio.load(html);
      $('a[href*="/p/"]').each((_, a) => {
        let href = $(a).attr('href');
        if (href.startsWith('/')) href = new URL(href, pageUrl).href;
        productLinks.add(href);
      });
    }

    // 3) نمرّ على كل رابط منتج ونستخرج البيانات
    const products = [];
    for (const link of productLinks) {
      try {
        const { data: prodHtml } = await axios.get(link, { timeout: 10000 });
        const $$ = cheerio.load(prodHtml);

        // اسم المنتج (مثال على الهيدر h1)
        const name = $$('h1.text-xl, h1.text-2xl, .product-title').first().text().trim();

        // وصف المنتج
        const description = $$('.product-single-top-description article, .description')
          .first().text().trim();

        // سعر المنتج
        let price = $$('h2.text-store-text-primary, .price, .product-price')
          .first().text().trim();

        // صورة رئيسية
        let img = $$('img').first().attr('src') || '';
        if (img.startsWith('/')) img = new URL(img, link).href;

        // تصنيفات (breadcrumb)
        const categories = [];
        $$('.breadcrumb a').each((_, b) => {
          const txt = $$(b).text().trim();
          if (txt) categories.push(txt);
        });

        products.push({ link, name, description, price, img, categories });

      } catch (prodErr) {
        console.warn(`⚠️ خطأ بجلب بيانات ${link}: ${prodErr.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      count: products.length,
      products
    });

  } catch (err) {
    console.error('❌ خطأ عام في scraper:', err);
    return res.status(500).json({
      success: false,
      message: `خطأ أثناء جلب أو تحليل البيانات: ${err.message}`
    });
  }
};
