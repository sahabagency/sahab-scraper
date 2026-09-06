import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { discoverLeads } from './src/discover.js';
import { enrichLeadContact } from './src/enrich.js';
import { auditLead } from './src/audit.js';
import { buildOutreach } from './src/outreach.js';
import { createGoogleAuthUrl, exchangeGoogleCode, gmailStatus, verifyGmailConnection, sendGmail, findReplies } from './src/gmail.js';
import { outboundPolicy, outboundRuntimeStatus } from './src/outboundGuard.js';
import { dbConfigured, saveCampaign, saveLead, getCampaign, listCampaigns, dbStatus, claimSend, markSent, markSendFailed, markReplied, dueFollowups, replyCandidates, suppressEmail } from './src/db.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const campaigns = new Map();

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Sahab X-Ray Lead Engine', persistence: dbConfigured() ? 'supabase' : 'memory', now: new Date().toISOString() });
});

app.get('/api/config', async (_req, res) => {
  const gmail = gmailStatus();
  let persistenceStats = null;
  if (dbConfigured()) {
    try { persistenceStats = await dbStatus(); } catch (error) { persistenceStats = { error: error.message }; }
  }
  res.json({
    googlePlacesReady: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    openAiReady: Boolean(process.env.OPENAI_API_KEY),
    bookingUrlReady: Boolean(process.env.CALENDAR_BOOKING_URL),
    webDiscoveryReady: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    gmailOauthReady: gmail.oauthConfigured,
    gmailConnected: gmail.connected,
    persistenceReady: dbConfigured(),
    persistenceStats,
    bookingUrl: process.env.CALENDAR_BOOKING_URL || '',
    outbound: { ...outboundRuntimeStatus(), persistence: dbConfigured() ? 'supabase' : 'memory_only' }
  });
});

app.get('/api/gmail/verify', async (_req, res) => {
  try {
    const profile = await verifyGmailConnection();
    res.json({ ok: true, connected: true, emailAddress: profile.emailAddress });
  } catch (error) {
    res.status(400).json({ ok: false, connected: false, error: error.message || 'Gmail verification failed' });
  }
});

app.get('/auth/google', (_req, res) => {
  try { res.redirect(createGoogleAuthUrl()); }
  catch (error) { res.status(500).send(`Gmail OAuth setup error: ${String(error.message || error)}`); }
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const tokens = await exchangeGoogleCode({ code: req.query.code, state: req.query.state });
    const refreshToken = tokens.refresh_token;
    const safeToken = String(refreshToken).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gmail connected</title><style>body{font-family:Arial,sans-serif;background:#111;color:#f5f0df;padding:40px}.card{max-width:760px;margin:auto;background:#1b1a16;border:1px solid #4b4638;border-radius:20px;padding:28px}textarea{width:100%;min-height:110px;background:#0d0d0c;color:#f5f0df;border:1px solid #5b5443;border-radius:12px;padding:12px}code{color:#e9c65a}</style></head><body><div class="card"><h1>Gmail OAuth approved</h1><p>الربط نجح. عشان يظل النظام شغال بعد أي Restart، انسخ القيمة التالية مرة واحدة وحطها في Railway باسم <code>GMAIL_REFRESH_TOKEN</code>. لا ترسلها في المحادثة.</p><textarea readonly onclick="this.select()">${safeToken}</textarea><p>بعد إضافتها في Railway وحفظها، ارجع للواجهة.</p></div></body></html>`);
  } catch (error) {
    res.status(400).type('html').send(`<h2>Gmail OAuth failed</h2><pre>${String(error.message || error)}</pre>`);
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const { name, industry, location, limit = 20, averageTicket = 2500, monthlyLeadEstimate = 40, bookingUrl = process.env.CALENDAR_BOOKING_URL || '' } = req.body || {};
    if (!industry || !location) return res.status(400).json({ error: 'industry and location are required' });

    const id = crypto.randomUUID();
    const campaign = {
      id,
      name: name || `${industry} — ${location}`,
      industry,
      location,
      bookingUrl,
      averageTicket: Number(averageTicket) || 2500,
      monthlyLeadEstimate: Number(monthlyLeadEstimate) || 40,
      status: 'discovering',
      createdAt: new Date().toISOString(),
      leads: []
    };
    campaigns.set(id, campaign);
    if (dbConfigured()) await saveCampaign(campaign);

    const rawLeads = await discoverLeads({ industry, location, limit: Math.min(Number(limit) || 20, 60) });
    campaign.status = 'auditing';
    if (dbConfigured()) await saveCampaign(campaign);

    const audited = [];
    for (const rawLead of rawLeads) {
      const lead = await enrichLeadContact(rawLead, { location });
      const audit = await auditLead(lead, { averageTicket: campaign.averageTicket, monthlyLeadEstimate: campaign.monthlyLeadEstimate });
      const outreach = await buildOutreach({ lead, audit, bookingUrl: campaign.bookingUrl, industry, location });
      const fullLead = { ...lead, audit, outreach, status: lead.contactEmail ? 'ready_to_send' : 'needs_contact' };
      if (dbConfigured()) fullLead.id = await saveLead(campaign.id, fullLead);
      audited.push(fullLead);
    }

    campaign.leads = audited;
    campaign.status = 'ready';
    if (dbConfigured()) await saveCampaign(campaign);
    res.json(campaign);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Campaign failed' });
  }
});

