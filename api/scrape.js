const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const url = req.query.url;        // أو ?s=
  if (!url) {
    return res.status(400).json({ success: false, message: 'يرجى تمرير رابط المتجر عبر ?url=' });
  }

  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // عنوان ومتا
    const title = $('title').text().trim() || '';
    const description = $('meta[name="description"]').attr('content') || '';

    // الأقسام (لو موجودة في القائمة الرئيسية)
    const categories = $('.main-menu a[href*="/ar/collection"]').map((i, el) =>
      $(el).text().trim()
    ).get();

    // كل المنتجات
    const products = $('.grid__item, .product-card').map((i, el) => {
      // اسم المنتج
      const name = $(el)
        .find('h1.text-xl, h2.text-store-text-primary')
        .first().text().trim();

      // الوصف التفصيلي
      const desc = $(el)
        .find('.product-single-top-description article')
        .text().trim();

      // السعر (مثلاً داخل <i class="sicon-sar">)
      const price = $(el)
        .find('h2 .sicon-sar')
        .parent()
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      // صورة
      const img = $(el)
        .find('img')
        .attr('src') || '';

      return { name, desc, price, img };
    }).get();

    return res.status(200).json({
      success: true,
      title,
      description,
      categories,
      count: products.length,
      products
    });

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: `خطأ أثناء جلب أو تحليل البيانات: ${error.message}` });
  }
};
