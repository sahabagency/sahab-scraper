const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const url = req.query.s;
  if (!url) {
    return res.status(400).json({ success: false, message: 'يرجى تمرير رابط المتجر عبر ?s=' });
  }

  try {
    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);

    // 1. اسم المنتج
    const name = $('h1.text-xl.md\\:text-2xl.leading-10.font-bold.text-store-text-primary')
      .text()
      .trim();

    // 2. وصف المنتج
    const description = $('.product-single-top-description article')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    // 3. السعر (بالخط الجديد)
    let priceText = $('h2.text-store-text-primary.font-bold.text-xl.inline-block')
      .first()
      .text()
      .trim();
    // نظّف السعر من أي رموز أو مسافات:
    const price = priceText.replace(/[^\d\u0660-\u0669]/g, '').trim();  

    // 4. صورة المنتج
    let image = $('img.product-single__photo, img.featured__media')
      .first()
      .attr('src') || '';
    if (image.startsWith('//')) image = 'https:' + image;

    return res.status(200).json({
      success: true,
      name,
      description,
      price,   // هنا السعر الرقمي كـ string
      image
    });
  } catch (error) {
    console.error('Scraper Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
