-- Lab: the cosmetic shop's Jetons (purchases, refunds) get their own ledger kind on the Lab test wallet, like the other
-- module movements (docs/COSMETIC_SHOP.md). Lab database only (the canonical Wallet records a free source).

alter table lab_wallet_ledger drop constraint lab_wallet_ledger_kind_check;
alter table lab_wallet_ledger add constraint lab_wallet_ledger_kind_check
  check (kind in ('set', 'adjust', 'reset', 'debit', 'refund', 'admin', 'raffle_win', 'word_game', 'mini_game',
    'channel_points', 'cosmetic'));
