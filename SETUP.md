# RealtyFlow Systems — Revenue Operating System Setup

## Phase 1: Stack (the lean answer to Make / Twilio / Cal / GHL)

| Need | Tool | Cost | Why |
|---|---|---|---|
| Database + API | Supabase (Free tier) | **$0/mo** | Postgres, Auth, Realtime, Edge Functions in one |
| Transactional email | Resend | **$0/mo** (3K/mo) | Best deliverability, dead-simple API |
| SMS | Twilio | **~$2/mo** | $1 number + $0.008/SMS. 100 SMS = $1.80 |
| Payments | Stripe | **0% monthly** | 2.9% + $0.30 per transaction only |
| Hosting | GitHub Pages (current) | **$0/mo** | Keep what works |
| **Total month 1** | | **~$2/mo** | vs $300+/mo for Make + GHL + Cal + Twilio plans |

Upgrade path: Supabase Pro ($25/mo) unlocks daily backups + 8GB DB. Cross that bridge at $10K MRR.

---

## Phase 2: Architecture

```
FRONTEND (GitHub Pages — realtyflow.xyz)
│
├── booking.html        → POST /functions/v1/booking-create
├── command-center.html → Supabase JS client (real-time pipeline)
├── portal/index.html   → Supabase Auth (token-based, no password)
└── js/rfs-backend.js   → Shared Supabase client + helpers
│
BACKEND (Supabase — your project)
│
├── Database (PostgreSQL)
│   ├── leads              ← core CRM
│   ├── bookings           ← audit appointments
│   ├── emails             ← outbound tracking
│   ├── sms_messages       ← SMS log
│   ├── sequences          ← follow-up configs
│   ├── sequence_steps     ← per-step content
│   ├── sequence_enrollments ← active follow-ups per lead
│   ├── payments           ← Stripe events
│   ├── clients            ← converted leads + portal token
│   ├── activity_log       ← full audit trail
│   └── daily_activity     ← weekly outreach tracker
│
├── Edge Functions (Deno / TypeScript)
│   ├── booking-create     ← replaces Make.com webhook
│   ├── sms-send           ← replaces Zapier → Twilio
│   ├── stripe-webhook     ← payment → client onboarding
│   └── sequence-runner    ← replaces Make.com follow-up flows (cron)
│
└── Realtime
    └── leads table changes → command-center.html auto-updates
```

---

## Phase 3: Implementation Order (highest ROI first)

### Step 1 — Booking → CRM (30 min setup) ← START HERE
Booking form already works. Connect Supabase and you have a real database.
Every booking auto-creates a lead in your pipeline. Zero manual entry.

### Step 2 — Confirmation email (1 hour)
Resend setup + your booking-create function = professional email on every booking.
This alone replaces Make.com for your core use case.

### Step 3 — Stripe payment link (30 min)
Create a product in Stripe. Share the link in your audit follow-up.
The stripe-webhook function auto-creates a client + sends onboarding email.

### Step 4 — SMS reminders (1 hour)
Twilio account + 3 env vars = automated reminders before calls.
Expect 40-60% reduction in no-shows.

### Step 5 — Automated follow-up sequences (already seeded in DB)
sequence-runner runs on cron. Three sequences are pre-loaded:
- Post-Booking Nurture (keeps them warm before the call)
- Post-Audit Follow-up (48h + 96h nudges to close)
- Proposal Follow-up (72h if proposal goes cold)

### Step 6 — Client portal
portal/index.html already exists. Wire it to Supabase using the portal_token
stored in the clients table. No password needed — token = access.

---

## Phase 4: Deployment Steps

### 4.1 Create Supabase Project (5 min)
1. Go to https://supabase.com → New Project
2. Name: `realtyflow-systems` | Region: `us-east-1`
3. Copy **Project URL** and **anon key** from Settings → API
4. Copy **service_role key** (keep secret — only for Edge Functions)

### 4.2 Run the Schema (2 min)
1. Supabase Dashboard → SQL Editor
2. Paste contents of `supabase/schema.sql`
3. Click Run

### 4.3 Configure rfs-backend.js (2 min)
Open `js/rfs-backend.js` and replace:
```js
SUPABASE_URL:  'https://YOUR_PROJECT_REF.supabase.co',
SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
FUNCTIONS_URL: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1',
```

