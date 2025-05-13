
import { load } from 'cheerio';

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    // 1) جلب الصفحة
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
    });
    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `Failed to fetch URL: ${response.status}` });
    }
    const html = await response.text();

    // 2) تحميل الـ HTML عبر cheerio
    const $ = load(html);

    // 3) دور على كل سكربت application/ld+json
    let itemList = null;
    $('script[type="application/ld+json"]').each((i, el) => {
      if (itemList) return; // إذا لقيناه خلاص
      try {
        const txt = $(el).html().trim();
        if (!txt) return;
        const parsed = JSON.parse(txt);
        // لو العنصر مبسط أو مصفوفة
        if (Array.isArray(parsed)) {
          parsed.forEach(obj => {
            if (obj['@type'] === 'ItemList' && Array.isArray(obj.itemListElement)) {
              itemList = obj;
            }
          });
        } else if (parsed['@type'] === 'ItemList' && Array.isArray(parsed.itemListElement)) {
          itemList = parsed;
        }
      } catch (e) {
        // تخطى لو فيه JSON خطأ
      }
    });

    if (!itemList) {
      // ما لقينا ItemList
      return res.status(200).json({ products: [] });
    }

    // 4) استخرج المنتجات
    const products = itemList.itemListElement.map(elem => {
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

    return res.status(200).json({ products });

  } catch (err) {
    console.error('Error in /api/scrape:', err);
    return res.status(500).json({ error: err.message });
  }
}
