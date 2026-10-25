-- Roue du Sub V2, RV2-2 (docs/SUB_WHEEL_V2_PLAN.md § 9) — Lab database. Same content as the production file
-- 20261109190000_sub_wheel_v2_redraw.sql (both re-runnable). ADDITIVE: no existing row is rewritten.

-- An exceptional new draw asked by the broadcaster after a draw (Studio « Relancer un tirage »): a NEW right of its own
-- (source manual, its own economic key: paid once), linked to the draw it follows. A Studio key makes a repeated
-- click the same right; one pending new draw per original draw at a time.
alter table sw_spins add column if not exists redraw_of uuid references sw_spins (spin_id);
create index if not exists sw_spins_redraw_of on sw_spins (redraw_of) where redraw_of is not null;
-- At most ONE pending new draw per original draw, whatever the race (Studio checks it first, the database too).
create unique index if not exists sw_spins_one_pending_redraw on sw_spins (redraw_of)
  where redraw_of is not null and status in ('owed', 'requested', 'queued', 'playing');
