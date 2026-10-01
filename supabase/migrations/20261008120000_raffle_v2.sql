-- Tombola V2 (Lab) — forward-only migration on top of the minimal Tombola of 20261007120000_moderation_d4.
-- Lab database only (applied by the Studio local runtime / bonk:lab launcher / package stage list).
-- Core is the single source of truth: round, phases, reward, currency, entries and their source,
-- winners, payouts, cancellation, stream session, configuration and audit live here.

-- --- « Gérer la Tombola »: a 7th permission granted per moderator (decision D7) --------------------------
alter table lab_staff drop constraint lab_staff_grants_check;
alter table lab_staff add constraint lab_staff_grants_check
  check (grants <@ array['wallet', 'modules', 'globalPause', 'perms', 'sensitive', 'words', 'raffle']::text[]);

-- --- Registry of the Lab currencies ---------------------------------------------------------------------
-- A real registry: a module (the Tombola) chooses a registered currency and Core credits the matching
-- balance. The three existing currencies keep their lab_wallets column; a currency added later is
-- stored in lab_wallet_balances (no schema change needed to credit it).
create table lab_currencies (
  currency_id text primary key check (currency_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  label text not null check (length(trim(label)) > 0),
  short_label text not null check (length(trim(short_label)) > 0),
  icon text not null,
  wallet_column text unique check (wallet_column in ('tokens', 'credits_tts', 'credits_soundboard')),
  available boolean not null default true,
  sort integer not null default 0,
  max_balance bigint not null check (max_balance > 0)
);
insert into lab_currencies (currency_id, label, short_label, icon, wallet_column, sort, max_balance) values
  ('tokens', 'Jetons', 'J', 'coin', 'tokens', 0, 1000000000),
  ('credits_tts', 'Crédits TTS', 'cr TTS', 'tts', 'credits_tts', 1, 100000),
  ('credits_soundboard', 'Crédits Soundboard', 'cr Sons', 'sound', 'credits_soundboard', 2, 100000);

create table lab_wallet_balances (
  channel_id text not null,
  viewer_id text not null,
  currency_id text not null references lab_currencies (currency_id),
  balance bigint not null check (balance >= 0),
  updated_at timestamptz not null,
  primary key (channel_id, viewer_id, currency_id)
);

alter table lab_wallet_ledger drop constraint lab_wallet_ledger_currency_check;
alter table lab_wallet_ledger add constraint lab_wallet_ledger_currency_fk
  foreign key (currency) references lab_currencies (currency_id);
-- One Tombola credit per winner and per round, whatever the retries or a crash recovery.
create unique index lab_wallet_ledger_raffle_once on lab_wallet_ledger (raffle_id, viewer_id)
  where kind = 'raffle_win';

-- --- Stream sessions (simulated in the Lab) -----------------------------------------------------------------
-- The viewer history shows the Tombolas of the current stream only.
create table lab_stream_sessions (
  session_id uuid primary key,
  channel_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  source text not null check (source in ('simulated', 'twitch')),
  started_by text not null,
  ended_by text
);
create unique index lab_stream_sessions_one_live on lab_stream_sessions (channel_id) where ended_at is null;
create index lab_stream_sessions_channel on lab_stream_sessions (channel_id, started_at desc);

-- --- Configuration (one row per channel; validated by Core) ------------------------------------------------
create table lab_raffle_settings (
  channel_id text primary key,
  config jsonb not null,
  updated_at timestamptz not null,
  updated_by text not null
);

-- --- Rounds -------------------------------------------------------------------------------------------------
alter table lab_raffles drop constraint lab_raffles_status_check;
alter table lab_raffles drop constraint lab_raffles_winners_count_check;
drop index lab_raffles_one_open;

alter table lab_raffles
  add column kind text not null default 'normal' check (kind in ('normal', 'super', 'giveaway')),
  add column is_full boolean not null default false,
  add column currency_id text references lab_currencies (currency_id),
  add column prize text,
  add column winners_mode text not null default 'custom' check (winners_mode in ('auto', 'custom')),
  add column duration_s integer,
  add column open_at timestamptz,
  add column paused_at timestamptz,
  add column paused_remaining_ms integer,
  add column reveal_at timestamptz,
  add column reveal_end_at timestamptz,
  add column viewer_result_at timestamptz,
  add column overlay_end_at timestamptz,
  add column viewer_idle_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancelled_by text,
  add column cancel_reason text,
  add column finished_at timestamptz,
  add column session_id uuid references lab_stream_sessions (session_id),
  add column display jsonb,
  add column phase_changed_at timestamptz;

-- The minimal rounds: tokens, custom winners; never drawn = cancelled, drawn = finished.
update lab_raffles set currency_id = 'tokens', duration_s = greatest(1, extract(epoch from (ends_at - opened_at))::int),
  open_at = opened_at, phase_changed_at = coalesce(drawn_at, closed_at, opened_at);
update lab_raffles set status = 'cancelled', cancelled_at = coalesce(closed_at, ends_at), cancelled_by = 'migration',
  cancel_reason = 'Tombola minimale fermée sans tirage', finished_at = coalesce(closed_at, ends_at)
  where status in ('open', 'closed');
update lab_raffles set status = 'finished', reveal_at = drawn_at, reveal_end_at = drawn_at, viewer_result_at = drawn_at,
  overlay_end_at = drawn_at, viewer_idle_at = drawn_at, finished_at = drawn_at where status = 'drawn';

alter table lab_raffles add constraint lab_raffles_status_check check (status in
  ('opening', 'open', 'paused', 'drawing', 'revealing', 'revealed', 'cancelled', 'finished'));
alter table lab_raffles add constraint lab_raffles_winners_count_check check (winners_count between 0 and 50);
alter table lab_raffles add constraint lab_raffles_reward_check check (
  (kind = 'giveaway' and prize is not null) or (kind <> 'giveaway' and currency_id is not null and jackpot > 0));
alter table lab_raffles alter column duration_s set not null;
alter table lab_raffles alter column open_at set not null;
alter table lab_raffles alter column phase_changed_at set not null;
-- One running round per channel (a cancelled or finished one never blocks the next).
create unique index lab_raffles_one_active on lab_raffles (channel_id)
  where status in ('opening', 'open', 'paused', 'drawing', 'revealing', 'revealed');
create index lab_raffles_running on lab_raffles (status) where status not in ('cancelled', 'finished');
create index lab_raffles_session on lab_raffles (session_id, opened_at desc);

-- --- Entries: source, command, manual add / removal, order --------------------------------------------------
alter table lab_raffle_entries
  add column source text not null default 'extension' check (source in ('chat', 'extension', 'manual')),
  add column command text,
  add column added_by text,
  add column removed_at timestamptz,
  add column removed_by text,
  add column removed_reason text,
  add column seq bigint generated by default as identity;
alter table lab_raffle_entries alter column source drop default;

-- --- Winners and their payout --------------------------------------------------------------------------------
alter table lab_raffle_winners
  add column position integer,
  add column currency_id text references lab_currencies (currency_id),
  add column payout_status text not null default 'none' check (payout_status in ('pending', 'paid', 'failed', 'none')),
  add column paid_at timestamptz,
  add column failure text,
  add column attempts integer not null default 0;
update lab_raffle_winners w set currency_id = 'tokens', payout_status = case when ledger_id is null then 'none' else 'paid' end,
  paid_at = (select drawn_at from lab_raffles r where r.raffle_id = w.raffle_id),
  attempts = case when ledger_id is null then 0 else 1 end;
with ranked as (
  select raffle_id, viewer_id, row_number() over (partition by raffle_id order by viewer_display_name) as n from lab_raffle_winners
)
update lab_raffle_winners w set position = ranked.n from ranked
  where ranked.raffle_id = w.raffle_id and ranked.viewer_id = w.viewer_id;
alter table lab_raffle_winners alter column position set not null;

-- --- Chat messages already handled (a replayed EventSub message never joins or cancels twice) ---------------
create table lab_raffle_chat (
  channel_id text not null,
  message_id text not null,
  outcome text not null,
  created_at timestamptz not null,
  primary key (channel_id, message_id)
);

-- --- Twitch profile pictures (cache; the initials fallback is used when absent) ----------------------------
create table lab_viewer_avatars (
  viewer_id text primary key,
  url text check (url is null or url ~ '^https://static-cdn\.jtvnw\.net/'),
  status text not null check (status in ('ok', 'missing', 'error')),
  fetched_at timestamptz not null
);
