-- Bonk V2, Lab slice: Extension Lab → Core → Studio → OBS. Test only. Isolated tables: no link to
-- viewers/wallets/loyalty/stats; the constraints make a real payment impossible to record.

-- Durable per-channel order: channel_sequence is allocated under this row's lock.
create table bonk_lab_channels (
  channel_id text primary key,
  last_sequence bigint not null default 0
);

create table bonk_lab_interactions (
  interaction_id uuid primary key,
  idempotency_key text not null,
  request_hash text not null,
  source text not null check (source = 'extension_lab'),
  channel_id text not null references bonk_lab_channels (channel_id),
  viewer_id text not null,
  viewer_display_name text not null,
  type text not null check (type = 'bonk'),
  provider text not null check (provider = 'unicode'),
  emote_id text not null,
  emote_glyph text,
  emote_url text not null,
  emote_animated boolean not null,
  quantity integer not null check (quantity = 1),
  created_at timestamptz not null,
  channel_sequence bigint not null,
  test_mode boolean not null check (test_mode),
  payment_mode text not null check (payment_mode = 'simulated'),
  simulated_cost integer not null,
  simulated_currency text not null,
  real_debited integer not null default 0 check (real_debited = 0),
  status text not null check (status in ('accepted', 'queued', 'executing', 'completed', 'failed', 'execution_unknown')),
  lab_session_id text not null,
  expires_at timestamptz not null,
  error jsonb,
  updated_at timestamptz not null,
  unique (channel_id, viewer_id, idempotency_key),
  unique (channel_id, channel_sequence)
);

create index bonk_lab_interactions_open_idx on bonk_lab_interactions (channel_id, channel_sequence)
  where status in ('accepted', 'queued', 'executing');

-- Execution metadata, separate from the authoritative interaction (current attempt only).
create table bonk_lab_deliveries (
  interaction_id uuid primary key references bonk_lab_interactions (interaction_id),
  studio_instance_id text not null,
  attempt_id text not null,
  lease_expires_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz
);

-- Studio worker readiness (heartbeat). Admission requires a fresh, ready Studio.
create table bonk_lab_studios (
  studio_instance_id text primary key,
  obs text not null check (obs in ('connected', 'offline')),
  source_ready boolean not null,
  overlay_ready boolean not null,
  last_seen timestamptz not null
);
