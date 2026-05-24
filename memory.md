# RealtyFlow Systems — Session Memory

_Last updated: May 24, 2026 (session 7)_

---

## Project Overview

| Field | Value |
|---|---|
| Domain | realtyflow.xyz (GoDaddy) |
| Hosting | GitHub Pages → `realtyflowsystems/xyz` (main branch) |
| Supabase Project | `realtyflow-systems` · ID: `wufmcymarbkrjzaqapuu` · ACTIVE_HEALTHY |
| Supabase URL | `https://wufmcymarbkrjzaqapuu.supabase.co` |
| Stripe Account | `acct_1T5OyWAM1e66iBUi` — "RealtyFlow Systems" |
| Founder | Erics · solo operator · 820 Massachusetts Ave, Cambridge MA |
| Target market | Real estate agents in Cambridge, Somerville, Newton, Brookline |
| Dev email | erics@realtyflow.xyz |

---

## System Architecture

Self-owned stack replacing Make.com + GoHighLevel + Cal.com:

- **Frontend:** Static HTML/CSS/JS on GitHub Pages
- **Database/Auth:** Supabase PostgreSQL + Supabase Auth
- **Backend logic:** Supabase Edge Functions (Deno/TypeScript)
- **Email:** Resend (domain `realtyflow.xyz` — verified ✅)
- **SMS:** Telnyx (migrated from Twilio)
- **Payments:** Stripe (webhook → edge function)
- **Scheduling:** pg_cron + pg_net (sequence-runner fires every 30 min)

---

## Website Pages (all tracked in git)

| URL | File | Description |
|---|---|---|
| `/` | `index.html` | Main landing page (ROI Calculator + exit-intent modal) |
| `/booking` | `booking/index.html` | Revenue Audit booking form |
| `/command-center` | `command-center.html` | Internal CRM dashboard (auth-gated) |
| `/portal` | `portal/index.html` | Client portal (token-gated, live milestone stepper) |
| `/intake` | `intake/index.html` | Self-serve audit intake form (reads `?token=`) |
| `/offer-comparison` | `offer-comparison/index.html` | Offer comparison page |
| `/audit` | `audit/index.html` | Revenue Leak Audit page |
| `/thank-you` | `thank-you/index.html` | Post-payment confirmation (personalized via Stripe session) |
| `/privacy` | `privacy/index.html` | Privacy policy |
| `/terms` | `terms/index.html` | Terms of service |
| `/404` | `404.html` | 404 page |

---

## Database Schema (verified live)

**`leads`** — everyone who contacts or books
- `id` UUID, `fname`, `lname`, `email` (UNIQUE), `phone`
- `source` (default: 'Booking Page')
- `stage` INT: 0=New, 1=Contacted, 2=Booked, 3=Audit Done, 4=Proposal, 5=Client, 6=Lost
- `stage_name` TEXT
- `tier`, `volume`, `sides`, `market`, `db_size`, `notes`
- `opted_out_sms` BOOLEAN (default false)
- `created_at`, `updated_at`

**`bookings`** — confirmed Revenue Audit calls
- `id`, `lead_id` (FK→leads)
- `slot_time` TIMESTAMPTZ (nullable — null = "we'll reach out within 24 hrs")
- `duration_minutes` (default 30), `status` (default 'confirmed')
- `audit_notes`, `google_event_id`
- `confirmation_sent`, `reminder_24h_sent`, `reminder_1h_sent` BOOLEAN

**`emails`** — all sent emails
- `id`, `lead_id`, `resend_id`
- `subject`, `body_html`, `type` (default 'transactional')
- `sequence_id` (FK→sequences), `sequence_step`
- `sent_at`, `opened_at`, `clicked_at`, `bounced_at`, `error`

**`sms_messages`** — all sent/received SMS
- `id`, `lead_id`, `telnyx_message_id`
- `direction` (default 'outbound'), `body`, `status`, `type`
- `sent_at`, `error`

