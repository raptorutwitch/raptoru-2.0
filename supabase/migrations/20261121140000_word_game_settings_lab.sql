-- Jeu des mots: a durable ON / OFF and the interval between two words (refonte Studio, decision H8 of 05/11/2026).
-- Lab-classified (the table is a Lab one) and applied by the main Core too (MAIN_CORE_LAB_MIGRATIONS). Additive and
-- idempotent: existing channels keep today's behaviour (ON, a word every 5 to 15 min). Prepared, NOT applied outside
-- the tests (needs Antoni's GO).
-- Rollback: alter table word_game_channels drop constraint word_game_interval_bounds, drop column enabled,
--   drop column interval_min_s, drop column interval_max_s; delete from schema_migrations where name = '20261121140000_word_game_settings_lab.sql';

alter table word_game_channels add column if not exists enabled boolean not null default true;
alter table word_game_channels add column if not exists interval_min_s integer not null default 300;
alter table word_game_channels add column if not exists interval_max_s integer not null default 900;
do $$
begin
  alter table word_game_channels add constraint word_game_interval_bounds
    check (interval_min_s between 60 and 3600 and interval_max_s between interval_min_s and 3600);
exception when duplicate_object then null;
end $$;
