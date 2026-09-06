import { getGoogleAccessToken } from './gmail.js';

export async function verifyCalendarConnection() {
  const token = await getGoogleAccessToken();
  const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Calendar verify HTTP ${response.status}`);
  return { ok: true };
}

export async function findCalendarBookingByEmail({ email, timeMin, timeMax }) {
  if (!email) return null;
  const token = await getGoogleAccessToken();
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '100');
  url.searchParams.set('timeMin', timeMin || new Date(Date.now() - 30 * 86400000).toISOString());
  url.searchParams.set('timeMax', timeMax || new Date(Date.now() + 90 * 86400000).toISOString());
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Calendar events HTTP ${response.status}`);
  const target = String(email).trim().toLowerCase();
  return (data.items || []).find(event => (event.attendees || []).some(a => String(a.email || '').toLowerCase() === target)) || null;
}
