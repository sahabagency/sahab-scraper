import axios from 'axios';
import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(html);

    const products = [];

    $('a[href*="/p"]').each((i, el) => {
      const productUrl = 'https://khairatlaziza.com' + $(el).attr('href');
      const name = $(el).find('h2, h3, h4, h5, h1').first().text().trim();
      const image = $(el).find('img').attr('src') || '';
      const priceText = $(el).text().match(/\d+\s*(ريال|SAR)/i);
      const price = priceText ? priceText[0].replace(/\s+/g, ' ') : '';

      if (name && productUrl) {
        products.push({
          name,
          url: productUrl,
          price,
          image
        });
      }
    });

    return res.status(200).json({ products });

  } catch (err) {
    console.error('❌ Error scraping homepage:', err);
    return res.status(500).json({ error: err.message });
  }
}
