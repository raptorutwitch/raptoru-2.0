import { z } from 'zod';
import { CasinoError, type CasinoService } from '../casino/service.js';
import { HttpError, limitParam, parse, type Route } from './server.js';

// Casino (docs/CASINO.md) — the Core's casino routes, in-process only: reached by the extension façade (`/casino/*`, the
// verified Twitch viewer, never a body field: ext/casino-ext.ts) and by Studio through the cockpit (`admin/*`, the
// broadcaster's installation). Never on public HTTP.

const Viewer = z.strictObject({
  id: z.string().regex(/^\d{1,32}$/),
  display_name: z.string().min(1).max(64),
});
const Spin = z.strictObject({
  viewer: Viewer,
  key: z.string().regex(/^[A-Za-z0-9_:-]{8,128}$/),
  bet: z.unknown().optional(),
  bets: z.unknown().optional(),
});
const Progress = z.strictObject({
  viewer: Viewer,
  round_id: z.unknown(),
  step: z.unknown(),
  done: z.unknown().optional(),
});
const Share = z.strictObject({ viewer: Viewer, round_id: z.unknown() });

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CasinoError)
      throw new HttpError(e.status, { error: e.code, ...e.details });
    throw e;
  }
}

/** The viewer of a GET (the façade adds its verified identity as query parameters; absent = anonymous). */
function viewerOf(url: URL) {
  const id = url.searchParams.get('viewer_id');
  if (id === null) return null;
  if (!/^\d{1,32}$/.test(id))
    throw new HttpError(400, { error: 'invalid_viewer' });
  return {
    id,
    display_name: (url.searchParams.get('viewer_name') ?? id).slice(0, 64),
  };
}

export function casinoRoutes(casino: CasinoService): Route[] {
  const at = (rest: string) =>
    new RegExp(`^\\/v1\\/lab\\/casino\\/(\\d{1,32})\\/${rest}$`);
  return [
    {
      method: 'GET',
      pattern: at('state'),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() => casino.viewerState(params[0]!, viewerOf(url))),
    },
    {
      method: 'POST',
      pattern: at('slot\\/spin'),
      auth: 'studio',
      handle: ({ params, body }) => {
        const b = parse(Spin, body);
        return mapped(() =>
          casino.spinSlot(params[0]!, b.viewer, { key: b.key, bet: b.bet }),
        );
      },
    },
    {
      method: 'POST',
      pattern: at('roulette\\/spin'),
      auth: 'studio',
      handle: ({ params, body }) => {
        const b = parse(Spin, body);
        return mapped(() =>
          casino.spinRoulette(params[0]!, b.viewer, {
            key: b.key,
            bets: b.bets,
          }),
        );
      },
    },
    {
      method: 'POST',
      pattern: at('progress'),
      auth: 'studio',
      handle: ({ params, body }) => {
        const b = parse(Progress, body);
        return mapped(() => casino.progress(params[0]!, b.viewer, b));
      },
    },
    {
      method: 'POST',
      pattern: at('share'),
      auth: 'studio',
      handle: ({ params, body }) => {
        const b = parse(Share, body);
        return mapped(() => casino.share(params[0]!, b.viewer, b.round_id));
      },
    },
    {
      method: 'GET',
      pattern: at('rounds\\/([0-9a-f-]{36})'),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() => casino.round(params[0]!, params[1]!, viewerOf(url))),
    },
    {
      method: 'GET',
      pattern: at('history'),
      auth: 'studio',
      handle: ({ params, url }) => {
        const v = viewerOf(url);
        if (!v) throw new HttpError(403, { error: 'identity_required' });
        return mapped(() =>
          casino.history(params[0]!, v, {
            game: url.searchParams.get('game'),
            limit: limitParam(url, 50, 100),
          }),
        );
      },
    },
    // Studio › Casino (cockpit): state, figures, rounds in progress, the last rounds, the refused ones.
    {
      method: 'GET',
      pattern: at('admin\\/state'),
      auth: 'studio',
      handle: ({ params }) => mapped(() => casino.adminState(params[0]!)),
    },
    {
      method: 'GET',
      pattern: at('admin\\/rounds\\/([0-9a-f-]{36})'),
      auth: 'studio',
      handle: ({ params }) =>
        mapped(() => casino.adminRound(params[0]!, params[1]!)),
    },
  ];
}
