-- Commands V2 (Lab) — phase B: invocations (admission and decision). Lab database only: classified
-- `lab` in apps/core-api/src/db/migration-scopes.ts. Forward-only, on top of 20261011120000_commands_v2.
-- One row per chat message that names a Commands V2 command, accepted or refused, with the decision,
-- the resolved arguments and the frozen rendering. Nothing is executed and nothing is sent to Twitch:
-- an accepted invocation is `simulated` until the durable step queue exists (phase C).

create table cmd_invocations (
  invocation_id uuid primary key,
  -- Arrival order (two invocations can share a timestamp).
  seq bigserial not null unique,
  channel_id text not null references cmd_channels (channel_id),
  command_id uuid not null references cmd_commands (command_id),
  -- Configuration version the decision was taken with.
  command_version integer not null,
  source text not null check (source in ('twitch', 'simulator')),
  source_message_id text not null,
  -- The word actually typed (name or alias) — the counters are per command_id, aliases share them.
  trigger text not null,
  viewer_id text not null,
  viewer_login text not null,
  viewer_display_name text not null,
  -- Who the viewer was at that moment (chat badges, Lab staff, follower answer).
  viewer_role text not null check (viewer_role in ('broadcaster', 'supermod', 'moderator', 'viewer')),
  viewer_groups text[] not null,
  follower boolean,
  raw_args text not null,
  args jsonb not null,
  live boolean not null,
  decision text not null check (decision in ('accepted', 'rejected')),
  reason text,
  reason_detail jsonb,
  -- Frozen rendering (reply and chat actions) of an accepted invocation.
  rendered jsonb,
  status text not null check (status in ('simulated', 'rejected')),
  created_at timestamptz not null,
  -- The same Twitch message is admitted once, whatever the redeliveries.
  unique (channel_id, source, source_message_id),
  check ((decision = 'accepted') = (reason is null)),
  check ((decision = 'accepted') = (rendered is not null)),
  check ((decision = 'accepted') = (status = 'simulated'))
);
-- Cooldown / quota counters: accepted invocations of a command (global) and of a viewer.
create index cmd_invocations_command on cmd_invocations (command_id, created_at desc)
  where decision = 'accepted';
create index cmd_invocations_viewer on cmd_invocations (command_id, viewer_id, created_at desc)
  where decision = 'accepted';
create index cmd_invocations_channel on cmd_invocations (channel_id, created_at desc);
