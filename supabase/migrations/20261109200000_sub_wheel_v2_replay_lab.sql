-- Roue du Sub V2, RV2-4 fix (docs/SUB_WHEEL_V2_PLAN.md § 10) — Lab database. Same content as the production file
-- 20261109210000_sub_wheel_v2_replay.sql (both re-runnable). ADDITIVE: no existing row is rewritten.

-- Replaying the animation of a draw already decided and credited but never shown (Studio « Rejouer l'animation »):
-- the SAME draw back in the queue — same segment, same gain, nothing credited again. `replayed_at` restarts its
-- display window (never swept « too late » at once), `replay_count` keeps the history.
alter table sw_spins add column if not exists replayed_at timestamptz;
alter table sw_spins add column if not exists replay_count integer not null default 0;
