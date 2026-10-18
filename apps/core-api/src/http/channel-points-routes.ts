import {
  CpAckRequest,
  CpClaimRequest,
  CpEffectReport,
  CpRedemptionInput,
  CpRewardsSync,
  CpRuleInput,
  CpSettingsInput,
} from '@raptoru/schemas';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type ChannelPointsService,
  CpError,
} from '../channel-points/service.js';
import { HttpError, parse, type Route } from './server.js';

// Points de chaîne V1 — the routes of the ONE implementation (docs/CHANNEL_POINTS_V1.md), same sub-paths twice:
// - Lab Core: /v1/lab/channel-points/* (Studio secret; the Lab chat adapter posts redemptions with it too);
// - production Core: /v1/studio/channel-points/* (Studio installation credential, the Core's channel only) for the
//   configuration, tests and Studio's OBS jobs, and /v1/bot/channel-points/* (bot secret) where the bot can only post
//   redemptions and the reward list — never change a rule or the master switch.

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CpError) throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

const RewardId = z.string().regex(/^[A-Za-z0-9-]{1,128}$/);
const TestRequest = z.strictObject({
  reward_id: RewardId,
  /** The viewer's text to simulate (FX Cam: the effect name). */
  user_input: z.string().max(500).optional(),
});

export function channelPointsRoutes(
  cp: ChannelPointsService,
  /** Production: Studio installation routes + bot routes for this channel; absent: the Lab routes. */
  production?: { channelId: string },
): Route[] {
  const base = production
    ? '/v1/studio/channel-points'
    : '/v1/lab/channel-points';
  const auth = production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const at = (b: string, path: string) =>
    new RegExp('^' + (b + path).replaceAll('/', '\\/') + '$');
  const channel = (id: string) => {
    if (production && id !== production.channelId)
      throw new HttpError(409, {
        error: 'wrong_channel',
        expected_channel_id: production.channelId,
      });
    return id;
  };
  const studio: Route[] = [
    {
      method: 'GET',
      pattern: at(base, '/(\\d{1,32})/state'),
      auth,
      handle: ({ params }) => cp.state(channel(params[0]!)),
    },
    {
      // The master switch (persistent, OFF by default). Only Studio, never the bot.
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/settings'),
      auth,
      handle: ({ params, body }) =>
        cp.setEnabled(
          channel(params[0]!),
          parse(CpSettingsInput, body).enabled,
          production ? 'studio_production' : 'studio_lab',
        ),
    },
    {
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/rules/([A-Za-z0-9-]{1,128})'),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          cp.saveRule(
            channel(params[0]!),
            params[1]!,
            parse(CpRuleInput, body),
          ),
        ),
    },
    {
      // A Studio test of a rule: a simulated redemption by the streamer (runs even with the switch OFF).
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/test'),
      auth,
      handle: ({ params, body }) =>
        mapped(async () => {
          const ch = channel(params[0]!);
          const { reward_id, user_input } = parse(TestRequest, body);
          const reward = (await cp.rewards(ch)).find((r) => r.id === reward_id);
          if (!reward) throw new CpError(404, 'unknown_reward');
          return cp.receive({
            channel_id: ch,
            source: 'simulation',
            redemption_id: `test-${randomUUID()}`,
            reward: { id: reward.id, title: reward.title, cost: reward.cost },
            user: { id: ch, login: 'studio', display_name: 'Test Studio' },
            ...(user_input ? { user_input } : {}),
            redeemed_at: new Date().toISOString(),
          });
        }),
    },
    {
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/claim'),
      auth,
      handle: async ({ params, body }) => ({
        job: await cp.claim(
          channel(params[0]!),
          parse(CpClaimRequest, body).consumer_id,
        ),
      }),
    },
    {
      method: 'POST',
      pattern: at(base, '/jobs/([0-9a-f-]{36})/ack'),
      auth,
      handle: ({ params, body }) =>
        mapped(() => cp.ack(params[0]!, parse(CpAckRequest, body))),
    },
    {
      // The end of an effect sound Studio started for this job (effects player).
      method: 'POST',
      pattern: at(base, '/jobs/([0-9a-f-]{36})/effects'),
      auth,
      handle: ({ params, body }) =>
        mapped(() => cp.effectReport(params[0]!, parse(CpEffectReport, body))),
    },
  ];
  // Redemptions and the reward list: the Lab adapter (Studio secret) or, in production, the bot (bot secret).
  const ingestBase = production ? '/v1/bot/channel-points' : base;
  const ingestAuth = production ? ('bot' as const) : auth;
  const ingest: Route[] = [
    {
      method: 'POST',
      pattern: at(ingestBase, '/redemptions'),
      auth: ingestAuth,
      handle: ({ body }) => {
        const e = parse(CpRedemptionInput, body);
        channel(e.channel_id);
        // Real redemptions only come from Twitch through the bot / adapter; a test goes through /test.
        if (e.source !== 'twitch')
          throw new HttpError(400, { error: 'twitch_source_required' });
        return cp.receive(e);
      },
    },
    {
      method: 'POST',
      pattern: at(ingestBase, '/rewards'),
      auth: ingestAuth,
      handle: ({ body }) => {
        const s = parse(CpRewardsSync, body);
        channel(s.channel_id);
        return cp.syncRewards(s);
      },
    },
  ];
  return [...studio, ...ingest];
}
