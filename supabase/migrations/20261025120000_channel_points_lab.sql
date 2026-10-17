-- Points de chaîne V1 (17/10/2026, docs/CHANNEL_POINTS_V1.md) — Lab database. Same schema as the production file
-- 20261025130000_channel_points.sql (checked by apps/core-api/test/channel-points-migration.test.ts). Additive.
-- Twitch channel points redemptions (read only) → per-reward rules → typed actions: Soundboard sounds (through the
-- Soundboard queue, paid by the channel points) and OBS actions run by Studio.

-- Master switch per channel: OFF by default, never turned on by a migration or a start.
create table cp_settings (
  channel_id text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null,
  updated_by text
);

-- The broadcaster's custom rewards as Twitch lists them (or as last seen in a redemption).
create table cp_rewards (
  channel_id text not null,
  reward_id text not null,
  title text not null,
  cost integer not null,
  prompt text,
  is_enabled boolean,
  user_input_required boolean not null default false,
  source text not null check (source in ('twitch_api', 'redemption')),
  last_seen_at timestamptz not null,
  primary key (channel_id, reward_id)
);

-- One rule per reward: enabled flag, ordered actions (typed, validated by Core), version for concurrent edits.
create table cp_rules (
  channel_id text not null,
  reward_id text not null,
  enabled boolean not null,
  actions jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null,
  primary key (channel_id, reward_id)
);

-- One row per received redemption: the dedup key (a redelivery changes nothing), what Core decided, per-action results.
create table cp_redemptions (
  channel_id text not null,
  source text not null check (source in ('twitch', 'simulation')),
  redemption_id text not null,
  reward_id text not null,
  reward_title text not null,
  reward_cost integer not null,
  user_id text not null,
  user_login text not null,
  user_name text not null,
  user_input text,
  twitch_status text,
  redeemed_at timestamptz not null,
  received_at timestamptz not null,
  status text not null check (status in ('ignored', 'pending', 'done', 'partial', 'failed')),
  reason text,
  -- Frozen copy of the rule's actions at reception, and one result per action.
  actions jsonb not null default '[]',
  results jsonb not null default '[]',
  job_id uuid,
  primary key (channel_id, source, redemption_id)
);
create index cp_redemptions_recent on cp_redemptions (channel_id, received_at desc);

-- OBS part of a redemption, executed by Studio: one job in flight per channel, lease, never replayed once started.
create table cp_jobs (
  job_id uuid primary key,
  channel_id text not null,
  source text not null,
  redemption_id text not null,
  seq bigint generated always as identity,
  -- [{index, action}] — the OBS actions of the redemption, with their index in the rule.
  actions jsonb not null,
  status text not null check (status in ('queued', 'claimed', 'running', 'completed', 'failed', 'expired')),
  consumer_id text,
  attempt_id uuid,
  attempts integer not null default 0,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  claimed_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  failure text,
  check ((status in ('claimed', 'running')) = (attempt_id is not null and lease_expires_at is not null))
);
create unique index cp_jobs_one_in_flight on cp_jobs (channel_id) where status in ('claimed', 'running');
create index cp_jobs_next on cp_jobs (channel_id, seq) where status = 'queued';

-- Soundboard: a sound may now be played for a channel points reward (paid on Twitch: no wallet debit, no refund).
alter table sound_lab_interactions drop constraint sound_lab_interactions_source_check;
alter table sound_lab_interactions add constraint sound_lab_interactions_source_check
  check (source in ('extension_lab', 'channel_points'));
alter table sound_lab_interactions drop constraint sound_lab_interactions_payment_method_check;
alter table sound_lab_interactions add constraint sound_lab_interactions_payment_method_check
  check (payment_method in ('tokens', 'credits', 'channel_points'));
