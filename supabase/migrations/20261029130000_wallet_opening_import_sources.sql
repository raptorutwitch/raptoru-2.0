-- Opening balances, source traceability (docs/ECONOMY_MIGRATION.md): every account of the source snapshot
-- (StreamElements username) is recorded ONCE with what became of it — imported into one Twitch wallet (several
-- accounts may be attached to the same wallet) or excluded and kept out of the Wallet. Together they must equal the
-- source snapshot (accounts and total), which the import registry now records with its fingerprint.

alter table wallet_imports
  add column source_sha256 text check (source_sha256 ~ '^[0-9a-f]{64}$'),
  add column source_accounts integer check (source_accounts >= 0),
  add column source_total bigint check (source_total >= 0),
  add column excluded_accounts integer check (excluded_accounts >= 0),
  add column excluded_total bigint check (excluded_total >= 0);

create table wallet_import_sources (
  import_id text not null references wallet_imports (id),
  source_ref text not null check (length(source_ref) between 1 and 200),
  -- null when excluded: an excluded balance never reaches a wallet.
  twitch_user_id text references viewers (twitch_user_id),
  balance bigint not null check (balance >= 0),
  status text not null check (status in ('imported', 'excluded')),
  reason text,
  primary key (import_id, source_ref),
  check ((status = 'imported') = (twitch_user_id is not null))
);

create index wallet_import_sources_wallet_idx on wallet_import_sources (twitch_user_id);

create function wallet_import_sources_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'wallet_import_sources is append-only';
end $$;

create trigger wallet_import_sources_no_update before update or delete on wallet_import_sources
  for each row execute function wallet_import_sources_immutable();
