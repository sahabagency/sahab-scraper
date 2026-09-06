const sentToday = new Map();
const sentDestinations = new Set();
const suppressed = new Set();

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

export function outboundPolicy() {
  return {
    enabled: process.env.OUTBOUND_ENABLED === '1',
    dailyLimit: Math.max(1, Math.min(Number(process.env.OUTBOUND_DAILY_LIMIT || 10), 100)),
    followupLimit: Math.max(0, Math.min(Number(process.env.OUTBOUND_FOLLOWUP_LIMIT || 2), 5)),
    requireReview: process.env.OUTBOUND_REQUIRE_REVIEW !== '0'
  };
}

export function suppressDestination(email) {
  const normalized = normalizeEmail(email);
  if (normalized) suppressed.add(normalized);
}

export function canSendOutbound({ to, requiresReview = true, approved = false }) {
  const policy = outboundPolicy();
  const email = normalizeEmail(to);
  if (!policy.enabled) return { ok: false, reason: 'outbound_disabled' };
  if (!email || !email.includes('@')) return { ok: false, reason: 'invalid_email' };
  if (suppressed.has(email)) return { ok: false, reason: 'suppressed' };
  if (sentDestinations.has(email)) return { ok: false, reason: 'duplicate_destination' };
  if (policy.requireReview && requiresReview && !approved) return { ok: false, reason: 'review_required' };

  const key = dayKey();
  const count = sentToday.get(key) || 0;
  if (count >= policy.dailyLimit) return { ok: false, reason: 'daily_limit_reached' };

  return { ok: true, reason: null, remainingToday: policy.dailyLimit - count };
}

export function recordOutboundSend({ to }) {
  const email = normalizeEmail(to);
  const key = dayKey();
  sentToday.set(key, (sentToday.get(key) || 0) + 1);
  if (email) sentDestinations.add(email);
}

export function outboundRuntimeStatus() {
  const policy = outboundPolicy();
  const count = sentToday.get(dayKey()) || 0;
  return {
    ...policy,
    sentToday: count,
    remainingToday: Math.max(0, policy.dailyLimit - count),
    persistence: 'memory_only'
  };
}
