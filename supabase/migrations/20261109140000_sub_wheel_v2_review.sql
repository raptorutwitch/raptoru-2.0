-- Roue du Sub V2, lot R2 (docs/SUB_WHEEL_V2_PLAN.md) — production database. Same content as the Lab file
-- 20261102120000_sub_wheel_v2_review_lab.sql (both re-runnable). ADDITIVE: one new table, no existing row touched.
-- Rights « À vérifier »: two rights of one viewer that may stand for the same subscription month without a reliable
-- proof joining them are both kept; the suspect one is blocked (no draw by any path) until a human decides (lot R4).
-- A review never changes a right, its proofs or a gain; it is closed, never deleted (the history stays).
create table if not exists sw_spin_reviews (
  id bigint generated always as identity primary key,
  channel_id text not null,
  viewer_id text not null,
  -- The blocked right, and the right it may duplicate.
  spin_id uuid not null references sw_spins (spin_id),
  other_spin_id uuid not null references sw_spins (spin_id),
  reason text not null check (reason in ('same_month')),
  month integer not null,
  detail jsonb not null,
  -- open (blocked) · unresolved (left so by a human: still blocked) · distinct (two months confirmed by a human) ·
  -- merged (a duplicate absorbed, lot R4: never a new credit) · auto_distinct (a Twitch proof gave two months).
  status text not null check (status in ('open', 'unresolved', 'distinct', 'merged', 'auto_distinct')),
  created_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by text,
  check (spin_id <> other_spin_id),
  unique (spin_id, other_spin_id)
);
create index if not exists sw_spin_reviews_blocking on sw_spin_reviews (spin_id) where status in ('open', 'unresolved');
create index if not exists sw_spin_reviews_channel on sw_spin_reviews (channel_id, status, created_at);
