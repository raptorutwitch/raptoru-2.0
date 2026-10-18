-- Random Ban V2 (M1.1, 18/10/2026, docs/RANDOM_BAN_V2.md) — Lab database. Same schema as the production file
-- 20261026130000_random_ban.sql (checked by apps/core-api/test/random-ban-migration.test.ts). Additive.
-- One row per Random Ban request (channel points redemption, later `!rb`, or a Studio test): the dedup key, the state
-- machine (queued → searching → timeout_requested → confirmed / flop / failed / uncertain / simulated), the target,
-- the sanction, the refund still owed, and the animation handed to Studio's effects player.

create table rb_requests (
  request_id uuid primary key,
  channel_id text not null,
  seq bigint generated always as identity,
  source text not null check (source in ('channel_points', 'chat', 'test')),
  -- Dedup key of the trigger (channel points: source + redemption id + action index).
  source_ref text not null,
  mode text not null check (mode in ('real', 'dry_run', 'animation')),
  buyer_id text not null,
  buyer_login text not null,
  buyer_name text not null,
  status text not null check (status in ('queued', 'searching', 'timeout_requested', 'confirmed', 'flop', 'failed',
    'uncertain', 'simulated')),
  target_id text,
  target_login text,
  target_name text,
  target_is_sub boolean,
  duration_s integer check (duration_s between 1 and 1209600),
  reason text,
  error text,
  -- none · needed (certainly not applied, the buyer paid) · to_verify (uncertain)
  refund text not null default 'none' check (refund in ('none', 'needed', 'to_verify')),
  stats jsonb,
  executor_id text,
  attempt_id uuid,
  attempts integer not null default 0,
  lease_expires_at timestamptz,
  animation text,
  animation_status text not null default 'none'
    check (animation_status in ('none', 'pending', 'playing', 'completed', 'failed', 'unknown', 'skipped')),
  animation_consumer text,
  animation_lease_expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  ended_at timestamptz,
  unique (channel_id, source, source_ref)
);
create index rb_requests_recent on rb_requests (channel_id, created_at desc);
create index rb_requests_open on rb_requests (channel_id, seq) where status in ('queued', 'searching', 'timeout_requested');
