import fetch from 'node-fetch';
import cheerio from 'cheerio';

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    // 1) نجيب HTML الصفحة الرئيسية
    const html = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then(r => r.text());

    // 2) نشغّل Cheerio
    const $ = cheerio.load(html);

    // 3) نلقى أول <script type="application/ld+json">
    const ldJson = $('script[type="application/ld+json"]').first().html();
    if (!ldJson) {
      return res.status(200).json({ products: [] });
    }

    // 4) نحاول نعمل Parse للـJSON
    let data;
    try {
      data = JSON.parse(ldJson);
    } catch (e) {
      return res.status(200).json({ products: [] });
    }

    // 5) نتأكد إنها ItemList وعندنا itemListElement
    if (data['@type'] !== 'ItemList' || !Array.isArray(data.itemListElement)) {
      return res.status(200).json({ products: [] });
    }

    // 6) نجمع المنتجات
    const products = data.itemListElement.map(li => {
      const p = li.item || {};
      return {
        name:        p.name        || '',
        description: p.description || '',
        price:       p.offers?.price
                      ? `${p.offers.price} ${p.offers.priceCurrency||''}`.trim()
                      : '',
        url:         p.url         || '',
        image:       p.image       || ''
      };
    });

    // 7) نرجع النتيجة
    return res.status(200).json({ products });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
