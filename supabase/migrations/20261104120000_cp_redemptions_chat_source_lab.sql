-- !fxcam paid in Jetons from the chat (docs/CHAT_COMMANDS.md): the chat purchase is recorded like a channel points
-- redemption (source « chat ») so the existing FX Cam engine (Studio job, effect report, expiry) runs and follows it
-- unchanged. Lab and main Core (MAIN_CORE_LAB_MIGRATIONS), like the cmd_steps origins.
-- ADDITIVE: the constraint only widens, no row is rewritten; re-runnable.
-- Rollback (only while no row has source 'chat'): restore check (source in ('twitch', 'simulation')).
alter table cp_redemptions drop constraint if exists cp_redemptions_source_check;
alter table cp_redemptions add constraint cp_redemptions_source_check
  check (source in ('twitch', 'simulation', 'chat'));
