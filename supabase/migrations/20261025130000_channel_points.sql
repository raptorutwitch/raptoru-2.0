-- Points de chaîne V1 — PRODUCTION schema (17/10/2026, docs/CHANNEL_POINTS_V1.md). The same tables as the Lab file
-- 20261025120000_channel_points_lab.sql (checked by test/channel-points-migration.test.ts). Additive and idempotent
-- (if not exists): five new tables, and the Soundboard table accepts sounds paid by channel points. Nothing reads the
-- new tables until the Core serves /v1/studio/channel-points; the master switch is OFF.
-- Rollback (only while nothing worth keeping is stored, and no sound row uses `channel_points`):
--   drop table cp_jobs; drop table cp_redemptions; drop table cp_rules; drop table cp_rewards; drop table cp_settings;
--   restore the two sound_lab_interactions checks to ('extension_lab') and ('tokens', 'credits');
--   delete from schema_migrations where name = '20261025130000_channel_points.sql';

create table if not exists cp_settings (
  channel_id text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null,
  updated_by text
);

create table if not exists cp_rewards (
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

create table if not exists cp_rules (
  channel_id text not null,
  reward_id text not null,
  enabled boolean not null,
  actions jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null,
  primary key (channel_id, reward_id)
);

create table if not exists cp_redemptions (
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
  actions jsonb not null default '[]',
  results jsonb not null default '[]',
  job_id uuid,
  primary key (channel_id, source, redemption_id)
);
create index if not exists cp_redemptions_recent on cp_redemptions (channel_id, received_at desc);

create table if not exists cp_jobs (
  job_id uuid primary key,
  channel_id text not null,
  source text not null,
  redemption_id text not null,
  seq bigint generated always as identity,
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
create unique index if not exists cp_jobs_one_in_flight on cp_jobs (channel_id) where status in ('claimed', 'running');
create index if not exists cp_jobs_next on cp_jobs (channel_id, seq) where status = 'queued';

-- Soundboard (when its table exists): sounds paid by channel points.
do $$
begin
  if to_regclass('sound_lab_interactions') is not null then
    alter table sound_lab_interactions drop constraint if exists sound_lab_interactions_source_check;
    alter table sound_lab_interactions add constraint sound_lab_interactions_source_check
      check (source in ('extension_lab', 'channel_points'));
    alter table sound_lab_interactions drop constraint if exists sound_lab_interactions_payment_method_check;
    alter table sound_lab_interactions add constraint sound_lab_interactions_payment_method_check
      check (payment_method in ('tokens', 'credits', 'channel_points'));
  end if;
end $$;
