-- Moderation V2 (Lab) + Lab test wallet. Lab database only (applied by the Studio local runtime /
-- bonk:lab launcher, never by the production migration flow). Core is the single source of truth:
-- module states, viewer restrictions, staff roles and the audit trail live here; Studio and the
-- extension only display and command.

-- Test wallet of the Lab (fictitious jetons and credits). Never linked to the real Wallet Core:
-- separate tables, Lab-only routes, local Lab Core only.
create table lab_wallets (
  channel_id text not null,
  viewer_id text not null,
  tokens bigint not null check (tokens between 0 and 1000000000),
  credits_tts integer not null check (credits_tts between 0 and 100000),
  credits_soundboard integer not null check (credits_soundboard between 0 and 100000),
  updated_at timestamptz not null,
  primary key (channel_id, viewer_id)
);

-- Every movement of the test wallet. A debit or a refund of an interaction is unique: at most one
-- debit and one refund per interaction, whatever the retries.
create table lab_wallet_ledger (
  id bigserial primary key,
  channel_id text not null,
  viewer_id text not null,
  kind text not null check (kind in ('set', 'adjust', 'reset', 'debit', 'refund')),
  currency text not null check (currency in ('tokens', 'credits_tts', 'credits_soundboard')),
  amount bigint not null,
  module_id text,
  interaction_id uuid,
  actor text not null,
  reason text,
  created_at timestamptz not null
);
create unique index lab_wallet_ledger_once on lab_wallet_ledger (interaction_id, kind)
  where interaction_id is not null and kind in ('debit', 'refund');
create index lab_wallet_ledger_viewer on lab_wallet_ledger (channel_id, viewer_id, id desc);

-- Module states other than TTS (TTS keeps tts_lab_settings.module_state).
create table lab_modules (
  module_id text primary key check (module_id in ('soundboard', 'bonk', 'raffle')),
  state text not null check (state in ('active', 'paused', 'disabled')),
  updated_at timestamptz not null,
  updated_by text not null
);

-- Viewer blocks: everything ('all') or one module; open-ended (until null) or temporary.
create table lab_viewer_blocks (
  channel_id text not null,
  viewer_id text not null,
  module_id text not null check (module_id in ('all', 'tts', 'soundboard', 'bonk', 'raffle')),
  until timestamptz,
  reason text,
  actor text not null,
  created_at timestamptz not null,
  primary key (channel_id, viewer_id, module_id)
);

-- Viewer cooldowns imposed by moderation (Soundboard / Bonk). TTS keeps its own per-viewer cooldown
-- (tts_lab_viewers.cooldown_until), which moderation edits directly.
create table lab_viewer_cooldowns (
  channel_id text not null,
  viewer_id text not null,
  module_id text not null check (module_id in ('soundboard', 'bonk', 'raffle')),
  until timestamptz not null,
  reason text,
  actor text not null,
  created_at timestamptz not null,
  primary key (channel_id, viewer_id, module_id)
);

-- Staff roles granted by the broadcaster on top of Twitch (a Twitch moderator is not a supermod).
create table lab_staff (
  channel_id text not null,
  viewer_id text not null,
  role text not null check (role in ('supermod')),
  granted_by text not null,
  created_at timestamptz not null,
  primary key (channel_id, viewer_id)
);

-- Single audit trail of every sensitive action (moderation, refunds, config, Lab wallet).
create table lab_moderation_audit (
  id bigserial primary key,
  channel_id text not null,
  created_at timestamptz not null,
  actor text not null,
  role text not null,
  module_id text,
  action text not null,
  viewer_id text,
  interaction_id uuid,
  reason text,
  before jsonb,
  after jsonb
);
create index lab_moderation_audit_channel on lab_moderation_audit (channel_id, id desc);

-- Soundboard: a waiting sound can be cancelled by moderation.
alter table sound_lab_interactions drop constraint sound_lab_interactions_status_check;
alter table sound_lab_interactions add constraint sound_lab_interactions_status_check
  check (status in ('accepted', 'queued', 'executing', 'completed', 'failed', 'execution_unknown', 'cancelled'));
