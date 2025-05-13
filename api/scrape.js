// api/scrape.js

import { load } from 'cheerio';

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    // جلب الصفحة باستخدام fetch المدمج
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `Failed to fetch URL: ${response.status}` });
    }
    const html = await response.text();

    // تحميل الـ HTML في cheerio
    const $ = load(html);

    // استخراج أول سكريبت من نوع application/ld+json
    const ldScript = $('script[type="application/ld+json"]').first().html();
    if (!ldScript) {
      return res.status(200).json({ products: [] });
    }

    // تحويل الـ JSON-LD إلى كائن
    let data;
    try {
      data = JSON.parse(ldScript);
    } catch (e) {
      console.error('LD JSON parse error:', e);
      return res.status(200).json({ products: [] });
    }

    // التحقق من الهيكل المتوقع
    if (data['@type'] !== 'ItemList' || !Array.isArray(data.itemListElement)) {
      console.error('Unexpected LD structure:', data);
      return res.status(200).json({ products: [] });
    }

    // بناء مصفوفة المنتجات
    const products = data.itemListElement.map(elem => {
      const p = elem.item || {};
      return {
        name:        p.name        || '',
        description: p.description || '',
        price:       p.offers?.price
                      ? `${p.offers.price} ${p.offers.priceCurrency || ''}`.trim()
                      : '',
        url:         p.url         || '',
        image:       p.image       || ''
      };
    });

    // إرجاع النتيجة
    return res.status(200).json({ products });

  } catch (err) {
    console.error('Unhandled error in /api/scrape:', err);
    return res.status(500).json({ error: err.message });
  }
}
