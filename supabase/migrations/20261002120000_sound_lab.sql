-- Soundboard V2, Lab slice: Extension Lab → Core → Studio → local audio player. Test only.
-- Isolated tables: no link to viewers/wallets/loyalty/stats; the constraints make a real payment
-- impossible to record. The sound file is resolved by Core from its own bank, never from the
-- caller.

-- Streamer settings per sound (the bank itself — files, durations — is in Core code).
create table sound_lab_sounds (
  sound_id text primary key check (sound_id ~ '^[a-z0-9][a-z0-9_-]{0,47}$'),
  label text not null check (length(label) between 1 and 40),
  enabled boolean not null,
  token_cost integer not null check (token_cost between 0 and 1000000),
  credit_cost integer not null check (credit_cost between 0 and 100),
  cooldown_ms integer not null check (cooldown_ms between 0 and 3600000),
  playback_mode text not null check (playback_mode in ('stack', 'queue', 'ignore_if_running')),
  volume integer not null check (volume between 0 and 100),
  updated_at timestamptz not null
);

-- Global Soundboard settings (single row).
create table sound_lab_settings (
  id boolean primary key default true check (id),
  volume_protection text not null check (volume_protection in ('off', 'light', 'medium')),
  updated_at timestamptz not null
);

-- Durable per-channel order: channel_sequence is allocated under this row's lock.
create table sound_lab_channels (
  channel_id text primary key,
  last_sequence bigint not null default 0
);

create table sound_lab_interactions (
  interaction_id uuid primary key,
  idempotency_key text not null,
  request_hash text not null,
  source text not null check (source = 'extension_lab'),
  channel_id text not null references sound_lab_channels (channel_id),
  viewer_id text not null,
  viewer_display_name text not null,
  type text not null check (type = 'sound'),
  -- What the viewer asked for (e.g. `random`) and what Core chose to play.
  requested_sound_id text not null,
  sound_id text not null,
  sound_label text not null,
  sound_url text not null,
  duration_ms integer not null check (duration_ms > 0),
  -- Settings snapshot at admission.
  playback_mode text not null check (playback_mode in ('stack', 'queue', 'ignore_if_running')),
  volume integer not null check (volume between 0 and 100),
  created_at timestamptz not null,
  channel_sequence bigint not null,
  test_mode boolean not null check (test_mode),
  payment_mode text not null check (payment_mode = 'simulated'),
  payment_method text not null check (payment_method in ('tokens', 'credits')),
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

create index sound_lab_interactions_open_idx on sound_lab_interactions (channel_id, channel_sequence)
  where status in ('accepted', 'queued', 'executing');
create index sound_lab_interactions_cooldown_idx on sound_lab_interactions (channel_id, requested_sound_id, created_at);

-- Execution metadata, separate from the authoritative interaction (current attempt only).
create table sound_lab_deliveries (
  interaction_id uuid primary key references sound_lab_interactions (interaction_id),
  studio_instance_id text not null,
  attempt_id text not null,
  lease_expires_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz
);

-- Studio worker readiness (heartbeat). Admission requires a fresh Studio with a live player.
create table sound_lab_studios (
  studio_instance_id text primary key,
  player_ready boolean not null,
  last_seen timestamptz not null
);
