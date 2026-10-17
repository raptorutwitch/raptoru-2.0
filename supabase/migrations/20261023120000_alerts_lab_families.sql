-- Twitch alerts — one queue per FAMILY (17/10/2026, Lab only; docs/TWITCH_ALERTS_PARITY_2026-10.md § 18).
-- Before: one alert in flight per channel. Now: one alert in flight per (channel, family), so a follow, a sub, bits,
-- a donation and a raid can play together while each family stays strictly first in, first out. Additive: rows of an
-- existing Lab database (A1 / A2) are classified from their event type; a fresh database gets the same result.
--   follow                                          → follow
--   sub, resub, gift_targeted, gift_community       → subscription (a gift and a sub never play together)
--   bits / raid / donation                          → bits / raid / donation

alter table alert_items add column family text;

update alert_items set family = case
  when type = 'follow' then 'follow'
  when type in ('sub', 'resub', 'gift_targeted', 'gift_community') then 'subscription'
  else type
end;

alter table alert_items alter column family set not null;
alter table alert_items add constraint alert_items_family_check
  check (family in ('follow', 'subscription', 'bits', 'raid', 'donation'));

-- At most ONE alert in flight per channel AND family (claimed or playing). An existing database holds at most one
-- in flight per channel, which satisfies the new index.
drop index alert_items_one_in_flight;
create unique index alert_items_one_in_flight_per_family on alert_items (channel_id, family)
  where status in ('claimed', 'playing');

-- Inside a family: arrival order only (the legacy priority no longer lets a later alert overtake an earlier one).
drop index alert_items_next;
create index alert_items_next_per_family on alert_items (channel_id, family, seq) where status = 'queued';
