// scraper.js
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
app.use(cors());

app.get('/api/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const $ = cheerio.load(html);

    // مثال سحب منتج من الصفحة الرئيسية
    const products = [];
    $('.product-card-wrapper').each((i, el) => {
      const name = $(el).find('.product-title a').text().trim();
      const price = $(el).find('.product-price').text().trim();
      const url = $(el).find('a').attr('href');
      const image = $(el).find('img').attr('src');
      if (name) {
        products.push({ name, price, url: `https://khairatlaziza.com${url}`, image });
      }
    });

    res.json({ store: 'khairatlaziza.com', products });

  } catch (err) {
    console.error('❌ Scrape Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Scraper running on port ${PORT}`));
