-- Moderation V2 — parity with the validated D4 prototype. Lab database only (applied by the Studio
-- local runtime / bonk:lab launcher, never by the production migration flow). Core stays the single
-- source of truth: team and fine permissions, global pause, D4 personal cooldowns, internal notes,
-- watched / blocked TTS words, Soundboard / Bonk debits and refunds, minimal Tombola.

-- Team: moderators seen through the extension, supermods named by the broadcaster, the broadcaster.
-- `grants` = the D4 permissions granted to a moderator (supermods and the broadcaster have them all).
alter table lab_staff drop constraint lab_staff_role_check;
alter table lab_staff add constraint lab_staff_role_check
  check (role in ('broadcaster', 'supermod', 'moderator'));
alter table lab_staff add column grants text[] not null default '{}';
alter table lab_staff add constraint lab_staff_grants_check
  check (grants <@ array['wallet', 'modules', 'globalPause', 'perms', 'sensitive', 'words']::text[]);
alter table lab_staff add column login text;
alter table lab_staff add column display_name text;
alter table lab_staff add column last_seen timestamptz;
alter table lab_staff add column updated_at timestamptz;
alter table lab_staff add column updated_by text;

-- Directory of every viewer seen by a Lab module (search, « Premier passage », names in histories).
create table lab_viewers (
  channel_id text not null,
  viewer_id text not null,
  display_name text not null,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  primary key (channel_id, viewer_id)
);
insert into lab_viewers (channel_id, viewer_id, display_name, first_seen, last_seen)
select channel_id, viewer_id, (array_agg(viewer_display_name order by created_at desc))[1],
  min(created_at), max(created_at)
from (
  select channel_id, viewer_id, viewer_display_name, created_at from tts_lab_interactions
  union all select channel_id, viewer_id, viewer_display_name, created_at from sound_lab_interactions
  union all select channel_id, viewer_id, viewer_display_name, created_at from bonk_lab_interactions
) v
group by channel_id, viewer_id;

-- « Pause globale » (D4): every new interaction is refused; nothing running is cut, no queue purged.
create table lab_global_state (
  channel_id text primary key,
  paused boolean not null default false,
  paused_at timestamptz,
  paused_by text,
  refused_count integer not null default 0,
  updated_at timestamptz not null
);

-- D4 personal cooldown: « délai imposé » between two uses of a module, « pendant » a span.
-- Replaces the previous timed lockout (Lab data only).
drop table lab_viewer_cooldowns;
create table lab_viewer_cooldowns (
  channel_id text not null,
  viewer_id text not null,
  module_id text not null check (module_id in ('tts', 'soundboard', 'bonk')),
  delay_s integer not null check (delay_s between 1 and 86400),
  until timestamptz not null,
  stream boolean not null default false,
  reason text,
  actor text not null,
  created_at timestamptz not null,
  primary key (channel_id, viewer_id, module_id)
);

-- Internal notes on a viewer (team only).
create table lab_viewer_notes (
  id bigserial primary key,
  channel_id text not null,
  viewer_id text not null,
  body text not null check (char_length(body) between 1 and 140),
  author text not null,
  author_role text not null,
  created_at timestamptz not null
);
create index lab_viewer_notes_viewer on lab_viewer_notes (channel_id, viewer_id, id desc);

-- Watched / blocked TTS words. `normalized` = lower case, no accents, single spaces.
create table lab_tts_words (
  id bigserial primary key,
  channel_id text not null,
  word text not null check (char_length(word) between 1 and 40),
  normalized text not null,
  kind text not null check (kind in ('watch', 'block')),
  created_by text not null,
  created_at timestamptz not null,
  unique (channel_id, normalized)
);

-- TTS review: a message containing a watched word is held (`pending`) until « Laisser passer ».
alter table tts_lab_interactions add column review_status text not null default 'none'
  check (review_status in ('none', 'pending', 'allowed'));
alter table tts_lab_interactions add column review_hits jsonb not null default '[]'::jsonb;
alter table tts_lab_interactions add column reviewed_by text;
alter table tts_lab_interactions add column reviewed_at timestamptz;

-- Soundboard: debited on the Lab test wallet (refund at most once); a playing sound can be stopped.
alter table sound_lab_interactions add column refund_status text not null default 'none'
  check (refund_status in ('none', 'refunded'));
alter table sound_lab_interactions add column refunded_at timestamptz;
alter table sound_lab_deliveries add column stopped_at timestamptz;

-- Bonk: debited on the Lab test wallet, refunded when it can never be shown.
alter table bonk_lab_interactions add column refund_status text not null default 'none'
  check (refund_status in ('none', 'refunded'));
alter table bonk_lab_interactions add column refunded_at timestamptz;

-- Lab wallet ledger: wallet admin adjustments (D4) and Tombola winnings.
alter table lab_wallet_ledger drop constraint lab_wallet_ledger_kind_check;
alter table lab_wallet_ledger add constraint lab_wallet_ledger_kind_check
  check (kind in ('set', 'adjust', 'reset', 'debit', 'refund', 'admin', 'raffle_win'));
alter table lab_wallet_ledger add column raffle_id uuid;

-- Minimal Tombola V2 (real model: free entry, one per viewer and per round, jackpot offered by the
-- channel, winners paid on the Lab test wallet). Opened, closed and drawn from Studio.
create table lab_raffles (
  raffle_id uuid primary key,
  channel_id text not null,
  status text not null check (status in ('open', 'closed', 'drawn')),
  jackpot bigint not null check (jackpot between 0 and 10000000),
  winners_count integer not null check (winners_count between 1 and 10),
  opened_at timestamptz not null,
  ends_at timestamptz not null,
  closed_at timestamptz,
  drawn_at timestamptz,
  opened_by text not null
);
create unique index lab_raffles_one_open on lab_raffles (channel_id) where status = 'open';
create index lab_raffles_channel on lab_raffles (channel_id, opened_at desc);
create table lab_raffle_entries (
  entry_id uuid primary key,
  raffle_id uuid not null references lab_raffles (raffle_id),
  channel_id text not null,
  viewer_id text not null,
  viewer_display_name text not null,
  idempotency_key text not null,
  created_at timestamptz not null,
  unique (raffle_id, viewer_id)
);
create index lab_raffle_entries_channel on lab_raffle_entries (channel_id, created_at desc);
create table lab_raffle_winners (
  raffle_id uuid not null references lab_raffles (raffle_id),
  viewer_id text not null,
  viewer_display_name text not null,
  amount bigint not null,
  ledger_id bigint,
  primary key (raffle_id, viewer_id)
);
