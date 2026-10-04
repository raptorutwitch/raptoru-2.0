-- Commands V2 (Lab) — phase D: the streamer's categories. Lab database only: classified `lab` in
-- apps/core-api/src/db/migration-scopes.ts. Forward-only, on top of 20261013120000_commands_v2_steps.
-- A category is data (name, icon, colour, position), never a fixed list. A command points to one
-- through its configuration (`config.category` = category_id), or to none (« Sans catégorie »).
-- Deleting a category moves its commands to « Sans catégorie » (each one a normal, logged update).

create table cmd_categories (
  channel_id text not null references cmd_channels (channel_id),
  category_id text not null check (category_id ~ '^[a-z][a-z0-9_-]{0,23}$'),
  name text not null check (char_length(name) between 1 and 24),
  icon text not null check (icon ~ '^[a-z][a-z0-9_-]{0,31}$'),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  -- Display order chosen by the streamer (0 first).
  position integer not null check (position >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  updated_by text not null,
  primary key (channel_id, category_id)
);
-- Two categories never share a name (case ignored).
create unique index cmd_categories_name on cmd_categories (channel_id, lower(name));
