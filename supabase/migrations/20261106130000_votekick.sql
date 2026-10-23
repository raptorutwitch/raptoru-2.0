-- Votekick V2 (docs/VOTEKICK_V2.md § 9) — production database. Same schema as the Lab file 20261106120000_votekick_lab.sql
-- (checked by apps/core-api/test/votekick-migration.test.ts). Additive, re-runnable.
-- One row per `!votekick` (the Twitch message id is the dedup key): the target read by the Twitch executor, the 60 s
-- vote, the verdict (rules: packages/schemas/src/votekick.ts) and its sanction (the bot's timeout, or the broadcaster's
-- mute in OBS by Studio). At most ONE vote checking / open per channel (partial unique index): two Cores can never open
-- two at once.

create table if not exists votekick_votes (
  vote_id uuid primary key,
  channel_id text not null,
  source_ref text not null,
  -- real: the executor applies the timeout · dry_run (Studio's chat simulator): the timeout is simulated by Core
  mode text not null default 'real' check (mode in ('real', 'dry_run')),
  status text not null check (status in ('checking', 'reading', 'open', 'sanctioning', 'done', 'refused', 'failed')),
  initiator_id text not null,
  initiator_login text not null,
  initiator_name text not null,
  target_input text not null,
  target_id text,
  target_login text,
  target_name text,
  opened_at timestamptz,
  ends_at timestamptz,
  -- The overlay's sequence: +1 on every visible change (a stale event of the same vote is ignored by the overlay).
  seq integer not null default 0,
  kick integer,
  save integer,
  outcome text check (outcome in ('no_quorum', 'no_timeout', 'target_timeout', 'target_timeout_perfect',
    'coinflip_target', 'coinflip_initiator', 'backfire')),
  punished_id text,
  punished_login text,
  minutes integer,
  duration_s integer,
  sanction text check (sanction in ('none', 'twitch_timeout', 'obs_mute')),
  -- confirmed / refused / uncertain (Twitch timeout) · not_sent (no executor took it) · simulated (dry_run) ·
  -- muted / not_muted (the broadcaster's mute in OBS)
  applied text check (applied in ('confirmed', 'refused', 'uncertain', 'not_sent', 'simulated', 'muted', 'not_muted')),
  reason text,
  error text,
  executor_id text,
  attempt_id uuid,
  attempts integer not null default 0,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  decided_at timestamptz,
  ended_at timestamptz,
  unique (channel_id, source_ref)
);
create unique index if not exists votekick_one_running on votekick_votes (channel_id)
  where status in ('checking', 'reading', 'open');
create index if not exists votekick_recent on votekick_votes (channel_id, created_at desc);
create index if not exists votekick_due on votekick_votes (status, ends_at) where status = 'open';

-- One ballot per voter and vote (`!kick` / `!save`, changing one's mind updates it); the initiator never has one.
create table if not exists votekick_ballots (
  vote_id uuid not null references votekick_votes (vote_id),
  voter_id text not null,
  choice text not null check (choice in ('kick', 'save')),
  updated_at timestamptz not null,
  primary key (vote_id, voter_id)
);

-- SAMMI's `votekick_cooldowns`: one launch per initiator per hour, recorded when the vote opens.
create table if not exists votekick_cooldowns (
  channel_id text not null,
  initiator_id text not null,
  until_at timestamptz not null,
  primary key (channel_id, initiator_id)
);

-- The broadcaster's mute (he cannot be timed out): a task for Studio's OBS mute controller, ended by its time or by a
-- paid caution. pending → active (Studio muted OBS) → ended · or failed (Studio / OBS absent: never muted).
create table if not exists votekick_mutes (
  mute_id text primary key,
  channel_id text not null,
  vote_id uuid not null references votekick_votes (vote_id),
  seconds integer not null check (seconds between 1 and 600),
  status text not null check (status in ('pending', 'active', 'ended', 'failed')),
  starts_at timestamptz,
  ends_at timestamptz,
  end_reason text check (end_reason in ('expired', 'caution')),
  error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists votekick_one_mute on votekick_mutes (channel_id) where status in ('pending', 'active');
