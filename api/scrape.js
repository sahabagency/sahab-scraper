// scraper.js
import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';

const app = express();
app.use(cors());

app.get('/api/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const browser = await puppeteer.launch({
      headless: 'new', // بدون واجهة رسومية
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

    // استخراج المنتجات من الصفحة
    const products = await page.evaluate(() => {
      const cards = document.querySelectorAll('.product-card-wrapper');
      const data = [];
      cards.forEach(card => {
        const name = card.querySelector('.product-title a')?.innerText?.trim();
        const price = card.querySelector('.product-price')?.innerText?.trim();
        const url = card.querySelector('a')?.href;
        const image = card.querySelector('img')?.src;
        if (name) {
          data.push({ name, price, url, image });
        }
      });
      return data;
    });

    await browser.close();
    return res.status(200).json({ store: url, products });

  } catch (err) {
    console.error('❌ Scraper error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Scraper running on port ${PORT}`));
