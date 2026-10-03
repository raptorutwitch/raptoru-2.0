-- Commands V2 (Lab) — phase A: configuration only. Lab database only: classified `lab` in
-- apps/core-api/src/db/migration-scopes.ts, so the production migrator never applies it.
-- Core is the single source of truth: it validates the configuration (jsonb, checked against the
-- shared zod schema), applies the team rights field by field and writes the history. No legacy data
-- (Wizebot / StreamElements / SAMMI) is imported: this migration creates empty tables.
-- Invocations and the durable step queue come with phases B / C (additive migrations).

-- One row per channel: every configuration write of a channel takes this lock first, so the
-- trigger-word checks and the versions are race-free.
create table cmd_channels (
  channel_id text primary key
);

create table cmd_commands (
  -- Stable identity: the visible name and the aliases can change, command_id never does.
  command_id uuid primary key,
  channel_id text not null references cmd_channels (channel_id),
  kind text not null check (kind in ('custom', 'system')),
  -- System commands: owned by a module, a stable key, locked fields and versioned defaults (reset).
  owner_module text,
  system_key text,
  locked_fields text[] not null default '{}',
  defaults jsonb,
  defaults_version integer check (defaults_version >= 1),
  -- Denormalized from `config` (listing); `config` is the whole editable configuration.
  name text not null check (name ~ '^[a-z0-9_]{1,25}$'),
  enabled boolean not null,
  listed boolean not null,
  config jsonb not null,
  -- Optimistic locking: every mutation states the version it read (409 otherwise).
  version integer not null check (version >= 1),
  created_at timestamptz not null,
  created_by text not null,
  updated_at timestamptz not null,
  updated_by text not null,
  -- Soft delete: the history stays, the trigger words are released.
  deleted_at timestamptz,
  deleted_by text,
  check (
    (kind = 'system') = (owner_module is not null and system_key is not null
      and defaults is not null and defaults_version is not null)
  ),
  check (kind = 'system' or locked_fields = '{}'),
  check (kind = 'custom' or deleted_at is null),
  check ((deleted_at is null) = (deleted_by is null))
);
create unique index cmd_commands_system_key on cmd_commands (channel_id, system_key)
  where system_key is not null;
create index cmd_commands_channel on cmd_commands (channel_id, name) where deleted_at is null;

-- A word (name or alias) belongs to one command of the channel at most — even a disabled one. The
-- words of a deleted command are released.
create table cmd_triggers (
  channel_id text not null,
  word text not null check (word ~ '^[a-z0-9_]{1,25}$'),
  command_id uuid not null references cmd_commands (command_id),
  kind text not null check (kind in ('name', 'alias')),
  primary key (channel_id, word)
);
create unique index cmd_triggers_one_name on cmd_triggers (command_id) where kind = 'name';
create index cmd_triggers_command on cmd_triggers (command_id);

-- Every configuration change, with the exact before / after of each field and the resulting
-- configuration. Team-rights changes are recorded here too (command_id null).
create table cmd_history (
  id bigserial primary key,
  channel_id text not null,
  command_id uuid references cmd_commands (command_id),
  version integer,
  action text not null check (action in ('create', 'update', 'delete', 'reset', 'system_sync', 'rights')),
  actor_id text not null,
  actor_login text,
  actor_role text not null check (actor_role in ('broadcaster', 'supermod', 'moderator', 'system')),
  via text not null check (via in ('studio', 'extension', 'system')),
  changes jsonb not null,
  snapshot jsonb,
  created_at timestamptz not null,
  check ((action = 'rights') = (command_id is null))
);
create index cmd_history_command on cmd_history (command_id, id desc);
create index cmd_history_channel on cmd_history (channel_id, id desc);

-- What moderators and supermods may change from the extension (defaults apply without a row).
create table cmd_team_rights (
  channel_id text not null,
  role text not null check (role in ('moderator', 'supermod')),
  rights jsonb not null,
  version integer not null check (version >= 1),
  updated_at timestamptz not null,
  updated_by text not null,
  primary key (channel_id, role)
);
