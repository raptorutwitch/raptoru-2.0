import { z } from 'zod';
import { DockError, type DockActivityService } from '../dock/service.js';
import { HttpError, parse, type Route } from './server.js';

// Dock OBS V1 (docs/OBS_DOCK.md) — the activity feed and the visual replay, for Studio only (Studio relays them to the
// OBS dock; the dock never reaches the Core): production /v1/studio/dock/* (installation credential), Lab
// /v1/lab/dock/* (Studio secret). Reads never change anything; the replay only queues an animation.

const ReplayRequest = z.strictObject({ replay_key: z.uuid() });

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DockError)
      throw new HttpError(e.status, { error: e.code });
    throw e;
  }
}

const int = (v: string | null, fallback: number) => {
  const n = v === null ? fallback : Number(v);
  if (!Number.isInteger(n) || n < 0)
    throw new HttpError(400, { error: 'bad_query' });
  return n;
};

export function dockRoutes(
  dock: DockActivityService,
  production?: { channelId: string },
): Route[] {
  const base = production ? '/v1/studio/dock' : '/v1/lab/dock';
  const auth = production
    ? ('studio_installation' as const)
    : ('studio' as const);
  const at = (path: string) =>
    new RegExp('^' + (base + path).replaceAll('/', '\\/') + '$');
  const channel = (id: string) => {
    if (production && id !== production.channelId)
      throw new HttpError(409, {
        error: 'wrong_channel',
        expected_channel_id: production.channelId,
      });
    return id;
  };
  return [
    {
      // The most recent activities and the cursor to follow from (one snapshot); ?before= pages back.
      method: 'GET',
      pattern: at('/(\\d{1,32})/activity'),
      auth,
      handle: ({ params, url }) => {
        const before = url.searchParams.get('before');
        if (before !== null && Number.isNaN(Date.parse(before)))
          throw new HttpError(400, { error: 'bad_query' });
        return dock.recent(channel(params[0]!), {
          limit: int(url.searchParams.get('limit'), 100),
          before:
            before === null
              ? undefined
              : { at: before, seq: int(url.searchParams.get('before_seq'), 0) },
        });
      },
    },
    {
      // The changes after ?after= (commit order), waiting up to ?wait_ms= for one (long-poll).
      method: 'GET',
      pattern: at('/(\\d{1,32})/changes'),
      auth,
      handle: ({ params, url }) =>
        dock.changes(channel(params[0]!), {
          after: int(url.searchParams.get('after'), 0),
          limit: int(url.searchParams.get('limit'), 100),
          waitMs: int(url.searchParams.get('wait_ms'), 0),
        }),
    },
    {
      // A visual replay of an alert (its animation only, never its effects).
      method: 'POST',
      pattern: at('/(\\d{1,32})/alerts/([0-9a-f-]{36})/replay'),
      auth,
      handle: ({ params, body }) =>
        mapped(() =>
          dock.replayAlert(
            channel(params[0]!),
            params[1]!,
            parse(ReplayRequest, body).replay_key,
          ),
        ),
    },
  ];
}
