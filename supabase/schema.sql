-- ============================================================
-- RealtyFlow Systems — Supabase Schema
-- Run once in Supabase SQL Editor: https://supabase.com/dashboard
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── LEADS ────────────────────────────────────────────────────
CREATE TABLE leads (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  fname       TEXT        NOT NULL,
  lname       TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  phone       TEXT,
  source      TEXT        DEFAULT 'Booking Page',
  -- 0=New Lead, 1=Contacted, 2=Audit Booked, 3=Audit Complete,
  -- 4=Proposal Sent, 5=Closed Won, 6=Closed Lost
  stage       INTEGER     DEFAULT 0,
  stage_name  TEXT        DEFAULT 'New Lead',
  tier        TEXT,       -- Core | Revenue Acceleration | Team Infrastructure
  volume      TEXT,       -- monthly lead volume
  sides       TEXT,       -- annual transaction sides
  market      TEXT,
  db_size     TEXT,
  notes       TEXT,
  opted_out_sms BOOLEAN   DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── BOOKINGS ─────────────────────────────────────────────────
CREATE TABLE bookings (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id             UUID        REFERENCES leads(id) ON DELETE CASCADE,
  slot_time           TIMESTAMPTZ,
  duration_minutes    INTEGER     DEFAULT 30,
  -- pending | confirmed | completed | cancelled | no-show
  status              TEXT        DEFAULT 'confirmed',
  audit_notes         TEXT,
  google_event_id     TEXT,
  confirmation_sent   BOOLEAN     DEFAULT FALSE,
  reminder_24h_sent   BOOLEAN     DEFAULT FALSE,
  reminder_1h_sent    BOOLEAN     DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── EMAILS (outbound tracking) ───────────────────────────────
CREATE TABLE emails (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id         UUID        REFERENCES leads(id) ON DELETE CASCADE,
  resend_id       TEXT,
  subject         TEXT        NOT NULL,
  body_html       TEXT,
  -- transactional | cold | follow-up | confirmation | reminder
  type            TEXT        DEFAULT 'transactional',
  sequence_id     UUID,
  sequence_step   INTEGER,
  sent_at         TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  bounced_at      TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── SMS ──────────────────────────────────────────────────────
CREATE TABLE sms_messages (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID        REFERENCES leads(id) ON DELETE CASCADE,
  twilio_sid  TEXT,
  -- outbound | inbound
  direction   TEXT        DEFAULT 'outbound',
  body        TEXT        NOT NULL,
  -- queued | sent | delivered | failed | undelivered
  status      TEXT        DEFAULT 'queued',
  -- reminder | confirmation | follow-up | manual
  type        TEXT        DEFAULT 'reminder',
  sent_at     TIMESTAMPTZ,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── EMAIL SEQUENCES ──────────────────────────────────────────
CREATE TABLE sequences (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT        NOT NULL,
  trigger_stage   INTEGER,    -- auto-enroll when lead reaches this stage
  active          BOOLEAN     DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sequence_steps (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence_id     UUID        REFERENCES sequences(id) ON DELETE CASCADE,
  step_number     INTEGER     NOT NULL,
  delay_hours     INTEGER     DEFAULT 24,
  channel         TEXT        DEFAULT 'email', -- email | sms
  subject         TEXT,
  body_html       TEXT,
  body_text       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sequence_enrollments (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id         UUID        REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id     UUID        REFERENCES sequences(id) ON DELETE CASCADE,
  current_step    INTEGER     DEFAULT 0,
  next_send_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  paused          BOOLEAN     DEFAULT FALSE,
  cancelled       BOOLEAN     DEFAULT FALSE
);

-- ── PAYMENTS ─────────────────────────────────────────────────
CREATE TABLE payments (
  id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id                     UUID        REFERENCES leads(id),
  stripe_payment_intent_id    TEXT        UNIQUE,
  stripe_customer_id          TEXT,
  stripe_checkout_session_id  TEXT        UNIQUE,
  amount_cents                INTEGER     NOT NULL,
  currency                    TEXT        DEFAULT 'usd',
  -- pending | succeeded | failed | refunded
  status                      TEXT        DEFAULT 'pending',
  tier                        TEXT,
  description                 TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ── CLIENTS (converted leads) ────────────────────────────────
CREATE TABLE clients (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id             UUID        REFERENCES leads(id) UNIQUE,
  payment_id          UUID        REFERENCES payments(id),
  -- secure token for passwordless portal access
  portal_token        TEXT        UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  -- 0=Welcome, 1=Intake Form, 2=Setup, 3=Go Live, 4=Ongoing
  onboarding_stage    INTEGER     DEFAULT 0,
  onboarding_stage_name TEXT      DEFAULT 'Welcome',
  intake_completed    BOOLEAN     DEFAULT FALSE,
  setup_completed     BOOLEAN     DEFAULT FALSE,
  go_live_date        DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── ACTIVITY LOG ─────────────────────────────────────────────
CREATE TABLE activity_log (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID        REFERENCES leads(id) ON DELETE CASCADE,
  -- booking | email | sms | stage_change | note | payment | call
  type        TEXT        NOT NULL,
  description TEXT        NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── DAILY ACTIVITY TRACKER ───────────────────────────────────
CREATE TABLE daily_activity (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  date        DATE        NOT NULL UNIQUE,
  dms         INTEGER     DEFAULT 0,
  follow_ups  INTEGER     DEFAULT 0,
  replies     INTEGER     DEFAULT 0,
  looms       INTEGER     DEFAULT 0,
  calls       INTEGER     DEFAULT 0,
  closes      INTEGER     DEFAULT 0,
  revenue     INTEGER     DEFAULT 0,  -- in dollars
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── TRIGGERS: updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_leads_updated        BEFORE UPDATE ON leads         FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER tr_bookings_updated     BEFORE UPDATE ON bookings      FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER tr_payments_updated     BEFORE UPDATE ON payments      FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER tr_clients_updated      BEFORE UPDATE ON clients       FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER tr_daily_activity_updated BEFORE UPDATE ON daily_activity FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
-- All tables are locked down. Edge Functions use service_role key
-- which bypasses RLS entirely. No direct anon/public access.
ALTER TABLE leads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequences           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_steps      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_activity      ENABLE ROW LEVEL SECURITY;

-- ── VIEWS ────────────────────────────────────────────────────
CREATE VIEW pipeline_view AS
SELECT
  l.id,
  l.fname,
  l.lname,
  l.email,
  l.phone,
  l.source,
  l.stage,
  l.stage_name,
  l.tier,
  l.volume,
  l.sides,
  l.notes,
  l.created_at,
  b.slot_time,
  b.status       AS booking_status,
  p.amount_cents,
  p.status       AS payment_status,
  c.portal_token,
  c.onboarding_stage AS client_stage
FROM leads l
LEFT JOIN bookings b ON b.lead_id = l.id AND b.status NOT IN ('cancelled')
LEFT JOIN payments p ON p.lead_id = l.id AND p.status = 'succeeded'
LEFT JOIN clients  c ON c.lead_id = l.id;

-- ── SEED: DEFAULT FOLLOW-UP SEQUENCES ────────────────────────
INSERT INTO sequences (name, trigger_stage) VALUES
  ('Post-Booking Nurture', 2),   -- triggers when audit booked
  ('Post-Audit Follow-up', 3),   -- triggers after audit complete
  ('Proposal Follow-up', 4);     -- triggers when proposal sent

-- Post-Booking Nurture: 3 touch sequence before the call
INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channel, subject, body_html, body_text)
SELECT id, 1, 1, 'email',
  'Your RFS Revenue Audit is confirmed ✓',
  '<p>Hi {{fname}},</p><p>Your Revenue Audit is locked in. Here is how to prepare:</p><ol><li>Know your average monthly lead volume</li><li>Know your current speed-to-respond (honestly)</li><li>Have your last 3 months of closed transactions handy</li></ol><p>This call is built to show you exactly where your pipeline is leaking revenue. Come ready to talk specifics.</p><p>— Erics<br>RealtyFlow Systems</p>',
  'Hi {{fname}}, your Revenue Audit is confirmed. Prepare: monthly lead volume, speed-to-respond, last 3 months closed. — Erics'
FROM sequences WHERE name = 'Post-Booking Nurture';

INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channel, subject, body_html, body_text)
SELECT id, 2, 23, 'sms',
  NULL,
  NULL,
  'Hey {{fname}} — reminder: your RealtyFlow Revenue Audit is tomorrow. I will be calling at your scheduled time. Reply STOP to opt out. — Erics'
FROM sequences WHERE name = 'Post-Booking Nurture';

-- Post-Audit Follow-up: 48h and 96h
INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channel, subject, body_html, body_text)
SELECT id, 1, 48, 'email',
  'Your Revenue Audit — next step',
  '<p>Hi {{fname}},</p><p>Great conversation. Based on what you shared, here is the short version of where I see your biggest revenue leak:</p><p><strong>Speed-to-lead response.</strong> Agents who respond within 60 seconds are 7x more likely to qualify that lead. Right now you are leaving money on the table every day.</p><p>The RFS system fixes this permanently. I put together a custom proposal for you — want me to send it over?</p><p>— Erics</p>',
  'Hi {{fname}}, great conversation. Your biggest revenue leak is speed-to-lead response. Want me to send over your custom proposal? — Erics'
FROM sequences WHERE name = 'Post-Audit Follow-up';

INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channel, subject, body_html, body_text)
SELECT id, 2, 96, 'email',
  'Quick question, {{fname}}',
  '<p>Hi {{fname}},</p><p>Following up — did you get a chance to review? I want to make sure this does not fall through the cracks.</p><p>If timing is off or you have questions, just reply and let me know.</p><p>— Erics</p>',
  'Hi {{fname}}, following up on your audit. Did you get a chance to review? Just reply if you have questions. — Erics'
FROM sequences WHERE name = 'Post-Audit Follow-up';

-- Proposal Follow-up: 72h
INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channel, subject, body_html, body_text)
SELECT id, 1, 72, 'email',
  'Re: Your RFS Proposal',
  '<p>Hi {{fname}},</p><p>Checking in on the proposal I sent. I only work with a small number of agents at a time to protect quality — I have one spot open right now.</p><p>If you are ready to move forward, reply and I will get everything set up within 24 hours. If you need more time, no pressure — just let me know where you are at.</p><p>— Erics</p>',
  'Hi {{fname}}, following up on your proposal. I have one spot open. Ready to move forward? — Erics'
FROM sequences WHERE name = 'Proposal Follow-up';
