-- Twitch emotes of Bonk on the public viewer frontier (/v1/ext): additive only.
-- The OAuth state names the viewer it was started for (Twitch user id of the extension JWT): the
-- account authorized at Twitch must be that viewer. A refused authorization (revoked / invalid
-- token) is remembered as « reconnexion nécessaire », without any token.

alter table bonk_lab_oauth_states
  add column viewer_id text check (viewer_id ~ '^[0-9]+$');

create table bonk_lab_viewer_reauth (
  user_id text primary key check (user_id ~ '^[0-9]+$'),
  login text not null,
  display_name text not null,
  at timestamptz not null
);
