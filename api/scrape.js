// api/scrape.js
const axios   = require('axios');
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
    // 1) جلب صفحة المتجر
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // 2) بيانات عامة
    const storefront    = url;
    const pageTitle     = $('title').text().trim();
    const pageDesc      = $('meta[name="description"]').attr('content')?.trim() || '';

    // 3) اسم / وصف / سعر المنتج
    const productName   = $('h1.text-store-text-primary').first().text().trim();
    const productDesc   = $('.product-single-top-description article').first().text().trim();
    const productPrice  = $('h2.text-store-text-primary').first().text().trim();

    // 4) تصنيفات breadcrumb (لو موجودة)
    const categories = $('nav.breadcrumb a')
      .map((i, el) => $(el).text().trim())
      .get();

    // 5) جهّز المخرجات
    const products = [];
    if (productName) {
      products.push({
        name:        productName,
        description: productDesc,
        price:       productPrice
      });
    }

    res.json({
      success:     true,
      storefront,              // رابط المتجر
      pageTitle,               // عنوان الصفحة
      pageDesc,                // ميتا الوصف
      categories,              // مصفوفة تصنيفات (إذا فيه)
      count:       products.length,
      products                  // مصفوفة المنتجات (واحد هنا)
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: `⚠️ خطأ خلال السحب: ${err.message}`
    });
  }
};