**`sequences`** — sequence definitions (3 seeded)
- `id`, `name`, `trigger_stage` INT, `active`

**`sequence_steps`** — steps per sequence (5 seeded)
- `id`, `sequence_id`, `step_number`
- `delay_hours`, `channel` ('email' or 'sms')
- `subject`, `body_html`, `body_text`

**`sequence_enrollments`** — per-lead sequence progress
- `id`, `lead_id`, `sequence_id`
- `current_step` (step last completed, starts at 0)
- `next_send_at`, `started_at`, `completed_at`
- `paused`, `cancelled` BOOLEAN

**`payments`** — Stripe payment records
- `id`, `lead_id`
- `stripe_payment_intent_id` (UNIQUE), `stripe_customer_id`
- `stripe_checkout_session_id` (UNIQUE)
- `amount_cents`, `currency`, `status`, `tier`, `description`

**`clients`** — paid clients
- `id`, `lead_id` (UNIQUE), `payment_id` (FK→payments)
- `portal_token` (auto-generated 64-char hex via `encode(gen_random_bytes(32),'hex')`)
- `onboarding_stage` INT, `onboarding_stage_name`
- `intake_completed`, `setup_completed` BOOLEAN
- `go_live_date`, `notes`

**`activity_log`** — event log per lead
- `id`, `lead_id`, `type`, `description`, `metadata` JSONB

**`sequence_contacts`** — exit-intent email capture
- `id`, `email` (UNIQUE), `source`, `status`, `next_email_at`

**`chat_settings`** — key/value config for chat widget
- `key` (PK), `value`
- Seeded: `auto_reply_enabled`, `auto_reply_delay_minutes`, `auto_reply_message`

**`teams`** — real estate team groupings (outreach targets)
- `id`, `team_name`, `market`, `team_size`, `primary_agent_id`

**`agents`** — outreach contacts (separate from inbound leads)
- `id`, `name`, `email` (UNIQUE), `phone`, `team_id`, `is_primary`
- `zillow_url`, `instagram`, `status` (pending/sent/replied/qualified/closed/locked), `notes`

**`outreach_log`** — outreach activity tracking
- `id`, `agent_id`, `team_id`, `contact_method` (sms/email/dm/call/other)
- `contacted_at`, `status`, `locked`, `notes`

**`daily_activity`** — manual daily tracking
- `id`, `date` (UNIQUE)
- `dms`, `follow_ups`, `replies`, `looms`, `calls`, `closes`, `revenue` (all INT)

**`chat_sessions`** — live chat sessions
- `id`, `session_key` (UUID, used by widget as identifier)
- `visitor_name`, `visitor_email`, `status` ('open'/'closed')
- `last_seen_at` (updated on every poll — used to detect offline visitors)
- `last_message_at`, `created_at`

**`chat_messages`** — live chat messages
- `id`, `session_id` (FK→chat_sessions), `sender` ('visitor'/'agent'), `body`, `created_at`

### Seeded Sequences

| Sequence | Trigger Stage | Steps |
|---|---|---|
| Post-Booking Nurture | 2 (Booked) | Step 1: Email @ 1hr · Step 2: SMS @ 23hr |
| Post-Audit Follow-up | 3 (Audit Done) | Step 1: Email @ 48hr · Step 2: Email @ 96hr |
| Proposal Follow-up | 4 (Proposal) | Step 1: Email @ 72hr |

### RLS Policies (all applied)

| Table | Role | Permission |
|---|---|---|
| `leads` | `anon` | INSERT only (booking form) |
| all tables | `authenticated` | ALL (command center) |
| all tables | `service_role` | bypasses RLS (edge functions) |

---

## Edge Functions (all ACTIVE)

