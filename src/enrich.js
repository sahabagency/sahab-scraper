import { discoverPublicWebContacts } from './webDiscover.js';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CONTACT_HINTS = ['contact', 'about', 'team', 'booking', 'appointments', 'support', 'reach-us', 'اتصل', 'تواصل'];
const ROLE_PRIORITY = ['info', 'hello', 'contact', 'sales', 'marketing', 'office', 'admin', 'support', 'bookings', 'appointments'];
const HUB_HOSTS = ['linktr.ee','beacons.ai','bio.site','campsite.bio','taplink.cc','lnk.bio','solo.to','msha.ke'];
const NAME_STOP = new Set(['the','and','clinic','clinics','center','centre','medical','beauty','saudi','arabia','riyadh','jeddah']);

function normalizeWebsite(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function hostOf(url = '') {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function isLinkHub(url = '') {
  const host = hostOf(url);
  return HUB_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

function nameTokens(value = '') {
  return [...new Set(String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(x => x.length > 2 && !NAME_STOP.has(x)))];
}

function pageMatchesBusiness(html = '', lead = {}) {
  const hay = String(html).toLowerCase();
  const tokens = nameTokens(lead.name);
  if (!tokens.length) return true;
  const hits = tokens.filter(t => hay.includes(t)).length;
  return hits >= Math.min(2, tokens.length) || hits / tokens.length >= 0.6;
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
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; SahabAuditBot/1.0; +https://sahab.agency)' }
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

function mergeWebSocials(target, webSocials) {
  for (const [key, value] of Object.entries(webSocials || {})) {
    if (!target[key] && value?.url) target[key] = value.url;
  }
}

function chooseContactRoute({ email, emailConfidence = 100, socials, phone, webDiscovery }) {
  if (email && emailConfidence >= 70) return { channel: 'email', destination: email, confidence: emailConfidence, reason: 'Public business email found with sufficient confidence.' };
  const socialOrder = ['linkedin', 'instagram', 'whatsapp', 'facebook', 'tiktok', 'x'];
  for (const channel of socialOrder) {
    if (!socials[channel]) continue;
    const confidence = webDiscovery?.socials?.[channel]?.confidence ?? 90;
    if (confidence >= 80) return { channel, destination: socials[channel], confidence, reason: `No reliable email found; ${channel} business presence available.` };
  }
  if (phone) return { channel: 'phone', destination: phone, confidence: 70, reason: 'No reliable email/social destination found; Google Places phone is available.' };
  return { channel: 'research_required', destination: null, confidence: 0, reason: 'No reliable direct contact destination found yet.' };
}

async function enrichFromWebsite(website, lead, found, socials, { requireBrandMatch = false } = {}) {
  const root = normalizeWebsite(website);
  if (!root) return { websiteHost: '', sourceType: 'none', homepageLoaded: false, brandMatched: false };
  const websiteHost = new URL(root).host;
  const pages = [website];
  const homepage = await fetchHtml(website);
  if (!homepage) return { websiteHost, sourceType: 'none', homepageLoaded: false, brandMatched: false };
  const brandMatched = pageMatchesBusiness(homepage, lead);
  if (requireBrandMatch && !brandMatched) return { websiteHost, sourceType: 'none', homepageLoaded: true, brandMatched: false };
  found.push(...extractEmails(homepage, websiteHost).map(x => ({ ...x, source: website, confidence: 95 })));
  mergeSocials(socials, extractSocialLinks(homepage, website));
  pages.push(...extractContactLinks(homepage, website));
  for (const page of [...new Set(pages)].slice(1, 7)) {
    const html = await fetchHtml(page);
    if (!html) continue;
    found.push(...extractEmails(html, websiteHost).map(x => ({ ...x, source: page, confidence: 95 })));
    mergeSocials(socials, extractSocialLinks(html, page));
  }
  return { websiteHost, sourceType: 'owned_website', homepageLoaded: true, brandMatched };
}

export async function enrichLeadContact(lead, { location = '' } = {}) {
  const emptySocials = { instagram: null, facebook: null, linkedin: null, tiktok: null, x: null, whatsapp: null };
  const socials = { ...emptySocials };
  const found = [];
  let websiteHost = '';
  let sourceType = 'none';
  const originalWebsite = lead?.website || null;
  const originalIsHub = Boolean(originalWebsite && isLinkHub(originalWebsite));
  let resolvedWebsite = originalIsHub ? null : originalWebsite;
  let websiteDiscovery = null;
  let linkHub = originalIsHub ? originalWebsite : null;

  if (originalWebsite) {
    const first = await enrichFromWebsite(originalWebsite, lead, found, socials, { requireBrandMatch: false });
    if (!originalIsHub) {
      websiteHost = first.websiteHost;
      sourceType = first.sourceType;
    } else {
      sourceType = 'link_hub';
    }
  }

  const hasAnySocial = Object.values(socials).some(Boolean);
  const needsWebDiscovery = originalIsHub || !found.length || !hasAnySocial || !resolvedWebsite;
  const webDiscovery = needsWebDiscovery
    ? await discoverPublicWebContacts({ ...lead, website: resolvedWebsite }, { location }).catch(() => ({ provider: 'error', website: null, socials: {}, emailCandidates: [], evidence: [] }))
    : { provider: 'not_needed', website: null, socials: {}, emailCandidates: [], evidence: [] };

  const candidate = webDiscovery.website;
  const shouldTryRecovered = candidate?.url && candidate.confidence >= 80 && hostOf(candidate.url) !== hostOf(resolvedWebsite || '');
  if (shouldTryRecovered) {
    const second = await enrichFromWebsite(candidate.url, lead, found, socials, { requireBrandMatch: true });
    if (second.homepageLoaded && second.brandMatched) {
      resolvedWebsite = candidate.url;
      websiteDiscovery = { ...candidate, verifiedByPageBrandMatch: true };
      websiteHost = second.websiteHost;
      sourceType = 'discovered_official_website';
    }
  }

  mergeWebSocials(socials, webDiscovery.socials);
  for (const candidateEmail of webDiscovery.emailCandidates || []) {
    found.push({ email: candidateEmail.email, source: candidateEmail.source, score: 0, confidence: candidateEmail.confidence });
  }

  const unique = new Map();
  for (const item of found) {
    const email = cleanEmail(item.email);
    const rank = (item.confidence || 0) + (item.score || scoreEmail(email, websiteHost));
    const current = unique.get(email);
    if (!current || rank > current.rank) unique.set(email, { ...item, email, rank });
  }

  const ranked = [...unique.values()].sort((a, b) => b.rank - a.rank);
  const best = ranked[0] || null;
  const route = chooseContactRoute({
    email: best?.email || null,
    emailConfidence: best?.confidence ?? (best ? 95 : 0),
    socials,
    phone: lead?.phone,
    webDiscovery
  });

  return {
    ...lead,
    website: resolvedWebsite,
    linkHub,
    websiteDiscovery,
    contactEmail: best?.email || null,
    contactEmailConfidence: best?.confidence ?? (best ? 95 : 0),
    contactEmailSource: best?.source || null,
    publicEmails: ranked.slice(0, 5).map(({ email, source, confidence }) => ({ email, source, confidence: confidence ?? 95 })),
    socials,
    contactRoute: route,
    discovery: {
      sourceType,
      originalWebsite,
      linkHub,
      websiteMatch: websiteDiscovery,
      webProvider: webDiscovery.provider,
      evidence: webDiscovery.evidence || [],
      socialMatches: webDiscovery.socials || {}
    }
  };
}
