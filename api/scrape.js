// api/scrape.js
const axios    = require('axios');
const cheerio  = require('cheerio');

module.exports = async (req, res) => {
  // بدل req.query.s نستخدم req.query.url
  const url = req.query.url;

  if (!url) {
    return res
      .status(400)
      .json({ success: false, message: '❌ يرجى تمرير رابط الموقع عبر ?url=' });
  }

  try {
    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);

    const title       = $('title').text().trim()                 || '';
    const description = $('meta[name="description"]').attr('content') || '';
    const keywords    = $('meta[name="keywords"]').attr('content')    || '';

    const products = [];
    $('.product, .item, .card, img').each((i, el) => {
      if (i >= 5) return false;
      const text = $(el).text().trim();
      const src  = $(el).attr('src') || '';
      products.push(text || src);
    });

    return res.json({ success: true, title, description, keywords, products });
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ success: false, message: e.message });
  }
};
