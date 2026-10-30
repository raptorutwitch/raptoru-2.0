-- Halloween economy (30/10/2026, docs/HALLOWEEN.md § 3) and alert variants — LAB twin of
-- 20261117130000_halloween_economy.sql (same content).
-- Rollback: drop table if exists alert_settings, event_presence;
--   alter table alert_events drop constraint alert_events_outcome_check;
--   alter table alert_events add constraint alert_events_outcome_check check (outcome in ('queued', 'absorbed',
--     'below_threshold')) not valid;  -- only if no family was switched off
--   alter table event_ledger drop constraint event_ledger_kind_check;
--   alter table event_ledger add constraint event_ledger_kind_check check (kind in ('grant', 'remove', 'sub_reward',
--     'gift_reward', 'convert', 'purchase', 'refund', 'raffle')) not valid;  -- only if no new kind was written
--   delete from schema_migrations where name = '<this file>';

-- Bonbons earned by watching: each viewer's validated presence seconds during the season (the presence tracker's
-- intervals, exactly once per cycle) and the presence blocks already paid (one ledger movement per block).
create table if not exists event_presence (
  season text not null,
  channel_id text not null,
  viewer_id text not null,
  seconds bigint not null default 0 check (seconds >= 0),
  blocks_paid integer not null default 0 check (blocks_paid >= 0),
  updated_at timestamptz not null,
  primary key (season, channel_id, viewer_id)
);

-- The ledger's movement kinds: presence, Bits and donations get their own (the conversion kind stays for history).
-- NOT VALID: the existing rows are not re-read (they all satisfy it), only new writes are checked.
alter table event_ledger drop constraint if exists event_ledger_kind_check;
alter table event_ledger add constraint event_ledger_kind_check check (kind in ('grant', 'remove', 'sub_reward',
  'gift_reward', 'convert', 'purchase', 'refund', 'raffle', 'presence', 'bits_reward', 'donation_reward')) not valid;

-- Alerts: which variants each family may play (docs/TWITCH_ALERTS_PARITY_2026-10.md, Studio › Alertes). No row: the
-- usual behaviour, unchanged.
create table if not exists alert_settings (
  channel_id text primary key,
  variants jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null
);

-- A family switched off records its events « disabled » (not animated). NOT VALID: only new rows are checked.
alter table alert_events drop constraint if exists alert_events_outcome_check;
alter table alert_events add constraint alert_events_outcome_check check (outcome in ('queued', 'absorbed',
  'below_threshold', 'disabled')) not valid;
