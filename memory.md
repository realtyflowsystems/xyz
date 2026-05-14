# RealtyFlow Systems — Session Memory

## Project Overview
- **Domain:** realtyflow.xyz (GoDaddy)
- **Hosting:** GitHub Pages → repo: realtyflowsystems/xyz
- **Supabase Project ID:** wufmcymarbkrjzaqapuu
- **Supabase Preview Branch (PR #3):** evwhptpedqirlqafljbd (merged, no longer active)
- **Founder:** Erics — solo operator, Cambridge MA
- **Target market:** Real estate agents in Cambridge, Somerville, Newton, Brookline

---

## Session: May 14, 2026

### What We Built (PR #3 — merged to main)

Full self-hosted revenue operating system replacing Make.com, GoHighLevel, and Twilio markup.

| File | Purpose |
|---|---|
| `supabase/schema.sql` | Human-readable schema reference |
| `supabase/migrations/20260514000000_initial_schema.sql` | Supabase-deployable migration (tables, views, RLS, triggers, seeded 3-step email sequence) |
| `supabase/config.toml` | Project config — edge function JWT settings |
| `supabase/functions/booking-create/index.ts` | Replaces Make.com webhook — logs lead + sends Resend confirmation email |
| `supabase/functions/sms-reminder/index.ts` | pg_cron every 5min — Twilio SMS 1hr before confirmed calls |
| `supabase/functions/stripe-webhook/index.ts` | Payment → create client record → send onboarding email with portal token |
| `supabase/functions/email-sequence/index.ts` | Daily cron cold outbound engine, 3-step default sequence, {{name}}/{{market}} vars |
| `booking.html` | Rerouted from Make.com to Supabase Edge Function |
| `js/rfs-config.js` | Shared Supabase client config — project URL set, anon key still needed |
| `SETUP.md` | Full 10-step deployment guide |

### Database Tables Created
- `leads` — everyone who books or is contacted
- `bookings` — confirmed Revenue Audit calls
- `email_log` — all sent emails with Resend IDs
- `sms_log` — all sent SMS with Twilio SIDs
- `sequence_contacts` — cold outbound targets
- `sequence_steps` — email templates (3 seeded)
- `clients` — paid clients (auto-created on Stripe payment)
- `payments` — Stripe payment records
- Views: `pipeline_view`, `analytics_summary`

### Existing Pages (untouched)
- `index.html` — main landing page
- `booking.html` — Revenue Audit booking form (now wired to Supabase)
- `command-center.html` — internal CRM dashboard (still uses localStorage — needs Supabase upgrade)
- `portal/index.html` — client onboarding portal (still static — needs Supabase auth)
- `offer-comparison/index.html`
- `terms/index.html`, `privacy/index.html`

---

## Tomorrow's To-Do List

### Immediate (required before anything goes live)
- [ ] **Get Supabase anon key** — Dashboard → Settings → API → anon/public key
- [ ] **Update `booking.html`** — replace `YOUR_SUPABASE_ANON_KEY`
- [ ] **Update `js/rfs-config.js`** — replace `YOUR_SUPABASE_ANON_KEY`
- [ ] **Deploy edge functions** via Supabase CLI:
  ```bash
  supabase link --project-ref wufmcymarbkrjzaqapuu
  supabase functions deploy booking-create
  supabase functions deploy sms-reminder
  supabase functions deploy stripe-webhook
  supabase functions deploy email-sequence
  ```
- [ ] **Add secrets** in Supabase Dashboard → Edge Functions → Manage Secrets:
  - `RESEND_API_KEY`
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`

### Setup & Verification
- [ ] **Verify Resend domain** — resend.com → Domains → add realtyflow.xyz → add SPF/DKIM/DMARC to GoDaddy DNS
- [ ] **Configure Stripe webhook** — point to `https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/stripe-webhook`, events: `checkout.session.completed` + `payment_intent.succeeded`
- [ ] **Enable pg_cron + pg_net extensions** in Supabase → Database → Extensions
- [ ] **Schedule SMS cron** — run the SQL from SETUP.md Step 7
- [ ] **Schedule email sequence cron** — run the SQL from SETUP.md Step 8
- [ ] **Test end-to-end** — submit booking.html form → confirm lead appears in Supabase `leads` table + confirmation email received

### Phase 4 Continued (next dev sessions)
- [ ] **Upgrade command-center.html** — replace localStorage with Supabase real-time data (pipeline, analytics)
- [ ] **Upgrade portal/index.html** — add Supabase auth token validation so portal is actually gated
- [ ] **Add time slot picker to booking.html** — let prospects self-select from available windows
- [ ] **Import first cold outreach contacts** — Supabase → Table Editor → sequence_contacts

---

## Cost Summary (current)
| Tool | Monthly |
|---|---|
| GitHub Pages | $0 |
| Supabase (free tier) | $0 |
| Resend (free tier) | $0 |
| Twilio (per SMS ~$0.008) | ~$1–2 |
| Stripe | 2.9% + 30¢ per transaction |
| **Total fixed** | **~$1–2/mo** |

Previously paying: Make.com + GoHighLevel = $110–$315/mo
