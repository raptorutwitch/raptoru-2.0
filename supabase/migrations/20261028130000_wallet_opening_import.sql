-- Opening balances (economic cutover, docs/ECONOMY_MIGRATION.md): the historical balances (StreamElements Jetons) enter
-- the Wallet ONCE. Two database barriers, independent of any idempotency key or file name:
-- - one opening import per currency, ever (a second snapshot can never be added on top of the first);
-- - at most one opening_balance ledger row per wallet (no other key can credit an opening twice).

create table wallet_imports (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_.:-]{2,63}$'),
  currency_id text not null unique references currencies (id),
  source text not null,
  cutoff timestamptz not null,
  -- sha256 of the approved snapshot file: the same file re-run is « already applied », any other one is refused.
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  accounts integer not null check (accounts >= 0),
  total bigint not null check (total >= 0),
  applied_at timestamptz not null default now()
);

create unique index wallet_transactions_one_opening on wallet_transactions (twitch_user_id, currency_id)
  where kind = 'opening_balance';
