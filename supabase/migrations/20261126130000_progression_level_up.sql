-- Progression native, Level Up V2 (docs/LEVEL_UP_V2.md) — PRODUCTION schema. Same content as the Lab file
-- 20261126120000_progression_level_up_lab.sql. Additive: three new tables, one new nullable column, one widened check
-- (NOT VALID: the existing rows are not rescanned, nothing is locked for long); nothing existing is changed or
-- deleted. Nothing changes for the viewers until the guarded activation in Studio.
-- - progression_normalizations: the audit of the one-time level normalization (WizeBot level, level and XP before,
--   native XP kept, new level and XP), per version; its undo keeps the rows (reverted_at).
-- - progression_ledger kind 'normalization': the XP movement of that normalization (never activity: no period, no
--   announcement).
-- - progression_level_events: a real level-up (presence / chat), once per ledger movement; its stream notification
--   (the viewer's mode, delivered / skipped / expired / merged, with or without sound) and its chat announcement
--   (chat_status: pending / sent / skipped / expired / merged, independent of the stream notification).
-- - progression_viewer_prefs: the viewer's level-up mode, chosen in the extension (absent: the channel's default).
-- - progression_accounts.last_message_fp: the fingerprint of the viewer's last REWARDED message (repeated text earns
--   nothing within the repeat window).
-- Written to be applied on a Lab database that already ran the first version of this file (20261115*): every
-- statement is « if not exists ».
-- Rollback: drop table progression_viewer_prefs, progression_level_events, progression_normalizations;
--   alter table progression_accounts drop column if exists last_message_fp;
--   alter table progression_ledger drop constraint progression_ledger_kind_check;
--   alter table progression_ledger add constraint progression_ledger_kind_check
--   check (kind in ('presence', 'message', 'import', 'grant', 'correction')) not valid;
--   delete from schema_migrations where name = '20261126130000_progression_level_up.sql';

create table if not exists progression_normalizations (
  channel_id text not null,
  version integer not null check (version >= 1),
  twitch_user_id text not null,
  wizebot_level integer,
  previous_level integer not null,
  previous_xp bigint not null,
  native_xp bigint not null,
  new_level integer not null,
  new_xp bigint not null check (new_xp >= 0),
  applied_at timestamptz not null,
  reverted_at timestamptz,
  primary key (channel_id, version, twitch_user_id)
);

alter table progression_ledger drop constraint if exists progression_ledger_kind_check;
alter table progression_ledger add constraint progression_ledger_kind_check
  check (kind in ('presence', 'message', 'import', 'grant', 'correction', 'normalization')) not valid;

create table if not exists progression_level_events (
  id bigserial primary key,
  channel_id text not null,
  twitch_user_id text not null,
  display_name text not null,
  from_level integer not null,
  to_level integer not null check (to_level > from_level),
  -- The ledger movement that crossed the level: one event per movement, a replay never makes a second one.
  source_key text not null,
  notify_mode text not null check (notify_mode in ('off', 'text', 'sound')),
  status text not null check (status in ('pending', 'delivered', 'skipped', 'expired', 'merged')),
  reason text,
  sound boolean not null default false,
  consumer text,
  created_at timestamptz not null,
  delivered_at timestamptz,
  unique (channel_id, source_key)
);
-- The chat announcement of that level-up (the commands' outbox, LeCroupier_), apart from the stream notification.
alter table progression_level_events add column if not exists login text;
alter table progression_level_events add column if not exists chat_status text not null default 'skipped'
  check (chat_status in ('pending', 'sent', 'skipped', 'expired', 'merged'));
alter table progression_level_events add column if not exists chat_reason text;
alter table progression_level_events add column if not exists chat_at timestamptz;
create index if not exists progression_level_events_pending
  on progression_level_events (channel_id, id) where status = 'pending';
create index if not exists progression_level_events_chat_pending
  on progression_level_events (channel_id, id) where chat_status = 'pending';
create index if not exists progression_level_events_recent on progression_level_events (channel_id, id desc);

create table if not exists progression_viewer_prefs (
  channel_id text not null,
  twitch_user_id text not null,
  level_up_notify text not null default 'off' check (level_up_notify in ('off', 'text', 'sound')),
  updated_at timestamptz not null,
  primary key (channel_id, twitch_user_id)
);

alter table progression_accounts add column if not exists last_message_fp text;
