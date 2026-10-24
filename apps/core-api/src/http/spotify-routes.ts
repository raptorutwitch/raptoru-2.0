import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CpTwitchActionReport,
  SpotifyAutoSkipReport,
  SpotifyJobReport,
  SpotifyJobStart,
  SpotifyPanelAction,
  SpotifySettingsUpdate,
  SpotifyStudioSync,
  SpotifyViewerOverrideUpdate,
} from '@raptoru/schemas';
import {
  CpTwitchError,
  type CpTwitchActions,
} from '../channel-points/twitch-actions.js';
import { SpotifyError, type SpotifyService } from '../spotify/service.js';
import { HttpError, parse, type Route } from './server.js';

// Spotify V2 — routes of the ONE implementation (docs/SPOTIFY_V2.md), same sub-paths twice (like Votekick):
// - Lab Core: /v1/lab/spotify/* (Studio secret; the Lab chat adapter runs the Twitch-side actions too);
// - production Core: /v1/studio/spotify/{channel}/… (Studio installation: panel, sync, jobs, reports) and
//   /v1/bot/channel-points/twitch-actions/* (bot secret: the redemption statuses and the reward creation).

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SpotifyError || e instanceof CpTwitchError)
      throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

/** The reward Raptoru creates for the song requests (historical name, cost and mandatory text). */
const SONG_REWARD = {
  title: 'Choisi la prochaine musique !',
  cost: 1000,
  is_user_input_required: true,
} as const;
const RewardCreate = z.strictObject({
  prompt: z.string().max(200),
  // Historical price by default; Antoni may set another one before creating it.
  cost: z.number().int().min(1).max(1_000_000).default(SONG_REWARD.cost),
});
// The Lab chat simulator's identities (numeric ids): the same viewer for !mysong / !songcancel.
const LabSimulate = z.strictObject({
  viewer_id: z.string().regex(/^\d{1,32}$/),
  viewer_login: z.string().regex(/^[a-z0-9_]{1,25}$/),
  user_input: z.string().max(500),
});

