# RealtyFlow Systems — Session Memory

## Project Overview
- **Domain:** realtyflow.xyz (GoDaddy)
- **Hosting:** GitHub Pages → repo: realtyflowsystems/xyz
- **Supabase Project:** `realtyflow-systems` — ID: `wufmcymarbkrjzaqapuu` — ACTIVE_HEALTHY
- **Supabase URL:** `https://wufmcymarbkrjzaqapuu.supabase.co`
- **Stripe Account:** `acct_1T5OyWAM1e66iBUi` — "RealtyFlow Systems"
- **Founder:** Erics — solo operator, Cambridge MA
- **Target market:** Real estate agents in Cambridge, Somerville, Newton, Brookline

---

## Actual Database Schema (verified live — May 17, 2026)

### Tables

**`leads`** — everyone who contacts or books
- `id`, `fname`, `lname`, `email` (unique), `phone`
- `source` (default: 'Booking Page')
- `stage` INTEGER (0=New, 1=Contacted, 2=Booked, 3=Audit Done, 4=Proposal, 5=Client, 6=Lost)
- `stage_name` TEXT
- `tier`, `volume`, `sides`, `market`, `db_size`, `notes`
- `opted_out_sms` BOOLEAN
- `created_at`, `updated_at`

**`bookings`** — confirmed Revenue Audit calls
- `id`, `lead_id` (FK→leads)
- `slot_time` TIMESTAMPTZ (NOT `scheduled_at`)
- `duration_minutes` (default 30)
- `status` (default 'confirmed')
- `audit_notes`, `google_event_id`
- `confirmation_sent`, `reminder_24h_sent`, `reminder_1h_sent` BOOLEAN
- `created_at`, `updated_at`

**`emails`** — all sent emails (NOT `email_log`)
- `id`, `lead_id`, `resend_id`
- `subject`, `body_html`
- `type` (default 'transactional')
- `sequence_id` (FK→sequences), `sequence_step`
- `sent_at`, `opened_at`, `clicked_at`, `bounced_at`, `error`

**`sms_messages`** — all sent/received SMS (NOT `sms_log`)
- `id`, `lead_id`, `twilio_sid`
- `direction` (default 'outbound'), `body`, `status`, `type`
- `sent_at`, `error`

**`sequences`** — email/SMS sequence definitions (3 seeded)
- `id`, `name`, `trigger_stage` INTEGER, `active`

**`sequence_steps`** — individual steps per sequence (5 seeded)
- `id`, `sequence_id`, `step_number`
- `delay_hours` (NOT delay_days)
- `channel` ('email' or 'sms')
- `subject`, `body_html`, `body_text`

**`sequence_enrollments`** — tracks each lead's progress through a sequence
- `id`, `lead_id`, `sequence_id`
- `current_step` (0-indexed, starts at 0)
- `next_send_at`, `started_at`, `completed_at`
- `paused`, `cancelled` BOOLEAN

**`clients`** — paid clients
- `id`, `lead_id` (unique), `payment_id` (FK→payments)
- `portal_token` (auto-generated hex, NOT `portal_access_token`)
- `onboarding_stage` INTEGER, `onboarding_stage_name`
- `intake_completed`, `setup_completed` BOOLEAN
- `go_live_date`, `notes`

**`payments`** — Stripe payment records
- `id`, `lead_id`
- `stripe_payment_intent_id` (unique), `stripe_customer_id`, `stripe_checkout_session_id` (unique)
- `amount_cents`, `currency`, `status`, `tier`, `description`

**`activity_log`** — timestamped event log per lead
- `id`, `lead_id`, `type`, `description`, `metadata` JSONB

**`daily_activity`** — manual daily tracking
- `id`, `date` (unique)
- `dms`, `follow_ups`, `replies`, `looms`, `calls`, `closes`, `revenue` (all INT)

### Seeded Sequences
| Sequence | Trigger Stage | Steps |
|---|---|---|
| Post-Booking Nurture | 2 (Booked) | Step 1: Email 1hr (confirmation) · Step 2: SMS 23hr (reminder) |
| Post-Audit Follow-up | 3 (Audit Done) | Step 1: Email 48hr · Step 2: Email 96hr |
| Proposal Follow-up | 4 (Proposal) | Step 1: Email 72hr |

