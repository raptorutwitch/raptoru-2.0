-- Daily → Wallet: frozen calculation of each claim, and traceability of its Wallet credit.
-- Null on rows created before this migration (and on imported history).

-- Reward calculation at claim time (config values, streak, bonus, cap): never recomputed later.
alter table daily_claims add column breakdown jsonb;

-- Durable key of the credit (also the Wallet idempotency key) and the Wallet operation it produced.
alter table daily_credits
  add column idempotency_key text unique,
  add column wallet_operation_id bigint references wallet_operations (id);
