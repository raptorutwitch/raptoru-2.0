-- Twitch alerts V1 — PRODUCTION schema (17/10/2026, docs/TWITCH_ALERTS_PARITY_2026-10.md § 22). The same tables as the
-- Lab database ends with after 20261022120000_alerts_lab.sql + 20261023120000_alerts_lab_families.sql (checked by
-- test/alerts-prod-migration.test.ts): source events (dedup), the durable queue, one alert in flight per channel and
-- family. Additive and idempotent (if not exists): it creates three new tables, touches nothing else, and is a no-op
-- on a database that already has them. Nothing reads them until the Core serves /v1/studio/alerts.
-- Rollback (only while the tables hold nothing worth keeping):
--   drop table alert_items; drop table alert_channels; drop table alert_events;
--   delete from schema_migrations where name = '20261024120000_alerts.sql';

create table if not exists alert_events (
  channel_id text not null,
  source text not null check (source in ('twitch', 'external', 'simulation')),
  source_event_id text not null,
  type text not null check (type in ('follow', 'sub', 'resub', 'gift_targeted', 'gift_community', 'gift_recipient',
    'bits', 'raid', 'donation')),
  payload jsonb not null,
  outcome text not null check (outcome in ('queued', 'absorbed', 'below_threshold')),
  alert_id uuid,
  received_at timestamptz not null,
  primary key (channel_id, source, source_event_id)
);

-- Channel row: serializes the claims of a channel.
create table if not exists alert_channels (
  channel_id text primary key
);

create table if not exists alert_items (
  alert_id uuid primary key,
  channel_id text not null,
  seq bigint generated always as identity,
  type text not null,
  variant_id text not null,
  -- Frozen copy of the variant chosen at reception (never drawn again).
  variant jsonb not null,
  -- Display data (untrusted viewer text).
  data jsonb not null,
  priority integer not null,
  status text not null check (status in ('queued', 'claimed', 'playing', 'completed', 'failed', 'expired')),
  consumer_id text,
  attempt_id uuid,
  attempts integer not null default 0,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  claimed_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  failure jsonb,
  family text not null constraint alert_items_family_check
    check (family in ('follow', 'subscription', 'bits', 'raid', 'donation')),
  check ((status in ('claimed', 'playing')) = (attempt_id is not null and lease_expires_at is not null))
);

-- At most ONE alert in flight per channel AND family; inside a family, arrival order.
create unique index if not exists alert_items_one_in_flight_per_family on alert_items (channel_id, family)
  where status in ('claimed', 'playing');
create index if not exists alert_items_next_per_family on alert_items (channel_id, family, seq)
  where status = 'queued';
