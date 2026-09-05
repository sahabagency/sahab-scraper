import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { discoverLeads } from './src/discover.js';
import { enrichLeadContact } from './src/enrich.js';
import { auditLead } from './src/audit.js';
import { buildOutreach } from './src/outreach.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const campaigns = new Map();

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Sahab X-Ray Lead Engine', now: new Date().toISOString() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    googlePlacesReady: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    openAiReady: Boolean(process.env.OPENAI_API_KEY),
    bookingUrlReady: Boolean(process.env.CALENDAR_BOOKING_URL),
    webDiscoveryReady: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    bookingUrl: process.env.CALENDAR_BOOKING_URL || ''
  });
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const {
      name,
      industry,
      location,
      limit = 20,
      averageTicket = 2500,
      monthlyLeadEstimate = 40,
      bookingUrl = process.env.CALENDAR_BOOKING_URL || ''
    } = req.body || {};

    if (!industry || !location) {
      return res.status(400).json({ error: 'industry and location are required' });
    }

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

    const rawLeads = await discoverLeads({ industry, location, limit: Math.min(Number(limit) || 20, 60) });
    campaign.status = 'auditing';

    const audited = [];
    for (const rawLead of rawLeads) {
      const lead = await enrichLeadContact(rawLead, { location });
      const audit = await auditLead(lead, {
        averageTicket: campaign.averageTicket,
        monthlyLeadEstimate: campaign.monthlyLeadEstimate
      });
      const outreach = await buildOutreach({
        lead,
        audit,
        bookingUrl: campaign.bookingUrl,
        industry,
        location
      });
      audited.push({ ...lead, audit, outreach, status: lead.contactRoute?.destination ? 'ready_to_send' : 'needs_contact' });
    }

    campaign.leads = audited;
    campaign.status = 'ready';
    res.json(campaign);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Campaign failed' });
  }
});

app.get('/api/campaigns', (_req, res) => {
  res.json(Array.from(campaigns.values()).map(c => ({
    id: c.id,
    name: c.name,
    industry: c.industry,
    location: c.location,
    status: c.status,
    createdAt: c.createdAt,
    leadCount: c.leads.length
  })));
});

app.get('/api/campaigns/:id', (req, res) => {
  const campaign = campaigns.get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

app.post('/api/leads/audit', async (req, res) => {
  try {
    const inputLead = req.body?.lead;
    if (!inputLead?.website && !inputLead?.name) return res.status(400).json({ error: 'lead.name or lead.website is required' });
    const location = req.body?.location || '';
    const lead = await enrichLeadContact(inputLead, { location });
    const audit = await auditLead(lead, req.body?.assumptions || {});
    const outreach = await buildOutreach({
      lead,
      audit,
      bookingUrl: req.body?.bookingUrl || process.env.CALENDAR_BOOKING_URL || '',
      industry: req.body?.industry || '',
      location
    });
    res.json({ lead, audit, outreach });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Audit failed' });
  }
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
      const outreach = await buildOutreach({
        lead,
        audit,
        bookingUrl: process.env.CALENDAR_BOOKING_URL || '',
        industry: 'aesthetic clinics',
        location
      });
      results.push({
        name: lead.name,
        website: lead.website || null,
        contactEmail: lead.contactEmail || null,
        contactRoute: lead.contactRoute || null,
        discoveryProvider: lead.discovery?.webProvider || null,
        rating: lead.rating || null,
        score: audit.score,
        opportunity: audit.opportunity?.annualRange || null,
        breakdown: audit.opportunityBreakdown || [],
        generatedBy: outreach.generatedBy || null,
        subject: outreach.subject,
        bodyPreview: String(outreach.body || '').slice(0, 320),
        bookingLinkIncluded: Boolean(process.env.CALENDAR_BOOKING_URL && outreach.body?.includes(process.env.CALENDAR_BOOKING_URL))
      });
    }
    console.log('[SELFTEST] SUCCESS ' + JSON.stringify({ count: results.length, durationMs: Date.now() - startedAt, results }));
  } catch (error) {
    console.error('[SELFTEST] FAILED ' + JSON.stringify({ durationMs: Date.now() - startedAt, error: error?.message || String(error), stack: error?.stack }));
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sahab X-Ray Lead Engine listening on :${PORT}`);
  runStartupSelfTest();
});