app.get('/api/campaigns', async (_req, res) => {
  try {
    if (dbConfigured()) return res.json(await listCampaigns());
    res.json(Array.from(campaigns.values()).map(c => ({ id: c.id, name: c.name, industry: c.industry, location: c.location, status: c.status, createdAt: c.createdAt, leadCount: c.leads.length })));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/campaigns/:id', async (req, res) => {
  try {
    if (dbConfigured()) {
      const campaign = await getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
      return res.json(campaign);
    }
    const campaign = campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/leads/audit', async (req, res) => {
  try {
    const inputLead = req.body?.lead;
    if (!inputLead?.website && !inputLead?.name) return res.status(400).json({ error: 'lead.name or lead.website is required' });
    const location = req.body?.location || '';
    const lead = await enrichLeadContact(inputLead, { location });
    const audit = await auditLead(lead, req.body?.assumptions || {});
    const outreach = await buildOutreach({ lead, audit, bookingUrl: req.body?.bookingUrl || process.env.CALENDAR_BOOKING_URL || '', industry: req.body?.industry || '', location });
    res.json({ lead, audit, outreach });
  } catch (error) { res.status(500).json({ error: error.message || 'Audit failed' }); }
});

app.post('/api/leads/:id/send', async (req, res) => {
  const policy = outboundPolicy();
  if (!dbConfigured()) return res.status(503).json({ ok: false, error: 'persistent database required before sending' });
  if (!policy.enabled) return res.status(403).json({ ok: false, error: 'outbound_disabled' });
  if (policy.requireReview && req.body?.approved !== true) return res.status(409).json({ ok: false, error: 'review_required' });

  let claim = null;
  try {
    claim = await claimSend(req.params.id, policy.dailyLimit);
    if (!claim?.ok) return res.status(409).json(claim);
    const sent = await sendGmail({ to: claim.email, subject: claim.subject, body: claim.body });
    await markSent(req.params.id, sent.id, sent.threadId || null);
    res.json({ ok: true, leadId: req.params.id, messageId: sent.id, threadId: sent.threadId || null });
  } catch (error) {
    if (claim?.ok) await markSendFailed(req.params.id, error.message).catch(() => {});
    res.status(500).json({ ok: false, error: error.message || 'send failed' });
  }
});

app.post('/api/leads/suppress', async (req, res) => {
  try {
    if (!dbConfigured()) return res.status(503).json({ ok: false, error: 'persistent database required' });
    if (!req.body?.email) return res.status(400).json({ ok: false, error: 'email required' });
    await suppressEmail(req.body.email, req.body.reason || 'manual');
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.post('/api/automation/check-replies', async (_req, res) => {
  try {
    if (!dbConfigured()) return res.status(503).json({ ok: false, error: 'persistent database required' });
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
    res.json({ ok: true, checked: candidates?.length || 0, repliesDetected: replies.length, replies, followupsDue: followups?.length || 0, followups });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.get('/api/system/status', async (_req, res) => {
  try {
    res.json({ ok: true, persistence: dbConfigured() ? await dbStatus() : null, outbound: { ...outboundRuntimeStatus(), persistence: dbConfigured() ? 'supabase' : 'memory_only' } });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function runStartupSelfTest() {
  if (process.env.RUN_SELF_TEST !== '1') return;
  const startedAt = Date.now();
  try {
    console.log('[SELFTEST] starting Riyadh aesthetic clinics dry-run (no email send)');
    const location = 'Riyadh, Saudi Arabia';
    const leads = await discoverLeads({ industry: 'aesthetic clinics', location, limit: 3 });
    const results = [];
    for (const rawLead of leads) {
      const lead = await enrichLeadContact(rawLead, { location });
      const audit = await auditLead(lead, { averageTicket: 2500, monthlyLeadEstimate: 40 });
      const outreach = await buildOutreach({ lead, audit, bookingUrl: process.env.CALENDAR_BOOKING_URL || '', industry: 'aesthetic clinics', location });
      results.push({ name: lead.name, website: lead.website || null, contactEmail: lead.contactEmail || null, contactRoute: lead.contactRoute || null, rating: lead.rating || null, score: audit.score, opportunity: audit.opportunity?.annualRange || null, generatedBy: outreach.generatedBy || null, subject: outreach.subject, bookingLinkIncluded: Boolean(process.env.CALENDAR_BOOKING_URL && outreach.body?.includes(process.env.CALENDAR_BOOKING_URL)) });
    }
    console.log('[SELFTEST] SUCCESS ' + JSON.stringify({ count: results.length, durationMs: Date.now() - startedAt, results }));
  } catch (error) { console.error('[SELFTEST] FAILED ' + JSON.stringify({ durationMs: Date.now() - startedAt, error: error?.message || String(error) })); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sahab X-Ray Lead Engine listening on :${PORT}`);
  runStartupSelfTest();
});
