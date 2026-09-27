-- Bonk V2 Lab: Twitch viewer identity and personal emote catalog (Lab/test only).
-- Tokens stay in this local database: never returned by any route, never sent to the extension,
-- the Studio UI or OBS. Read-only scope: user:read:emotes.

alter table bonk_lab_interactions drop constraint bonk_lab_interactions_provider_check;
alter table bonk_lab_interactions add constraint bonk_lab_interactions_provider_check
  check (provider in ('unicode', 'twitch'));

-- OAuth state (CSRF): single use, short lived.
create table bonk_lab_oauth_states (
  state text primary key,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Viewer OAuth token (one per Twitch account), validated owner = user_id.
create table bonk_lab_viewer_tokens (
  user_id text primary key check (user_id ~ '^[0-9]+$'),
  login text not null,
  display_name text not null,
  access_token text not null,
  refresh_token text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null
);

-- Last catalog returned by Get User Emotes for that viewer (validation source for admissions).
create table bonk_lab_viewer_catalogs (
  user_id text primary key references bonk_lab_viewer_tokens (user_id) on delete cascade,
  fetched_at timestamptz not null,
  emotes jsonb not null,
  owners jsonb not null
);
