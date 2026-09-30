-- TTS V2 Lab: a manual « clear cooldown » stays effective for the TTS already bought.
-- The TTS cooldown is armed at the real audio start; a TTS admitted before the latest manual clear
-- no longer re-arms it when it starts. Lab database only (applied by the Studio Lab runtime).
alter table tts_lab_viewers add column if not exists cooldown_cleared_at timestamptz;
