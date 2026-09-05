const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CONTACT_HINTS = ['contact', 'about', 'team', 'booking', 'appointments', 'support'];
const ROLE_PRIORITY = ['info', 'hello', 'contact', 'sales', 'marketing', 'office', 'admin', 'support', 'bookings', 'appointments'];

function normalizeWebsite(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function cleanEmail(email) {
  return email.trim().replace(/[),.;:]+$/g, '').toLowerCase();
}

function isLikelyAsset(email) {
  return /\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(email);
}

function scoreEmail(email, websiteHost) {
  let score = 0;
  const [local, domain = ''] = email.split('@');
  const host = (websiteHost || '').replace(/^www\./, '');
  if (host && (domain === host || domain.endsWith(`.${host}`))) score += 20;
  const roleIndex = ROLE_PRIORITY.findIndex(role => local === role || local.startsWith(`${role}.`) || local.startsWith(`${role}-`) || local.startsWith(`${role}_`));
  if (roleIndex >= 0) score += 15 - roleIndex;
  if (/noreply|no-reply|donotreply|do-not-reply/.test(local)) score -= 30;
  if (/privacy|legal|abuse/.test(local)) score -= 10;
  return score;
}

function extractEmails(html, host) {
  const matches = html.match(EMAIL_RE) || [];
  return [...new Set(matches.map(cleanEmail))]
    .filter(email => !isLikelyAsset(email))
    .map(email => ({ email, score: scoreEmail(email, host) }))
    .sort((a, b) => b.score - a.score);
}

function extractContactLinks(html, baseUrl) {
  const links = [];
  const hrefRe = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRe.exec(html))) {
    const href = match[1];
    if (!CONTACT_HINTS.some(h => href.toLowerCase().includes(h))) continue;
    try {
      const absolute = new URL(href, baseUrl);
      if (absolute.protocol === 'http:' || absolute.protocol === 'https:') links.push(absolute.toString());
    } catch {}
  }
  return [...new Set(links)].slice(0, 4);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SahabAuditBot/1.0; +https://sahab.agency)'
      }
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichLeadContact(lead) {
  if (!lead?.website) {
    return { ...lead, contactEmail: null, contactEmailSource: null, publicEmails: [] };
  }

  const root = normalizeWebsite(lead.website);
  if (!root) return { ...lead, contactEmail: null, contactEmailSource: null, publicEmails: [] };

  const host = new URL(root).host;
  const pages = [lead.website];
  const homepage = await fetchHtml(lead.website);
  const found = [];

  if (homepage) {
    found.push(...extractEmails(homepage, host).map(x => ({ ...x, source: lead.website })));
    pages.push(...extractContactLinks(homepage, lead.website));
  }

  for (const page of [...new Set(pages)].slice(1, 5)) {
    const html = await fetchHtml(page);
    if (!html) continue;
    found.push(...extractEmails(html, host).map(x => ({ ...x, source: page })));
  }

  const unique = new Map();
  for (const item of found) {
    const current = unique.get(item.email);
    if (!current || item.score > current.score) unique.set(item.email, item);
  }

  const ranked = [...unique.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;

  return {
    ...lead,
    contactEmail: best?.email || null,
    contactEmailSource: best?.source || null,
    publicEmails: ranked.slice(0, 5).map(({ email, source }) => ({ email, source }))
  };
}
