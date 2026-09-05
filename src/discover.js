const GOOGLE_TEXT_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';

function normalizePlace(place) {
  return {
    placeId: place.place_id,
    name: place.name,
    address: place.formatted_address || '',
    rating: place.rating ?? null,
    reviewCount: place.user_ratings_total ?? 0,
    types: place.types || [],
    website: null,
    phone: null,
    source: 'google_places'
  };
}

async function fetchPlaceDetails(placeId, key) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'name,website,formatted_phone_number,url,business_status',
    key
  });
  const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
  if (!response.ok) throw new Error(`Google Place Details HTTP ${response.status}`);
  const data = await response.json();
  if (data.status !== 'OK') return {};
  return data.result || {};
}

export async function discoverLeads({ industry, location, limit = 20 }) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error('GOOGLE_MAPS_API_KEY is not configured yet');
  }

  const leads = [];
  let pageToken = null;

  while (leads.length < limit) {
    const params = new URLSearchParams({
      query: `${industry} in ${location}`,
      key
    });
    if (pageToken) params.set('pagetoken', pageToken);

    const response = await fetch(`${GOOGLE_TEXT_SEARCH_URL}?${params}`);
    if (!response.ok) throw new Error(`Google Places HTTP ${response.status}`);
    const data = await response.json();
    if (!['OK', 'ZERO_RESULTS'].includes(data.status)) {
      throw new Error(`Google Places error: ${data.status}${data.error_message ? ` — ${data.error_message}` : ''}`);
    }

    for (const place of data.results || []) {
      if (leads.length >= limit) break;
      const base = normalizePlace(place);
      const details = await fetchPlaceDetails(place.place_id, key).catch(() => ({}));
      leads.push({
        ...base,
        website: details.website || null,
        phone: details.formatted_phone_number || null,
        googleMapsUrl: details.url || null,
        businessStatus: details.business_status || null
      });
    }

    pageToken = data.next_page_token;
    if (!pageToken || leads.length >= limit) break;
    await new Promise(resolve => setTimeout(resolve, 2200));
  }

  return leads;
}
