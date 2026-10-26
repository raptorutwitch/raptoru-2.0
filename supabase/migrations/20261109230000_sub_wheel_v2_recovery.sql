-- Roue du Sub V2, autonomous recovery (docs/SUB_WHEEL_V2_PLAN.md § 10) — production database. Same content as the Lab
-- file 20261109220000_sub_wheel_v2_recovery_lab.sql (both re-runnable). ADDITIVE: no existing row is rewritten.

-- A wheel drawn and credited whose animation did not end « shown » (docs/SUB_WHEEL_V2_PLAN.md § 10): what happens next.
--   retry  — never shown for sure (the player never started it): shown again automatically, the SAME draw, nothing
--            credited again, in live, mode v2, wheel on, not before retry_at; at most SUB_WHEEL.retryMax times;
--   manual — never shown, nothing automatic any more (attempts exhausted, an error a retry cannot fix, or outside
--            mode v2): « Rejouer l'animation » in Studio;
--   check  — perhaps shown (started without a confirmed end, or the player vanished during it): « À vérifier » in
--            Studio, never shown again automatically.
-- null: nothing to recover (any other status, or a row from before this file).
alter table sw_spins add column if not exists recovery text check (recovery in ('retry', 'manual', 'check'));
alter table sw_spins add column if not exists retry_count integer not null default 0;
alter table sw_spins add column if not exists retry_at timestamptz;
create index if not exists sw_spins_retry on sw_spins (channel_id, retry_at) where recovery = 'retry';
