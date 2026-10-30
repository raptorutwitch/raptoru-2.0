-- Boutique cosmétique V1 (docs/COSMETIC_SHOP.md) — LAB schema. Same content as the Production file
-- 20261116130000_cosmetic_shop.sql. Additive: columns with constant defaults (no rewrite), new tables, a widened check
-- NOT VALID (no table scan, no long lock); nothing existing is changed or deleted. The existing titles and badges stay
-- « published » with no look: nothing changes for the viewers until Antoni publishes an offer.
-- - progression_rewards: a publication state (draft / published / hidden / archived), a look (validated JSON: colours,
--   gradient, a preset effect — never CSS, HTML or script), an optional badge image, an optional event.
-- - cosmetic_images: badge images, checked by the Core (PNG or still WebP, ≤ 40 Ko, ≤ 128 × 128), by content hash.
-- - cosmetic_offers: how an item is sold — currency (Jetons `main` or Bonbons), price, on / off, opening and closing
--   times, an optional event that must be open. Publication, visibility and sale are separate.
-- - cosmetic_purchases: every purchase with the price and currency really paid, its idempotency key (a double click or
--   a replay is the same purchase), refunds with who and why.
-- - cosmetic_awards: rewards given by a module (a mini-game, an event), once per key.
-- - progression_grants: new sources « purchase » and « reward ».
-- Rollback: drop table cosmetic_awards, cosmetic_purchases, cosmetic_offers;
--   alter table progression_rewards drop column status, drop column style, drop column image_id, drop column event_key;
--   drop table cosmetic_images;
--   alter table progression_grants drop constraint progression_grants_source_check;
--   alter table progression_grants add constraint progression_grants_source_check
--   check (source in ('level', 'event', 'manual', 'import')) not valid;
--   delete from schema_migrations where name = '20261116120000_cosmetic_shop_lab.sql';

create table if not exists cosmetic_images (
  image_id text primary key check (image_id ~ '^[0-9a-f]{64}$'),
  mime text not null check (mime in ('image/png', 'image/webp')),
  width integer not null check (width between 1 and 128),
  height integer not null check (height between 1 and 128),
  size integer not null check (size between 1 and 40960),
  bytes bytea not null,
  created_at timestamptz not null
);

alter table progression_rewards
  add column if not exists status text not null default 'published'
    check (status in ('draft', 'published', 'hidden', 'archived')),
  add column if not exists style jsonb not null default '{}'::jsonb,
  add column if not exists image_id text references cosmetic_images (image_id),
  add column if not exists event_key text check (event_key is null or event_key ~ '^[a-z0-9][a-z0-9-]{1,39}$');

create table if not exists cosmetic_offers (
  offer_id text primary key check (offer_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  channel_id text not null,
  reward_id text not null,
  currency text not null check (currency in ('main', 'bonbons')),
  price bigint not null check (price between 1 and 100000000),
  enabled boolean not null default false,
  opens_at timestamptz,
  closes_at timestamptz,
  event_key text check (event_key is null or event_key ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  sort integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (closes_at is null or opens_at is null or closes_at > opens_at),
  foreign key (channel_id, reward_id) references progression_rewards (channel_id, reward_id)
);
create index if not exists cosmetic_offers_reward on cosmetic_offers (channel_id, reward_id);

create table if not exists cosmetic_purchases (
  purchase_id uuid primary key,
  channel_id text not null,
  viewer_id text not null,
  viewer_name text not null,
  offer_id text not null references cosmetic_offers (offer_id),
  reward_id text not null,
  currency text not null check (currency in ('main', 'bonbons')),
  price bigint not null check (price > 0),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  status text not null check (status in ('completed', 'refunded')),
  created_at timestamptz not null,
  refunded_at timestamptz,
  refunded_by text,
  refund_reason text,
  unique (channel_id, viewer_id, idempotency_key)
);
create index if not exists cosmetic_purchases_viewer on cosmetic_purchases (channel_id, viewer_id, created_at desc);
create index if not exists cosmetic_purchases_recent on cosmetic_purchases (channel_id, created_at desc);

create table if not exists cosmetic_awards (
  channel_id text not null,
  award_key text not null check (length(award_key) between 3 and 160),
  module text not null check (module ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  viewer_id text not null,
  kind text not null check (kind in ('reward', 'bonbons', 'jetons')),
  reward_id text,
  amount bigint,
  reference text,
  created_at timestamptz not null,
  primary key (channel_id, award_key)
);

alter table progression_grants drop constraint if exists progression_grants_source_check;
alter table progression_grants add constraint progression_grants_source_check
  check (source in ('level', 'event', 'manual', 'import', 'purchase', 'reward')) not valid;
