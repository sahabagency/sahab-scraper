const SOCIAL_DOMAINS = {
  linkedin: ['linkedin.com'],
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  tiktok: ['tiktok.com'],
  x: ['x.com', 'twitter.com']
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const STOP = new Set(['the','and','clinic','clinics','center','centre','company','co','llc','ltd','saudi','arabia','riyadh','jeddah','dubai','ksa']);

function tokens(value = '') {
  return [...new Set(String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(x => x.length > 2 && !STOP.has(x)))];
}

function similarity(text, lead, location) {
  const hay = String(text || '').toLowerCase();
  const nameTokens = tokens(lead.name);
  const locationTokens = tokens(location || lead.address || '');
  const nameHits = nameTokens.filter(t => hay.includes(t)).length;
  const locHits = locationTokens.filter(t => hay.includes(t)).length;
  const nameScore = nameTokens.length ? nameHits / nameTokens.length : 0;
  const locScore = locationTokens.length ? Math.min(1, locHits / Math.min(2, locationTokens.length)) : 0;
  return Math.round((nameScore * 80) + (locScore * 20));
}

function channelFromUrl(url = '') {
  const lower = url.toLowerCase();
  for (const [channel, domains] of Object.entries(SOCIAL_DOMAINS)) {
    if (domains.some(d => lower.includes(d))) return channel;
  }
  return null;
}

async function braveSearch(q, count = 10) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', q);
  url.searchParams.set('count', String(Math.min(20, count)));
  url.searchParams.set('extra_snippets', 'true');
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Brave Search HTTP ${response.status}`);
  const data = await response.json();
  return data.web?.results || [];
}

function collectEmails(results, lead, location) {
  const found = [];
  for (const result of results) {
    const text = [result.title, result.description, ...(result.extra_snippets || [])].join(' ');
    const confidence = similarity(`${text} ${result.url}`, lead, location);
    for (const email of text.match(EMAIL_RE) || []) {
      found.push({ email: email.toLowerCase(), confidence, source: result.url });
    }
  }
  return found.sort((a,b) => b.confidence - a.confidence);
}

export async function discoverPublicWebContacts(lead, { location = '' } = {}) {
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    return { provider: 'not_configured', socials: {}, emailCandidates: [], evidence: [] };
  }

  const baseQuery = `\"${lead.name}\" ${location || lead.address || ''}`.trim();
  const queries = [
    `${baseQuery} contact email`,
    `${baseQuery} Instagram Facebook LinkedIn`
  ];

  const all = [];
  for (const q of queries) {
    const rows = await braveSearch(q, 10).catch(() => []);
    all.push(...rows.map(r => ({ ...r, query: q })));
  }

  const socials = {};
  const evidence = [];
  for (const result of all) {
    const channel = channelFromUrl(result.url);
    if (!channel) continue;
    const confidence = similarity(`${result.title} ${result.description} ${result.url}`, lead, location);
    if (confidence < 60) continue;
    const current = socials[channel];
    if (!current || confidence > current.confidence) {
      socials[channel] = { url: result.url, confidence, source: 'brave_web_search' };
    }
  }

  const emailCandidates = collectEmails(all, lead, location).filter(x => x.confidence >= 65);
  const uniqueEvidence = [];
  const seen = new Set();
  for (const r of all) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    const confidence = similarity(`${r.title} ${r.description} ${r.url}`, lead, location);
    if (confidence >= 60) uniqueEvidence.push({ title: r.title, url: r.url, confidence, query: r.query });
  }

  return {
    provider: 'brave',
    socials,
    emailCandidates: emailCandidates.slice(0, 5),
    evidence: uniqueEvidence.slice(0, 10)
  };
}
