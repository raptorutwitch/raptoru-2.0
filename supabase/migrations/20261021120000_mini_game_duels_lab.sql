-- Duel V1 (docs/DUEL_PARITY.md). Lab only. Both participants are identified by their Twitch User ID (logins are
-- display only). The stake moves through the Lab test wallet (ledger kind mini_game, keys mg:duel:<id>:loser /
-- :winner) and the answers through cmd_steps (origin mini_game). Same « Mini-jeux » switch as Roulette / Slot.

create table mini_game_duels (
  duel_id uuid primary key,
  channel_id text not null,
  -- The Twitch message of the challenge: a challenge is created at most once.
  challenge_message_id text not null,
  challenger_id text not null,
  challenger_name text not null,
  target_id text not null,
  target_login text not null,
  target_name text not null,
  -- 0 = free duel.
  bet bigint not null check (bet >= 0 and bet <= 100000),
  -- Fixed (50/50) when the challenge is created, revealed at the acceptance: never drawn again.
  challenger_wins boolean not null,
  status text not null check (status in ('pending', 'resolved', 'denied', 'cancelled', 'expired', 'refused')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  -- The Twitch message that ended it (accept / deny / cancel): a resent message does nothing more.
  end_message_id text,
  winner_id text,
  loser_id text,
  unique (channel_id, challenge_message_id),
  check (challenger_id <> target_id),
  check ((status = 'pending') = (ended_at is null)),
  check ((status = 'resolved') = (winner_id is not null and loser_id is not null))
);
-- One pending challenge per challenger and per target.
create unique index mini_game_duels_one_out on mini_game_duels (channel_id, challenger_id) where status = 'pending';
create unique index mini_game_duels_one_in on mini_game_duels (channel_id, target_id) where status = 'pending';
create index mini_game_duels_end on mini_game_duels (channel_id, end_message_id) where end_message_id is not null;
