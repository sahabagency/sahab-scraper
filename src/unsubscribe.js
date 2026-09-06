import crypto from 'crypto';

function secret() {
  const value = process.env.LEAD_ENGINE_DB_TOKEN || '';
  if (!value) throw new Error('unsubscribe signing secret unavailable');
  return value;
}

function b64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createUnsubscribeToken({ leadId, email, expiresDays = 365 }) {
  const payload = JSON.stringify({
    leadId: String(leadId || ''),
    email: String(email || '').trim().toLowerCase(),
    exp: Date.now() + Math.max(1, expiresDays) * 86400000
  });
  const encoded = b64url(payload);
  return `${encoded}.${signature(encoded)}`;
}

export function verifyUnsubscribeToken(token = '') {
  const [encoded, sig] = String(token).split('.');
  if (!encoded || !sig) throw new Error('invalid unsubscribe token');
  const expected = signature(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('invalid unsubscribe signature');
  const payload = JSON.parse(fromB64url(encoded));
  if (!payload.email || !payload.exp || Date.now() > Number(payload.exp)) throw new Error('unsubscribe token expired or incomplete');
  return payload;
}
