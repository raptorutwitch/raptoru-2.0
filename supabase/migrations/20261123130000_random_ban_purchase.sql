-- Random Ban V2 — purchases (Mini-jeux, 12/11/2026) — production database. Same content as the Lab file
-- 20261123120000_random_ban_purchase_lab.sql:
-- the Jetons price of each purchase (extension / `!rb`), the series level it was charged at (the progressive price of
-- docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 2 is derived from the last counted purchase: no counter), the extension as a
-- source, the Sniper prediction (frozen at purchase, never read by the draw) and a moderator cancellation. Additive:
-- the new columns are nullable or defaulted, the widened checks keep every existing value valid, existing rows are not
-- rewritten. The progressive price only applies to rows that carry series_level (none before this migration).

alter table rb_requests drop constraint if exists rb_requests_source_check;
alter table rb_requests add constraint rb_requests_source_check
  check (source in ('channel_points', 'chat', 'test', 'extension'));

alter table rb_requests drop constraint if exists rb_requests_status_check;
alter table rb_requests add constraint rb_requests_status_check
  check (status in ('queued', 'searching', 'timeout_requested', 'confirmed', 'flop', 'failed', 'uncertain', 'simulated',
    'canceled'));

alter table rb_requests
  add column if not exists price_paid integer check (price_paid is null or price_paid >= 0),
  -- 0 = normal price; the level the purchase was charged at (the next one starts from series_level + 1).
  add column if not exists series_level smallint check (series_level is null or series_level between 0 and 20),
  add column if not exists wish_id text,
  add column if not exists wish_login text,
  add column if not exists wish_name text,
  -- none (no prediction) · armed (a prediction not decided yet) · decided at the result: hit (bonus paid) · miss ·
  -- glory / glory_hit (missed / hit outside the 30 min window: no bonus) · void (nothing happened) · revoked (bonus
  -- taken back by a moderator)
  add column if not exists sniper text not null default 'none'
    check (sniper in ('none', 'armed', 'hit', 'miss', 'glory', 'glory_hit', 'void', 'revoked')),
  add column if not exists canceled_by text,
  add column if not exists cancel_reason text;

-- One buyer's last purchases (price, pending cap, channel points cooldown, Sniper window).
create index if not exists rb_requests_buyer on rb_requests (channel_id, buyer_id, seq desc);

-- Moderation (D4): Random Ban gets the blocks and personal cooldowns of every module (widened checks only).
alter table if exists lab_viewer_blocks drop constraint if exists lab_viewer_blocks_module_id_check;
alter table if exists lab_viewer_blocks add constraint lab_viewer_blocks_module_id_check
  check (module_id in ('all', 'tts', 'soundboard', 'bonk', 'raffle', 'random_ban'));
alter table if exists lab_viewer_cooldowns drop constraint if exists lab_viewer_cooldowns_module_id_check;
alter table if exists lab_viewer_cooldowns add constraint lab_viewer_cooldowns_module_id_check
  check (module_id in ('tts', 'soundboard', 'bonk', 'random_ban'));
