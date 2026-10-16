-- Roulette and Slot V1 (docs/ROULETTE_SLOT_PARITY.md). Lab only. Core is the source of truth; the answers go
-- through cmd_steps (origin mini_game), the bets and gains through the Lab test wallet (Jetons).

-- Studio switch « Mini-jeux », per channel: OFF by default (no double answer with StreamElements in tests).
create table mini_game_channels (
  channel_id text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null
);

-- One row per game played. The Twitch message id is the key: a message plays at most once.
create table mini_game_plays (
  channel_id text not null,
  message_id text not null,
  game text not null check (game in ('roulette', 'slot')),
  viewer_id text not null,
  viewer_display_name text not null,
  bet bigint not null check (bet > 0),
  all_in boolean not null default false,
  -- Slot only: the three reels.
  symbols text[],
  won boolean not null,
  -- Net change of the balance (+bet / +24 × bet / −bet).
  delta bigint not null,
  balance_after bigint not null check (balance_after >= 0),
  ledger_id bigint not null,
  created_at timestamptz not null,
  primary key (channel_id, message_id),
  check ((game = 'slot') = (symbols is not null))
);
-- Cooldown per viewer and game.
create index mini_game_plays_cooldown on mini_game_plays (channel_id, viewer_id, game, created_at desc);

-- Lab test wallet: one ledger row per game (key mg:<channel_id>:<message_id> in reason).
alter table lab_wallet_ledger drop constraint lab_wallet_ledger_kind_check;
alter table lab_wallet_ledger add constraint lab_wallet_ledger_kind_check
  check (kind in ('set', 'adjust', 'reset', 'debit', 'refund', 'admin', 'raffle_win', 'word_game', 'mini_game'));
create unique index lab_wallet_ledger_mini_game_once on lab_wallet_ledger (reason)
  where kind = 'mini_game';

-- The durable chat queue (LeCroupier_) also carries the mini-game answers (no Commands invocation).
alter table cmd_steps drop constraint cmd_steps_origin_check;
alter table cmd_steps add constraint cmd_steps_origin_check
  check (origin in ('commands', 'word_game', 'mini_game'));
