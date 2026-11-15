-- Level Up V2, the sound just BEFORE the announcement (docs/LEVEL_UP_V2.md § 5) — LAB schema. Same content as
-- the Production file 20261127130000_level_up_announcements.sql. Additive, re-runnable: one new table, one new nullable
-- column; nothing existing is changed or deleted, no XP, level or reward is touched.
-- - progression_announcements: one row per Level Up announcement given to LeCroupier_ (a real one, or Studio's
--   « [TEST] »), keyed by its outbox step (cmd_steps.idempotency_key).
--   - Its ONE sound (one viewer named turned it on; a test: always) waits for Studio's OBS source, which plays it once
--     (played_at); the announcement then leaves level_up_sound_lead_s later. Never after the announcement left
--     (sound_status 'missed'), never twice.
--   - announce_status: what Twitch said (sent / failed), recorded from the step.
-- - progression_level_events.announcement_id: the announcement that named that level-up.
-- Rollback: alter table progression_level_events drop column if exists announcement_id;
--   drop table if exists progression_announcements;
--   delete from schema_migrations where name = '20261127120000_level_up_announcements_lab.sql';

create table if not exists progression_announcements (
  id bigserial primary key,
  channel_id text not null,
  -- The outbox step that carries it (its idempotency key).
  step_key text not null unique,
  test boolean not null default false,
  names integer not null check (names >= 1),
  sound_status text not null check (sound_status in ('waiting', 'played', 'silent', 'skipped', 'missed')),
  sound_reason text,
  announce_status text not null default 'queued' check (announce_status in ('queued', 'sent', 'failed')),
  announce_reason text,
  created_at timestamptz not null,
  played_at timestamptz,
  consumer text,
  -- When Twitch confirmed it (the step's end).
  announced_at timestamptz
);
create index if not exists progression_announcements_waiting
  on progression_announcements (channel_id, id) where sound_status = 'waiting';
create index if not exists progression_announcements_queued
  on progression_announcements (channel_id, id) where announce_status = 'queued';

alter table progression_level_events add column if not exists announcement_id bigint;
