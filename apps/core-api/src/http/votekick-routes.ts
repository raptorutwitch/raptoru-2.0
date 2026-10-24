import {
  VotekickCheckReport,
  VotekickClaimRequest,
  VotekickMuteReport,
  VotekickSettingsUpdate,
  VotekickTimeoutReport,
} from '@raptoru/schemas';
import { VotekickError, type VotekickService } from '../votekick/service.js';
import { HttpError, parse, type Route } from './server.js';

// Votekick V2 — routes of the ONE implementation (docs/VOTEKICK_V2.md § 9), same sub-paths twice (like Caution):
// - Lab Core: /v1/lab/votekick/* (Studio secret; the Lab chat adapter — the Twitch executor — uses it too);
// - production Core: /v1/studio/votekick/{channel}/… (Studio installation: state, the overlay / mute task, the mute's
//   reports) and /v1/bot/votekick/* (bot secret: the Twitch executor's claim / check / timeout only).

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof VotekickError)
      throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

export function votekickRoutes(
  votekick: VotekickService,
  production?: { channelId: string },
): Route[] {
  const base = production ? '/v1/studio/votekick' : '/v1/lab/votekick';
  const auth = production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const execBase = production ? '/v1/bot/votekick' : base;
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
      handle: ({ params }) => votekick.state(channel(params[0]!)),
    },
    {
      // Studio's Votekick settings: read back, and saved for the NEXT votes (validated here: 400 on a bad value).
      method: 'GET',
      pattern: at(base, '/(\\d{1,32})/settings'),
      auth,
      handle: ({ params }) => votekick.settings(channel(params[0]!)),
    },
    {
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/settings'),
      auth,
      handle: ({ params, body }) =>
        votekick.saveSettings(
          channel(params[0]!),
          parse(VotekickSettingsUpdate, body),
          'studio',
        ),
    },
    {
      method: 'GET',
      pattern: at(base, '/(\\d{1,32})/studio'),
      auth,
      handle: ({ params }) => votekick.studio(channel(params[0]!)),
    },
    {
      method: 'POST',
      pattern: at(base, '/(\\d{1,32})/mutes/(mute:[0-9a-f-]{36})/report'),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          votekick.muteReport(
            channel(params[0]!),
            params[1]!,
            parse(VotekickMuteReport, body),
          ),
        ),
    },
    {
      method: 'POST',
      pattern: at(execBase, '/(\\d{1,32})/claim'),
      auth: execAuth,
      handle: ({ params, body }) =>
        votekick.claim(channel(params[0]!), parse(VotekickClaimRequest, body)),
    },
    {
      method: 'POST',
      pattern: at(execBase, `/votes/${uuid}/check`),
      auth: execAuth,
      handle: ({ params, body }) =>
        mapped(() =>
          votekick.check(params[0]!, parse(VotekickCheckReport, body)),
        ),
    },
    {
      method: 'POST',
      pattern: at(execBase, `/votes/${uuid}/timeout`),
      auth: execAuth,
      handle: ({ params, body }) =>
        mapped(() =>
          votekick.timeoutResult(
            params[0]!,
            parse(VotekickTimeoutReport, body),
          ),
        ),
    },
  ];
}
