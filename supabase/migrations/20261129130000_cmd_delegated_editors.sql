-- Commands V2, delegated editors and keyword triggers (docs/COMMANDS_V2_STATUS.md) — PRODUCTION schema. Same content as
-- the Lab file 20261129120000_cmd_delegated_editors_lab.sql.
-- Additive and re-runnable: the history of the commands accepts the author « editor », a viewer the streamer named editor
-- of a command (config.editors) who changes from the extension only whether it is on and its expressions. Nothing
-- existing is changed or deleted, no economy involved. The keyword trigger and the editors live in config (jsonb): no
-- column for them. A database without the Commands tables (production scope alone) is left as it is.
-- Rollback (only while no row has actor_role = 'editor'):
--   alter table cmd_history drop constraint if exists cmd_history_actor_role;
--   alter table cmd_history add constraint cmd_history_actor_role
--     check (actor_role in ('broadcaster', 'supermod', 'moderator', 'system'));
--   delete from schema_migrations where name = '20261129130000_cmd_delegated_editors.sql';

do $$
declare c record;
begin
  if to_regclass('cmd_history') is null then
    return;
  end if;
  for c in
    select conname from pg_constraint
    where conrelid = 'cmd_history'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%actor_role%'
  loop
    execute format('alter table cmd_history drop constraint %I', c.conname);
  end loop;
  alter table cmd_history
    add constraint cmd_history_actor_role
    check (actor_role in ('broadcaster', 'supermod', 'moderator', 'editor', 'system'));
end $$;
