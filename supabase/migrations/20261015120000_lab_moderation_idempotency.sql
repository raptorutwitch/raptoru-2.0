-- Moderation V2 (Lab) — idempotent actions. Lab database only: classified `lab` in
-- apps/core-api/src/db/migration-scopes.ts. Forward-only, on top of 20261014120000_commands_v2_categories.
-- A client retry (lost response) carries the same Idempotency-Key: the action recorded here with its
-- result, in the SAME transaction as its effect, is answered again instead of being applied twice
-- (+100 test tokens, a note…). Same key with another payload: refused.

create table lab_moderation_requests (
  channel_id text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  -- sha256 of the actor id and the command: the same key never covers another action.
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null,
  primary key (channel_id, idempotency_key)
);
create index lab_moderation_requests_created on lab_moderation_requests (created_at);
