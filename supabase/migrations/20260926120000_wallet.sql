-- Wallet / Loyalty Core V1: multi-currency balances, immutable ledger, idempotent operations,
-- individual rates, global boosts, internal staff roles. Only core-api writes these tables.

create table currencies (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,31}$'),
  singular text not null check (length(trim(singular)) > 0),
  plural text not null check (length(trim(plural)) > 0),
  icon text,
  active boolean not null default true,
  is_primary boolean not null default false,
  transferable boolean not null default true,
  allow_negative_admin boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one primary currency.
create unique index currencies_single_primary on currencies ((is_primary)) where is_primary;

insert into currencies (id, singular, plural, is_primary) values ('main', 'Jeton', 'Jetons', true);

-- Current balance per viewer and currency (fast reads). Always equal to the ledger sum.
create table wallets (
  twitch_user_id text not null references viewers (twitch_user_id),
  currency_id text not null references currencies (id),
  balance bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (twitch_user_id, currency_id)
);

create index wallets_ranking_idx on wallets (currency_id, balance desc);

-- One row per logical operation (credit, spend, transfer, admin adjustment…), successful or refused.
-- Its idempotency key makes retries return the original outcome.
create table wallet_operations (
  id bigint generated always as identity primary key,
  idempotency_key text not null unique,
  kind text not null,
  request_hash text not null,
  status text not null check (status in ('pending', 'applied', 'rejected')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Immutable ledger: one row per balance movement. Corrections are new compensating rows.
create table wallet_transactions (
  id bigint generated always as identity primary key,
  operation_id bigint not null references wallet_operations (id),
  twitch_user_id text not null,
  currency_id text not null,
  amount bigint not null check (amount <> 0),
  kind text not null check (kind in (
    'reward', 'spend', 'transfer_out', 'transfer_in', 'admin_add', 'admin_remove',
    'admin_set_adjustment', 'penalty', 'refund', 'opening_balance'
  )),
  source text not null,
  reference text,
  actor text,
  reason text,
  balance_after bigint not null,
  created_at timestamptz not null default now(),
  foreign key (twitch_user_id, currency_id) references wallets (twitch_user_id, currency_id)
);

create index wallet_transactions_wallet_idx on wallet_transactions (twitch_user_id, currency_id, id desc);

create function wallet_transactions_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'wallet_transactions is append-only';
end $$;

create trigger wallet_transactions_no_update before update or delete on wallet_transactions
  for each row execute function wallet_transactions_immutable();

-- Individual loyalty multiplier (replaces the standard viewer/sub multiplier).
create table viewer_loyalty_rates (
  twitch_user_id text primary key references viewers (twitch_user_id),
  multiplier numeric(6, 2) not null check (multiplier > 0),
  set_by text not null,
  reason text,
  updated_at timestamptz not null default now()
);

-- Global temporary boost; at most one active at a time (enforced by Core).
create table loyalty_boosts (
  id bigint generated always as identity primary key,
  multiplier numeric(6, 2) not null check (multiplier > 0),
  label text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  created_by text not null,
  stopped_at timestamptz,
  stopped_by text,
  created_at timestamptz not null default now()
);

-- Internal economy permissions, independent from Twitch moderator status.
create table staff_roles (
  twitch_user_id text primary key references viewers (twitch_user_id),
  role text not null check (role in ('owner', 'supermod')),
  granted_by text not null,
  created_at timestamptz not null default now()
);
