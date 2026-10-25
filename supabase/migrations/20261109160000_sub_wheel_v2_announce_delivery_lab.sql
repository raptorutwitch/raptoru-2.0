-- Roue du Sub V2, RV2-1 (docs/SUB_WHEEL_V2_PLAN.md § 10 bis) — Lab database. Same content as the production file
-- 20261109170000_sub_wheel_v2_announce_delivery.sql (both re-runnable). ADDITIVE: no existing row is rewritten.

-- The winner announcement waits this long after the end of the wheel animation (seconds), set from Studio by the
-- broadcaster: the viewers see the stream a few seconds late, the chat must not reveal the gain first. 8 s = the delay
-- used until now (default).
alter table sw_settings add column if not exists announce_delay_s integer not null default 8;
alter table sw_settings drop constraint if exists sw_settings_announce_delay_s_check;
alter table sw_settings add constraint sw_settings_announce_delay_s_check check (announce_delay_s between 0 and 60);

-- An invitation whose message never reached the chat (« Sortie chat » OFF meanwhile, no executor before it expired,
-- Twitch refused it): « undelivered ». Never answerable, never re-offered in the same live; the tours stay owed.
alter table sw_invitations drop constraint if exists sw_invitations_status_check;
alter table sw_invitations add constraint sw_invitations_status_check check (status in (
  'offered', 'accepted', 'declined', 'expired', 'clarified', 'undelivered'));
