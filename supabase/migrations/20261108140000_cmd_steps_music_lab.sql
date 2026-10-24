-- Spotify V2 (docs/SPOTIFY_V2.md § 6): the music commands' chat answers carry their own origin in the durable chat queue
-- (LeCroupier_), shown « Musique » in Studio. Lab and main Core (MAIN_CORE_LAB_MIGRATIONS), in the cmd_steps lineage
-- after 20261031140000_cmd_steps_win_announcements_lab.sql (same list plus 'music'). Nothing reads the origin to route a
-- step. ADDITIVE: the constraint only widens, no row is rewritten; re-runnable.
alter table cmd_steps drop constraint if exists cmd_steps_origin_check;
alter table cmd_steps add constraint cmd_steps_origin_check
  check (origin in ('commands', 'word_game', 'mini_game', 'raffle', 'sub_wheel', 'music'));
