-- Roue du Sub V2, lots R8–R9 (docs/SUB_WHEEL_V2_PLAN.md § 10 bis) — Lab database. Same content as the production file
-- 20261103130000_sub_wheel_v2_viewers.sql (both re-runnable). ADDITIVE: no existing row is rewritten.

-- Natural invitations (R9): OFF by default, the broadcaster only.
alter table sw_settings add column if not exists invitations_enabled boolean not null default false;

-- Who asked a draw: studio · moderator (extension) · the viewer (command « !roue oui », chat answer, extension).
-- A viewer's own request also waits for its presence (it sees its wheel).
alter table sw_spins add column if not exists requested_via text;
alter table sw_spins drop constraint if exists sw_spins_requested_via_check;
alter table sw_spins add constraint sw_spins_requested_via_check check (requested_via is null or requested_via in (
  'studio', 'moderator', 'command', 'chat_accept', 'extension'));

-- One spontaneous invitation per viewer and per live, persistent (a restart never invites twice); a Twitch message
-- counts once (the trigger and the answer are unique).
create table if not exists sw_invitations (
  id bigint generated always as identity primary key,
  channel_id text not null,
  -- The live: the Daily's stream id (production) or the Lab session id.
  session_key text not null,
  viewer_id text not null,
  status text not null check (status in ('offered', 'accepted', 'declined', 'expired', 'clarified')),
  trigger_message_id text not null,
  offered_at timestamptz not null,
  expires_at timestamptz not null,
  answered_at timestamptz,
  answer_message_id text,
  answer_class text check (answer_class is null or answer_class in ('accept', 'decline', 'ambiguous', 'unrelated')),
  rights_offered integer not null check (rights_offered > 0),
  rights_requested integer not null default 0,
  unique (channel_id, session_key, viewer_id),
  unique (channel_id, trigger_message_id),
  unique (channel_id, answer_message_id)
);

-- LeCroupier_'s answers (« !roue », invitations) ride the durable chat queue: origin sub_wheel. Only where the queue
-- and its `origin` column exist (main Core and Lab: both already hold the chat games files). An installation that
-- would apply the chat games files AFTER this one gets their narrower constraint: LeCroupier_'s Roue du Sub answers
-- would then be refused until it is widened again (never the case of the production or Lab databases).
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'cmd_steps' and column_name = 'origin') then
    alter table cmd_steps drop constraint if exists cmd_steps_origin_check;
    alter table cmd_steps add constraint cmd_steps_origin_check
      check (origin in ('commands', 'word_game', 'mini_game', 'sub_wheel'));
  end if;
end $$;
