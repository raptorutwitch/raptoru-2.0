-- Commands V2 (Lab) — phase C: durable steps (queue executed by the Lab Twitch adapter, LeCroupier_).
-- Lab database only: classified `lab` in apps/core-api/src/db/migration-scopes.ts. Forward-only, on top
-- of 20261012120000_commands_v2_invocations. Core is the source of truth: the adapter claims one step
-- under a lease (attempt_id), sends it, then acknowledges it with the same attempt_id.

-- « Sortie chat réelle »: OFF by default. While OFF, steps are created and stay queued (then expire);
-- the executor is never handed one, so nothing reaches Twitch.
alter table cmd_channels
  add column chat_output boolean not null default false,
  add column chat_output_updated_at timestamptz,
  add column chat_output_updated_by text;

-- An accepted invocation now creates its steps (`dispatched`); `simulated` stays for phase B rows.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'cmd_invocations'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table cmd_invocations drop constraint %I', c.conname);
  end loop;
end $$;
alter table cmd_invocations
  add constraint cmd_invocations_status
    check (status in ('simulated', 'dispatched', 'rejected')),
  add constraint cmd_invocations_status_decision
    check ((decision = 'accepted') = (status in ('simulated', 'dispatched')));

create table cmd_steps (
  step_id uuid primary key,
  -- Channel order (FIFO): one step in flight per channel, handed out in this order.
  seq_global bigserial not null unique,
  invocation_id uuid not null references cmd_invocations (invocation_id),
  channel_id text not null references cmd_channels (channel_id),
  -- Order inside the invocation (1, 2, …).
  seq integer not null check (seq >= 1),
  -- Stable idempotency key: invocation_id:seq.
  idempotency_key text not null unique,
  executor text not null check (executor in ('twitch_chat')),
  -- reply / action of an accepted invocation, or the refusal answer of a refused one.
  kind text not null check (kind in ('reply', 'action', 'refusal')),
  type text not null check (type in ('chat', 'module')),
  -- Frozen at admission (mode, text, reply_to…): never re-rendered.
  params jsonb not null,
  on_error text not null check (on_error in ('stop', 'continue')),
  status text not null check (status in (
    'queued', 'claimed', 'running', 'succeeded', 'failed', 'unknown', 'expired', 'cancelled', 'skipped')),
  executor_id text,
  attempt_id uuid,
  -- Attempt that closed the step: a replay of its final ACK is answered idempotently.
  last_attempt_id uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  error jsonb,
  -- Proof of the Twitch send (Send Chat Message `message_id`), when Twitch gives one.
  twitch_message_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  unique (invocation_id, seq),
  check ((status in ('claimed', 'running')) = (attempt_id is not null)),
  check ((status in ('claimed', 'running')) = (lease_expires_at is not null))
);
create index cmd_steps_channel_open on cmd_steps (channel_id, seq_global)
  where status in ('queued', 'claimed', 'running');
create index cmd_steps_channel on cmd_steps (channel_id, seq_global desc);
