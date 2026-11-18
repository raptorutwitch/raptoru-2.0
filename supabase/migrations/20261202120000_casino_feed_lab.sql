-- Lab twin of 20261202130000_casino_feed.sql (same content).
-- Casino spectators (docs/CASINO.md § 6): the public feed of each player's session, in order. A step enters it only
-- once the PLAYER's screen has shown it (the reels stopped, a respin of the Coffre played, the end) — or once its
-- animation is overdue — so a spectator never receives a result before it is revealed. Spectators follow a player,
-- not a round: they read the rows after their cursor (seq), long-poll, and catch up after a disconnection.
-- - kind: start | result | coffre | step | end (a round's stages, pos = their order) · draft (the roulette bets being
--   placed, never debited) · presence (the game the player has open, or none);
-- - data: only what is revealed at that stage (never the next steps of a Coffre);
-- - one row per (round, stage): a resent progress never doubles an animation.
-- Short-lived (pruned after a few hours); nothing reads it but the casino module (closed by default).
-- Rollback: redeploy the previous Core (it ignores the table). To remove it: drop table if exists casino_feed;
-- delete from schema_migrations where name = '20261202120000_casino_feed_lab.sql';

create table if not exists casino_feed (
  seq bigserial primary key,
  channel_id text not null,
  viewer_id text not null,
  viewer_name text not null,
  round_id uuid,
  game text,
  kind text not null check (kind in ('start', 'result', 'coffre', 'step', 'end', 'draft', 'presence')),
  pos integer,
  data jsonb not null default '{}'::jsonb,
  fast boolean not null default false,
  at timestamptz not null
);
create unique index if not exists casino_feed_once on casino_feed (round_id, pos) where round_id is not null;
create index if not exists casino_feed_player on casino_feed (channel_id, viewer_id, seq);
create index if not exists casino_feed_channel on casino_feed (channel_id, seq);
