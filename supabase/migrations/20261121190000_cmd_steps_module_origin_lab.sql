-- Architecture socle (docs/studio-refonte/architecture/CONTRATS.md): the chat answers of the module host's modules carry
-- the origin `module:<id>` in the durable chat queue (LeCroupier_), so a NEW module never needs its own migration here
-- (friction C4). Lab and main Core (MAIN_CORE_LAB_MIGRATIONS), in the cmd_steps lineage after
-- 20261108140000_cmd_steps_music_lab.sql (same list, plus the module pattern). Nothing reads the origin to route a step.
-- ADDITIVE: the constraint only widens, no row is rewritten; re-runnable.
alter table cmd_steps drop constraint if exists cmd_steps_origin_check;
alter table cmd_steps add constraint cmd_steps_origin_check
  check (
    origin in ('commands', 'word_game', 'mini_game', 'raffle', 'sub_wheel', 'music')
    or origin ~ '^module:[a-z][a-z0-9_]{1,40}$'
  );
