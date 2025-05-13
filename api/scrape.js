// api/scrape.js
const chrome = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ success:false, message:'مرّر ?url=' });

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chrome.args,
      executablePath: await chrome.executablePath,
      headless: true,
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    // إذا عندك الكثير من الـ AJAX ممكن تنتظر زيادة
    await page.waitForTimeout(2000);

    const html = await page.content();
    const $ = cheerio.load(html);
    const products = [];

    // عدّل الـ selectors حسب اللي بالموقع
    $('.product-single-item, .product-item').each((i, el) => {
      const name = $(el).find('h1.text-xl, h2.product-title').text().trim();
      const desc = $(el).find('.product-single-top-description article').text().trim();
      const price = $(el).find('h2.text-store-text-primary, .sicon-sar').parent().text().trim();
      if (name) products.push({ name, desc, price });
    });

    await browser.close();
    return res.json({ success:true, count:products.length, products });

  } catch (e) {
    if (browser) await browser.close();
    return res.status(500).json({ success:false, message:e.message });
  }
};