### 4.4 Install Supabase CLI (2 min)
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### 4.5 Set Edge Function env vars (5 min)
```bash
supabase secrets set \
  RESEND_API_KEY="re_xxxx" \
  TWILIO_ACCOUNT_SID="ACxxxx" \
  TWILIO_AUTH_TOKEN="xxxx" \
  TWILIO_FROM_NUMBER="+1XXXXXXXXXX" \
  RFS_FROM_EMAIL="erics@realtyflow.xyz" \
  RFS_REPLY_TO="erics@realtyflow.xyz" \
  STRIPE_SECRET_KEY="sk_live_xxxx" \
  STRIPE_WEBHOOK_SECRET="whsec_xxxx"
```

### 4.6 Deploy Edge Functions (3 min)
```bash
supabase functions deploy booking-create
supabase functions deploy sms-send
supabase functions deploy stripe-webhook
supabase functions deploy sequence-runner
```

### 4.7 Set up sequence-runner cron (5 min)
In Supabase SQL Editor:
```sql
-- Runs sequence-runner every 30 minutes
select cron.schedule(
  'sequence-runner',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sequence-runner',
    headers := '{"Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
  ) as request_id
  $$
);
```

### 4.8 Configure Stripe webhook (3 min)
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`
3. Events: `checkout.session.completed`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`
4. Copy signing secret → add as `STRIPE_WEBHOOK_SECRET` env var

### 4.9 Set up Resend domain (10 min)
1. https://resend.com → Add Domain → realtyflow.xyz
2. Add the 3 DNS records to GoDaddy
3. Verify domain (usually < 5 min propagation)
4. API Keys → Create key → paste in step 4.5

### 4.10 Push updated site to GitHub (1 min)
```bash
git add -A
git commit -m "Connect Supabase backend — replace Make.com/Zapier"
git push origin main
```

---

## Phase 5: Monetization Beyond Your Own Agency

### Tier 1 — Done-For-You Setup (fastest cash)
**Offer:** "I'll build your RFS system" → one-time $2,500–$5,000
**Target:** Other RE agents/teams in Greater Boston
**Delivery:** Fork this repo, swap their branding, point to their Supabase

### Tier 2 — White-Label SaaS ($MRR)
**Offer:** RFS Platform — $297/mo per agent, $997/mo per team
**What they get:** Booking page, CRM pipeline, automated sequences, SMS
**Stack cost per client:** ~$2–5/mo (Supabase + Twilio usage)
**Margin at 10 clients:** $2,970 revenue / ~$50 cost = 98% margin

### Tier 3 — RE Agency Vertical SaaS (the big play)
**Expand to:** Redfin agents, RE/MAX teams, Compass agents nationally
**Positioning:** "GoHighLevel built for real estate, without the $300/mo overhead"
**Price:** $197–$497/mo per seat
**10 clients = $2K/mo | 100 clients = $20K/mo | 500 clients = $100K/mo**

### Tier 4 — API + Embeds (passive)
Package the booking widget as an embeddable script.
Charge $49/mo for agents who just want the booking + CRM sync.

### Tier 5 — Referral/Affiliate (zero work)
- Refer Resend: revenue share
- Refer Supabase Pro: partner program
- Refer Stripe (Atlas): referral fees

---

## Monthly Cost Reference

| Stage | Revenue | Monthly Cost |
|---|---|---|
| Solo (now) | $0–$5K | ~$2/mo |
| 5 clients | $12K+ | ~$15/mo (Supabase Pro) |
| 10 SaaS clients | $3K MRR | ~$40/mo |
| 50 SaaS clients | $15K MRR | ~$150/mo |
| 200 SaaS clients | $60K MRR | ~$500/mo |

This is the point: the infrastructure cost is nearly flat while revenue scales.

---

## Service Credentials Needed

| Service | URL | What to Get |
|---|---|---|
| Supabase | supabase.com | Project URL, anon key, service_role key |
| Resend | resend.com | API key + verify realtyflow.xyz domain |
| Twilio | twilio.com | Account SID, Auth Token, buy a number |
| Stripe | stripe.com | Secret key, webhook signing secret |

Questions? Reply to this file as a comment or open an issue on the repo.
