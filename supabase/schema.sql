-- RealtyFlow Systems — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ── LEADS ──────────────────────────────────────────────────────────────────
-- Every person who submits a form (booking, contact, inbound)
create table if not exists leads (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  email       text not null unique,
  phone       text,
  source      text default 'realtyflow.xyz/booking',
  stage       text default 'new',
  -- stages: new | contacted | booked | qualified | proposal | client | lost
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── BOOKINGS ───────────────────────────────────────────────────────────────
-- Confirmed Revenue Audit calls
create table if not exists bookings (
  id                  uuid primary key default uuid_generate_v4(),
  lead_id             uuid references leads(id) on delete set null,
  name                text not null,
  email               text not null,
  phone               text,
  scheduled_at        timestamptz,
  status              text default 'confirmed',
  -- statuses: confirmed | completed | no_show | cancelled
  sms_reminder_sent   boolean default false,
  zoom_link           text,
  cal_event_id        text,
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ── EMAIL LOG ──────────────────────────────────────────────────────────────
create table if not exists email_log (
  id          uuid primary key default uuid_generate_v4(),
  lead_id     uuid references leads(id) on delete set null,
  to_email    text not null,
  subject     text,
  type        text,
  -- types: confirmation | reminder | sequence | onboarding | follow_up
  resend_id   text,
  opened_at   timestamptz,
  clicked_at  timestamptz,
  created_at  timestamptz default now()
);

-- ── SMS LOG ────────────────────────────────────────────────────────────────
create table if not exists sms_log (
  id          uuid primary key default uuid_generate_v4(),
  lead_id     uuid references leads(id) on delete set null,
  to_phone    text,
  message     text,
  twilio_sid  text,
  status      text default 'queued',
  created_at  timestamptz default now()
);

-- ── SEQUENCE CONTACTS ──────────────────────────────────────────────────────
-- Cold outbound targets (import from Apollo, LinkedIn, etc.)
create table if not exists sequence_contacts (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  email           text not null unique,
  phone           text,
  company         text,
  market          text,
  -- e.g. Cambridge, Somerville, Newton, Brookline
  current_step    int default 0,
  status          text default 'active',
  -- statuses: active | replied | booked | unsubscribed | bounced | completed
  unsubscribed_at timestamptz,
  last_email_at   timestamptz,
  next_email_at   timestamptz default now(),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── SEQUENCE STEPS ─────────────────────────────────────────────────────────
-- Email templates for cold outbound (use {{name}}, {{market}} as variables)
create table if not exists sequence_steps (
  id          uuid primary key default uuid_generate_v4(),
  step_number int not null unique,
  delay_days  int not null default 0,
  subject     text not null,
  body_html   text not null,
  body_text   text,
  active      boolean default true,
  created_at  timestamptz default now()
);

-- Seed default 3-step sequence
insert into sequence_steps (step_number, delay_days, subject, body_html, body_text) values
(1, 0,
  'Quick question, {{name}}',
  '<p>Hi {{name}},</p><p>I help real estate agents in {{market}} recover leads that go cold — usually $30K–$90K in uncaptured revenue per quarter.</p><p>Is that worth a 15-minute look?</p><p>— Erics<br>RealtyFlow Systems</p>',
  'Hi {{name}}, I help real estate agents in {{market}} recover leads that go cold — usually $30K–$90K in uncaptured revenue per quarter. Is that worth a 15-minute look? — Erics, RealtyFlow Systems'
),
(2, 3,
  'Re: Quick question, {{name}}',
  '<p>Hi {{name}},</p><p>Following up on my note from a few days ago.</p><p>Most agents I talk to in {{market}} don''t realize how much revenue is sitting in their existing lead database — not in new leads, just better follow-up timing.</p><p>Worth a quick call this week?</p><p>— Erics</p>',
  'Hi {{name}}, following up — most agents in {{market}} have $30K+ sitting in their existing database. Worth a quick call? — Erics'
),
(3, 5,
  'Last note — {{name}}',
  '<p>Hi {{name}},</p><p>I won''t keep following up — I know your inbox is full.</p><p>If the timing ever works, I''m at <a href="https://realtyflow.xyz/booking">realtyflow.xyz/booking</a>.</p><p>— Erics</p>',
  'Hi {{name}}, last note — if the timing ever works: realtyflow.xyz/booking. — Erics'
)
on conflict (step_number) do nothing;

-- ── CLIENTS ────────────────────────────────────────────────────────────────
-- Paid clients (created automatically on Stripe payment)
create table if not exists clients (
  id                    uuid primary key default uuid_generate_v4(),
  lead_id               uuid references leads(id) on delete set null,
  stripe_customer_id    text,
  plan                  text default 'starter',
  -- plans: starter | growth | scale
  amount_cents          int,
  status                text default 'active',
  -- statuses: active | paused | cancelled
  onboarded_at          timestamptz,
  portal_access_token   text unique default encode(gen_random_bytes(32), 'hex'),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ── PAYMENTS ───────────────────────────────────────────────────────────────
create table if not exists payments (
  id                        uuid primary key default uuid_generate_v4(),
  client_id                 uuid references clients(id) on delete set null,
  stripe_payment_intent_id  text unique,
  amount_cents              int,
  status                    text,
  -- statuses: succeeded | failed | refunded
  description               text,
  created_at                timestamptz default now()
);

-- ── PIPELINE VIEW ──────────────────────────────────────────────────────────
-- Denormalized view for the Command Center dashboard
create or replace view pipeline_view as
select
  l.id,
  l.name,
  l.email,
  l.phone,
  l.stage,
  l.source,
  l.notes,
  l.created_at,
  b.id            as booking_id,
  b.scheduled_at,
  b.status        as booking_status,
  c.id            as client_id,
  c.plan          as client_plan,
  c.amount_cents,
  c.status        as client_status,
  c.portal_access_token
from leads l
left join bookings b  on b.lead_id = l.id
left join clients c   on c.lead_id = l.id
order by l.created_at desc;

-- ── ANALYTICS VIEW ─────────────────────────────────────────────────────────
create or replace view analytics_summary as
select
  (select count(*) from leads)                                          as total_leads,
  (select count(*) from leads where stage = 'booked')                   as booked_calls,
  (select count(*) from leads where stage = 'client')                   as total_clients,
  (select count(*) from bookings where status = 'completed')            as calls_completed,
  (select count(*) from bookings where status = 'no_show')              as no_shows,
  (select coalesce(sum(amount_cents),0) from payments where status = 'succeeded') as revenue_cents,
  (select count(*) from sequence_contacts where status = 'active')      as active_sequences,
  (select count(*) from sequence_contacts where status = 'booked')      as sequence_bookings;

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
alter table leads              enable row level security;
alter table bookings           enable row level security;
alter table email_log          enable row level security;
alter table sms_log            enable row level security;
alter table sequence_contacts  enable row level security;
alter table sequence_steps     enable row level security;
alter table clients            enable row level security;
alter table payments           enable row level security;

-- Anon can INSERT leads (from the public booking form)
create policy "public_booking" on leads
  for insert to anon
  with check (true);

-- Service role (Edge Functions) bypasses RLS automatically
-- No additional policies needed for service_role key

-- ── UPDATED_AT TRIGGER ─────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$ begin
  create trigger leads_updated_at             before update on leads             for each row execute function set_updated_at();
  create trigger bookings_updated_at          before update on bookings          for each row execute function set_updated_at();
  create trigger sequence_contacts_updated_at before update on sequence_contacts for each row execute function set_updated_at();
  create trigger clients_updated_at           before update on clients           for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
