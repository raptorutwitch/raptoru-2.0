-- Single active production bot (21/10/2026, docs/PLAN_POST_LIVE_2026-10-21.md lot 1) — production database. Additive.
-- Wherever it runs (VPS container, PC), a bot instance connects to Twitch only while it holds this lease (renewed every
-- 15 s, 45 s without renewal = free). bot_instances keeps what Studio shows: the holder's health and the instances
-- refused while waiting. Never a secret here: flags are booleans / modes, never values.

create table if not exists bot_lease (
  channel text primary key,
  instance_id text not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists bot_instances (
  instance_id text primary key,
  host text not null,
  version text not null,
  started_at timestamptz not null,
  state text not null check (state in ('active', 'standby', 'released')),
  health jsonb not null default '{}'::jsonb,
  flags jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null
);
create index if not exists bot_instances_recent on bot_instances (last_seen_at desc);
