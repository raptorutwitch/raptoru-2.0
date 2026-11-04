-- Défis et succès (raptoru.fr lot 5; docs/CHALLENGES.md) — PRODUCTION schema. Lab twin: 20261120120000_challenges_lab.sql
-- (same content). New tables only, nothing existing is changed. Prepared, NOT applied (needs Antoni's GO).
-- - challenge_defs: what Antoni creates in Studio (a metric, a threshold, a period, a reward). Nothing is seeded: the
--   catalogue is empty until he writes it. Once activated, the condition is frozen (only the texts may change).
-- - challenge_progress: the viewer's value per challenge and period, written by the Core's recount (never by a read).
-- - challenge_awards: one row per (challenge, period, viewer) = never two rewards; the payment itself goes through
--   cosmetic_awards (`challenges:<award_key>`, the existing idempotent award) so a crash between the two is replayed.
-- - challenge_runs / challenge_log: every recount, every change of value (before, after), completion, award, correction.
-- Rollback (nothing else depends on them): drop table challenge_log, challenge_runs, challenge_awards,
--   challenge_progress, challenge_defs; delete from schema_migrations where name = '20261120130000_challenges.sql';

create table if not exists challenge_defs (
  channel_id text not null,
  challenge_id text not null check (challenge_id ~ '^[a-z0-9][a-z0-9_-]{0,47}$'),
  version integer not null default 1 check (version >= 1),
  title text not null check (length(title) between 1 and 80),
  description text not null default '' check (length(description) <= 400),
  category text not null default 'general' check (category ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  icon text check (icon is null or icon ~ '^[a-z0-9_-]{1,32}$'),
  metric text not null check (metric ~ '^[a-z0-9_]{1,48}$'),
  target bigint not null check (target between 1 and 1000000000),
  period text not null default 'once' check (period in ('once', 'week', 'month')),
  starts_at timestamptz,
  ends_at timestamptz,
  retroactive boolean not null default false,
  visibility text not null default 'public' check (visibility in ('public', 'secret')),
  reward jsonb,
  status text not null default 'draft' check (status in ('draft', 'active', 'suspended', 'archived')),
  -- First activation: where a non-retroactive challenge starts counting. Never moved afterwards.
  activated_at timestamptz,
  created_by text not null,
  created_at timestamptz not null,
  updated_by text not null,
  updated_at timestamptz not null,
  primary key (channel_id, challenge_id),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists challenge_progress (
  channel_id text not null,
  challenge_id text not null,
  -- 'all' (once), 'w2026-11-02' (week starting that Monday, Europe/Paris), 'm2026-11' (month).
  period_key text not null check (period_key ~ '^(all|w\d{4}-\d{2}-\d{2}|m\d{4}-\d{2})$'),
  viewer_id text not null,
  value bigint not null check (value >= 0),
  target bigint not null,
  version integer not null,
  completed_at timestamptz,
  updated_at timestamptz not null,
  primary key (channel_id, challenge_id, period_key, viewer_id),
  foreign key (channel_id, challenge_id) references challenge_defs (channel_id, challenge_id)
);
create index if not exists challenge_progress_viewer on challenge_progress (channel_id, viewer_id);

create table if not exists challenge_awards (
  channel_id text not null,
  challenge_id text not null,
  period_key text not null,
  viewer_id text not null,
  version integer not null,
  reward jsonb not null,
  award_key text not null unique,
  status text not null check (status in ('pending', 'granted', 'failed', 'revoked')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null,
  granted_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  primary key (channel_id, challenge_id, period_key, viewer_id),
  foreign key (channel_id, challenge_id) references challenge_defs (channel_id, challenge_id)
);
create index if not exists challenge_awards_open on challenge_awards (channel_id, created_at) where status in ('pending', 'failed');

create table if not exists challenge_runs (
  run_id uuid primary key,
  channel_id text not null,
  trigger text not null check (trigger in ('auto', 'manual', 'activation')),
  actor text,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('running', 'done', 'failed')),
  summary jsonb,
  error text
);
create index if not exists challenge_runs_recent on challenge_runs (channel_id, started_at desc);

create table if not exists challenge_log (
  id bigserial primary key,
  channel_id text not null,
  run_id uuid,
  challenge_id text not null,
  period_key text,
  viewer_id text,
  kind text not null check (kind in ('progress', 'completed', 'below_target', 'award_granted', 'award_failed',
    'award_revoked', 'admin')),
  before bigint,
  after bigint,
  detail jsonb,
  actor text,
  at timestamptz not null
);
create index if not exists challenge_log_challenge on challenge_log (channel_id, challenge_id, at desc);
