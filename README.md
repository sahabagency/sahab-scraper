# Sahab X-Ray Lead Engine

Independent outbound lead engine for Sahab Agency.

## What v1 does

1. Accepts an industry + location.
2. Discovers businesses through Google Places.
3. Pulls public website signals and audits conversion/marketing gaps.
4. Produces a transparent opportunity range based on explicit campaign assumptions. It does **not** present estimated revenue leakage as verified fact.
5. Generates a personalized audit-first outreach email and inserts the booking URL.
6. Shows results in a lightweight dashboard.

## Required integrations

- `GOOGLE_MAPS_API_KEY` — lead discovery and business details.
- `OPENAI_API_KEY` — optional AI rewrite/personalization. A deterministic fallback email works without it.
- `CALENDAR_BOOKING_URL` — booking CTA included in outbound.

Copy `.env.example` to `.env`, add values, then run:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## API

- `GET /health`
- `GET /api/config`
- `POST /api/campaigns`
- `GET /api/campaigns`
- `GET /api/campaigns/:id`
- `POST /api/leads/audit`

## Next production steps

The current branch is the working v1 foundation. Before full autonomous sending, add persistent Postgres storage, Gmail OAuth/send queue, contact-email enrichment, suppression/unsubscribe controls, daily limits, bounce tracking, reply detection, and an approval policy for first-touch campaigns.
