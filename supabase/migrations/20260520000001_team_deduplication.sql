-- RealtyFlow Systems — Team Deduplication & Contact Lock
-- Migration: 20260520000001_team_deduplication

-- ── CHAT SETTINGS ──────────────────────────────────────────────────────────────
create table if not exists chat_settings (
  key   text primary key,
  value text not null
);

insert into chat_settings (key, value) values
  ('auto_reply_enabled',       'true'),
  ('auto_reply_delay_minutes', '5'),
  ('auto_reply_message',       'Hey! Erics is away from his phone right now — he''ll get back to you within a few hours. Feel free to email erics@realtyflow.xyz if it''s urgent.')
on conflict (key) do nothing;

-- ── CHAT SESSION UPDATES ───────────────────────────────────────────────────────
alter table chat_sessions add column if not exists auto_reply_sent boolean default false;

-- ── TEAMS ──────────────────────────────────────────────────────────────────────
create table if not exists teams (
  id               uuid primary key default gen_random_uuid(),
  team_name        text not null,
  market           text,
  team_size        int default 1,
  primary_agent_id uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ── AGENTS (outreach targets — separate from inbound leads) ───────────────────
create table if not exists agents (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text unique,
  phone       text,
  team_id     uuid references teams(id) on delete set null,
  is_primary  boolean default false,
  zillow_url  text,
  instagram   text,
  status      text default 'pending'
              check (status in ('pending','sent','replied','qualified','closed','locked')),
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Add FK from teams → agents (deferred so both can be inserted together)
alter table teams add constraint if not exists fk_teams_primary_agent
  foreign key (primary_agent_id) references agents(id)
  on delete set null
  deferrable initially deferred;

-- ── OUTREACH LOG ───────────────────────────────────────────────────────────────
create table if not exists outreach_log (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid references agents(id) on delete cascade,
  team_id        uuid references teams(id) on delete cascade,
  contact_method text not null
                 check (contact_method in ('sms','email','dm','call','other')),
  contacted_at   timestamptz default now(),
  status         text default 'sent'
                 check (status in ('sent','replied','qualified','closed','bounced')),
  locked         boolean default false,
  notes          text,
  created_at     timestamptz default now()
);

-- ── PERFORMANCE INDEXES ────────────────────────────────────────────────────────
create index if not exists idx_agents_email    on agents(email);
create index if not exists idx_agents_phone    on agents(phone);
create index if not exists idx_agents_team_id  on agents(team_id);
create index if not exists idx_agents_status   on agents(status);
create index if not exists idx_outreach_agent  on outreach_log(agent_id);
create index if not exists idx_outreach_team   on outreach_log(team_id);
create index if not exists idx_outreach_locked on outreach_log(locked) where locked = true;

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table chat_settings enable row level security;
alter table teams          enable row level security;
alter table agents         enable row level security;
alter table outreach_log   enable row level security;
