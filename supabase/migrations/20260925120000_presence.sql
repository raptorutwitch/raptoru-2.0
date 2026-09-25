-- Presence tracker V1 (shadow mode): estimated watch time from Get Chatters snapshots.
-- No wallet, no credits: observation data only. Only core-api writes these tables.

-- One worker per channel at a time. A worker must hold the lease to report observations.
create table presence_lease (
  channel text primary key,
  worker_id text not null,
  expires_at timestamptz not null
);

-- One row per snapshot attempt (~30/hour of live), successful or not.
create table presence_cycles (
  id bigint generated always as identity primary key,
  cycle_id text not null unique,
  stream_id text not null references stream_sessions (stream_id),
  worker_id text not null,
  observed_at timestamptz not null,
  received_at timestamptz not null,
  duration_ms integer not null,
  live_state_age_s integer,
  status text not null check (status in ('ok', 'error')),
  error_kind text,
  http_status integer,
  error_message text,
  chatter_count integer,
  reported_total integer,
  pages integer,
  -- Length of the interval ending at this cycle that was credited (0 if none) and why not.
  credited_seconds integer not null default 0 check (credited_seconds >= 0),
  credited_viewers integer not null default 0,
  gap_reason text,
  check ((status = 'ok') = (chatter_count is not null)),
  check ((status = 'error') = (error_kind is not null))
);

create index presence_cycles_stream_idx on presence_cycles (stream_id, observed_at);

-- One row per viewer per stream: the durable aggregate (no per-second or per-snapshot rows).
create table presence_viewer_streams (
  stream_id text not null references stream_sessions (stream_id),
  twitch_user_id text not null references viewers (twitch_user_id),
  estimated_watch_seconds integer not null default 0 check (estimated_watch_seconds >= 0),
  snapshots_present integer not null default 0,
  intervals_credited integer not null default 0,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  -- Last snapshot containing this viewer: an interval is credited only if it is the previous one.
  last_seen_cycle bigint not null references presence_cycles (id),
  primary key (stream_id, twitch_user_id)
);
