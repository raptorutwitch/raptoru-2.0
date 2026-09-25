-- Daily v1: stream sessions, stream-days, viewer Daily state, claims, credits and attempt journal.
-- Only core-api writes these tables.

create table viewers (
  twitch_user_id text primary key check (twitch_user_id ~ '^[0-9]+$'),
  login text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A stream-day exists only once a live actually aired in it. Days without stream never appear here.
create table stream_days (
  day date primary key,
  opened_at timestamptz not null
);

-- One row per Twitch broadcast (stream_id = Twitch stream id). stream_day is fixed when the live starts.
create table stream_sessions (
  stream_id text primary key,
  stream_day date not null references stream_days (day),
  started_at timestamptz not null,
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);

-- The channel has at most one live at a time.
create unique index stream_sessions_single_open on stream_sessions ((ended_at is null)) where ended_at is null;

create table daily_stats (
  twitch_user_id text primary key references viewers (twitch_user_id),
  total_daily integer not null default 0 check (total_daily >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  best_streak integer not null default 0 check (best_streak >= current_streak),
  last_claim_day date references stream_days (day),
  updated_at timestamptz not null default now()
);

create table daily_claims (
  id bigint generated always as identity primary key,
  twitch_user_id text not null references viewers (twitch_user_id),
  stream_day date not null references stream_days (day),
  -- Null only for history imported from the legacy system.
  stream_id text references stream_sessions (stream_id),
  request_id text unique,
  source text not null check (source in ('chat', 'import')),
  claimed_at timestamptz not null,
  streak_before integer,
  streak_after integer not null,
  total_before integer,
  total_after integer not null,
  best_after integer not null,
  reward integer not null check (reward >= 0),
  unique (twitch_user_id, stream_day),
  check (source = 'import' or (stream_id is not null and request_id is not null
    and streak_before is not null and total_before is not null))
);

-- Exactly one credit per paid claim. 'sending' left behind by a crash becomes 'unknown' and is
-- never retried automatically: it must be reconciled against the wallet provider.
create table daily_credits (
  claim_id bigint primary key references daily_claims (id),
  twitch_user_id text not null,
  login text not null,
  amount integer not null check (amount > 0),
  provider text not null,
  status text not null check (status in ('pending', 'sending', 'credited', 'failed', 'unknown')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index daily_credits_open_idx on daily_credits (status) where status <> 'credited';

-- Every !daily attempt, accepted or not, with the state before/after.
create table daily_attempts (
  id bigint generated always as identity primary key,
  attempted_at timestamptz not null,
  twitch_user_id text not null,
  login text not null,
  request_id text not null,
  outcome text not null check (outcome in ('claimed', 'already_claimed', 'no_active_stream', 'replayed')),
  stream_id text,
  stream_day date,
  claim_id bigint references daily_claims (id),
  streak_before integer,
  streak_after integer,
  total_before integer,
  total_after integer,
  reward integer
);

create index daily_attempts_viewer_idx on daily_attempts (twitch_user_id, attempted_at desc);

-- Streamer-editable Daily configuration (single row). Missing row = code defaults.
create table daily_config (
  id integer primary key default 1 check (id = 1),
  config jsonb not null,
  updated_at timestamptz not null default now()
);
