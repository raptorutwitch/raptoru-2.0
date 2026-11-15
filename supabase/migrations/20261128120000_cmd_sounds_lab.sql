-- Commands V2, the « sound » action (docs/COMMANDS_V2_STATUS.md) — LAB schema. Same content as the Production file
-- 20261128130000_cmd_sounds.sql. Additive, re-runnable: one new table; nothing existing is changed or deleted, no
-- economy involved.
-- - cmd_sounds: the sound of an accepted command use (its invocation and action), queued for Studio's invisible OBS
--   sound source, which plays it once (played_at); not taken within the steps' minute of life: expired, never late.
-- Rollback: drop table if exists cmd_sounds;
--   delete from schema_migrations where name = '20261128120000_cmd_sounds_lab.sql';

create table if not exists cmd_sounds (
  id bigserial primary key,
  channel_id text not null,
  invocation_id uuid not null,
  action_id uuid not null,
  -- The sound's id in Studio (its file there).
  sound text not null,
  status text not null check (status in ('queued', 'played', 'expired')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  played_at timestamptz,
  consumer text,
  unique (invocation_id, action_id)
);
create index if not exists cmd_sounds_queued on cmd_sounds (channel_id, id) where status = 'queued';
