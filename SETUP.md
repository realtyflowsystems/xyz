# RealtyFlow Systems — Infrastructure Setup Guide

Self-hosted revenue operating system. Total monthly cost: ~$0–$5 until $10K MRR.

---

## Stack Summary

| Layer | Tool | Cost |
|---|---|---|
| Frontend | GitHub Pages | Free |
| Backend / DB | Supabase | Free → $25/mo |
| Email | Resend | Free (3k/day) → $20/mo |
| SMS | Twilio (direct) | ~$1–2/mo |
| Payments | Stripe | 2.9% + 30¢ |
| Automation | Supabase Edge Functions | Included |

---

## Step 1 — Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it `realtyflow-systems`, choose US East region, set a DB password
3. Wait ~2 min for provisioning
4. Go to **Settings → API** and copy:
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon/public key** → long JWT string

---

## Step 2 — Run the Database Schema

1. Supabase Dashboard → **SQL Editor** → New Query
2. Paste the entire contents of `supabase/schema.sql`
3. Click **Run**

This creates all tables, views, RLS policies, and seeds the 3-step cold email sequence.

---

## Step 3 — Set Environment Variables (Secrets)

Supabase Dashboard → **Edge Functions** → **Manage Secrets** → Add each:

| Secret Name | Value |
|---|---|
| `RESEND_API_KEY` | From resend.com → API Keys |
| `TWILIO_ACCOUNT_SID` | From twilio.com console |
| `TWILIO_AUTH_TOKEN` | From twilio.com console |
| `TWILIO_PHONE_NUMBER` | Your Twilio number in E.164 format e.g. +16175551234 |
| `STRIPE_SECRET_KEY` | From stripe.com → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Generated in Step 6 |

Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

---

## Step 4 — Deploy Edge Functions

Install Supabase CLI first: `npm install -g supabase`

```bash
# Login
supabase login

# Link to your project (get project-id from dashboard URL)
supabase link --project-ref YOUR_PROJECT_ID

# Deploy all functions
supabase functions deploy booking-create
supabase functions deploy sms-reminder
supabase functions deploy stripe-webhook
supabase functions deploy email-sequence
```

---

## Step 5 — Update Booking Form

Edit `booking.html` and `js/rfs-config.js`, replace:
- `YOUR_PROJECT_ID` → your actual Supabase project ID
- `YOUR_SUPABASE_ANON_KEY` → your anon/public key

Then push to GitHub:
```bash
git add booking.html js/rfs-config.js
git commit -m "Wire booking form to Supabase"
git push
```

The booking form on realtyflow.xyz now routes through Supabase instead of Make.com.

---

## Step 6 — Stripe Webhook

1. Stripe Dashboard → **Developers → Webhooks** → Add endpoint
2. URL: `https://YOUR_PROJECT_ID.supabase.co/functions/v1/stripe-webhook`
3. Select events:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
4. Copy the **Signing secret** → add to Supabase Secrets as `STRIPE_WEBHOOK_SECRET`

---

## Step 7 — SMS Reminder Cron (Optional but High-ROI)

Enable the `pg_cron` and `pg_net` extensions:

Supabase Dashboard → **Database → Extensions** → search and enable:
- `pg_cron`
- `pg_net`

Then run in SQL Editor:

```sql
select cron.schedule(
  'sms-reminder',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/sms-reminder',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  )
  $$
);
```

Get `YOUR_SERVICE_ROLE_KEY` from Supabase → Settings → API → service_role key.

---

## Step 8 — Cold Email Sequence Cron

```sql
select cron.schedule(
  'email-sequence',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/email-sequence',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  )
  $$
);
```

Runs daily at 9 AM UTC. Import contacts via Supabase → Table Editor → sequence_contacts.

---

## Step 9 — Resend Domain Verification

1. [resend.com](https://resend.com) → Domains → Add domain → `realtyflow.xyz`
2. Add the DNS records to GoDaddy:
   - SPF, DKIM, DMARC records (Resend provides exact values)
3. Verify (takes 5–30 min)

This ensures your confirmation emails land in inbox, not spam.

---

## Step 10 — Twilio Setup

1. [twilio.com](https://twilio.com) → Get a Phone Number → pick a 617 or 857 area code
2. Verify your own number for testing
3. If using trial account, verify recipient numbers before going live
4. For MA TCPA compliance, your SMS already includes STOP opt-out in the template

---

## Command Center Access

`https://realtyflow.xyz/command-center.html`

This is your private CRM. Keep the URL unlisted — it's not linked from the public site.
Future version will add Supabase Auth for password protection.

---

## Sequence Contact Import

Add cold outreach targets via Supabase Dashboard → Table Editor → sequence_contacts:

Required columns: `name`, `email`
Optional: `phone`, `company`, `market` (e.g. "Cambridge"), `next_email_at`

Set `next_email_at` to when you want step 1 to send. Leave blank to send on next cron run.

---

## What This Replaces

| Before | After | Savings |
|---|---|---|
| Make.com ($16+/mo) | Supabase Edge Functions | $16+/mo |
| GoHighLevel ($97–$297/mo) | Supabase + your own UI | $97–$297/mo |
| Cal.com hosted | Custom form | $0 |
| GHL SMS markup | Twilio direct (~$0.008/SMS) | ~80% savings |
| GHL email markup | Resend direct | ~90% savings |

**Estimated savings: $110–$315/month**

---

## Support

Questions → erics@realtyflow.xyz
