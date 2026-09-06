import { findReplies } from './gmail.js';
import { dbConfigured, replyCandidates, markReplied, dueFollowups } from './db.js';

let running = false;
let lastRunAt = null;
let lastResult = null;
let lastError = null;

export async function runReplyAndFollowupCheck() {
  if (!dbConfigured()) return { ok: false, skipped: true, reason: 'db_not_configured' };
  if (running) return { ok: false, skipped: true, reason: 'already_running' };
  running = true;
  const startedAt = new Date();
  try {
    const candidates = await replyCandidates(200);
    const replies = [];
    for (const lead of candidates || []) {
      const afterUnix = lead.sentAt ? Math.floor(new Date(lead.sentAt).getTime() / 1000) : 0;
      const found = await findReplies({ fromEmail: lead.email, afterUnix, maxResults: 5 });
      if (found.length) {
        await markReplied(lead.id, found[0].id || null);
        replies.push({ leadId: lead.id, email: lead.email, messageId: found[0].id || null });
      }
    }
    const followups = await dueFollowups(50);
    lastRunAt = new Date().toISOString();
    lastResult = {
      ok: true,
      checked: candidates?.length || 0,
      repliesDetected: replies.length,
      replies,
      followupsDue: followups?.length || 0,
      followups,
      durationMs: Date.now() - startedAt.getTime()
    };
    lastError = null;
    return lastResult;
  } catch (error) {
    lastRunAt = new Date().toISOString();
    lastError = error.message || String(error);
    throw error;
  } finally {
    running = false;
  }
}

export function automationStatus() {
  return { running, lastRunAt, lastResult, lastError };
}

export function startAutomationLoop() {
  const intervalMs = Math.max(60 * 60 * 1000, Number(process.env.AUTOMATION_INTERVAL_MS || 60 * 60 * 1000));
  const timer = setInterval(() => {
    runReplyAndFollowupCheck().then(result => {
      if (!result?.skipped) console.log('[AUTOMATION] reply/followup check', JSON.stringify({ checked: result.checked, repliesDetected: result.repliesDetected, followupsDue: result.followupsDue }));
    }).catch(error => console.error('[AUTOMATION] check failed', error.message || error));
  }, intervalMs);
  timer.unref?.();
  return timer;
}
