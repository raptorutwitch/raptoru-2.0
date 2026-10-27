-- Dock OBS V1 — PRODUCTION schema (27/10/2026, docs/OBS_DOCK.md). Same tables as the Lab file 20261110120000_obs_dock_lab.sql.
-- A read-only projection of what Raptoru already recorded (alerts, channel points) for the OBS dock, its commit-ordered
-- cursor and the audit of visual replays. Additive and idempotent: three new tables and one index; nothing existing
-- changes, no economic table is read or written by the dock.
-- Rollback: drop table dock_replays; drop table dock_activity; drop table dock_activity_channels;
--   drop index if exists alert_events_recent; delete from schema_migrations where name = '20261110130000_obs_dock.sql';

-- One activity per source event (alert event, channel points redemption). `seq` is its position in the change feed:
-- given under the channel row's lock (dock_activity_channels) held until commit, so seq order IS commit order; a row
-- that changes (alert played, redemption done) gets a new seq — the dock replaces it.
create table if not exists dock_activity (
  channel_id text not null,
  activity_key text not null,
  kind text not null check (kind in ('alert', 'channel_points')),
  type text not null,
  occurred_at timestamptz not null,
  -- Display data (untrusted viewer text), copied from the source record.
  data jsonb not null,
  -- Processing / presentation state (alert played, redemption done…) and the replay summary.
  state jsonb not null,
  version text not null,
  seq bigint not null,
  updated_at timestamptz not null,
  primary key (channel_id, activity_key)
);
create unique index if not exists dock_activity_seq on dock_activity (channel_id, seq);
create index if not exists dock_activity_recent on dock_activity (channel_id, occurred_at desc);

create table if not exists dock_activity_channels (
  channel_id text primary key,
  seq bigint not null default 0
);

-- A visual replay asked from the dock: a NEW alert item with the original's frozen variant and data (never a new
-- reception: no Roue, no loyalty, no economy). replay_key = the click's idempotency key.
create table if not exists dock_replays (
  replay_key text primary key,
  channel_id text not null,
  original_alert_id uuid not null,
  replay_alert_id uuid not null,
  requested_at timestamptz not null
);
create index if not exists dock_replays_original on dock_replays (original_alert_id, requested_at desc);

-- The projector reads the recent alert events of a channel.
create index if not exists alert_events_recent on alert_events (channel_id, received_at desc);
