import type { TierStatus } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Route } from '../http/server.js';
import { passiveReward } from './calc.js';
import { loadLoyaltyConfig } from './config.js';
import { rewardMode, type LoyaltyModes } from './engine.js';
import { resolveTiers } from './tiers.js';

/**
 * The extension's mini-profile: the Loyalty status of ONE viewer (the JWT's, chosen by the façade — never an id sent by
 * the client). Read-only, the engine's own rules:
 * - the subscription tier as the engine knows it (`unknown` without a fresh Twitch snapshot: never guessed);
 * - the multiplier of the PRESENCE gains of Jetons, exactly as `passiveReward` applies it: the personal rate, else the
 *   tier's (Studio's Loyalty config). The boosts (wallet/loyalty.ts) are applied to no gain today: not counted. An
 *   excluded account earns nothing; an unknown tier is paid the base rate until verified (engine.ts, H9);
 * - the last cumulative month Twitch itself announced (a resub message, Roue du Sub sources): dated, never extrapolated.
 */
export async function viewerLoyaltyStatus(
  db: Db,
  channelId: string,
  viewerId: string,
  now: Date,
  modes: LoyaltyModes,
) {
  const tier: TierStatus = (await resolveTiers(db, [viewerId], now)).get(
    viewerId,
  )!;
  const [sub, rate, excluded, month, config] = await Promise.all([
    db.query<{ is_gift: boolean }>(
      'select is_gift from viewer_subscriptions where twitch_user_id = $1',
      [viewerId],
    ),
    db.query<{ multiplier: string }>(
      'select multiplier from viewer_loyalty_rates where twitch_user_id = $1',
      [viewerId],
    ),
    db.query('select 1 from loyalty_exclusions where twitch_user_id = $1', [
      viewerId,
    ]),
    db.query<{ months: number; at: Date | null }>(
      `select months, occurred_at as at from sw_spin_sources
       where channel_id = $1 and viewer_id = $2 and months is not null order by months desc limit 1`,
      [channelId, viewerId],
    ),
    loadLoyaltyConfig(db),
  ]);
  const personal = rate[0] ? Number(rate[0].multiplier) : null;
  const isExcluded = excluded.length > 0;
  const b = passiveReward(config, tier, personal, isExcluded);
  const source = isExcluded
    ? 'excluded'
    : personal !== null
      ? 'personal'
      : tier === 'unknown'
        ? 'unknown'
        : 'tier';
  return {
    subscription: {
      tier,
      subscribed: tier === 't1' || tier === 't2' || tier === 't3',
      gift: sub[0]?.is_gift ?? false,
      months: month[0]?.months ?? null,
      months_at: month[0]?.at ? new Date(month[0].at).toISOString() : null,
    },
    presence: {
      // Presence gains credited on this channel (Loyalty modes); otherwise the multiplier is only what they would be.
      credited: rewardMode('passive', modes) === 'credit',
      multiplier: isExcluded
        ? null
        : (b.effectiveMultiplier ?? config.passive.tierMultipliers.none),
      source,
      base: config.passive.baseAmount,
      interval_minutes: config.passive.intervalMinutes,
    },
  };
}

/** In-process only (the main Core's façade); the Lab Core serves it to the Extension Lab like its other /v1/lab routes. */
export function loyaltyViewerRoutes(
  db: Db,
  clock: Clock,
  modes: LoyaltyModes,
  channelId: string,
): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/lab\/loyalty\/me\/(\d{1,32})$/,
      auth: 'studio',
      handle: ({ params }) =>
        viewerLoyaltyStatus(db, channelId, params[0]!, clock.now(), modes),
    },
  ];
}
