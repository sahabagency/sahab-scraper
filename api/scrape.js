// api/scrape.js
const axios  = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({
      success: false,
      message: '❌ مرّر رابط المتجر عبر ?url='
    });
  }

  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // 1) عنوان الصفحة والوصف
    const storefront   = url;
    const title        = $('title').text().trim();
    const description  = $('meta[name="description"]').attr('content')?.trim() || '';

    // 2) اسم المنتج
    // لاحظ أننا نهرب نقطتين في اسم الكلاس md\:text-2xl
    const productName = $('h1.text-xl.md\\:text-2xl.leading-10.font-bold.text-store-text-primary')
                          .first()
                          .text()
                          .trim();

    // 3) وصف المنتج
    const productDesc = $('.product-single-top-description article')
                          .first()
                          .text()
                          .trim();

    // 4) السعر
    const productPrice = $('h2.text-store-text-primary.font-bold.text-xl.inline-block')
                           .first()
                           .text()
                           .trim();

    // 5) تصنيفات breadcrumb (اختياري)
    const categories = $('nav.breadcrumb a')
                          .map((i, el) => $(el).text().trim())
                          .get();

    // 6) جهّز الإخراج
    const products = [];
    if (productName) {
      products.push({
        name:        productName,
        description: productDesc,
        price:       productPrice
      });
    }

    res.json({
      success:    true,
      storefront,              // رابط المتجر
      title,                   // عنوان الصفحة
      description,             // ميتا ديسكريبشن
      categories,              // array من نصوص الرابط في الـ breadcrumb
      count:      products.length,
      products                  // مصفوفة فيها كائن واحد (أو أكثر لو كررت المنطق)
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: `⚠️ خطأ أثناء جلب البيانات: ${error.message}`
    });
  }
};
