-- Crédits TTS and Crédits Soundboard (D2, Antoni 19/10/2026) — secondary currencies of the SAME canonical Wallet as the
-- Jetons: balances per Twitch ID and currency, the same ledger, never interchangeable, never converted, never
-- transferable between viewers, no administrative debt. Obtained only through channel points rewards configured for
-- it; no starting balance (a wallet is created at 0 when first used). Additive, idempotent.

insert into currencies (id, singular, plural, icon, active, is_primary, transferable, allow_negative_admin)
values
  ('credits_tts', 'Crédit TTS', 'Crédits TTS', 'tts', true, false, false, false),
  ('credits_soundboard', 'Crédit Soundboard', 'Crédits Soundboard', 'sound', true, false, false, false)
on conflict (id) do nothing;
