-- Roue du Sub V2, lot R1 (docs/SUB_WHEEL_V2_PLAN.md) — LAB database. Same content as the production file
-- 20261101130000_sub_wheel_v2.sql (both re-runnable: `if not exists`, constraints dropped then re-added). ADDITIVE:
-- no existing row is rewritten; every new column is NULL (or its default) on the V1 rows.
-- A right to a spin = one sw_spins row (one viewer, one subscription month); every Twitch event that announced it is
-- a proof in sw_spin_sources (unique per source event). The mode (v1 by default) decides who draws: nothing changes
-- until the broadcaster switches it.

-- Mode per channel (v1: today's wheel · v2_acquire: rights kept, V1 still draws · v2: V2 draws, lot R3) and the
-- recovery switch of certainly double-credited gains (lot R3b, OFF by default, broadcaster only).
alter table sw_settings add column if not exists mode text not null default 'v1';
alter table sw_settings drop constraint if exists sw_settings_mode_check;
alter table sw_settings add constraint sw_settings_mode_check check (mode in ('v1', 'v2_acquire', 'v2'));
alter table sw_settings add column if not exists recovery_enabled boolean not null default false;
alter table sw_settings add column if not exists recovery_enabled_at timestamptz;

-- New states: owed (acquired, nothing drawn) · requested (manual draw asked, lot R3) · merged (absorbed by the right of
-- the same certain month, never drawn). New origins of a right: manual (granted) · reconcile (Twitch API catch-up).
alter table sw_spins drop constraint if exists sw_spins_status_check;
alter table sw_spins add constraint sw_spins_status_check check (status in (
  'ignored', 'queued', 'playing', 'shown', 'failed', 'skipped', 'owed', 'requested', 'merged'));
alter table sw_spins drop constraint if exists sw_spins_source_check;
alter table sw_spins add constraint sw_spins_source_check check (source in (
  'twitch', 'simulation', 'test', 'manual', 'reconcile'));

alter table sw_spins add column if not exists queue text;
alter table sw_spins drop constraint if exists sw_spins_queue_check;
alter table sw_spins add constraint sw_spins_queue_check check (queue is null or queue in ('auto', 'manual'));
-- The subscription month this right stands for, and how sure we are: twitch (Twitch's cumulative months: certain) ·
-- estimated (last certain month + 1) · estimated_no_history (1) · badge (lot R6) · legacy (reserved).
alter table sw_spins add column if not exists sub_month integer;
alter table sw_spins drop constraint if exists sw_spins_sub_month_check;
alter table sw_spins add constraint sw_spins_sub_month_check check (sub_month is null or sub_month >= 1);
alter table sw_spins add column if not exists month_source text;
alter table sw_spins drop constraint if exists sw_spins_month_source_check;
alter table sw_spins add constraint sw_spins_month_source_check check (month_source is null or month_source in (
  'twitch', 'estimated', 'estimated_no_history', 'badge', 'legacy'));
alter table sw_spins add column if not exists acquired_at timestamptz;
alter table sw_spins add column if not exists confirmed_at timestamptz;
alter table sw_spins add column if not exists requested_at timestamptz;
alter table sw_spins add column if not exists requested_by text;
alter table sw_spins add column if not exists drawn_at timestamptz;
alter table sw_spins add column if not exists granted_by text;
alter table sw_spins add column if not exists grant_note text;
alter table sw_spins add column if not exists merged_into uuid references sw_spins (spin_id);
alter table sw_spins drop constraint if exists sw_spins_merged_check;
alter table sw_spins add constraint sw_spins_merged_check check ((status = 'merged') = (merged_into is not null));

-- One right per certain month of a viewer: two rights can never carry the same Twitch cumulative month.
create unique index if not exists sw_spins_certain_month on sw_spins (channel_id, viewer_id, sub_month)
  where month_source = 'twitch' and status <> 'merged';
create index if not exists sw_spins_rights on sw_spins (channel_id, queue, acquired_at)
  where status in ('owed', 'requested');
create index if not exists sw_spins_viewer on sw_spins (channel_id, viewer_id, created_at desc);

-- The proofs of a right: every Twitch event that announced it, once (a redelivery is the same proof). spin_id null:
-- an orphan proof (mode v1: a subscribe / resub message never makes a right outside V1; the chat notice of the same
-- renewal takes it). An orphan proof never becomes a right by itself.
create table if not exists sw_spin_sources (
  id bigint generated always as identity primary key,
  spin_id uuid references sw_spins (spin_id),
  channel_id text not null,
  source text not null check (source in (
    'chat_notification', 'subscribe', 'message', 'badge', 'reconcile', 'manual')),
  source_event_id text not null,
  viewer_id text,
  occurred_at timestamptz,
  months integer,
  tier integer,
  is_gift boolean,
  received_at timestamptz not null,
  unique (channel_id, source, source_event_id)
);
create index if not exists sw_spin_sources_viewer on sw_spin_sources (channel_id, viewer_id, occurred_at);
create index if not exists sw_spin_sources_spin on sw_spin_sources (spin_id);

-- Recovery of a CERTAINLY double-credited gain (lot R3b): one per duplicate right, never a negative balance.
create table if not exists sw_recoveries (
  spin_id uuid primary key references sw_spins (spin_id),
  duplicate_of uuid not null references sw_spins (spin_id),
  channel_id text not null,
  viewer_id text not null,
  amount_due bigint not null check (amount_due > 0),
  amount_recovered bigint not null default 0 check (amount_recovered >= 0 and amount_recovered <= amount_due),
  status text not null check (status in ('due', 'partial', 'recovered')),
  proof jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- Two moderator permissions (R-7): ask a draw · grant / reactivate a right (broadcaster and supermods have all). Only
-- where the moderation tables exist (a production-only database has none).
do $$
begin
  if to_regclass('lab_staff') is not null then
    alter table lab_staff drop constraint if exists lab_staff_grants_check;
    alter table lab_staff add constraint lab_staff_grants_check check (grants <@ array[
      'wallet', 'modules', 'globalPause', 'perms', 'sensitive', 'words', 'raffle', 'subWheelDraw', 'subWheelGrant']::text[]);
  end if;
end $$;
