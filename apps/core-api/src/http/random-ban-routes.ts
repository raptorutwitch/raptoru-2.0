import {
  RbAnimationClaim,
  RbAnimationReport,
  RbClaimRequest,
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
