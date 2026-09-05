import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { discoverLeads } from './src/discover.js';
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
    for (const lead of rawLeads) {
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
      audited.push({ ...lead, audit, outreach, status: 'ready' });
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
    const lead = req.body?.lead;
    if (!lead?.website) return res.status(400).json({ error: 'lead.website is required' });
    const audit = await auditLead(lead, req.body?.assumptions || {});
    const outreach = await buildOutreach({
      lead,
      audit,
      bookingUrl: req.body?.bookingUrl || process.env.CALENDAR_BOOKING_URL || ''
    });
    res.json({ lead, audit, outreach });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Audit failed' });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sahab X-Ray Lead Engine listening on :${PORT}`));
