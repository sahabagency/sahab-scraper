const url = () => process.env.SUPABASE_URL || '';
const apiKey = () => process.env.SUPABASE_ANON_KEY || '';
const token = () => process.env.LEAD_ENGINE_DB_TOKEN || '';

export function dbConfigured() {
  return Boolean(url() && apiKey() && token());
}

async function rpc(name, payload = {}) {
  if (!dbConfigured()) throw new Error('Lead DB is not configured');
  const response = await fetch(`${url()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: apiKey(),
      authorization: `Bearer ${apiKey()}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ p_token: token(), ...payload }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.error || `Supabase RPC ${name} HTTP ${response.status}`);
  return data;
}

export async function saveCampaign(campaign) {
  return rpc('lead_engine_save_campaign', { p_campaign: campaign });
}

export async function saveLead(campaignId, lead) {
  return rpc('lead_engine_save_lead', { p_campaign_id: campaignId, p_lead: lead });
}

export async function getCampaign(id) {
  return rpc('lead_engine_get_campaign', { p_campaign_id: id });
}

export async function listCampaigns(limit = 50) {
  return rpc('lead_engine_list_campaigns', { p_limit: limit });
}

export async function dbStatus() {
  return rpc('lead_engine_status');
}

export async function claimSend(leadId, dailyLimit = 10) {
  return rpc('lead_engine_claim_send', { p_lead_id: leadId, p_daily_limit: dailyLimit });
}

export async function markSent(leadId, messageId, threadId = null) {
  return rpc('lead_engine_mark_sent', { p_lead_id: leadId, p_message_id: messageId, p_thread_id: threadId });
}

export async function markSendFailed(leadId, error) {
  return rpc('lead_engine_mark_send_failed', { p_lead_id: leadId, p_error: String(error || 'unknown error') });
}

export async function markReplied(leadId, messageId = null) {
  return rpc('lead_engine_mark_replied', { p_lead_id: leadId, p_message_id: messageId });
}

export async function markBooked(leadId, eventId = null, startAt = null) {
  return rpc('lead_engine_mark_booked', { p_lead_id: leadId, p_event_id: eventId, p_start_at: startAt });
}

export async function dueFollowups(limit = 20) {
  return rpc('lead_engine_due_followups', { p_limit: limit });
}

export async function replyCandidates(limit = 100) {
  return rpc('lead_engine_reply_candidates', { p_limit: limit });
}

export async function bookingCandidates(limit = 200) {
  return rpc('lead_engine_booking_candidates', { p_limit: limit });
}

export async function suppressEmail(email, reason = 'manual') {
  return rpc('lead_engine_suppress', { p_email: email, p_reason: reason });
}
