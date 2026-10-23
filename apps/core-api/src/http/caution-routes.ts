import {
  CautionCheckReport,
  CautionClaimRequest,
  CautionRecheckReport,
  CautionReleaseReport,
} from '@raptoru/schemas';
import { CautionError, type CautionService } from '../caution/service.js';
import { HttpError, parse, type Route } from './server.js';

// Caution — routes of the ONE implementation (docs/CAUTION.md), same sub-paths twice (like Random Ban):
// - Lab Core: /v1/lab/caution/* (Studio secret; the Lab chat adapter — the Twitch executor — uses it too);
// - production Core: /v1/studio/caution/{channel}/state (Studio installation) and /v1/bot/caution/* (bot secret: the
//   Twitch executor's claim / check / recheck / result only).

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CautionError)
      throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

export function cautionRoutes(
  caution: CautionService,
  production?: { channelId: string },
): Route[] {
  const base = production ? '/v1/studio/caution' : '/v1/lab/caution';
  const auth = production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const execBase = production ? '/v1/bot/caution' : base;
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
      handle: ({ params }) => caution.state(channel(params[0]!)),
    },
    {
      method: 'POST',
      pattern: at(execBase, '/(\\d{1,32})/claim'),
      auth: execAuth,
      handle: ({ params, body }) =>
        caution.claim(channel(params[0]!), parse(CautionClaimRequest, body)),
    },
    {
      method: 'POST',
      pattern: at(execBase, `/requests/${uuid}/check`),
      auth: execAuth,
      handle: ({ params, body }) =>
        mapped(() =>
          caution.check(params[0]!, parse(CautionCheckReport, body)),
        ),
    },
    {
      method: 'POST',
      pattern: at(execBase, `/requests/${uuid}/recheck`),
      auth: execAuth,
      handle: ({ params, body }) =>
        mapped(() =>
          caution.recheck(params[0]!, parse(CautionRecheckReport, body)),
        ),
    },
    {
      method: 'POST',
      pattern: at(execBase, `/requests/${uuid}/result`),
      auth: execAuth,
      handle: ({ params, body }) =>
        mapped(() =>
          caution.result(params[0]!, parse(CautionReleaseReport, body)),
        ),
    },
  ];
}
