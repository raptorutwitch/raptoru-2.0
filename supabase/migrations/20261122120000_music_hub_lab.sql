-- Music Hub (docs/music/MUSIC_HUB_STATE.md) — Lab database. Same content as the production file 20261122130000_music_hub.sql:
-- the extension's entry into Spotify V2's requests (one queue for the reward, the chat and the extension), paid in Jetons;
-- the search and player-control jobs Studio runs; the moderation trace of a removal (with or without refund). Additive:
-- every new column has a default or is nullable, the widened checks keep every existing value valid. Nothing is turned
-- on: extension_enabled and player_controls start OFF, the reward behaves exactly as before.

alter table spotify_settings
  add column if not exists extension_enabled boolean not null default false,
  add column if not exists extension_price_tokens integer not null default 500
    check (extension_price_tokens between 0 and 1000000),
  add column if not exists no_duplicates boolean not null default true,
  add column if not exists player_controls boolean not null default false;

alter table spotify_requests drop constraint if exists spotify_requests_source_check;
alter table spotify_requests add constraint spotify_requests_source_check
  check (source in ('twitch', 'simulation', 'extension'));

alter table spotify_requests
  -- How the request was paid: channel points (the reward: refunded by Twitch, CANCELED) or Jetons (the extension:
  -- refunded by the economy, the debit's interaction = request_id).
  add column if not exists payment text not null default 'channel_points' check (payment in ('channel_points', 'tokens')),
  add column if not exists price_tokens integer check (price_tokens is null or price_tokens >= 0),
  -- Jetons only: refunded (once) or kept (a removal without refund, a request that played).
  add column if not exists refund_status text check (refund_status in ('refunded', 'kept')),
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_by text,
  -- What the viewer saw when choosing (album, art, provider): display only, never a rule.
  add column if not exists display jsonb;

alter table spotify_jobs drop constraint if exists spotify_jobs_kind_check;
alter table spotify_jobs add constraint spotify_jobs_kind_check
  check (kind in ('song_request', 'skip', 'read_playback', 'search', 'control'));

-- A search is reused by its text (a second viewer typing the same words gets the same answer).
create index if not exists spotify_jobs_search_idx on spotify_jobs (channel_id, (payload->>'query'), created_at)
  where kind = 'search';
