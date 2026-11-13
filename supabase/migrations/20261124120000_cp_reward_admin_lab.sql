-- Lab database. Same content as the production file 20261124130000_cp_reward_admin.sql.
-- Points de chaîne — Studio administers the rewards Raptoru owns (docs/mini-jeux/RECOMPENSES_TWITCH.md): a reward
-- created by Raptoru's Twitch app can be paused / resumed / edited by it (`reward_update`, run once by the bot); a
-- new reward may replace an old one (`migrated_from`: the old reward's id, its rule copied OFF at creation); the
-- Twitch pause is kept apart from « disabled ». Additive: nullable / defaulted columns, a widened check.

alter table cp_twitch_actions drop constraint if exists cp_twitch_actions_kind_check;
alter table cp_twitch_actions add constraint cp_twitch_actions_kind_check
  check (kind in ('redemption_status', 'reward_create', 'reward_update'));

alter table cp_rewards
  add column if not exists is_paused boolean,
  add column if not exists migrated_from text;