export function spotifyRoutes(
  spotify: SpotifyService,
  twitch: CpTwitchActions,
  production?: { channelId: string },
): Route[] {
  const base = production ? '/v1/studio/spotify' : '/v1/lab/spotify';
  const auth = production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const execBase = production
    ? '/v1/bot/channel-points/twitch-actions'
    : '/v1/lab/channel-points/twitch-actions';
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
  const ch = '(\\d{1,32})';
  // Lab only: a viewer's request without Twitch (any login), straight into the same admission as a redemption.
  const simulate: Route[] = production
    ? []
    : [
        {
          method: 'POST',
          pattern: at(base, `/${ch}/simulate`),
          auth,
          handle: ({ params, body }) =>
            mapped(async () => {
              const s = parse(LabSimulate, body);
              const ref = randomUUID();
              const { request } = await spotify.admit({
                channel_id: channel(params[0]!),
                source: 'simulation',
                source_ref: `simulation:lab-${ref}`,
                reward_id: 'lab-simulated',
                redemption_id: `lab-${ref}`,
                viewer: {
                  id: s.viewer_id,
                  login: s.viewer_login,
                  name: s.viewer_login,
                },
                user_input: s.user_input,
              });
              return { request };
            }),
        },
      ];
  return [
    ...simulate,
    {
      method: 'GET',
      pattern: at(base, `/${ch}/state`),
      auth,
      handle: ({ params }) => mapped(() => spotify.state(channel(params[0]!))),
    },
    {
      method: 'POST',
      pattern: at(base, `/${ch}/settings`),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          spotify.saveSettings(
            channel(params[0]!),
            parse(SpotifySettingsUpdate, body),
            'studio',
          ),
        ),
    },
    {
      // Studio's sync (status + last playback reading) → its jobs and the logical queue.
      method: 'POST',
      pattern: at(base, `/${ch}/studio`),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          spotify.sync(channel(params[0]!), parse(SpotifyStudioSync, body)),
        ),
    },
    {
      method: 'POST',
      pattern: at(base, `/${ch}/jobs/${uuid}/start`),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          spotify.startJob(
            channel(params[0]!),
            params[1]!,
            parse(SpotifyJobStart, body).attempt_id,
          ),
        ),
    },
    {
      method: 'POST',
      pattern: at(base, `/${ch}/jobs/${uuid}/report`),
      auth,
      handle: ({ params, body }) =>
        mapped(async () => {
          await spotify.reportJob(
            channel(params[0]!),
            params[1]!,
            parse(SpotifyJobReport, body),
          );
          return { ok: true };
        }),
    },
    {
      method: 'POST',
      pattern: at(base, `/${ch}/auto-skips`),
      auth,
      handle: ({ params, body }) =>
        mapped(async () => {
          await spotify.autoSkip(
            channel(params[0]!),
            parse(SpotifyAutoSkipReport, body),
          );
          return { ok: true };
        }),
    },
    {
      // The panel's moderation (the broadcaster's own console): remove a request, skip the current song.
      method: 'POST',
      pattern: at(base, `/${ch}/actions`),
      auth,
      handle: ({ params, body }) =>
        mapped(async () => {
          const id = channel(params[0]!);
          const a = parse(SpotifyPanelAction, body);
          const key = `spotify:panel:${randomUUID()}`;
          return {
            outcome:
              a.action === 'remove'
                ? await spotify.remove(
                    id,
                    key,
                    { request_id: a.request_id },
                    'studio',
                  )
                : await spotify.skip(id, key, null),
          };
        }),
    },
    {
      // A viewer's exception to the global limits (null = global; both null = back to the global settings).
      method: 'POST',
      pattern: at(base, `/${ch}/overrides`),
      auth,
      handle: ({ params, body }) =>
        mapped(async () => ({
          overrides: await spotify.saveOverride(
            channel(params[0]!),
            parse(SpotifyViewerOverrideUpdate, body),
            'studio',
          ),
        })),
    },
    {
      // An uncertain addition settled by hand: refund it (CANCELED) / keep it (stays PENDING on Twitch).
      method: 'POST',
      pattern: at(base, `/${ch}/requests/${uuid}/settle`),
      auth,
      handle: ({ params, body }) =>
        mapped(async () => {
          const d = parse(
            z.strictObject({ decision: z.enum(['refund', 'keep']) }),
            body,
          );
          await spotify.settle(channel(params[0]!), params[1]!, d.decision);
          return { ok: true };
        }),
    },
    {
      // Create the reward owned by Raptoru (Antoni's GO): run by the bot, recorded as managed when done.
      method: 'POST',
      pattern: at(base, `/${ch}/reward`),
      auth,
      handle: ({ params, body }) =>
        mapped(async () => {
          const id = channel(params[0]!);
          const r = parse(RewardCreate, body);
          // One « Choisi la prochaine musique ! » owned by Raptoru: never a second one by a double click.
          if (
            (await spotify.managedRewards(id)).some(
              (m) => m.title === SONG_REWARD.title,
            )
          )
            throw new HttpError(409, { error: 'reward_exists' });
          return twitch.createReward(id, {
            ...SONG_REWARD,
            cost: r.cost,
            prompt: r.prompt,
          });
        }),
    },
    {
      method: 'POST',
      pattern: at(execBase, `/${ch}/claim`),
      auth: execAuth,
      handle: ({ params }) => mapped(() => twitch.claim(channel(params[0]!))),
    },
    {
      method: 'POST',
      pattern: at(execBase, `/${ch}/${uuid}/report`),
      auth: execAuth,
      handle: ({ params, body }) =>
        mapped(() =>
          twitch.report(
            channel(params[0]!),
            params[1]!,
            parse(CpTwitchActionReport, body),
          ),
        ),
    },
  ];
}
