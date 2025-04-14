const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const url = req.query.s || 'https://example.com';
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const title = $('title').text();
    res.status(200).json({ success: true, title });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
