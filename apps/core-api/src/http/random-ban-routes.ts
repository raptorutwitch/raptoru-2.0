import { z } from 'zod';
import { mappedModeration } from './lab-moderation-routes.js';
import {
  RbAnimationClaim,
  RbAnimationReport,
  RbClaimRequest,
  RbMuteClaim,
  RbMuteReport,
  RbTestMuteRequest,
  RbResultReport,
  RbTargetReport,
  RbTestRequest,
} from '@raptoru/schemas';
import { RbError, type RandomBanService } from '../random-ban/service.js';
import { HttpError, parse, type Route } from './server.js';

// Random Ban V2 — routes of the ONE implementation (docs/RANDOM_BAN_V2.md), same sub-paths twice:
// - Lab Core: /v1/lab/random-ban/* (Studio secret; the Lab chat adapter — the Twitch executor — uses it too);
// - production Core: /v1/studio/random-ban/* (Studio installation: state, tests, animations) and /v1/bot/random-ban/*
//   (bot secret: the Twitch executor's claim / target / result only).

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RbError) throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

const ModActorShape = z.strictObject({
  id: z.string().min(1).max(64),
  login: z.string().max(64).optional(),
  display_name: z.string().max(64).optional(),
  role: z.enum(['viewer', 'moderator', 'broadcaster']),
  via: z.enum(['studio', 'extension']),
});
const ModActor = z.strictObject({ actor: ModActorShape });
const ModHistory = z.strictObject({
  actor: ModActorShape,
  viewer: z
    .string()
    .regex(/^\d{1,32}$/)
    .nullable()
    .optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
const Reason = z.string().trim().min(1).max(300);
const ModAct = z.strictObject({
  actor: ModActorShape,
  command: z.discriminatedUnion('action', [
    z.strictObject({
      action: z.literal('cancel'),
      request_id: z.uuid(),
      reason: Reason,
    }),
    z.strictObject({
      action: z.literal('refund_uncertain'),
      request_id: z.uuid(),
      reason: Reason,
    }),
    z.strictObject({
      action: z.literal('revoke_bonus'),
      request_id: z.uuid(),
      reason: Reason,
    }),
    z.strictObject({
      action: z.literal('resolve_sniper'),
      request_id: z.uuid(),
      viewer_id: z
        .string()
        .regex(/^\d{1,32}$/)
        .nullable(),
      reason: Reason,
    }),
    z.strictObject({
      action: z.literal('refill_charges'),
      viewer_id: z.string().regex(/^\d{1,32}$/),
      reason: Reason,
    }),
    z.strictObject({ action: z.literal('pause'), reason: Reason }),
    z.strictObject({ action: z.literal('resume'), reason: Reason }),
  ]),
});

/** Random Ban refusals and the moderation's (permissions, wallet) as explicit answers. */
async function moderated<T>(fn: () => Promise<T>): Promise<T> {
  return mappedModeration(() => mapped(fn));
}

export function randomBanRoutes(
  rb: RandomBanService,
  production?: { channelId: string },
): Route[] {
  const base = production ? '/v1/studio/random-ban' : '/v1/lab/random-ban';
  const auth = production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const execBase = production ? '/v1/bot/random-ban' : base;
  const execAuth = production ? ('bot' as const) : auth;
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
  const uuid = '([0-9a-f-]{36})';
  return [
    {
      method: 'GET',
      pattern: at(base, '/(\\d{1,32})/state'),
      auth,
      handle: ({ params }) => rb.state(channel(params[0]!)),
    },
    {
      // Studio « Tester »: never a real timeout (dry run or animation only).
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/test'),
      auth,
      handle: ({ params, body }) =>
        rb.test(channel(params[0]!), parse(RbTestRequest, body)),
    },
    {
      // V3: the streamer's mic muted in OBS for real (no Twitch call, nothing paid).
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/test-streamer-mute'),
      auth,
      // `{ caution: true }`: « Test Caution Random Ban » — a test mute Caution may end (real Jetons).
      handle: ({ params, body }) =>
        mapped(() =>
          rb.testStreamerMute(
            channel(params[0]!),
            undefined,
            parse(RbTestMuteRequest, body ?? {}),
          ),
        ),
    },
    {
      // V3: Studio's poll for the streamer's mute (and whether it could mute now).
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/mutes/claim'),
      auth,
      handle: ({ params, body }) =>
        rb.claimMute(channel(params[0]!), parse(RbMuteClaim, body)),
    },
    {
      method: 'POST',
      pattern: at(base, `/requests/${uuid}/mute`),
      auth,
      handle: ({ params, body }) =>
        mapped(() => rb.reportMute(params[0]!, parse(RbMuteReport, body))),
    },
    {
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/animations/claim'),
      auth,
      handle: ({ params, body }) =>
        rb.claimAnimation(
          channel(params[0]!),
          parse(RbAnimationClaim, body).consumer_id,
        ),
    },
    {
      method: 'POST',
      pattern: at(base, `/requests/${uuid}/animation`),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          rb.reportAnimation(params[0]!, parse(RbAnimationReport, body)),
        ),
    },
    // Moderation (Mini-jeux, SPEC § 8): the team's history, « À vérifier », and the audited actions. The caller is the
    // actor in the body (Studio: the broadcaster; the extension's moderation: the verified JWT, set by its façade).
    {
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/moderation/history'),
      auth,
      handle: ({ params, body }) =>
        moderated(() => {
          const b = parse(ModHistory, body);
          return rb.moderation!.history(channel(params[0]!), b.actor, {
            viewer: b.viewer ?? null,
            limit: b.limit,
          });
        }),
    },
    {
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/moderation/reconciliation'),
      auth,
      handle: ({ params, body }) =>
        moderated(() =>
          rb.moderation!.reconciliation(
            channel(params[0]!),
            parse(ModActor, body).actor,
          ),
        ),
    },
    {
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/moderation/act'),
      auth,
      handle: ({ params, body }) =>
        moderated(() => {
          const b = parse(ModAct, body);
          return rb.moderation!.act(channel(params[0]!), b.actor, b.command);
        }),
    },
    {
      method: 'POST',
      pattern: at(execBase, '/(\\d{1,32})/claim'),
      auth: execAuth,
      handle: ({ params, body }) =>
        rb.claim(channel(params[0]!), parse(RbClaimRequest, body)),
    },
    {
      method: 'POST',
      pattern: at(execBase, `/requests/${uuid}/target`),
      auth: execAuth,
      handle: ({ params, body }) =>
        mapped(() => rb.target(params[0]!, parse(RbTargetReport, body))),
    },
    {
      method: 'POST',
      pattern: at(execBase, `/requests/${uuid}/result`),
      auth: execAuth,
      handle: ({ params, body }) =>
        mapped(() => rb.result(params[0]!, parse(RbResultReport, body))),
    },
  ];
}
