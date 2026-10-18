-- Roue du Sub (18/10/2026, docs/SUB_WHEEL.md) — Lab database. Same schema as the production file
-- 20261027130000_sub_wheel.sql (checked by apps/core-api/test/sub-wheel.test.ts). Additive.
-- One row per admissible Twitch event (sub, resub, Prime): the dedup key (the alert event), the draw decided once by
-- Core, the animation handed to Studio, and the gain — recorded, never credited automatically.

-- Switch per channel: OFF by default (gains not attributable yet), never turned on by a migration or a start.
create table sw_settings (
  channel_id text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null
);

create table sw_spins (
  spin_id uuid primary key,
  channel_id text not null,
  seq bigint generated always as identity,
  source text not null check (source in ('twitch', 'simulation', 'test')),
  -- The logical event (alert event source + its id): one wheel per event, whatever the redeliveries.
  event_key text not null,
  alert_id uuid,
  type text not null check (type in ('sub', 'resub')),
  viewer_id text,
  viewer_login text,
  viewer_name text not null,
  tier integer not null check (tier between 1 and 3),
  months integer not null check (months >= 0),
  status text not null check (status in ('ignored', 'queued', 'playing', 'shown', 'failed', 'skipped')),
  reason text,
  segment integer,
  amount bigint check (amount >= 0),
  award_status text not null default 'none'
    check (award_status in ('none', 'pending', 'awarded', 'manual', 'cancelled', 'test')),
  award_ref text,
  award_note text,
  award_updated_at timestamptz,
  animation_consumer text,
  animation_lease_expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  shown_at timestamptz,
  unique (channel_id, event_key)
);
create index sw_spins_recent on sw_spins (channel_id, created_at desc);
create index sw_spins_queue on sw_spins (channel_id, seq) where status in ('queued', 'playing');
create index sw_spins_awards on sw_spins (channel_id, award_status) where award_status = 'pending';
