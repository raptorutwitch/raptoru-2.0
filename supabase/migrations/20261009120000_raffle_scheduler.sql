-- Tombola V2 (Lab) — automatic scheduler + launch sound. Forward-only, on top of 20261008120000_raffle_v2.
-- Lab database only (Studio local runtime / bonk:lab launcher / package stage list).

-- Origin of a round: launched by the automatic scheduler or by someone (Studio, console).
alter table lab_raffles
  add column origin text not null default 'manual' check (origin in ('manual', 'automatic')),
  -- Launch sound chosen at the opening (copy of the configured sound: a later change never alters it).
  add column launch_sound jsonb;
alter table lab_raffles alter column origin drop default;

-- One scheduler per channel, bound to the live stream session. `next_at` null = waiting for the
-- current round to leave the screen (the next launch is then computed from its end).
create table lab_raffle_scheduler (
  channel_id text primary key,
  session_id uuid references lab_stream_sessions (session_id),
  state text not null check (state in ('stopped', 'running', 'paused')),
  next_at timestamptz,
  paused_remaining_ms integer,
  last_auto_raffle_id uuid,
  last_skip_reason text,
  updated_at timestamptz not null
);
