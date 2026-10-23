-- Caution (docs/CAUTION.md) — Lab database. Same schema as the production file 20261105130000_caution.sql (checked by
-- apps/core-api/test/caution-migration.test.ts). Additive.
-- One row per `!caution` (the Twitch message id is the dedup key): the target read by the Twitch executor, the quote,
-- the payer's answer, the debit (interaction id = request_id in the economy's ledger), the release and the refund.
-- At most ONE open caution per channel (partial unique index): two Cores can never open two at once.

create table caution_requests (
  request_id uuid primary key,
  channel_id text not null,
  seq bigint generated always as identity,
  source_ref text not null,
  -- real: the executor lifts the timeout · dry_run (Studio's chat simulator): real reads, the release simulated by Core
  mode text not null default 'real' check (mode in ('real', 'dry_run')),
  payer_id text not null,
  payer_login text not null,
  payer_name text not null,
  target_input text not null,
  target_id text,
  target_login text,
  target_name text,
  kind text check (kind in ('timeout', 'mute')),
  status text not null check (status in ('checking', 'quoting', 'quoted', 'confirmed', 'rechecking', 'releasing',
    'released', 'refused', 'cancelled', 'expired', 'failed', 'uncertain')),
  sanction_ends_at timestamptz,
  price integer check (price between 0 and 1000000000),
  quote_expires_at timestamptz,
  confirm_ref text,
  -- Why it ended (no_timeout, permanent, insufficient, …) and the executor's error, readable.
  reason text,
  error text,
  -- Jetons: none (never debited) · debited · refunded (exactly once) · to_verify (uncertain release)
  money text not null default 'none' check (money in ('none', 'debited', 'refunded', 'to_verify')),
  mute_id text,
  executor_id text,
  attempt_id uuid,
  attempts integer not null default 0,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  ended_at timestamptz,
  unique (channel_id, source_ref)
);
create unique index caution_one_open on caution_requests (channel_id)
  where status in ('checking', 'quoting', 'quoted', 'confirmed', 'rechecking', 'releasing');
create index caution_recent on caution_requests (channel_id, created_at desc);
