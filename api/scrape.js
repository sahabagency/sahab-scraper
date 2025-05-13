// scrape.js
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const storefront = req.query.url;
  if (!storefront) {
    return res
      .status(400)
      .json({ success: false, message: 'يرجى تمرير رابط المتجر عبر ?url=' });
  }

  try {
    // 1. جلب صفحة المتجر الرئيسية
    const { data: html } = await axios.get(storefront);
    const $ = cheerio.load(html);

    // 2. استخراج أول 10 روابط لصفحات المنتجات
    const productLinks = [];
    // هذا السِلِكتر خاص بمنصة سلة؛ قد تحتاج تضيف أو تغيّره حسب السمة الفعلية
    $('a.card__link[href]').each((_, el) => {
      if (productLinks.length >= 10) return false;
      const href = $(el).attr('href');
      const absolute = new URL(href, storefront).href;
      productLinks.push(absolute);
    });

    // 3. لكل رابط منتج: جلب التفاصيل
    const products = [];
    for (let link of productLinks) {
      const { data: prodHtml } = await axios.get(link);
      const $$ = cheerio.load(prodHtml);

      const title = $$(
        'h1.text-xl.md\\:text-2xl.leading-10.font-bold.text-store-text-primary'
      )
        .text()
        .trim();

      const description = $$('div.product-single-top-description')
        .text()
        .trim();

      const price = $$(
        'h2.text-store-text-primary.font-bold.text-xl.inline-block'
      )
        .text()
        .trim();

      products.push({
        title,
        description,
        price,
        url: link
      });
    }

    return res.json({
      success: true,
      storefront,
      count: products.length,
      products
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'خطأ أثناء جلب أو تحليل البيانات: ' + err.message
    });
  }
};
