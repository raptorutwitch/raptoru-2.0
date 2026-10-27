-- Dock OBS V1.1 — Lab schema (27/10/2026, docs/OBS_DOCK.md). Same change as 20261111130000_obs_dock_interactions.sql.
-- The projection also holds Raptoru's own interactions (Bonk, Soundboard, TTS, Tombola entries, `!rb`): a third kind of
-- activity. Only the check of dock_activity.kind is widened; nothing else changes (dock_activity is the dock's own,
-- small, read-only projection). Idempotent.
-- Rollback: alter table dock_activity drop constraint dock_activity_kind_check; delete from dock_activity where kind =
--   'interaction'; alter table dock_activity add constraint dock_activity_kind_check check (kind in ('alert',
--   'channel_points')); delete from schema_migrations where name = '20261111120000_obs_dock_interactions_lab.sql';
alter table dock_activity drop constraint if exists dock_activity_kind_check;
alter table dock_activity add constraint dock_activity_kind_check
  check (kind in ('alert', 'channel_points', 'interaction'));
