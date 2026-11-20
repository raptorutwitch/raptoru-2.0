-- Lab twin of 20261204130000_casino_v1.sql (same content).
-- Casino V1 (docs/CASINO.md § 12–13): the emote machine and the multiplayer blackjack.
-- 1. casino_rounds accepts two more games: 'book' (the emote machine: one row per spin, its free spins inside, like the
--    Coffre) and 'blackjack' (one row per player and settled table round, written by the table's settlement: the
--    viewer's history and Studio's figures; the Jetons moved with the table's own keys casino:bj:…).
-- 2. casino_bj_tables: one row per blackjack table. `state` holds the WHOLE table (seats, hands, the shoe, the round,
--    the pending step); it is changed only under the row's lock, in the same transaction as the Wallet movements it
--    asks for. `next_at` = the table's pending step (deal pacing, a decision's deadline, the dealer, the next round):
--    the Core's ticker runs the due ones, and after a restart they run late with their safe defaults. An empty table
--    has no step (next_at null): it keeps its number and costs nothing. (channel_id, table_no) is unique: two players
--    opening an empty blackjack at once create ONE table n°1 (the lobby lock + this constraint).
-- Additive and idempotent; closed by default (casino.open = 0, CASINO_EXTENSION = off).
-- Rollback: redeploy the previous Core (it never reads casino_bj_tables and never writes the new games). To remove:
-- drop table if exists casino_bj_tables; restore the check below to ('slot', 'roulette') once no such row exists.

alter table casino_rounds drop constraint if exists casino_rounds_game_check;
alter table casino_rounds add constraint casino_rounds_game_check
  check (game in ('slot', 'roulette', 'book', 'blackjack'));

create table if not exists casino_bj_tables (
  table_id uuid primary key,
  channel_id text not null,
  table_no integer not null check (table_no >= 1),
  state jsonb not null,
  version bigint not null default 0,
  next_at timestamptz,
  created_by text,
  created_by_name text,
  created_at timestamptz not null,
  announced_at timestamptz,
  updated_at timestamptz not null,
  economy text not null check (economy in ('lab', 'canonical')),
  unique (channel_id, table_no)
);
create index if not exists casino_bj_tables_due on casino_bj_tables (next_at) where next_at is not null;
