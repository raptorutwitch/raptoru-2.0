-- Chaos V2 lot 2 — the Core's `chaos` module (docs/chaos/CONTRAT_LOT2.md § 2) — production database. Same content as
-- the Lab file 20261206120000_chaos_lab.sql. Additive: new tables only, and the D4 restriction checks widened with
-- `chaos` (the full list restated, every existing value still valid). Nothing is enabled by this file: purchases stay
-- refused until the module setting `chaos.enabled` = 1 AND the Core's CHAOS_EXTENSION lets the viewer in.

-- One row per channel: its lock (every admission, claim, ACK, sweep and moderation command of the channel takes it)
-- and the purchases' switch from moderation (« Ouverts / Suspendus »).
create table if not exists chaos_channels (
  channel_id text primary key,
  state text not null default 'open' check (state in ('open', 'paused')),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- What each Studio last told the Core (heartbeat every 3 s): engine ready, Safety ceiling, soft mode, effects enabled.
create table if not exists chaos_studios (
  studio_instance_id text primary key,
  channel_id text not null,
  engine_ready boolean not null,
  safety_max_ms integer not null check (safety_max_ms between 1000 and 60000),
  safe_mode boolean not null,
  effects jsonb not null default '{}'::jsonb,
  last_seen timestamptz not null
);
create index if not exists chaos_studios_channel on chaos_studios (channel_id, last_seen desc);

-- A purchase (or a gift from moderation) of one effect: its normalized choice, the engine request built by the Core,
-- its price and payment, its execution by Studio (claim → lease → ACK) and its refund (at most once).
create table if not exists chaos_requests (
  id uuid primary key,
  seq bigint generated always as identity,
  channel_id text not null,
  viewer_id text not null,
  viewer_name text not null,
  idempotency_key text not null,
  request_hash text not null,
  effect text not null,
  preset text,
  level text,
  choice jsonb not null,
  engine_request jsonb not null,
  duration_ms integer not null check (duration_ms between 1000 and 60000),
  price integer not null check (price >= 0),
  payment text not null check (payment in ('jetons', 'credit', 'gift')),
  credit_id uuid,
  -- a purchase « à charges » (Un clignement): its own queue (burst) and caps
  charged boolean not null default false,
  -- a gift from moderation passes before the queue
  priority smallint not null default 0,
  status text not null check (status in ('queued', 'claimed', 'started', 'ended', 'failed', 'canceled', 'expired')),
  code text,
  reason text,
  refund_status text not null default 'none' check (refund_status in ('none', 'refunded')),
  refunded_at timestamptz,
  refund_reason text,
  actor text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  studio_instance_id text,
  attempt_id uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  played_ms integer,
  stop_requested_at timestamptz,
  stop_refund boolean,
  stop_reason text,
  updated_at timestamptz not null,
  unique (channel_id, viewer_id, idempotency_key)
);
create index if not exists chaos_requests_open on chaos_requests (channel_id, status, priority desc, seq)
  where status in ('queued', 'claimed', 'started');
create index if not exists chaos_requests_channel on chaos_requests (channel_id, seq desc);
create index if not exists chaos_requests_viewer on chaos_requests (channel_id, viewer_id, seq desc);

-- Effect credits given by the streamer or a moderator (EXTENSION_INTERACTIONS.md § 8): one effect, one use.
create table if not exists chaos_effect_credits (
  id uuid primary key,
  channel_id text not null,
  viewer_id text not null,
  viewer_name text,
  effect_id text not null,
  -- { max_duration_ms?, levels?: [], presets?: [] }
  constraints jsonb not null default '{}'::jsonb,
  source_kind text not null check (source_kind in ('streamer', 'moderator', 'reward', 'event')),
  source_actor_id text,
  reason text not null,
  granted_at timestamptz not null,
  expires_at timestamptz,
  state text not null default 'available' check (state in ('available', 'reserved', 'used', 'revoked', 'expired')),
  request_id uuid,
  updated_at timestamptz not null
);
create index if not exists chaos_effect_credits_viewer on chaos_effect_credits (channel_id, viewer_id, state);

-- The credits' journal, never modified.
create table if not exists chaos_effect_credit_events (
  id bigserial primary key,
  credit_id uuid not null references chaos_effect_credits (id),
  channel_id text not null,
  kind text not null check (kind in ('granted', 'reserved', 'used', 'restored', 'revoked', 'expired')),
  actor text not null,
  reason text,
  request_id uuid,
  at timestamptz not null
);
create index if not exists chaos_effect_credit_events_credit on chaos_effect_credit_events (credit_id, id);

-- A viewer's charges of a preset « à charges » at instant `at` (they come back with time: computed, never ticked).
create table if not exists chaos_charges (
  channel_id text not null,
  viewer_id text not null,
  effect text not null,
  preset text not null,
  n integer not null check (n >= 0),
  at timestamptz not null,
  primary key (channel_id, viewer_id, effect, preset)
);

-- Moderation (D4): Chaos gets the blocks and personal cooldowns of every module (widened checks only).
alter table if exists lab_viewer_blocks drop constraint if exists lab_viewer_blocks_module_id_check;
alter table if exists lab_viewer_blocks add constraint lab_viewer_blocks_module_id_check
  check (module_id in ('all', 'tts', 'soundboard', 'bonk', 'raffle', 'random_ban', 'chaos'));
alter table if exists lab_viewer_cooldowns drop constraint if exists lab_viewer_cooldowns_module_id_check;
alter table if exists lab_viewer_cooldowns add constraint lab_viewer_cooldowns_module_id_check
  check (module_id in ('tts', 'soundboard', 'bonk', 'random_ban', 'chaos'));
