-- Votekick V2 settings — production database. Same schema as the Lab file 20261107120000_votekick_settings_lab.sql
-- (checked by apps/core-api/test/votekick-migration.test.ts). Additive, re-runnable.
-- One row per channel, written from Studio. Core is the authority: a new vote reads its length here at its opening
-- (an open vote keeps the length it opened with: votekick_votes.ends_at). No row = the defaults (60 s).
-- Room for the next options (cooldowns, sanction lengths…): one column each, added when they become configurable.
create table if not exists votekick_settings (
  channel_id text primary key,
  vote_seconds integer not null check (vote_seconds between 15 and 300),
  updated_at timestamptz not null,
  updated_by text
);
