import axios from 'axios';
import cheerio from 'cheerio';

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(html);

    // نفلتر كل سكربتات الـ JSON-LD ونشوف اول واحد فيه ItemList
    let itemList = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (itemList) return;
      try {
        const obj = JSON.parse($(el).contents().text());
        // لو هو Array أو فيه @graph
        const list = Array.isArray(obj) ? obj 
                   : obj['@graph']   ? obj['@graph'] 
                   : [obj];
        for (const o of list) {
          if (o['@type'] === 'ItemList' && Array.isArray(o.itemListElement)) {
            itemList = o;
            break;
          }
        }
      } catch (e) { /* parse error */ }
    });

    if (!itemList) {
      // ما لقينا ItemList، رجّع فاضية
      return res.status(200).json({ products: [] });
    }

    const products = itemList.itemListElement.map(({ item: p }) => ({
      name:        p.name        || '',
      description: p.description || '',
      price:       p.offers?.price
                      ? `${p.offers.price} ${p.offers.priceCurrency||''}`.trim()
                      : '',
      url:         p.url         || '',
      image:       p.image       || ''
    }));

    return res.status(200).json({ products });

  } catch (err) {
    console.error('Error scraping:', err);
    return res.status(500).json({ error: err.message });
  }
}
