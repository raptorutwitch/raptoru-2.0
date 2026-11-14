-- Caution collective (docs/CAUTION.md § 9, 14/11) — Lab database. Same content as the production file
-- 20261125130000_caution_pool.sql. Additive, re-runnable: a new open status `pooling` (30 s of free sign-ups,
-- nothing debited), the quote's unit price and the personal cap, and one row per participant (its share, its own
-- debit). The individual caution is unchanged.

alter table caution_requests add column if not exists unit_price integer check (unit_price > 0);
alter table caution_requests add column if not exists pool_ends_at timestamptz;
alter table caution_requests add column if not exists pool_cap integer check (pool_cap > 0);

alter table caution_requests drop constraint if exists caution_requests_status_check;
alter table caution_requests add constraint caution_requests_status_check check (status in ('checking', 'quoting',
  'quoted', 'pooling', 'confirmed', 'rechecking', 'releasing', 'released', 'refused', 'cancelled', 'expired', 'failed',
  'uncertain'));

-- One open caution per channel, the pool included (two Cores never open two).
drop index if exists caution_one_open;
create unique index if not exists caution_one_open on caution_requests (channel_id)
  where status in ('checking', 'quoting', 'quoted', 'pooling', 'confirmed', 'rechecking', 'releasing');

create table if not exists caution_pool (
  request_id uuid not null references caution_requests (request_id),
  viewer_id text not null,
  viewer_login text not null,
  viewer_name text not null,
  joined_ref text not null,
  joined_at timestamptz not null,
  -- Set at the closing, in the debit's transaction: what this participant paid (its own wallet interaction).
  share integer check (share >= 0),
  interaction_id uuid,
  primary key (request_id, viewer_id)
);
