const SOCIAL_DOMAINS = {
  linkedin: ['linkedin.com'],
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  tiktok: ['tiktok.com'],
  x: ['x.com', 'twitter.com']
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TEXT_URL_RE = /\b(?:https?:\/\/|www\.)[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^^\s<>()"']*)?/gi;
const STOP = new Set(['the','and','clinic','clinics','center','centre','company','co','llc','ltd','saudi','arabia','riyadh','jeddah','dubai','ksa','medical','beauty']);
const BAD_SOCIAL_PATHS = ['/popular/', '/explore/', '/search', '/hashtag/', '/topics/', '/directory/', '/reel/', '/reels/', '/p/', '/stories/', '/story/', '/video/', '/videos/', '/watch/'];
const DIRECTORY_DOMAINS = ['google.com','maps.google','instagram.com','facebook.com','fb.com','linkedin.com','tiktok.com','x.com','twitter.com','youtube.com','yelp.com','tripadvisor.com','foursquare.com','yellowpages','linktr.ee','beacons.ai','bio.site','campsite.bio','taplink.cc','lnk.bio','solo.to','snapchat.com','pinterest.com','zavis.ai','therapr.com','magicpin.com','gulfhex.com'];

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
  return Math.round((nameScore * 88) + (locScore * 12));
}

function channelFromUrl(url = '') {
  const lower = url.toLowerCase();
  for (const [channel, domains] of Object.entries(SOCIAL_DOMAINS)) {
    if (domains.some(d => lower.includes(d))) return channel;
  }
  return null;
}

function isDirectSocialProfile(url = '') {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (BAD_SOCIAL_PATHS.some(p => path.includes(p))) return false;
    const segments = path.split('/').filter(Boolean);
    return segments.length === 1 || (segments.length === 2 && ['company','in'].includes(segments[0]));
  } catch {
    return false;
  }
}

function isCandidateOfficialWebsite(url = '') {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (DIRECTORY_DOMAINS.some(d => host === d || host.endsWith(`.${d}`) || host.includes(d))) return false;
    if (/\/search|\/directory|\/listing|\/profile\//i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizeTextUrl(raw = '') {
  const value = String(raw).replace(/[),.;:]+$/g, '');
  if (!value) return null;
  try {
    const url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
    return url.toString();
  } catch {
    return null;
  }
}

function urlsFromSearchText(result) {
  const text = [result.title, result.description, ...(result.extra_snippets || [])].join(' ');
  return [...new Set((text.match(TEXT_URL_RE) || []).map(normalizeTextUrl).filter(Boolean))];
}

async function braveSearch(q, count = 10) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', q);
  url.searchParams.set('count', String(Math.min(20, count)));
  url.searchParams.set('extra_snippets', 'true');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
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

function bestWebsite(all, lead, location) {
  const candidates = [];
  for (const result of all) {
    const context = `${result.title || ''} ${result.description || ''} ${(result.extra_snippets || []).join(' ')} ${result.url || ''}`;
    const contextConfidence = similarity(context, lead, location);

    if (isCandidateOfficialWebsite(result.url) && contextConfidence >= 80) {
      candidates.push({ url: result.url, confidence: contextConfidence, title: result.title || '', source: 'brave_direct_result' });
    }

    if (contextConfidence >= 80) {
      for (const extractedUrl of urlsFromSearchText(result)) {
        if (!isCandidateOfficialWebsite(extractedUrl)) continue;
        candidates.push({
          url: extractedUrl,
          confidence: Math.max(0, contextConfidence - 4),
          title: result.title || '',
          source: `brave_snippet_via:${new URL(result.url).hostname}`
        });
      }
    }
  }

  const byHost = new Map();
  for (const candidate of candidates) {
    let host;
    try { host = new URL(candidate.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { continue; }
    const current = byHost.get(host);
    if (!current || candidate.confidence > current.confidence) byHost.set(host, candidate);
  }
  return [...byHost.values()].sort((a,b) => b.confidence - a.confidence)[0] || null;
}

export async function discoverPublicWebContacts(lead, { location = '' } = {}) {
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    return { provider: 'not_configured', website: null, socials: {}, emailCandidates: [], evidence: [] };
  }

  const locationText = location || lead.address || '';
  const baseQuery = `\"${lead.name}\" ${locationText}`.trim();
  const brandTokens = tokens(lead.name).slice(0, 4).join(' ');
  const queries = [
    `${baseQuery} official website`,
    `${baseQuery} website`,
    `${brandTokens} ${locationText} official site`,
    `${baseQuery} contact email`,
    `${baseQuery} Instagram Facebook LinkedIn`,
    `${baseQuery} official Instagram LinkedIn`
  ];

  const all = [];
  for (const q of queries) {
    const rows = await braveSearch(q, 10).catch(() => []);
    all.push(...rows.map(r => ({ ...r, query: q })));
  }

  const socials = {};
  for (const result of all) {
    const channel = channelFromUrl(result.url);
    if (!channel || !isDirectSocialProfile(result.url)) continue;
    const confidence = similarity(`${result.title} ${result.description} ${result.url}`, lead, location);
    if (confidence < 80) continue;
    const current = socials[channel];
    if (!current || confidence > current.confidence) socials[channel] = { url: result.url, confidence, source: 'brave_web_search' };
  }

  const emailCandidates = collectEmails(all, lead, location).filter(x => x.confidence >= 80);
  const uniqueEvidence = [];
  const seen = new Set();
  for (const r of all) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    const confidence = similarity(`${r.title} ${r.description} ${r.url}`, lead, location);
    if (confidence >= 75) uniqueEvidence.push({ title: r.title, url: r.url, confidence, query: r.query });
  }

  return {
    provider: 'brave',
    website: bestWebsite(all, lead, location),
    socials,
    emailCandidates: emailCandidates.slice(0, 5),
    evidence: uniqueEvidence.slice(0, 12)
  };
}
