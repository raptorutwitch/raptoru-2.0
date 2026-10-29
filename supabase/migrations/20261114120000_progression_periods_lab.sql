-- Progression native, periods (docs/PROGRESSION.md) — LAB schema. Same content as the Production file
-- 20261114130000_progression_periods.sql. Additive: one table, one column with a constant default (no rewrite),
-- one index, one trigger; nothing existing is changed or deleted.
-- - progression_period_stats: what each viewer EARNED per calendar week and month (Europe/Paris): XP from presence and
--   chat, presence time, messages — the rankings « Semaine » / « Mois » of raptoru.fr, without WizeBot. Filled by each
--   ledger movement, in its transaction (exactly once, like the ledger). WizeBot's history has no dates: it is never
--   spread over periods (the global totals keep it).
-- - progression_ledger.watch_seconds: the presence time of a movement (the ledger alone can rebuild every total).
-- - progression_history: never deleted; one WizeBot history per viewer (a second attachment is refused by the base).
-- Rollback: drop table progression_period_stats; alter table progression_ledger drop column watch_seconds;
--   drop trigger progression_history_no_delete on progression_history; drop function progression_history_kept();
--   drop index progression_history_one_per_viewer;
--   delete from schema_migrations where name = '20261114120000_progression_periods_lab.sql';

create table if not exists progression_period_stats (
  channel_id text not null,
  period text not null check (period in ('week', 'month')),
  -- Monday (week) or the 1st (month), Europe/Paris calendar.
  period_start date not null,
  twitch_user_id text not null,
  xp bigint not null default 0 check (xp >= 0),
  watch_seconds bigint not null default 0 check (watch_seconds >= 0),
  messages bigint not null default 0 check (messages >= 0),
  updated_at timestamptz not null,
  primary key (channel_id, period, period_start, twitch_user_id)
);

alter table progression_ledger add column if not exists watch_seconds integer not null default 0
  check (watch_seconds >= 0);

-- An imported history row is never thrown away (an undo only puts it back to pending).
create or replace function progression_history_kept() returns trigger language plpgsql as $$
begin
  raise exception 'progression_history rows are never deleted';
end $$;
drop trigger if exists progression_history_no_delete on progression_history;
create trigger progression_history_no_delete before delete on progression_history
  for each row execute function progression_history_kept();

-- One WizeBot history per viewer: two attached rows on one account are refused by the base itself.
create unique index if not exists progression_history_one_per_viewer
  on progression_history (channel_id, source, resolved_id) where status = 'imported';

-- Activity already recorded (since the activation), into its periods: XP and messages from the ledger (presence time
-- was not kept per movement before this migration: none is invented).
insert into progression_period_stats (channel_id, period, period_start, twitch_user_id, xp, watch_seconds, messages,
  updated_at)
select l.channel_id, p.period,
  date_trunc(p.period, l.created_at at time zone 'Europe/Paris')::date,
  l.twitch_user_id, greatest(0, sum(l.amount)), 0, count(*) filter (where l.kind = 'message'), now()
from progression_ledger l cross join (values ('week'), ('month')) as p(period)
where l.kind in ('presence', 'message')
group by 1, 2, 3, 4
on conflict do nothing;
