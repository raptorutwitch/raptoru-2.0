-- Lab twin of 20261121160000_module_settings.sql (same content).
-- Module settings (refonte Studio, decisions H10 / H12 of 05/11/2026): prices, delays and limits of the modules, set
-- from Studio, read by the executors. Per channel, one row per changed value (absent = the Core's default, i.e. today's
-- behaviour). Bounds live in the Core (module-settings/service.ts). Never odds nor prize tables. New table only.
-- Prepared, NOT applied outside the tests (needs Antoni's GO).
-- Rollback: drop table module_settings; delete from schema_migrations where name = '20261121150000_module_settings_lab.sql';

create table if not exists module_settings (
  channel_id text not null,
  key text not null check (key ~ '^[a-z0-9_]{1,40}\.[a-z0-9_]{1,40}$'),
  value integer not null,
  updated_at timestamptz not null,
  updated_by text not null,
  primary key (channel_id, key)
);
