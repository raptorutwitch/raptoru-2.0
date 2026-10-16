-- Twitch alerts V1, lot A1 (docs/TWITCH_ALERTS_PARITY_2026-10.md). Lab only. Core receives normalized events (Twitch
-- Bot, simulator, future donation adapter), deduplicates them, picks the legacy variant ONCE and queues one alert;
-- Studio (A2) claims one alert at a time per channel and acknowledges it. No economy involved.

-- One row per source event: a redelivered event (same source + id) is recognised and changes nothing.
create table alert_events (
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

-- Channel row: serializes the claims of a channel (one alert at a time).
create table alert_channels (
  channel_id text primary key
);

create table alert_items (
  alert_id uuid primary key,
  channel_id text not null,
  -- Arrival order inside a priority.
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
  -- Why an alert failed / expired (diagnosis of lost or interrupted alerts).
  failure jsonb,
  check ((status in ('claimed', 'playing')) = (attempt_id is not null and lease_expires_at is not null))
);
-- At most ONE alert in flight per channel (claimed or playing).
create unique index alert_items_one_in_flight on alert_items (channel_id) where status in ('claimed', 'playing');
create index alert_items_next on alert_items (channel_id, priority desc, seq) where status = 'queued';
