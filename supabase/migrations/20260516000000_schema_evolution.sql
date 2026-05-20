-- RealtyFlow Systems — Schema Evolution
-- Brings schema from initial state up to current production state.
-- All DDL uses IF NOT EXISTS / DO blocks — safe to run on a DB that already
-- has these columns (production) and on a fresh preview branch.

-- ── LEADS ──────────────────────────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fname        text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lname        text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_name   text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tier         text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS volume       text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sides        text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS market       text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS db_size      text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opted_out_sms boolean default false;

-- Drop views that depend on leads.stage before converting its type.
-- pipeline_view is recreated with security_invoker=on by 20260518000000.
-- analytics_summary used text stage comparisons; replaced below with integer-based version.
DROP VIEW IF EXISTS analytics_summary;
DROP VIEW IF EXISTS pipeline_view;

-- Convert leads.stage from text (initial default 'new') to integer
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads'
      AND column_name = 'stage' AND data_type = 'text'
  ) THEN
    ALTER TABLE leads ALTER COLUMN stage DROP DEFAULT;
    ALTER TABLE leads ALTER COLUMN stage TYPE integer
      USING CASE WHEN stage ~ '^\d+$' THEN stage::integer ELSE 0 END;
    ALTER TABLE leads ALTER COLUMN stage SET DEFAULT 0;
  END IF;
END $$;

-- Recreate analytics_summary using integer stage values
-- (stage 5 = client, stage 3 = booked per STAGE_CLIENT in stripe-webhook)
CREATE OR REPLACE VIEW analytics_summary AS
SELECT
  (SELECT count(*)                          FROM leads)                                       AS total_leads,
  (SELECT count(*)                          FROM leads    WHERE stage >= 3)                   AS booked_calls,
  (SELECT count(*)                          FROM leads    WHERE stage = 5)                    AS total_clients,
  (SELECT count(*)                          FROM bookings WHERE status = 'completed')         AS calls_completed,
  (SELECT count(*)                          FROM bookings WHERE status = 'no_show')           AS no_shows,
  (SELECT coalesce(sum(amount_cents), 0)    FROM payments WHERE status = 'succeeded')         AS revenue_cents,
  (SELECT count(*)                          FROM sequence_contacts WHERE status = 'active')   AS active_sequences,
  (SELECT count(*)                          FROM sequence_contacts WHERE status = 'booked')   AS sequence_bookings;

-- ── BOOKINGS ───────────────────────────────────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS slot_time            timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_minutes     integer default 30;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS audit_notes          text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS google_event_id      text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmation_sent    boolean default false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_24h_sent    boolean default false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_1h_sent     boolean default false;

-- ── PAYMENTS ───────────────────────────────────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS lead_id                     uuid references leads(id) on delete set null;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_customer_id          text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_checkout_session_id  text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency                    text default 'usd';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tier                        text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at                  timestamptz default now();

DO $$ BEGIN
  CREATE TRIGGER payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── CLIENTS ────────────────────────────────────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_id           uuid references payments(id) on delete set null;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_token         text default encode(gen_random_bytes(32), 'hex');
ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_stage     integer default 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_stage_name text default 'Welcome';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS intake_completed     boolean default false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS setup_completed      boolean default false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS go_live_date         date;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes                text;

-- ── EMAILS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id            uuid primary key default uuid_generate_v4(),
  lead_id       uuid references leads(id) on delete set null,
  resend_id     text,
  subject       text not null,
  body_html     text,
  type          text default 'transactional',
  sequence_id   uuid,
  sequence_step integer,
  sent_at       timestamptz,
  opened_at     timestamptz,
  clicked_at    timestamptz,
  bounced_at    timestamptz,
  error         text,
  created_at    timestamptz default now()
);

-- ── ACTIVITY LOG ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id          uuid primary key default uuid_generate_v4(),
  lead_id     uuid references leads(id) on delete set null,
  type        text not null,
  description text not null,
  metadata    jsonb,
  created_at  timestamptz default now()
);

ALTER TABLE emails       ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
