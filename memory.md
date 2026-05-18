# RealtyFlow Systems — Session Memory

_Last updated: May 18, 2026 (session 3)_

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
- **SMS:** Twilio
- **Payments:** Stripe (webhook → edge function)
- **Scheduling:** pg_cron + pg_net (sequence-runner fires every 30 min)

---

## Website Pages (all tracked in git)

| URL | File | Description |
|---|---|---|
| `/` | `index.html` | Main landing page |
| `/booking` | `booking/index.html` | Revenue Audit booking form (moved from flat booking.html) |
| `/command-center` | `command-center.html` | Internal CRM dashboard (auth-gated) |
| `/portal` | `portal/index.html` | Client portal (token-gated) |
| `/offer-comparison` | `offer-comparison/index.html` | Offer comparison page |
| `/privacy` | `privacy/index.html` | Privacy policy |
| `/terms` | `terms/index.html` | Terms of service |
| `/thank-you` | `thank-you/index.html` | Stripe post-payment success page |
| `/audit` | `audit/index.html` | Revenue Leak Audit landing + checkout ($497) |
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
- `id`, `lead_id`, `twilio_sid`
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

**`daily_activity`** — manual daily tracking
- `id`, `date` (UNIQUE)
- `dms`, `follow_ups`, `replies`, `looms`, `calls`, `closes`, `revenue` (all INT)

### Seeded Sequences

| Sequence | Trigger Stage | Steps |
|---|---|---|
| Post-Booking Nurture | 2 (Booked) | Step 1: Email @ 1hr · Step 2: SMS @ 23hr |
| Post-Audit Follow-up | 3 (Audit Done) | Step 1: Email @ 48hr · Step 2: Email @ 96hr |
| Proposal Follow-up | 4 (Proposal) | Step 1: Email @ 72hr |

> **All step body copy written and live in DB** — `{{fname}}` template variable resolved by `personalize()` in sequence-runner.

#### Step Copy Summary

| Sequence | Step | Channel | Delay | Subject / Content |
|---|---|---|---|---|
| Post-Booking Nurture | 1 | Email | 1hr | "Your Revenue Audit is confirmed" — slot confirmation + what to expect |
| Post-Booking Nurture | 2 | SMS | 23hr | "Hey {{fname}}, just a heads up — your Revenue Audit with Erics is coming up soon…" + STOP opt-out |
| Post-Audit Follow-up | 1 | Email | 48hr | "What your audit revealed, {{fname}}" — $30K–$90K missed revenue callout |
| Post-Audit Follow-up | 2 | Email | 96hr | "Still thinking it over, {{fname}}?" — scarcity framing, open slot urgency |
| Proposal Follow-up | 1 | Email | 72hr | "Checking in on your proposal, {{fname}}" — direct follow-up |

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
| `stripe-webhook` | `supabase/functions/stripe-webhook/index.ts` | off | Handles `checkout.session.completed` |
| `portal-data` | `supabase/functions/portal-data/index.ts` | off | Returns client data for portal |
| `chat-send` | `supabase/functions/chat-send/index.ts` | off | POST: store visitor message + SMS Erics; GET: poll for new messages |
| `chat-reply` | `supabase/functions/chat-reply/index.ts` | off | Twilio incoming SMS webhook — routes Erics's reply to visitor widget + email fallback |

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
- Sends email (Resend) or SMS (Twilio) per step channel
- Respects `opted_out_sms` flag before sending SMS
- Advances `current_step`, schedules `next_send_at`, marks `completed_at` if no more steps

### stripe-webhook flow
On `checkout.session.completed`:
1. Verify Stripe signature
2. Upsert lead → stage=5 (Client)
3. Insert payment record
4. Insert client record (portal_token auto-generated by DB)
5. Send onboarding email with portal link

### portal-data flow
- Validates `?token=` param against `/^[a-f0-9]{64}$/`
- Returns 401 if malformed, 404 if not found
- Returns `client + leads(fname,lname,email,phone,tier) + payments(amount_cents,tier,description,status)`

---

## pg_cron Jobs

| Job | Schedule | Status |
|---|---|---|
| `sequence-runner` | `*/30 * * * *` | ✅ active |

> `sms-reminder` cron was deleted (was pointing to a non-existent function with malformed headers).

---

## Secrets (all set in Supabase Dashboard → Settings → Edge Functions)

