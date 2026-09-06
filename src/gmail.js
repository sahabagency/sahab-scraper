import crypto from 'crypto';

const pendingStates = new Map();
const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'
].join(' ');

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function oauthConfigured() {
  return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REDIRECT_URI);
}

export function gmailStatus() {
  return {
    oauthConfigured: oauthConfigured(),
    connected: Boolean(process.env.GMAIL_REFRESH_TOKEN)
  };
}

export function createGoogleAuthUrl() {
  if (!oauthConfigured()) throw new Error('Gmail OAuth is not configured');
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  for (const [key, expiresAt] of pendingStates) if (expiresAt < Date.now()) pendingStates.delete(key);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GMAIL_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.GMAIL_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', OAUTH_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGoogleCode({ code, state }) {
  const expiresAt = pendingStates.get(state);
  pendingStates.delete(state);
  if (!expiresAt || expiresAt < Date.now()) throw new Error('OAuth state expired or invalid');
  if (!code) throw new Error('Missing OAuth code');

  const body = new URLSearchParams({
    code,
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    redirect_uri: process.env.GMAIL_REDIRECT_URI,
    grant_type: 'authorization_code'
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || `Google token HTTP ${response.status}`);
  if (!data.refresh_token) throw new Error('Google did not return a refresh token. Reconnect and approve consent again.');
  return data;
}

export async function getGoogleAccessToken() {
  if (!process.env.GMAIL_REFRESH_TOKEN) throw new Error('GMAIL_REFRESH_TOKEN is not configured');
  const body = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Could not refresh Google access token');
  return data.access_token;
}

export async function verifyGmailConnection() {
  const token = await getGoogleAccessToken();
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gmail profile HTTP ${response.status}`);
  return { emailAddress: data.emailAddress, messagesTotal: data.messagesTotal, threadsTotal: data.threadsTotal };
}

export async function sendGmail({ to, subject, body, html = null, replyToMessageId = null, unsubscribeUrl = null }) {
  const token = await getGoogleAccessToken();
  const headers = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0'
  ];
  if (replyToMessageId) headers.push(`In-Reply-To: ${replyToMessageId}`, `References: ${replyToMessageId}`);
  if (unsubscribeUrl) {
    headers.push(`List-Unsubscribe: <${unsubscribeUrl}>`);
    headers.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  }

  let message;
  if (html) {
    const boundary = `sahab_${crypto.randomBytes(12).toString('hex')}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    message = `${headers.join('\r\n')}\r\n\r\n` +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n` +
      `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n` +
      `--${boundary}--`;
  } else {
    headers.push('Content-Type: text/plain; charset=UTF-8');
    message = `${headers.join('\r\n')}\r\n\r\n${body}`;
  }

  const raw = base64url(message);
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gmail send HTTP ${response.status}`);
  return data;
}

export async function findReplies({ fromEmail, afterUnix = 0, maxResults = 10 }) {
  if (!fromEmail) return [];
  const token = await getGoogleAccessToken();
  const q = [`from:${fromEmail}`];
  if (afterUnix) q.push(`after:${Math.floor(afterUnix)}`);
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('q', q.join(' '));
  url.searchParams.set('maxResults', String(Math.min(50, maxResults)));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gmail search HTTP ${response.status}`);
  return data.messages || [];
}
