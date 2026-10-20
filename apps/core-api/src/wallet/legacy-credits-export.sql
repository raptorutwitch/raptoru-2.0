-- Lot 10 — export of the legacy extension's credits (ext_channel_point_redemptions), for
-- `npm run wallet:credits-from-legacy` (docs/ECONOMY_MIGRATION.md § 18). READ ONLY: one SELECT inside a read-only,
-- repeatable-read transaction (the rows and their declared totals come from the same snapshot). It writes nothing,
-- calls no function with side effects (ext_expire_redemptions, ext_recover_stale_claims… are NEVER called: the
-- expiry is judged by the converter at the cutoff below).
-- Replace the cutoff (the freeze instant, UTC) before running. Save the single JSON value as a file OUTSIDE the
-- repository (C:\Users\Antoni\Documents\Raptoru\_migration-exports\…): it holds Twitch IDs and logins.
begin transaction isolation level repeatable read read only;

with params as (
  select timestamptz '2026-10-20T00:00:00Z' as cutoff -- ← heure de gel (UTC)
),
iso as (
  select r.*,
         to_char(r.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_iso,
         to_char(r.redeemed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as redeemed_iso,
         to_char(r.settled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as settled_iso
    from public.ext_channel_point_redemptions r
)
select json_build_object(
  'source', 'legacy-ext-redemptions',
  'exported_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'cutoff', (select to_char(cutoff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from params),
  'declared', json_build_object(
    'rows', (select count(*) from iso),
    'remaining', coalesce(
      (select json_object_agg(reward_key, total)
         from (select reward_key, sum(credit_remaining)::bigint as total from iso group by reward_key) t),
      '{}'::json)
  ),
  'rows', coalesce(
    (select json_agg(json_build_object(
        'redemption_id', redemption_id,
        'reward_key', reward_key,
        'twitch_user_id', twitch_user_id,
        'login', login,
        'status', status,
        'expires_at', expires_iso,
        'credit_units', credit_units,
        'credit_remaining', credit_remaining,
        'credit_in_flight', credit_in_flight,
        'reward_id', reward_id,
        'source', source,
        'cost', cost,
        'redeemed_at', redeemed_iso,
        'settled_at', settled_iso,
        'credit_claim_cost', credit_claim_cost
      ) order by redemption_id)
       from iso),
    '[]'::json)
) as legacy_credits_export;

commit;

-- Contrôle rapide dans la même console (lecture seule) : crédits en vol à drainer avant l'export final.
-- select status, reward_key, count(*), sum(credit_remaining), sum(credit_claim_cost)
--   from public.ext_channel_point_redemptions
--  where status in ('claimed', 'cancel_pending') or credit_in_flight > 0
--  group by 1, 2;
