-- Winner announcements in chat (Tombola, Roue du Sub V1): the durable chat queue (LeCroupier_) also carries them, with
-- their own origin (no Commands invocation). Lab and main Core (MAIN_CORE_LAB_MIGRATIONS), like the mini-games origin.
-- ADDITIVE: the constraint only widens, no row is rewritten; re-runnable.
alter table cmd_steps drop constraint if exists cmd_steps_origin_check;
alter table cmd_steps add constraint cmd_steps_origin_check
  check (origin in ('commands', 'word_game', 'mini_game', 'raffle', 'sub_wheel'));
