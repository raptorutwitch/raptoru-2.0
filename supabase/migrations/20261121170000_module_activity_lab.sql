-- Lab twin of 20261121180000_module_activity.sql (same content).
-- Module host journal (docs/studio-refonte/architecture/CONTRATS.md): one row per admin or viewer action of a module
-- declared in apps/core-api/src/modules — history (Studio, viewer, moderation), idempotency of the viewer's intent
-- (unique key per module), link to the Wallet debit (activity_id = the economy's interaction id) so that a refund pays
-- back the ORIGINAL debit, once. Module ids are a pattern, never an enumeration (no migration per new module).
-- New table only. Prepared, NOT applied outside the tests (needs Antoni's GO).
-- module_state: a module's own small state (a counter, a current round…) as JSON per key, so that a simple module
-- needs no migration of its own.
-- Rollback: drop table module_state; drop table module_activity; delete from schema_migrations where name = '20261121170000_module_activity_lab.sql';

create table if not exists module_activity (
  activity_id uuid primary key,
  channel_id text not null,
  module_id text not null check (module_id ~ '^[a-z][a-z0-9_]{1,40}$'),
  action text not null check (action ~ '^[a-z][a-z0-9_]{0,40}$'),
  viewer_id text,
  viewer_name text,
  idempotency_key text,
  request_hash text,
  amount integer not null default 0 check (amount >= 0),
  status text not null check (status in ('done', 'queued', 'failed', 'refunded', 'canceled')),
  input jsonb,
  result jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  ended_by text,
  reason text
);
create unique index if not exists module_activity_intent on module_activity (channel_id, module_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists module_activity_recent on module_activity (channel_id, module_id, created_at desc);
create index if not exists module_activity_viewer on module_activity (channel_id, viewer_id, created_at desc);

create table if not exists module_state (
  channel_id text not null,
  module_id text not null check (module_id ~ '^[a-z][a-z0-9_]{1,40}$'),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  value jsonb not null,
  updated_at timestamptz not null,
  primary key (channel_id, module_id, key)
);