---

## Stripe Products (7 created)
- `prod_UGTKfcdo4ZbJGe` — RFS Revenue Leak Audit
- `prod_U4Lw3U0HgaLyQN` — AI Voice Qualifier Add-On
- `prod_U4LwFj5h2cOBje` — Lead Capture Protection Plan Tier 2
- `prod_U4LwqATFLE75J0` — Lead Capture Protection Plan Tier 1
- `prod_U4Lw74JRodCVvf` — Team Infrastructure Build Setup
- `prod_U4Lv4qUywy4JGy` — Revenue Acceleration Build Setup
- `prod_U4Lv9gBQA2VHcK` — Core Speed System Setup

---

## Edge Functions (written, NOT yet deployed)

| Function | File | Status |
|---|---|---|
| `booking-create` | `supabase/functions/booking-create/index.ts` | Ready to deploy |
| `sequence-runner` | `supabase/functions/sequence-runner/index.ts` | Ready to deploy |
| `stripe-webhook` | `supabase/functions/stripe-webhook/index.ts` | Ready to deploy |

Note: `sms-reminder` and `email-sequence` are **obsolete** — replaced by `sequence-runner`.

---

## RLS Policy Status
- `leads`: ✅ `anon_insert_leads` policy applied live (May 17, 2026)
- All other tables: service_role bypasses RLS (Edge Functions use service_role key)

---

## Key Config Details
- `booking.html` sends to: `https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/booking-create`
- Anon key still needed in `booking.html` and `js/rfs-config.js` (`YOUR_SUPABASE_ANON_KEY` placeholder)
- `booking-create`: `verify_jwt = false` (public endpoint)
- `stripe-webhook`: `verify_jwt = false` (Stripe calls directly)
- `sequence-runner`: `verify_jwt = true` (cron-triggered with service_role key)

---

## Tomorrow's To-Do List

### Blocking Go-Live (do these first)
- [ ] Get Supabase anon key → Dashboard → Settings → API → anon/public key
- [ ] Replace `YOUR_SUPABASE_ANON_KEY` in `booking.html` and `js/rfs-config.js`
- [ ] Deploy 3 edge functions:
  ```bash
  supabase link --project-ref wufmcymarbkrjzaqapuu
  supabase functions deploy booking-create
  supabase functions deploy sequence-runner
  supabase functions deploy stripe-webhook
  ```
- [ ] Add secrets in Supabase Dashboard → Edge Functions → Manage Secrets:
  - `RESEND_API_KEY`
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER` (E.164 format, e.g. +16175551234)
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET` (generated when adding webhook in Stripe)

### Setup & Verification
- [ ] Verify Resend domain — resend.com → Domains → realtyflow.xyz → add DNS records to GoDaddy
- [ ] Configure Stripe webhook → Developers → Webhooks → Add endpoint:
  - URL: `https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/stripe-webhook`
  - Event: `checkout.session.completed`
- [ ] Enable pg_cron + pg_net in Supabase → Database → Extensions
- [ ] Schedule sequence-runner cron (run in SQL Editor):
  ```sql
  select cron.schedule('sequence-runner', '*/30 * * * *',
    $$select net.http_post(
      url:='https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/sequence-runner',
      headers:='{"Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
    )$$
  );
  ```
- [ ] Test end-to-end: submit booking form → check `leads` table in Supabase → confirm email received

### Next Dev Work
- [ ] Upgrade `command-center.html` — replace localStorage with Supabase real-time data
- [ ] Gate `portal/index.html` — validate `portal_token` query param against `clients` table
- [ ] Add time slot picker to `booking.html`
- [ ] Create Stripe prices for existing products (products exist, prices needed for checkout)

---

## Monthly Cost Summary
| Tool | Cost |
|---|---|
| GitHub Pages | $0 |
| Supabase (free tier) | $0 |
| Resend (free tier, 3k/day) | $0 |
| Twilio (~$0.008/SMS) | ~$1–2/mo |
| Stripe | 2.9% + 30¢/transaction |
| **Total fixed** | **~$1–2/mo** |
