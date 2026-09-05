const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CONTACT_HINTS = ['contact', 'about', 'team', 'booking', 'appointments', 'support', 'reach-us', 'اتصل', 'تواصل'];
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
  return [...new Set(links)].slice(0, 6);
}

function extractSocialLinks(html, baseUrl) {
  const socials = { instagram: null, facebook: null, linkedin: null, tiktok: null, x: null, whatsapp: null };
  const hrefRe = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRe.exec(html))) {
    const href = match[1];
    let absolute = href;
    try { absolute = new URL(href, baseUrl).toString(); } catch {}
    const lower = absolute.toLowerCase();
    if (!socials.instagram && lower.includes('instagram.com/')) socials.instagram = absolute;
    if (!socials.facebook && (lower.includes('facebook.com/') || lower.includes('fb.com/'))) socials.facebook = absolute;
    if (!socials.linkedin && lower.includes('linkedin.com/')) socials.linkedin = absolute;
    if (!socials.tiktok && lower.includes('tiktok.com/')) socials.tiktok = absolute;
    if (!socials.x && (lower.includes('x.com/') || lower.includes('twitter.com/'))) socials.x = absolute;
    if (!socials.whatsapp && (lower.includes('wa.me/') || lower.includes('api.whatsapp.com/') || lower.includes('whatsapp.com/'))) socials.whatsapp = absolute;
  }
  return socials;
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

function mergeSocials(target, next) {
  for (const key of Object.keys(target)) if (!target[key] && next?.[key]) target[key] = next[key];
}

function chooseContactRoute({ email, socials, phone }) {
  if (email) return { channel: 'email', destination: email, reason: 'Verified public business email found on owned website.' };
  if (socials.linkedin) return { channel: 'linkedin', destination: socials.linkedin, reason: 'No public email found; LinkedIn business presence available.' };
  if (socials.instagram) return { channel: 'instagram', destination: socials.instagram, reason: 'No public email found; Instagram business presence available.' };
  if (socials.whatsapp) return { channel: 'whatsapp', destination: socials.whatsapp, reason: 'No public email found; WhatsApp contact available.' };
  if (socials.facebook) return { channel: 'facebook', destination: socials.facebook, reason: 'No public email found; Facebook business presence available.' };
  if (phone) return { channel: 'phone', destination: phone, reason: 'No email/social destination found; Google Places phone is available.' };
  return { channel: 'research_required', destination: null, reason: 'No reliable direct contact destination found yet.' };
}

export async function enrichLeadContact(lead) {
  const emptySocials = { instagram: null, facebook: null, linkedin: null, tiktok: null, x: null, whatsapp: null };
  if (!lead?.website) {
    const route = chooseContactRoute({ email: null, socials: emptySocials, phone: lead?.phone });
    return { ...lead, contactEmail: null, contactEmailSource: null, publicEmails: [], socials: emptySocials, contactRoute: route };
  }

  const root = normalizeWebsite(lead.website);
  if (!root) {
    const route = chooseContactRoute({ email: null, socials: emptySocials, phone: lead?.phone });
    return { ...lead, contactEmail: null, contactEmailSource: null, publicEmails: [], socials: emptySocials, contactRoute: route };
  }

  const host = new URL(root).host;
  const pages = [lead.website];
  const homepage = await fetchHtml(lead.website);
  const found = [];
  const socials = { ...emptySocials };

  if (homepage) {
    found.push(...extractEmails(homepage, host).map(x => ({ ...x, source: lead.website })));
    mergeSocials(socials, extractSocialLinks(homepage, lead.website));
    pages.push(...extractContactLinks(homepage, lead.website));
  }

  for (const page of [...new Set(pages)].slice(1, 7)) {
    const html = await fetchHtml(page);
    if (!html) continue;
    found.push(...extractEmails(html, host).map(x => ({ ...x, source: page })));
    mergeSocials(socials, extractSocialLinks(html, page));
  }

  const unique = new Map();
  for (const item of found) {
    const current = unique.get(item.email);
    if (!current || item.score > current.score) unique.set(item.email, item);
  }

  const ranked = [...unique.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  const route = chooseContactRoute({ email: best?.email || null, socials, phone: lead.phone });

  return {
    ...lead,
    contactEmail: best?.email || null,
    contactEmailSource: best?.source || null,
    publicEmails: ranked.slice(0, 5).map(({ email, source }) => ({ email, source })),
    socials,
    contactRoute: route
  };
}
