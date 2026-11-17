-- Lab twin of 20261201130000_casino.sql (same content).
-- Casino (docs/CASINO.md): the extension's slot machine (with its bonus, the Coffre) and European roulette. One row per
-- round, written in the SAME transaction as the bet's debit and the win's credit (Wallet keys casino:<round>:bet /
-- casino:<round>:win): the history, the Replay, the spectators and the shares read it; the extension only animates it.
-- - idempotency_key: the client's intent (one per spin): a resent spin returns this round, never a second one;
-- - outcome: what was drawn (slot: stops, grid, lines, the Coffre's whole script; roulette: the bets, the pocket, the
--   ball's visual seed) — public, never secret;
-- - raw_payout / payout / capped: the win before and after the per-round win cap (casino.max_win), shown as such;
-- - progress_step / progress_at / finished_at: how far the player has watched the Coffre (display only, no Jeton).
-- Additive and idempotent; nothing reads it but the casino module (closed by default: casino.open = 0 and the Core's
-- CASINO_EXTENSION = off).
-- Rollback: redeploy the previous Core (it ignores the table). To remove it: drop table if exists casino_rounds;
-- delete from schema_migrations where name = '20261201120000_casino_lab.sql';

create table if not exists casino_rounds (
  round_id uuid primary key,
  channel_id text not null,
  viewer_id text not null,
  viewer_name text not null,
  game text not null check (game in ('slot', 'roulette')),
  idempotency_key text not null,
  request_hash text not null,
  bet integer not null check (bet > 0),
  raw_payout integer not null check (raw_payout >= 0),
  payout integer not null check (payout >= 0 and payout <= raw_payout),
  capped boolean not null default false,
  outcome jsonb not null,
  economy text not null check (economy in ('lab', 'canonical')),
  progress_step integer not null default -1,
  progress_at timestamptz,
  finished_at timestamptz,
  shared_at timestamptz,
  announced boolean not null default false,
  created_at timestamptz not null,
  unique (channel_id, viewer_id, idempotency_key)
);
create index if not exists casino_rounds_recent on casino_rounds (channel_id, created_at desc);
create index if not exists casino_rounds_viewer on casino_rounds (channel_id, viewer_id, created_at desc);
