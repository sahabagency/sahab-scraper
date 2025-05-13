import cheerio from 'cheerio';

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    // استخدم fetch المدمج
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await response.text();

    const $ = cheerio.load(html);
    const ldJson = $('script[type="application/ld+json"]').first().html();
    if (!ldJson) return res.status(200).json({ products: [] });

    let data;
    try { data = JSON.parse(ldJson); }
    catch (e) { console.error('LD JSON parse error:', e); return res.status(200).json({ products: [] }); }

    if (data['@type'] !== 'ItemList' || !Array.isArray(data.itemListElement)) {
      console.error('Unexpected LD structure:', data);
      return res.status(200).json({ products: [] });
    }

    const products = data.itemListElement.map(({ item: p }) => ({
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
    console.error('Unhandled error in /api/scrape:', err);
    return res.status(500).json({ error: err.message });
  }
}