| Function | File | JWT | Purpose |
|---|---|---|---|
| `booking-create` | `supabase/functions/booking-create/index.ts` | off | Public booking endpoint |
| `sequence-runner` | `supabase/functions/sequence-runner/index.ts` | on | Processes due email/SMS steps |
| `stripe-webhook` | `supabase/functions/stripe-webhook/index.ts` | off | Handles `checkout.session.completed`; v7 includes intake CTA in audit email |
| `portal-data` | `supabase/functions/portal-data/index.ts` | off | Returns client data for portal |
| `checkout-info` | `supabase/functions/checkout-info/index.ts` | off | GET `?session_id=` — returns fname/tier for thank-you personalization |
| `lead-capture` | `supabase/functions/lead-capture/index.ts` | off | Exit-intent email → upsert `sequence_contacts` |
| `intake-submit` | `supabase/functions/intake-submit/index.ts` | off | Saves audit intake form, emails Erics, logs to `activity_log` |
| `onboarding-update` | `supabase/functions/onboarding-update/index.ts` | on | Updates `clients.onboarding_stage`, sends milestone email for stage ≥ 3, logs to `activity_log` |
| `monthly-report` | `supabase/functions/monthly-report/index.ts` | on | Emails 30-day perf summary to all live clients (stage ≥ 4); pg_cron `0 9 1 * *` |
| `sms-reminder` | `supabase/functions/sms-reminder/index.ts` | on | Sends SMS 1hr before confirmed bookings; pg_cron `*/5 * * * *` |
| `chat-send` | `supabase/functions/chat-send/index.ts` | off | POST: store visitor message + SMS Erics; GET: poll for new messages |
| `chat-reply` | `supabase/functions/chat-reply/index.ts` | off | Telnyx incoming SMS webhook — routes Erics's reply to visitor widget + email fallback |

### booking-create flow
1. Validate name/email/phone → normalizePhone() to E.164
2. Upsert lead (onConflict: email) → stage=2 (Booked)
3. Insert booking record
4. Send Resend confirmation email
5. Enroll in "Post-Booking Nurture" sequence (skip step 1, schedule step 2 at now + 23hrs)
6. Log to `activity_log`

### sequence-runner flow
- Runs every 30 min via pg_cron
- Queries enrollments where `next_send_at <= now`, `paused=false`, `cancelled=false`, `completed_at=null`
- Sends email (Resend) or SMS (Telnyx) per step channel
- Respects `opted_out_sms` flag before sending SMS
- Advances `current_step`, schedules `next_send_at`, marks `completed_at` if no more steps

### stripe-webhook flow
On `checkout.session.completed`:
1. Verify Stripe signature
2. Upsert lead → stage=5 (Client)
3. Insert payment record
4. Insert client record (portal_token auto-generated by DB)
5. Send onboarding email with portal link
   - Audit purchase (`metadata.type=audit`): includes gold "COMPLETE YOUR INTAKE FORM →" button linking to `/intake?token=<portal_token>`
   - Setup purchase: standard onboarding email with portal CTA

### onboarding-update flow
- POST `{ client_id, stage }` from command center (JWT required)
- Updates `clients.onboarding_stage` + `onboarding_stage_name` + `updated_at`
- Stage names: 0=Welcome, 1=Kickoff Complete, 2=Build Started, 3=Live Setup, 4=Review, 5=Live
- Sends milestone email to client for stage ≥ 3
- Logs `milestone_updated` to `activity_log`

### intake-submit flow
- POST with all intake form fields (JWT off — public)
- Looks up payment by `stripe_checkout_session_id = token` if token provided
- Upserts lead by email; logs all fields to `activity_log` as metadata
- Emails Erics an HTML table of all answers via Resend

### monthly-report flow
- Queries all clients with `onboarding_stage >= 4`
- Computes 30-day stats: new leads, bookings, emails sent, revenue
- Sends branded dark HTML email with 3-column stat grid and portal CTA per client
- Logs each send to `emails` table

### portal-data flow
- Validates `?token=` param against `/^[a-f0-9]{64}$/`
- Returns 401 if malformed, 404 if not found
- Returns `client + leads(fname,lname,email,phone,tier) + payments(amount_cents,tier,description,status)`

---

