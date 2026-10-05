-- ASTRA-P1-007 (lot 1): a Twitch-sourced Lab stream session is identified by its Twitch stream id,
-- like the canonical stream_sessions: one session per live (a reconnection with the same id reopens
-- it, a new id replaces a session left open). Simulated sessions keep a null id. Additive only.
alter table lab_stream_sessions add column twitch_stream_id text
  check (twitch_stream_id is null or source = 'twitch');
create unique index lab_stream_sessions_twitch_id on lab_stream_sessions (channel_id, twitch_stream_id)
  where twitch_stream_id is not null;
