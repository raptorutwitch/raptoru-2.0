import {
  LoyaltyConfig,
  LoyaltyEvent,
  SubscriptionSnapshot,
  Viewer,
} from '@raptoru/schemas';
import { z } from 'zod';
import type { LoyaltyEngine } from '../loyalty/engine.js';
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

export function loyaltyRoutes(engine: LoyaltyEngine): Route[] {
  return [
    // --- bot: normalized Twitch events (Core decides shadow/preview/credit) ---
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/loyalty\/events$/,
      auth: 'bot',
      handle: async ({ body }) => engine.handleEvent(parse(LoyaltyEvent, body)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/loyalty\/subscriptions\/snapshot$/,
      auth: 'bot',
      handle: async ({ body }) =>
        engine.applySubscriptionSnapshot(parse(SubscriptionSnapshot, body)),
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
