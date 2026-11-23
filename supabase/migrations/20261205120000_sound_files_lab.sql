-- Soundboard: sounds added or re-cut in Studio (docs/SOUNDBOARD.md). Lab schema: the Lab twin of
-- 20261205130000_sound_files.sql (same content).
-- Additive and re-runnable: one new table, three nullable columns, one partial index. No existing sound, price,
-- setting or history row is changed.
-- - sound_files: the published audio files, immutable; file_id = SHA-256 of the bytes (a complete WAV checked by the
--   Core: PCM 16-bit, mono or stereo, 100 ms to 20 s, 4 MB at most). Served publicly to the extension and to Studio.
-- - sound_lab_sounds.file_id: the sound's published file (a sound added in Studio, or a bank sound re-cut in Studio);
--   null = the bank's own file, shipped with the extension.
-- - sound_lab_sounds.added_at: set for a sound added in Studio (no bank entry); they follow the bank, oldest first.
-- - sound_lab_sounds.deleted_at: removed from the Soundboard (never offered, never playable); its history is kept.
-- - one live sound per file: the same extract is never published twice by mistake.
-- Rollback: redeploy the previous Core (it reads the bank only: added sounds disappear from the catalogue, re-cut bank
-- sounds play their original file again, removed bank sounds come back). To remove:
--   drop index if exists sound_lab_sounds_live_file;
--   alter table sound_lab_sounds drop column if exists file_id, drop column if exists added_at,
--     drop column if exists deleted_at;
--   delete from sound_lab_sounds where sound_id not in (<the bank's ids>);  -- only if added sounds exist
--   drop table if exists sound_files;
--   delete from schema_migrations where name = '20261205120000_sound_files_lab.sql';

create table if not exists sound_files (
  file_id text primary key check (file_id ~ '^[0-9a-f]{64}$'),
  mime text not null check (mime = 'audio/wav'),
  duration_ms integer not null check (duration_ms > 0),
  size integer not null check (size > 0),
  bytes bytea not null,
  created_at timestamptz not null
);

-- sound_lab_sounds comes from a Lab file the production migrator holds (LEGACY_LAB_IN_PROD): guarded, like the channel
-- points file, so the production selection alone still applies.
do $$
begin
  if to_regclass('sound_lab_sounds') is not null then
    alter table sound_lab_sounds add column if not exists file_id text references sound_files (file_id);
    alter table sound_lab_sounds add column if not exists added_at timestamptz;
    alter table sound_lab_sounds add column if not exists deleted_at timestamptz;
    create unique index if not exists sound_lab_sounds_live_file on sound_lab_sounds (file_id)
      where file_id is not null and deleted_at is null;
  end if;
end $$;
