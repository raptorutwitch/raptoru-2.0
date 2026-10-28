-- Boutique d'événement (Halloween 2026, docs/HALLOWEEN.md) — LAB schema. Same content as the Production file
-- 20261112130000_event_shop.sql. Additive and idempotent: new tables only, nothing existing is changed.
-- The event currency (Bonbons) lives in its OWN ledger, per season: it never touches the Jetons / Crédits Wallet
-- (the only bridge is the capped conversion, which debits Jetons through the economy port in the same transaction).
-- Rollback: drop table event_shop_purchases, event_shop_studios, event_shop_items, event_shop_settings, event_ledger,
--   event_wallets cascade; drop function event_ledger_immutable(); delete from schema_migrations where name =
--   '20261112120000_event_shop_lab.sql';

-- Balance per season, channel and viewer (fast reads); always equal to the sum of the ledger.
create table if not exists event_wallets (
  season text not null check (season ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  channel_id text not null,
  viewer_id text not null,
  viewer_name text not null,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null,
  primary key (season, channel_id, viewer_id)
);

-- Append-only ledger: one row per movement; `key` makes every movement idempotent (a replay never pays twice).
create table if not exists event_ledger (
  id bigint generated always as identity primary key,
  season text not null,
  channel_id text not null,
  viewer_id text not null,
  kind text not null check (kind in ('grant', 'remove', 'sub_reward', 'gift_reward', 'convert', 'purchase', 'refund',
    'raffle')),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  key text not null unique,
  reference text,
  actor text not null,
  reason text,
  created_at timestamptz not null,
  foreign key (season, channel_id, viewer_id) references event_wallets (season, channel_id, viewer_id)
);
create index if not exists event_ledger_viewer_idx on event_ledger (season, channel_id, viewer_id, created_at desc);

create or replace function event_ledger_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'event_ledger is append-only';
end $$;
drop trigger if exists event_ledger_no_update on event_ledger;
create trigger event_ledger_no_update before update or delete on event_ledger
  for each row execute function event_ledger_immutable();

-- The event, per channel: open or not, its season, its limits and its earning rules (all set from Studio).
create table if not exists event_shop_settings (
  channel_id text primary key,
  season text not null check (season ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  enabled boolean not null,
  rules jsonb not null,
  updated_at timestamptz not null
);

-- The catalogue: what viewers can buy (a screamer / apparition plays a media; an effect is drawn by the overlay).
create table if not exists event_shop_items (
  channel_id text not null,
  item_id text not null check (item_id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  kind text not null check (kind in ('screamer', 'apparition', 'effect')),
  media_id text check (media_id is null or media_id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  effect text check (effect is null or effect ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  label text not null check (length(label) between 1 and 40),
  description text not null default '' check (length(description) <= 120),
  price integer not null check (price between 1 and 100000),
  cooldown_ms integer not null check (cooldown_ms between 0 and 86400000),
  enabled boolean not null,
  sort integer not null default 0,
  params jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  primary key (channel_id, item_id),
  check ((kind = 'effect') = (effect is not null)),
  check ((kind = 'effect') = (media_id is null))
);

-- Studio's executor (the overlay engine): its last heartbeat says whether purchases can be admitted.
create table if not exists event_shop_studios (
  channel_id text not null,
  studio_instance_id text not null,
  engine_ready boolean not null,
  media jsonb not null default '[]'::jsonb,
  seen_at timestamptz not null,
  primary key (channel_id, studio_instance_id)
);

-- One purchase = one play. Never replayed: a play not taken / not started in time fails and is refunded once;
-- a play started whose end never comes is « unknown » (no refund: it was probably seen).
create table if not exists event_shop_purchases (
  purchase_id uuid primary key,
  season text not null,
  channel_id text not null,
  viewer_id text not null,
  viewer_name text not null,
  item_id text not null,
  item_kind text not null,
  label text not null,
  price integer not null check (price > 0),
  idempotency_key text not null,
  request_hash text not null,
  status text not null check (status in ('queued', 'executing', 'completed', 'failed', 'unknown')),
  refund_status text not null default 'none' check (refund_status in ('none', 'refunded')),
  error text,
  studio_instance_id text,
  attempt_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz,
  unique (channel_id, viewer_id, idempotency_key)
);
create index if not exists event_shop_purchases_open_idx on event_shop_purchases (channel_id, created_at)
  where status in ('queued', 'executing');
create index if not exists event_shop_purchases_recent_idx on event_shop_purchases (channel_id, created_at desc);
