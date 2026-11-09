import { z } from 'zod';
import { SpotifyError, type SpotifyService } from '../spotify/service.js';
import { HttpError, parse, type Route } from './server.js';

// Music Hub (docs/music/MUSIC_HUB_STATE.md) — the extension's doors into Spotify V2, IN-PROCESS ONLY: listed in the
// viewer frontier's internal route table (ext/public-frontier.ts), never mounted on HTTP. The façade (ext/music-ext.ts)
// fills `viewer` / `actor` from the verified Twitch JWT, never from the extension's body.

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SpotifyError)
      throw new HttpError(e.status, {
        error: e.code,
        ...(e.details ? { details: e.details } : {}),
      });
    throw e;
  }
}

const Id = z.string().regex(/^\d{1,32}$/);
const Viewer = z.strictObject({
  id: Id,
  login: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
});
const Actor = z.strictObject({
  id: z.string().min(1).max(64),
  login: z.string().max(64).optional(),
  display_name: z.string().max(64).optional(),
  role: z.enum(['viewer', 'moderator', 'broadcaster']),
  via: z.literal('extension'),
});
const StateQuery = z.strictObject({
  viewer: Viewer.nullable(),
  team: z.boolean(),
  /** The JWT's role (Core computes the grade: a supermod is a moderator named in lab_staff). */
  role: z.enum(['viewer', 'moderator', 'broadcaster']).optional(),
});
const HistoryQuery = z.strictObject({
  viewer_id: Id.nullable(),
  before: z.iso.datetime({ offset: true }).nullable(),
});
const SearchQuery = z.strictObject({
  viewer_id: Id,
  query: z.string().max(200),
});
const RequestBody = z.strictObject({
  viewer: Viewer,
  track_id: z.string().max(40),
  key: z.string().max(128),
  expected_price: z.number().int().min(0).nullable(),
});
const CancelBody = z.strictObject({
  viewer: z.strictObject({ id: Id, name: z.string().min(1).max(64) }),
  request_id: z.uuid(),
});
const ModerateBody = z.strictObject({
  actor: Actor,
  key: z.string().min(8).max(128),
  command: z.discriminatedUnion('action', [
    z.strictObject({
      action: z.literal('remove'),
      request_id: z.uuid(),
      refund: z.boolean(),
    }),
    z.strictObject({ action: z.literal('skip') }),
    z.strictObject({ action: z.literal('pause') }),
    z.strictObject({ action: z.literal('resume') }),
    z.strictObject({
      action: z.literal('volume'),
      volume_percent: z.number().int().min(0).max(100),
    }),
    // Music Hub: a click on the timeline (supermods / broadcaster): a seek in the track playing, never a skip.
    z.strictObject({
      action: z.literal('seek'),
      position_ms: z
        .number()
        .int()
        .min(0)
        .max(24 * 3_600_000),
    }),
    z.strictObject({ action: z.literal('open') }),
    z.strictObject({ action: z.literal('close') }),
  ]),
});

const SkipBody = z.strictObject({
  viewer: Viewer,
  key: z.string().max(128),
  expected_price: z.number().int().min(0).nullable(),
});
const SkipResultBody = z.strictObject({ viewer_id: Id, id: z.uuid() });

export function musicExtRoutes(spotify: SpotifyService): Route[] {
  const base = '/v1/lab/spotify-ext';
  const at = (path: string) =>
    new RegExp('^' + (base + path).replaceAll('/', '\\/') + '$');
  const ch = '(\\d{1,32})';
  const uuid = '([0-9a-f-]{36})';
  const auth = 'studio' as const;
  return [
    {
      method: 'GET',
      pattern: at(`/${ch}/summary`),
      auth,
      handle: ({ params }) =>
        mapped(() => spotify.extensionSummary(params[0]!)),
    },
    {
      method: 'POST',
      pattern: at(`/${ch}/state`),
      auth,
      handle: ({ params, body }) =>
        mapped(() => {
          const b = parse(StateQuery, body);
          return spotify.extensionState(
            params[0]!,
            b.viewer ? { id: b.viewer.id, login: b.viewer.login } : null,
            b.team,
            b.role,
          );
        }),
    },
    {
      method: 'POST',
      pattern: at(`/${ch}/history`),
      auth,
      handle: ({ params, body }) =>
        mapped(() => {
          const b = parse(HistoryQuery, body);
          return spotify.extensionHistory(params[0]!, b.viewer_id, b.before);
        }),
    },
    {
      method: 'POST',
      pattern: at(`/${ch}/search`),
      auth,
      handle: ({ params, body }) =>
        mapped(() => {
          const b = parse(SearchQuery, body);
          return spotify.extensionSearch(params[0]!, b.viewer_id, b.query);
        }),
    },
    {
      method: 'GET',
      pattern: at(`/${ch}/search/${uuid}`),
      auth,
      handle: ({ params }) =>
        mapped(() => spotify.searchResult(params[0]!, params[1]!)),
    },
    {
      method: 'POST',
      pattern: at(`/${ch}/request`),
      auth,
      handle: ({ params, body }) =>
        mapped(() => {
          const b = parse(RequestBody, body);
          return spotify.extensionRequest({ channel_id: params[0]!, ...b });
        }),
    },
    {
      method: 'POST',
      pattern: at(`/${ch}/cancel`),
      auth,
      handle: ({ params, body }) =>
        mapped(() => {
          const b = parse(CancelBody, body);
          return spotify.extensionCancel(params[0]!, b.viewer, b.request_id);
        }),
    },
    {
      method: 'POST',
      pattern: at(`/${ch}/moderate`),
      auth,
      handle: ({ params, body }) =>
        mapped(() => {
          const b = parse(ModerateBody, body);
          return spotify.extensionModerate(
            params[0]!,
            b.actor,
            b.command,
            b.key,
          );
        }),
    },
    {
      // Music Hub: a viewer's paid skip (the price is Core's, never the body's: `expected_price` only guards a change).
      method: 'POST',
      pattern: at(`/${ch}/viewer-skip`),
      auth,
      handle: ({ params, body }) =>
        mapped(() => {
          const b = parse(SkipBody, body);
          return spotify.viewerSkip({ channel_id: params[0]!, ...b });
        }),
    },
    {
      method: 'POST',
      pattern: at(`/${ch}/viewer-skip/result`),
      auth,
      handle: ({ params, body }) =>
        mapped(() => {
          const b = parse(SkipResultBody, body);
          return spotify.viewerSkipResult(params[0]!, b.viewer_id, b.id);
        }),
    },
    {
      method: 'GET',
      pattern: at(`/${ch}/controls/${uuid}`),
      auth,
      handle: ({ params }) =>
        mapped(() => spotify.controlResult(params[0]!, params[1]!)),
    },
  ];
}
