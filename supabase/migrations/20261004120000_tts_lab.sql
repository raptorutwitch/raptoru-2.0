-- TTS V2, Lab slice: Extension Lab → Core → Studio TTS worker → local player / OBS overlay. Test only.
-- Isolated tables (Lab database): no link to viewers / wallets / loyalty / stats. The constraints
-- make a real payment impossible to record and a second refund impossible to write.
-- Core decides price, cooldown, queue order and the cast (character + voice) once, at admission.

-- Module state and authoritative rules snapshot (single row). Rules are Core defaults unless set.
create table tts_lab_settings (
  id boolean primary key default true check (id),
  module_state text not null check (module_state in ('active', 'paused', 'disabled')),
  rules jsonb,
  updated_at timestamptz not null
);

-- Durable per-channel order + last character (legacy: never the same character twice in a row).
create table tts_lab_channels (
  channel_id text primary key,
  last_sequence bigint not null default 0,
  last_character_id text
);

create table tts_lab_interactions (
  interaction_id uuid primary key,
  idempotency_key text not null,
  request_hash text not null,
  source text not null check (source = 'extension_lab'),
  channel_id text not null references tts_lab_channels (channel_id),
  viewer_id text not null,
  viewer_display_name text not null,
  type text not null check (type = 'tts'),
  message text not null check (char_length(message) between 1 and 8000),
  length integer not null check (length > 0),
  tier_id text not null,
  character_id text not null,
  voice_profile_id text not null,
  voice_category text not null check (voice_category in ('normal', 'japanese', 'variant')),
  estimated_duration_ms integer not null check (estimated_duration_ms > 0),
  estimated_weight integer not null check (estimated_weight > 0),
  cooldown_seconds integer not null check (cooldown_seconds >= 0),
  created_at timestamptz not null,
  channel_sequence bigint not null,
  test_mode boolean not null check (test_mode),
  payment_mode text not null check (payment_mode = 'simulated'),
  payment_method text not null check (payment_method in ('tokens', 'credits')),
  simulated_cost integer not null check (simulated_cost >= 0),
  simulated_currency text not null,
  real_debited integer not null default 0 check (real_debited = 0),
  -- At most one refund: 'none' → 'refunded' only (see the conditional update in Core).
  refund_status text not null default 'none' check (refund_status in ('none', 'refunded')),
  refunded_at timestamptz,
  status text not null check (status in ('queued', 'starting', 'playing', 'completed', 'failed', 'execution_unknown', 'cancelled')),
  lab_session_id text not null,
  expires_at timestamptz not null,
  error jsonb,
  updated_at timestamptz not null,
  unique (channel_id, viewer_id, idempotency_key),
  unique (channel_id, channel_sequence),
  check ((refund_status = 'refunded') = (refunded_at is not null))
);

create index tts_lab_interactions_open_idx on tts_lab_interactions (channel_id, channel_sequence)
  where status in ('queued', 'starting', 'playing');
create index tts_lab_interactions_viewer_idx on tts_lab_interactions (channel_id, viewer_id, created_at desc);

-- Execution metadata of the current attempt (one attempt per interaction: never replayed).
create table tts_lab_deliveries (
  interaction_id uuid primary key references tts_lab_interactions (interaction_id),
  studio_instance_id text not null,
  attempt_id text not null,
  lease_expires_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz
);

-- Studio worker readiness (heartbeat). Admission requires a fresh Studio with a live player.
create table tts_lab_studios (
  studio_instance_id text primary key,
  player_ready boolean not null,
  last_seen timestamptz not null
);

-- Per-viewer moderation state: block (optionally until), cooldown (starts at the real audio start).
create table tts_lab_viewers (
  channel_id text not null,
  viewer_id text not null,
  blocked boolean not null default false,
  blocked_until timestamptz,
  cooldown_until timestamptz,
  updated_at timestamptz not null,
  primary key (channel_id, viewer_id)
);

-- Audit trail of moderation actions and refunds (Moderation V2 will read it).
create table tts_lab_audit (
  id bigserial primary key,
  channel_id text not null,
  actor text not null,
  action text not null,
  interaction_id uuid,
  viewer_id text,
  detail jsonb,
  created_at timestamptz not null
);
