-- PRODUCTION schema; Lab twin 20261121120000_sub_wheel_enabled_at_lab.sql.
-- Roue du Sub, live boundary (refonte Studio F2, audit P0-3 / R9). A sub received during this live waits for no presence
-- check only when it arrived after the wheel was switched ON. That instant used to be `sw_settings.updated_at`, which
-- every setting (invitations, announce delay, mode) also bumps: saving a setting during a live sent the subs already
-- received back to the presence wait. `enabled_at` = the last OFF → ON switch; only that moves the boundary.
-- Additive and idempotent. Backfill: the current boundary (updated_at of a wheel that is ON), so nothing due changes at
-- the deployment. Prepared, NOT applied outside the tests (needs Antoni's GO).
-- Rollback: alter table sw_settings drop column enabled_at; delete from schema_migrations where name = '20261121130000_sub_wheel_enabled_at.sql';

alter table sw_settings add column if not exists enabled_at timestamptz;
update sw_settings set enabled_at = updated_at where enabled and enabled_at is null;