## pg_cron Jobs

| Job | Schedule | Status |
|---|---|---|
| `sequence-runner` | `*/30 * * * *` | ✅ active |
| `sms-reminder` | `*/5 * * * *` | ✅ active (jobid 3) |
| `monthly-report` | `0 9 1 * *` | ✅ active (jobid 4) |

To configure in Supabase Dashboard → Database → Extensions → pg_cron:
```sql
select cron.schedule('sms-reminder', '*/5 * * * *',
  $$select net.http_post(
    url:='https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/sms-reminder',
    headers:='{"Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  )$$
);

select cron.schedule('monthly-report', '0 9 1 * *',
  $$select net.http_post(
    url:='https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/monthly-report',
    headers:='{"Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  )$$
);
```

---

## Secrets (Supabase Dashboard → Settings → Edge Functions)

| Secret | Used by | Status |
|---|---|---|
| `RESEND_API_KEY` | booking-create, sequence-runner, stripe-webhook, chat-reply | ✅ set |
| `TELNYX_API_KEY` | sequence-runner, chat-send | ⚠️ needs to be set |
| `TELNYX_PHONE` | sequence-runner, chat-send (E.164 Telnyx number) | ⚠️ needs to be set |
| `ERICS_PHONE` | chat-send, chat-reply (Erics's personal cell in E.164) | ⚠️ needs to be set |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | ✅ set |
| `SUPABASE_URL` | all (auto-injected) | ✅ auto |
| `SUPABASE_SERVICE_ROLE_KEY` | all (auto-injected) | ✅ auto |

**Old Twilio secrets to remove once Telnyx is confirmed working:**
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_PHONE`

---

## Stripe Products & Prices (all created)

| Product | ID | Price ID | Amount | Type |
|---|---|---|---|---|
| Core Speed System — Setup | `prod_U4Lv9gBQA2VHcK` | `price_1TY5K0AM1e66iBUiWXiOhDLs` | $2,497 | One-time |
| Revenue Acceleration — Setup | `prod_U4Lv4qUywy4JGy` | `price_1TY5K9AM1e66iBUiusSsf7X2` | $4,000 | One-time |
| Team Infrastructure — Setup | `prod_U4Lw74JRodCVvf` | `price_1TY5KBAM1e66iBUiJqY436rQ` | $7,500 | One-time |
| Revenue Leak Audit | `prod_UGTKfcdo4ZbJGe` | `price_1TY5fEAM1e66iBUidQYoGQpJ` | $497 | One-time |
| AI Voice Qualifier Add-On | `prod_U4Lw3U0HgaLyQN` | `price_1TY5fHAM1e66iBUiQ661zTD7` | $697 | One-time |
| Protection Plan — Tier 1 | `prod_U4LwqATFLE75J0` | `price_1TY5fKAM1e66iBUi6xzSqe83` | $397/mo | Recurring |
| Protection Plan — Tier 2 | `prod_U4LwFj5h2cOBje` | `price_1TY5fMAM1e66iBUiwSFwvnbl` | $497/mo | Recurring |

> Stripe webhook endpoint: `https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/stripe-webhook`
> Event: `checkout.session.completed`

---

## Key Files

| File | Purpose |
|---|---|
| `js/rfs-config.js` | Shared Supabase URL + anon key, `RFS.client()` helper |
| `js/chat-widget.js` | Self-contained live chat widget (no external deps) |
| `supabase/migrations/20260514000000_initial_schema.sql` | Full schema DDL |
| `supabase/migrations/20260514000001_rls_policies.sql` | RLS policies |
| `supabase/migrations/20260516000000_schema_evolution.sql` | Idempotent migration: adds all columns added directly to production, fixes `leads.stage` type, drops+recreates views |
| `supabase/migrations/20260518000000_fix_pipeline_view_security_invoker.sql` | pipeline_view → SECURITY INVOKER |
| `supabase/migrations/20260518000001_create_chat_tables.sql` | Chat sessions + messages tables |
| `supabase/migrations/20260520000001_team_deduplication.sql` | teams, agents, outreach_log, chat_settings tables |
| `supabase/schema.sql` | Schema reference |
| `supabase/config.toml` | Supabase project config |

---

## Supabase Auth

- Auth user created: `erics@realtyflow.xyz`
- Used by `command-center.html` — `signInWithPassword()` via anon key client
- Service role key is NEVER used in browser-facing code

---

## Command Center (`/command-center.html`)

- Auth gate: Supabase email + password sign-in
- Pipeline: reads `leads` table, groups by stage, drag-advance with sequence auto-enrollment
- Daily tracker: reads/writes `daily_activity` table (dms, follow_ups, replies, looms, calls, closes, revenue)
- Clients tab: reads `clients + leads + payments`; **inline stage dropdown** (0–5) per row calls `onboarding-update` edge function; colored dot (green=5, gold=3-4, gray=0-2); toast on success
- Payments tab: reads `payments`, manual log form
- Revenue stats: calculated from `payments.amount_cents`

### Tier values (used for pipeline value estimates)
- Core: $2,497
- Revenue Acceleration: $4,000
- Team Infrastructure: $7,500

---

## Portal (`/portal/index.html`)

- Reads `?token=` from URL
- Calls `portal-data` edge function to validate and fetch data
- Shows spinner → populates dashboard on success → shows access-denied on 401/404
- Displays: client name, tier, go-live date, payment history
- **Build Progress stepper:** 6-stage vertical tracker (0=Welcome → 5=Live) driven by `client.onboarding_stage`
  - Completed stages: gold filled circle + checkmark
  - Current stage: hollow gold circle with pulse animation
  - Future stages: gray

---

## Booking Form (`/booking/index.html`)

- 5-day weekday slot picker with 6 ET time slots (9:00, 10:30, 12:00, 1:30, 3:00, 4:30)
- "No preference" option → `slot_time` omitted from payload
- Phone sent raw → `normalizePhone()` in backend handles E.164
- Submits to `booking-create` edge function

---

## Chat Widget (`js/chat-widget.js`)

Custom live chat widget — replaced Zoho SalesIQ (cancelled).

**How it works:**
- Floating gold bubble (bottom-right, z-index 9998), slide-out 360px panel
- New visitor: shows intro card + name/email fields above message input
- On first send: creates `chat_sessions` row, stores message, sends Erics SMS via Telnyx
- Auto-reply stored as agent message: "Hey [first name]! Got it — Erics will be with you in just a moment."
- Widget polls `/chat-send?session_key=...` every 3s (panel open) or 15s (background) for new messages
- Returning visitor: session_key + messages cached in localStorage (last 60 messages)
- Unread badge on bubble when replies arrive while panel is closed

**Erics's reply flow:**
- Gets SMS: `💬 RFS Chat [A3F8C2] Sarah M: "message text"`
- Texts back to same Telnyx number → `chat-reply` Telnyx webhook fires
- Reply stored as agent message → visitor sees it within 3s
- If visitor offline (last_seen_at > 3 min ago) and has email → email fallback via Resend

**Telnyx setup required:**
- In Telnyx portal → Messaging Profile → Inbound webhook URL:
  `https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/chat-reply` (HTTP POST)

**Secrets needed (not yet confirmed set):**
- `TELNYX_API_KEY` — Telnyx V2 API key
- `TELNYX_PHONE` — E.164 Telnyx number (shared with sequence-runner)
- `ERICS_PHONE` — Erics's personal cell in E.164 format

**Widget on pages:** index.html, audit/, offer-comparison/, booking/, thank-you/, privacy/, terms/

---

## Monthly Cost Summary

| Tool | Cost |
|---|---|
| GitHub Pages | $0 |
| Supabase (free tier) | $0 |
| Resend (free tier, 3k/day) | $0 |
| Telnyx (~$0.004/SMS, own carrier) | ~$1/mo |
| Stripe | 2.9% + 30¢/transaction |
| **Total fixed** | **~$1/mo** |

---

## 10DLC Status — PENDING (blocked on EIN)

Required for A2P SMS (sequence-runner, chat-reply SMS notifications).

- **EIN status:** Never received — online application failed (unknown reason), faxed IRS twice, no response after 2+ weeks. No SS-4 confirmation PDF on file.
- City business license does NOT come with an EIN (separate federal process).
- **Next step:** Call IRS Business & Specialty Tax Line **1-800-829-4933** (Mon–Fri 7am–7pm, best before 9am)
  - Tell them: tried online (failed), faxed twice (no response), need to know if EIN was issued or if there's a block
  - Ask for **147C letter** (EIN verification/issuance letter)
  - Have ready: SSN, legal business name, business address (820 Massachusetts Ave, Cambridge MA), authorized rep name
- **Telnyx workaround to ask about:** Telnyx support may allow sole proprietor SSN for 10DLC brand registration temporarily — worth asking before the IRS call resolves
- Once EIN in hand → Telnyx guides 10DLC brand + campaign registration (3–7 business days after)
- SMS will send without 10DLC but carrier filtering risk increases at volume

---

## Future / Parked Ideas

- **Client SMS sub-accounts** — provision each RFS client their own Telnyx number; mark up messaging at ~$49/month (cost ~$19, margin ~$30). RFS handles 10DLC compliance for all clients. Revisit at 10+ active clients.
- **Command-center chat tab** — add active chat sessions panel to command-center.html so Erics can reply from browser in addition to SMS.
- **Founding Client pricing** — first 5 clients at ~30% off setup fee in exchange for written testimonial + one referral + case study rights. Better than a free trial — client has skin in the game, Erics gets paid and gets social proof.

---

## Go-Live Checklist

### Blockers (must complete before launch)
- [ ] **Add Telnyx secrets in Supabase** — `TELNYX_API_KEY`, `TELNYX_PHONE`, `ERICS_PHONE` (blocked on Telnyx account access — support ticket submitted)
- [ ] **Set Telnyx incoming webhook** — Telnyx portal → Messaging Profile → webhook URL: `https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/chat-reply`
- [x] **End-to-end booking test** — email fires ✅, lead/booking/enrollment in DB ✅, SMS skipped (no Telnyx yet — expected)
- [ ] **End-to-end payment test** — Stripe test mode purchase → confirm portal email arrives → portal loads → thank-you page shows personalized name/tier. **Status:** Stripe was verifying business website (user added `https://realtyflow.xyz`). Use test card `4242 4242 4242 4242` to run test.

### Important (not day-one blockers)
- [x] **pg_cron for sms-reminder + monthly-report** — both active (jobids 3 & 4)
- [ ] **10DLC** — call IRS 1-800-829-4933 for EIN, then complete Telnyx brand + campaign registration
- [ ] **Remove old Twilio secrets** — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_PHONE` — once Telnyx confirmed working
- [x] **Cancel Zoho SalesIQ** — widget replaced, subscription cancelled
- [x] **Cancel Twilio** — migrated to Telnyx
- [ ] **Push all 8 HTML pages with `?v=2` to `main`** — forces Fastly CDN to serve updated `chat-widget.js` (which has GHL redirect fix). Files all have `?v=2` locally. Push is in progress (session 7).

### Optional enhancements
- [ ] **Retainer / add-on post-payment** — Protection Plan and AI Voice Qualifier use Stripe hosted confirmation (no `/thank-you` redirect)
- [ ] **Duplicate sequence enrollment guard** — `booking-create` should cancel existing active enrollments before creating a new one (low priority, only affects repeated test bookings with same email)

---

## Known Issues / Root Causes

- **GHL booking link appearing after hard refresh** — Root cause confirmed: Fastly CDN (GitHub Pages) is serving a cached version of `chat-widget.js` that predates the GHL fix (commit `00c1a72`). The `leadconnectorhq.com` URL does NOT exist in any HTML/JS source file — confirmed by exhaustive grep and GitHub code search. Fix: `?v=2` cache buster on all 8 pages forces CDN to fetch the new file. Push in progress.
- **`/audit` and `/booking` 404 on direct URL** — Two-pronged fix applied to `main`: (1) `.nojekyll` file prevents Jekyll from interfering with directory routing; (2) `404.html` tries trailing-slash redirect before falling back to home. Non-blocking — users navigate via site links.

---

## Completed ✅

- ~~Session 7 fixes~~ — `?v=2` cache buster on all 8 HTML pages (push to main in progress); GHL CDN cache root cause identified and confirmed

- ~~Session 6 fixes~~ — pg_cron jobs active (sms-reminder jobid 3, monthly-report jobid 4); booking slot picker auto-selects first date on load; `.nojekyll` added to main; GHL redirect fix live on main; `404.html` trailing-slash redirect; PR #9 merged

- ~~ROI Calculator~~ — interactive section on `index.html`; leak/recoverable numbers update live
- ~~Exit-intent modal~~ — fires on mouse leave, once per session; POSTs to `lead-capture`; `/booking`, `/portal`, `/thank-you` excluded
- ~~Self-serve audit intake form~~ — `/intake/index.html`; 4 sections; `intake-submit` logs to `activity_log` + emails Erics; intake CTA in audit confirmation email
- ~~Portal milestone stepper~~ — live 6-stage Build Progress tracker in `/portal`; driven by `onboarding_stage`
- ~~Command center stage control~~ — inline dropdown per client row; calls `onboarding-update`; sends client email on stage ≥ 3
- ~~Monthly report function~~ — `monthly-report` deployed ACTIVE; sends 30-day stats to all live clients
- ~~sms-reminder~~ — migrated from Twilio to Telnyx, fixed column names (`slot_time`, `reminder_1h_sent`); deployed ACTIVE
- ~~Thank-you page personalization~~ — reads `?session_id=`, calls `checkout-info`, shows name + tier-specific step cards; 6 retries at 1.5s
- ~~checkout-info function~~ — deployed, JWT off, resolves Stripe session → fname + tier
- ~~Schema evolution migration~~ — `20260516000000` idempotent; fixes all production drift, drops views before type conversion; fixed preview branch CI
- ~~PR #8 merged~~ — all schema migration fixes in main
- ~~SMS migrated to Telnyx~~ — sequence-runner v6, chat-send v2, chat-reply v2 all deployed; single API key, JSON payload
- ~~Custom live chat widget~~ — Telnyx SMS bridge, email fallback, localStorage persistence, all 7 public pages
- ~~pipeline_view security fix~~ — migration applied, SECURITY DEFINER → SECURITY INVOKER
- ~~Booking link routing fix~~ — `booking.html` → `booking/index.html`; all CTAs use `/booking`
- ~~Booking slot picker~~ — slot-selected-display element added, JS wired, "Your Information" step label
- ~~Revenue Leak Audit page~~ — `/audit` built, payment link `plink_1TYO6aAM1e66iBUiZZBmrkIw` live, redirects to `/thank-you`
- ~~Stripe webhook onboarding emails~~ — personalized copy for setup clients and audit purchasers (v7, ACTIVE)
- ~~Sequence body copy~~ — all 5 steps written and live in DB
- ~~Stripe payment links~~ — all 6 created with tier metadata
- ~~Offer page CTAs~~ — all wired in `offer-comparison/index.html`
- ~~Homepage link fixes~~ — `.html` extensions → clean paths; dead Cal.com link → `/offer-comparison`
- ~~Thank-you page~~ — `/thank-you` built, all 3 setup links redirect there
- ~~portal-data edge function~~ — deployed, token-gated, returns client data
- ~~Theme consistency~~ — cursor, footer brand/subtitle/TCPA line applied across all pages
- ~~Zoho SalesIQ removed~~ — snippet deleted from index.html, subscription cancelled
