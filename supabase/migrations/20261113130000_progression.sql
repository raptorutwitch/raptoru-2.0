-- Progression native (XP, niveaux, titres et badges ; docs/PROGRESSION.md) — PRODUCTION schema. Same content as the Lab
-- file 20261113120000_progression_lab.sql. Additive and idempotent: new tables only, nothing existing is changed.
-- Replaces WizeBot's levels: the Core is the source of truth for XP, levels, their history and the cosmetic rewards
-- (titles, badges) shown on raptoru.fr — never Twitch chat badges.
-- Rollback: drop table progression_history, progression_equipped, progression_grants, progression_rewards, progression_ledger,
--   progression_accounts, progression_settings cascade; drop function progression_ledger_immutable();
--   delete from schema_migrations where name = '20261113130000_progression.sql';

-- Per channel: OFF by default (no XP is counted before Antoni turns it on), the rules (XP sources, anti-spam, curve).
create table if not exists progression_settings (
  channel_id text primary key,
  enabled boolean not null default false,
  rules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null
);

-- One account per channel and viewer: totals for fast reads, always equal to the sum of its ledger.
create table if not exists progression_accounts (
  channel_id text not null,
  twitch_user_id text not null,
  xp bigint not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  watch_seconds bigint not null default 0 check (watch_seconds >= 0),
  messages bigint not null default 0 check (messages >= 0),
  last_message_xp_at timestamptz,
  -- Imported history (WizeBot), shown apart from what the Core measured itself.
  imported_watch_seconds bigint not null default 0 check (imported_watch_seconds >= 0),
  imported_messages bigint not null default 0 check (imported_messages >= 0),
  imported_level integer,
  updated_at timestamptz not null,
  primary key (channel_id, twitch_user_id)
);
create index if not exists progression_accounts_rank on progression_accounts (channel_id, xp desc);

-- Every XP movement, once (its key): presence interval, chat message, import, manual grant / correction.
create table if not exists progression_ledger (
  id bigserial primary key,
  channel_id text not null,
  twitch_user_id text not null,
  kind text not null check (kind in ('presence', 'message', 'import', 'grant', 'correction')),
  amount bigint not null,
  key text not null,
  actor text not null,
  reason text,
  created_at timestamptz not null,
  unique (channel_id, key)
);
create index if not exists progression_ledger_viewer on progression_ledger (channel_id, twitch_user_id, id desc);

-- Append-only: a movement is never edited; an import is undone by deleting its rows (documented rollback path).
create or replace function progression_ledger_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'progression_ledger is append-only';
end $$;
drop trigger if exists progression_ledger_no_update on progression_ledger;
create trigger progression_ledger_no_update before update on progression_ledger
  for each row execute function progression_ledger_immutable();

-- The catalogue of cosmetic rewards: titles and badges, by rarity and category; optionally unlocked at a level.
create table if not exists progression_rewards (
  channel_id text not null,
  reward_id text not null check (reward_id ~ '^[a-z0-9][a-z0-9_-]{0,47}$'),
  kind text not null check (kind in ('title', 'badge')),
  label text not null check (length(label) between 1 and 60),
  description text not null default '' check (length(description) <= 200),
  rarity text not null default 'common' check (rarity in ('common', 'rare', 'epic', 'legendary', 'event')),
  category text not null default 'general' check (category ~ '^[a-z0-9_-]{1,32}$'),
  unlock_level integer check (unlock_level is null or unlock_level >= 1),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (channel_id, reward_id)
);

-- The inventory: one row per viewer and reward, kept when revoked (revoked_at), so nothing is lost or re-granted
-- silently. Equipping never touches it.
create table if not exists progression_grants (
  id bigserial primary key,
  channel_id text not null,
  twitch_user_id text not null,
  reward_id text not null,
  source text not null check (source in ('level', 'event', 'manual', 'import')),
  reference text,
  granted_by text not null,
  granted_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  unique (channel_id, twitch_user_id, reward_id),
  foreign key (channel_id, reward_id) references progression_rewards (channel_id, reward_id)
);
create index if not exists progression_grants_reward on progression_grants (channel_id, reward_id);

-- What the viewer shows: one title, up to 3 badges (owned, not revoked — checked by the Core).
create table if not exists progression_equipped (
  channel_id text not null,
  twitch_user_id text not null,
  title_id text,
  badge_ids text[] not null default '{}' check (cardinality(badge_ids) <= 3),
  updated_at timestamptz not null,
  primary key (channel_id, twitch_user_id)
);

-- Historical measures from another bot (WizeBot), every row kept with its source and date — attached or not. A row is
-- attached to a viewer with the Wallet's identity rules (docs/ECONOMY_MIGRATION.md § 8: the Twitch id is the identity,
-- quarantine rather than a wrong holder): an exact id, a legacy (id, pseudo) pair the Core does not contradict, or the
-- ONE Core account behind its pseudo; otherwise it waits (pending / ambiguous / conflict) — attached automatically when
-- the viewer comes back, or by a Studio decision; never guessed, never thrown away. Once imported, its measures are
-- frozen (a later reading never overwrites what was imported).
create table if not exists progression_history (
  channel_id text not null,
  source text not null check (source in ('wizebot')),
  login text not null check (login ~ '^[a-z0-9_]{1,25}$'),
  twitch_user_id text check (twitch_user_id is null or twitch_user_id ~ '^[0-9]{1,32}$'),
  -- Where the id comes from: WizeBot's own user id (exact), the legacy site's dated (id, pseudo) pairs, or 'ambiguous'
  -- (the legacy data saw several holders of this pseudo: never attached by pseudo).
  id_source text check (id_source is null or id_source in ('wizebot', 'legacy', 'ambiguous')),
  level integer not null check (level >= 1),
  watch_seconds bigint not null default 0 check (watch_seconds >= 0),
  messages bigint not null default 0 check (messages >= 0),
  measured_at timestamptz not null,
  status text not null check (status in ('pending', 'ambiguous', 'conflict', 'imported')),
  resolved_id text,
  resolved_by text check (resolved_by is null or resolved_by in ('id', 'login', 'manual')),
  resolved_at timestamptz,
  -- A Studio decision (manual attachment): who and why.
  resolve_note text,
  first_seen_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (channel_id, source, login)
);
create index if not exists progression_history_status on progression_history (channel_id, source, status);
