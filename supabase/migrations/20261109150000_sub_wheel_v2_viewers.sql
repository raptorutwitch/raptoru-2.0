-- Roue du Sub V2, lots R8–R9 (docs/SUB_WHEEL_V2_PLAN.md § 10 bis) — production database. Same content as the Lab file
-- 20261103120000_sub_wheel_v2_viewers_lab.sql (both re-runnable), EXCEPT cmd_steps' origins (end of file): the Lab
-- file narrows them, this one leaves them alone. ADDITIVE: no existing row is rewritten.

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

-- LeCroupier_'s answers (« !roue », invitations) ride the durable chat queue with origin sub_wheel, allowed since
-- 20261031140000_cmd_steps_win_announcements_lab.sql. cmd_steps' origins are NOT redefined here: production already
-- holds raffle (Tombola announcements) and music (Spotify V2), and narrowing the constraint would refuse them (or
-- fail on their existing rows). Renumbered after 20261108140000_cmd_steps_music_lab.sql for the same reason.
