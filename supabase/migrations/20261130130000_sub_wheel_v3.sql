-- PRODUCTION schema; Lab twin 20261130120000_sub_wheel_v3_lab.sql.
-- Roue du Sub V3 (docs/SUB_WHEEL_V3.md § 13): the barème of each draw and the seniority confirmations.
-- - sw_settings.grid: the barème of the draws from now on (1 = the legacy SAMMI wheel, 3 = V3); grid_since: when it
--   was last changed — a right acquired BEFORE it keeps the barème of its time (a pending right is never turned into
--   a V3 reward silently);
-- - sw_spins.grid: the barème the draw used (1 for every existing row: history is never recomputed);
-- - sw_spins.prime: the sub was a Prime one (Twitch's chat notice): the wheel shows « PRIME » at its hub (paid as T1);
-- - month_source 'manual' (Studio « Confirmer l'ancienneté ») and confirmed_by (who confirmed a month by hand);
--   'badge' (the chat badge's cumulative months) already exists since the V2 schema.
-- Additive and idempotent; every default keeps the previous Core's behaviour (grid 1 everywhere).
-- Rollback: redeploy the previous Core (it ignores these columns and draws on the legacy wheel). To remove them, once
-- no row uses V3: alter table sw_spins drop column grid, drop column confirmed_by,
-- drop column prime; alter table sw_settings drop column
-- grid, drop column grid_since; restore the month_source check without 'manual' (only if no row uses it); delete from
-- schema_migrations where name = '20261130130000_sub_wheel_v3.sql';

alter table sw_settings add column if not exists grid smallint not null default 1;
alter table sw_settings drop constraint if exists sw_settings_grid_check;
alter table sw_settings add constraint sw_settings_grid_check check (grid in (1, 3));
alter table sw_settings add column if not exists grid_since timestamptz;

alter table sw_spins add column if not exists grid smallint not null default 1;
alter table sw_spins drop constraint if exists sw_spins_grid_check;
alter table sw_spins add constraint sw_spins_grid_check check (grid in (1, 3));
alter table sw_spins add column if not exists confirmed_by text;
alter table sw_spins add column if not exists prime boolean not null default false;
alter table sw_spins drop constraint if exists sw_spins_month_source_check;
alter table sw_spins add constraint sw_spins_month_source_check check (month_source is null or month_source in (
  'twitch', 'estimated', 'estimated_no_history', 'badge', 'legacy', 'manual'));