| Secret | Used by |
|---|---|
| `RESEND_API_KEY` | booking-create, sequence-runner, stripe-webhook, chat-reply |
| `TWILIO_ACCOUNT_SID` | sequence-runner, chat-send |
| `TWILIO_AUTH_TOKEN` | sequence-runner, chat-send |
| `TWILIO_PHONE_NUMBER` | sequence-runner (E.164 format, "From" number) |
| `TWILIO_PHONE` | chat-send (E.164 format — confirm this secret name matches) |
| `ERICS_PHONE` | chat-send, chat-reply (Erics's personal cell in E.164) |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook |
| `SUPABASE_URL` | all (auto-injected) |
| `SUPABASE_SERVICE_ROLE_KEY` | all (auto-injected) |

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

## Stripe Payment Links (all live)

| Product | Payment Link ID | URL | Metadata | Redirect |
|---|---|---|---|---|
| Core Speed System — Setup | `plink_1T7hG5AM1e66iBUiMk4ALOph` | `https://buy.stripe.com/...` | `tier=Core` | `/thank-you` ✅ |
| Revenue Acceleration — Setup | `plink_1T85ERAM1e66iBUiTDF0RRS1` | `https://buy.stripe.com/...` | `tier=Revenue Acceleration` | `/thank-you` ✅ |
| Team Infrastructure — Setup | `plink_1T85DuAM1e66iBUijyFzH9Uq` | `https://buy.stripe.com/...` | `tier=Team Infrastructure` | `/thank-you` ✅ |
| Revenue Leak Audit | `plink_1TYO6aAM1e66iBUiZZBmrkIw` | `https://buy.stripe.com/5kQ14mdnwgqTdgsg1T4F207` | `type=audit` | `/thank-you` ✅ |
| AI Voice Qualifier Add-On | `plink_...` | `https://buy.stripe.com/9B69ASfvE4Ibcco02V4F202` | `type=addon` | Stripe hosted ✅ |
| Protection Plan — Tier 1 | `plink_...` | `https://buy.stripe.com/3cIeVcfvE0rVcco16Z4F203` | `tier=Core,type=retainer` | Stripe hosted ✅ |
| Protection Plan — Tier 2 | `plink_...` | `https://buy.stripe.com/4gM5kC1EO1vZ1xKaHz4F201` | `tier=Revenue Acceleration,type=retainer` | Stripe hosted ✅ |

> Setup and audit payment links redirect to `https://realtyflow.xyz/thank-you` on success.
> stripe-webhook reads `session.metadata.tier` to route the payment record.

### Billing Portal

- URL: `https://billing.stripe.com/p/login/9B67sK5V47Unb8k6rj4F200`
- Linked in `/portal/index.html` — "Manage Billing" button

---

## Key Files

| File | Purpose |
|---|---|
| `js/rfs-config.js` | Shared Supabase URL + anon key, `RFS.client()` helper |
| `js/chat-widget.js` | Self-contained live chat widget (no dependencies) |
| `supabase/migrations/20260514000000_initial_schema.sql` | Full schema DDL |
| `supabase/migrations/20260514000001_rls_policies.sql` | RLS policies |
| `supabase/migrations/20260518000000_fix_pipeline_view_security_invoker.sql` | Fix pipeline_view SECURITY DEFINER → SECURITY INVOKER |
| `supabase/migrations/20260518000001_create_chat_tables.sql` | chat_sessions + chat_messages tables |
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
- Clients tab: reads `clients + leads + payments`
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
- Displays: client name, tier, go-live date, onboarding stage, payment history

---

## Booking Form (`/booking`)

- File moved to `booking/index.html` (was `booking.html` — flat file caused GitHub Pages 404 → redirect loop)
- 5-day weekday slot picker with 6 ET time slots (9:00, 10:30, 12:00, 1:30, 3:00, 4:30)
- Selected slot confirmed with gold display text (e.g. "✓ Thu May 22 at 10:30 AM ET")
- "No preference" option → `slot_time` omitted from payload
- Phone sent raw → `normalizePhone()` in backend handles E.164
- Submits to `booking-create` edge function

---

## Chat Widget (`js/chat-widget.js`)

Custom live chat replacing Zoho SalesIQ (subscription cancelled in ~2 weeks).

**How it works:**
- Floating gold bubble (bottom-right, z-index 9998), slide-out 360px panel
- New visitor: shows intro card + name/email fields above message input
- On first send: creates `chat_sessions` row, stores message, sends Erics SMS via Twilio
- Auto-reply stored as agent message: "Hey [first name]! Got it — Erics will be with you in just a moment."
- Widget polls `/chat-send?session_key=...` every 3s (panel open) or 15s (background) for new messages
- Returning visitor: session_key + messages cached in localStorage (last 60 messages)
- Unread badge on bubble when replies arrive while panel is closed

**Erics's reply flow:**
- Gets SMS: `💬 RFS Chat [A3F8C2] Sarah M: "message text"`
- Texts back to same Twilio number → `chat-reply` Twilio webhook fires
- Reply stored as agent message → visitor sees it within 3s
- If visitor offline (last_seen_at > 3 min ago) and has email → email fallback via Resend

**Twilio setup required:**
- In Twilio console → phone number → Messaging → "A Message Comes In" webhook:
  `https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/chat-reply` (HTTP POST)

**Secrets needed (not yet confirmed set):**
- `TWILIO_PHONE` — E.164 Twilio number for chat-send (may differ from `TWILIO_PHONE_NUMBER` used by sequence-runner)
- `ERICS_PHONE` — Erics's personal cell in E.164 format

**Widget on pages:** index.html, audit/, offer-comparison/, booking/, thank-you/, privacy/, terms/

---

## Database — Chat Tables

**`chat_sessions`**
- `id`, `session_key` (UUID, used by widget as identifier)
- `visitor_name`, `visitor_email`, `status` ('open'/'closed')
- `last_seen_at` (updated on every poll — used to detect offline visitors)
- `last_message_at`, `created_at`

**`chat_messages`**
- `id`, `session_id` (FK→chat_sessions), `sender` ('visitor'/'agent'), `body`, `created_at`

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

---

## 10DLC Status — PENDING

Required for A2P SMS (sequence-runner, chat-reply SMS notifications).

- Applied for brand registration with The Campaign Registry (TCR)
- EIN verification failed online — faxed IRS twice, no response after 2 weeks
- **Next step:** Call IRS Business & Specialty Tax Line **1-800-829-4933** (Mon–Fri 7am–7pm)
  - Ask specifically for **147C letter** (EIN verification letter)
  - Have ready: EIN, exact legal business name as filed, business address, authorized rep name
- Once 147C received → resubmit brand registration → campaign approval 3–7 business days
- Until approved: SMS may be filtered by carriers

---

## Future / Parked Ideas

- **Client SMS sub-accounts** — provision each RFS client their own Twilio number under RFS master account; mark up messaging at ~$49/month (cost ~$19, margin ~$30). Real value: RFS handles 10DLC registration and compliance for clients. Revisit once RFS hits 10+ active clients.
- **Telnyx migration** — ~50% cheaper than Twilio, own carrier network. Minimal code change. Worth evaluating at 50+ clients when volume pricing matters.
- **Command-center chat tab** — add active chat sessions panel to command-center.html so Erics can reply from browser in addition to SMS.

---

## What's Still Needed

- [ ] **Twilio webhook configured** — set `chat-reply` URL in Twilio console (see Chat Widget section above)
- [ ] **Secrets confirmed** — verify `TWILIO_PHONE` and `ERICS_PHONE` secrets are set in Supabase for chat functions
- [ ] **10DLC** — call IRS for 147C letter, then complete TCR brand + campaign registration
- [ ] **Retainer / add-on post-payment** — Protection Plan and AI Voice Qualifier links use Stripe's hosted confirmation (no `/thank-you` redirect); consider adding if desired

## Completed ✅

- ~~Custom live chat widget~~ — replaces Zoho SalesIQ; SMS bridge, email fallback, localStorage persistence, all 7 public pages
- ~~pipeline_view security fix~~ — migration applied, SECURITY DEFINER → SECURITY INVOKER
- ~~Booking link routing fix~~ — `booking.html` → `booking/index.html`; all CTAs use `/booking`
- ~~Booking slot picker~~ — slot-selected-display element added, JS wired, "Your Information" step label
- ~~Revenue Leak Audit page~~ — `/audit` built, payment link `plink_1TYO6aAM1e66iBUiZZBmrkIw` live, redirects to `/thank-you`
- ~~Stripe webhook onboarding emails~~ — personalized copy for setup clients and audit purchasers (v6, ACTIVE)
- ~~Sequence body copy~~ — all 5 steps written and live in DB
- ~~Stripe payment links~~ — all 6 created with tier metadata
- ~~Offer page CTAs~~ — all wired in `offer-comparison/index.html`
- ~~Homepage link fixes~~ — `.html` extensions → clean paths; dead Cal.com link → `/offer-comparison`
- ~~Thank-you page~~ — `/thank-you` built, all 3 setup links redirect there
- ~~portal-data edge function~~ — deployed, token-gated, returns client data
- ~~sms-reminder cron~~ — deleted (was broken/malformed)
- ~~Theme consistency~~ — cursor, footer brand/subtitle/TCPA line applied across all pages
- ~~Zoho SalesIQ removed~~ — snippet deleted from index.html
