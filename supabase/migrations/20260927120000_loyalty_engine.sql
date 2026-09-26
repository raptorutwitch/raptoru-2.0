-- Loyalty Engine V1: config, exclusions, subscription tier cache, passive aggregation and computed
-- rewards with a frozen breakdown. Wallet writes only happen for rewards in 'pending' status
-- (credit flags), never in preview. Only core-api writes these tables.

-- Structured config (single row). Missing row = code defaults. Read at each reward: changes apply
-- to the next rewards only.
create table loyalty_config (
  id integer primary key default 1 check (id = 1),
  config jsonb not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

-- Viewers excluded from passive gains (bots, technical accounts, streamer…).
create table loyalty_exclusions (
  twitch_user_id text primary key references viewers (twitch_user_id),
  reason text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- Current subscription tier, fed by Twitch events and reconciled by full snapshots.
create table viewer_subscriptions (
  twitch_user_id text primary key references viewers (twitch_user_id),
  tier text not null check (tier in ('t1', 't2', 't3')),
  is_gift boolean not null default false,
  source text not null check (source in ('event', 'snapshot')),
  updated_at timestamptz not null default now()
);

-- Freshness of the last complete snapshot: absence from a fresh snapshot means "not subscribed";
-- without one, a viewer's tier is unknown (never silently "none").
create table loyalty_sub_sync (
  id integer primary key default 1 check (id = 1),
  last_snapshot_at timestamptz not null,
  subscriber_count integer not null
);

-- Validated presence accumulated per stream and viewer, and passive ticks already awarded.
create table loyalty_passive_progress (
  stream_id text not null references stream_sessions (stream_id),
  twitch_user_id text not null references viewers (twitch_user_id),
  validated_seconds integer not null default 0 check (validated_seconds >= 0),
  ticks integer not null default 0 check (ticks >= 0),
  updated_at timestamptz not null default now(),
  primary key (stream_id, twitch_user_id)
);

-- Every computed reward (preview or credit), with the calculation frozen at computation time.
create table loyalty_rewards (
  id bigint generated always as identity primary key,
  idempotency_key text not null unique,
  request_hash text not null,
  source text not null check (source in ('passive_watch', 'sub', 'resub', 'subgift', 'bits', 'tip', 'follow')),
  twitch_user_id text not null references viewers (twitch_user_id),
  stream_id text,
  currency_id text not null,
  amount integer check (amount is null or amount >= 0),
  status text not null check (status in ('preview', 'pending', 'credited', 'excluded', 'tier_unknown', 'rejected')),
  breakdown jsonb not null,
  wallet_operation_id bigint references wallet_operations (id),
  error text,
  created_at timestamptz not null default now(),
  credited_at timestamptz
);

create index loyalty_rewards_viewer_idx on loyalty_rewards (twitch_user_id, id desc);
create index loyalty_rewards_stream_idx on loyalty_rewards (stream_id) where stream_id is not null;
create index loyalty_rewards_pending_idx on loyalty_rewards (id) where status = 'pending';
