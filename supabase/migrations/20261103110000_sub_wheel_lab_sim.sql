-- Roue du Sub V2 — Lab database only (never the production selection): the explicit simulators of the Lab and the
-- Lab wallet's ledger kind of the wheel's gains.

-- Simulated chatters readings (the production presence is Get Chatters, absent from the Lab database): readings ON
-- = a reading is going on (viewers present / absent); OFF = presence unknown (no automatic draw).
create table if not exists lab_sw_presence_feed (
  channel_id text primary key,
  readings boolean not null,
  updated_at timestamptz not null
);
create table if not exists lab_sw_presence (
  channel_id text not null,
  viewer_id text not null,
  display_name text not null,
  present boolean not null,
  updated_at timestamptz not null,
  primary key (channel_id, viewer_id)
);

-- The wheel's gains credited on the Lab test wallet (Lab Core only): one ledger row per spin (its key), never two.
alter table lab_wallet_ledger drop constraint lab_wallet_ledger_kind_check;
alter table lab_wallet_ledger add constraint lab_wallet_ledger_kind_check
  check (kind in ('set', 'adjust', 'reset', 'debit', 'refund', 'admin', 'raffle_win', 'word_game', 'mini_game',
    'channel_points', 'sub_wheel'));
create unique index if not exists lab_wallet_ledger_sub_wheel_once on lab_wallet_ledger (channel_id, reason)
  where kind = 'sub_wheel';
