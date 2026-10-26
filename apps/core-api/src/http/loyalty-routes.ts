import {
  LoyaltyConfig,
  LoyaltyEvent,
  SubscriptionSnapshot,
  Viewer,
} from '@raptoru/schemas';
import { z } from 'zod';
import type { LoyaltyEngine } from '../loyalty/engine.js';
import type { SubWheelService } from '../sub-wheel/service.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

const TwitchUserId = z.string().regex(/^\d+$/);
const ConfigUpdate = z.object({
  config: LoyaltyConfig,
  actor: z.string().min(1).max(64),
});
const ExclusionRequest = z.object({
  viewer: Viewer,
  reason: z.string().min(1).max(200),
  actor: z.string().min(1).max(64),
});

export function loyaltyRoutes(
  engine: LoyaltyEngine,
  /** Roue du Sub V2 (R2): the sub / resub events are also proofs of rights to a spin, on this channel. */
  wheel?: { service: SubWheelService; channelId: string },
): Route[] {
  return [
    // --- bot: normalized Twitch events (Core decides shadow/preview/credit) ---
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/loyalty\/events$/,
      auth: 'bot',
      handle: async ({ body }) => {
        const event = parse(LoyaltyEvent, body);
        const response = await engine.handleEvent(event);
        // Two independent transactions, loyalty first. If the acquisition fails the answer is an error: the bot keeps
        // the event and sends it again — loyalty answers from its stored reward (never paid twice), the acquisition
        // (idempotent per EventSub message id) completes. Replays included: a lost acquisition is always resumed.
        if (wheel)
          await wheel.service.acquireFromLoyalty(wheel.channelId, event);
        return response;
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/loyalty\/subscriptions\/snapshot$/,
      auth: 'bot',
      handle: async ({ body }) => {
        const snapshot = parse(SubscriptionSnapshot, body);
        const r = await engine.applySubscriptionSnapshot(snapshot);
        // Roue du Sub R7, own transaction after the loyalty one (a failure: 5xx, the bot sends the snapshot again;
        // the catch-up is idempotent per snapshot and viewer).
        if (wheel && r.previousAt && r.added.length)
          await wheel.service.reconcile(
            wheel.channelId,
            r.added.map((s) => ({
              id: s.viewer.twitchUserId,
              login: s.viewer.login,
              name: s.viewer.displayName,
              tier: s.tier === 't3' ? 3 : s.tier === 't2' ? 2 : 1,
            })),
            r.previousAt,
            new Date(snapshot.fetchedAt),
          );
        return { subscribers: r.subscribers };
      },
    },

    // --- Studio / admin ---
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/loyalty\/config$/,
      auth: 'studio',
      handle: async () => ({
        config: await engine.getConfig(),
        modes: engine.modes,
      }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/loyalty\/config$/,
      auth: 'studio',
      handle: async ({ body }) => {
        const req = parse(ConfigUpdate, body);
        return {
          config: await engine.setConfig(req.config, `studio:${req.actor}`),
        };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/loyalty\/exclusions$/,
      auth: 'studio',
      handle: async () => engine.listExclusions(),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/loyalty\/exclusions$/,
      auth: 'studio',
      handle: async ({ body }) => {
        const req = parse(ExclusionRequest, body);
        await engine.exclude(req.viewer, req.reason, `studio:${req.actor}`);
        return { excluded: req.viewer.twitchUserId };
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/admin\/loyalty\/exclusions\/([^/]+)\/remove$/,
      auth: 'studio',
      handle: async ({ params }) => {
        await engine.unexclude(parse(TwitchUserId, params[0]));
        return { removed: true };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/loyalty\/viewers\/([^/]+)\/rewards$/,
      auth: 'studio',
      handle: async ({ params, url }) =>
        engine.rewardsOf(
          parse(TwitchUserId, params[0]),
          limitParam(url, 100, 500),
        ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/loyalty\/report\/([^/]+)$/,
      auth: 'studio',
      handle: async ({ params }) => {
        const report = await engine.report(params[0]!);
        if (!report) throw new HttpError(404, { error: 'no_loyalty_data' });
        return report;
      },
    },
  ];
}
