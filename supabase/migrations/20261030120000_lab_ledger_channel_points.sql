-- Lab: credits granted by a channel points reward (Points de chaîne « accorder des crédits », phase 2 lot 4) get their
-- own ledger kind on the Lab test wallet, like the other module movements. Lab database only.

alter table lab_wallet_ledger drop constraint lab_wallet_ledger_kind_check;
alter table lab_wallet_ledger add constraint lab_wallet_ledger_kind_check
  check (kind in ('set', 'adjust', 'reset', 'debit', 'refund', 'admin', 'raffle_win', 'word_game', 'mini_game',
    'channel_points'));
