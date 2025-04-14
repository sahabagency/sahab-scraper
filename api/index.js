const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const url = req.query.s;

  if (!url) {
    return res.status(400).json({ success: false, message: 'يرجى تمرير رابط الموقع عبر ?s=' });
  }

  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const title = $('title').text() || '';
    const description = $('meta[name="description"]').attr('content') || '';
    const keywords = $('meta[name="keywords"]').attr('content') || '';

    // نحاول نلقط أول 5 منتجات بشكل ذكي
    const products = [];
    $('.product, .item, .card, img').each((i, el) => {
      if (i >= 5) return false;
      const text = $(el).text().trim();
      const src = $(el).attr('src') || $(el).find('img').attr('src') || '';
      products.push(text || src);
    });

    res.status(200).json({
      success: true,
      title,
      description,
      keywords,
      products
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
