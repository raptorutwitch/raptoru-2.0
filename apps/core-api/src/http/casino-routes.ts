import { z } from 'zod';
import type { BlackjackService } from '../casino/blackjack/service.js';
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
  test: z.unknown().optional(),
});
// Blackjack: the viewer + the intent's fields (the engine validates each value; never a body-chosen identity).
const BjBody = z.strictObject({
  viewer: Viewer,
  table_id: z.unknown().optional(),
  seat: z.unknown().optional(),
  main: z.unknown().optional(),
  side: z.unknown().optional(),
  ready: z.unknown().optional(),
  type: z.unknown().optional(),
  token: z.unknown().optional(),
  action_id: z.unknown().optional(),
  stake: z.unknown().optional(),
  even: z.unknown().optional(),
  rig: z.unknown().optional(),
});
const Progress = z.strictObject({
  viewer: Viewer,
  round_id: z.unknown(),
  stage: z.unknown().optional(),
  step: z.unknown().optional(),
  done: z.unknown().optional(),
  fast: z.unknown().optional(),
  of: z.unknown().optional(),
});
const Draft = z.strictObject({ viewer: Viewer, bets: z.unknown() });
const Presence = z.strictObject({ viewer: Viewer, game: z.unknown() });
/** A long-poll's wait (ms), bounded by the feed. */
const waitOf = (url: URL) => {
  const n = Number(url.searchParams.get('wait_ms') ?? 0);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 25_000) : 0;
};
const afterOf = (url: URL) => {
  const n = Number(url.searchParams.get('after') ?? -1);
  return Number.isSafeInteger(n) ? n : 0;
};
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

export function casinoRoutes(
  casino: CasinoService,
  blackjack: BlackjackService,
): Route[] {
  const at = (rest: string) =>
    new RegExp(`^\\/v1\\/lab\\/casino\\/(\\d{1,32})\\/${rest}$`);
  const bj = (
    path: string,
    fn: (ch: string, b: z.infer<typeof BjBody>) => Promise<unknown>,
  ): Route => ({
    method: 'POST',
    pattern: at(`bj\\/${path}`),
    auth: 'studio',
    handle: ({ params, body }) =>
      mapped(() => fn(params[0]!, parse(BjBody, body))),
  });
  return [
    {
      method: 'POST',
      pattern: at('book\\/spin'),
      auth: 'studio',
      handle: ({ params, body }) => {
        const b = parse(Spin, body);
        return mapped(() =>
          casino.spinBook(params[0]!, b.viewer, {
            key: b.key,
            bet: b.bet,
            test: b.test,
          }),
        );
      },
    },
    // Blackjack: the lobby, a table's redacted state (long-poll; anyone may watch), the player's intents.
    {
      method: 'GET',
      pattern: at('bj\\/tables'),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() => blackjack.tables(params[0]!, viewerOf(url))),
    },
    {
      method: 'GET',
      pattern: at('bj\\/state'),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() =>
          blackjack.state(
            params[0]!,
            url.searchParams.get('table') ?? '',
            viewerOf(url),
            afterOf(url),
            waitOf(url),
          ),
        ),
    },
    bj('join', (ch, b) =>
      blackjack.join(ch, b.viewer, { table_id: b.table_id, seat: b.seat }),
    ),
    bj('bet', (ch, b) =>
      blackjack.bet(ch, b.viewer, {
        main: b.main,
        side: b.side,
        ready: b.ready,
      }),
    ),
    bj('clear', (ch, b) => blackjack.clear(ch, b.viewer)),
    bj('act', (ch, b) =>
      blackjack.act(ch, b.viewer, {
        type: b.type,
        token: b.token,
        action_id: b.action_id,
      }),
    ),
    bj('insure', (ch, b) =>
      blackjack.insure(ch, b.viewer, {
        stake: b.stake,
        even: b.even,
        action_id: b.action_id,
      }),
    ),
    bj('leave', (ch, b) => blackjack.leave(ch, b.viewer)),
    bj('announce', (ch, b) => blackjack.announce(ch, b.viewer, b.table_id)),
    bj('rig', (ch, b) => blackjack.rig(ch, b.viewer, b.rig)),
    {
      method: 'GET',
      pattern: at('admin\\/bj'),
      auth: 'studio',
      handle: ({ params }) =>
        mapped(async () => ({
          tables: await blackjack.adminTables(params[0]!),
        })),
    },
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
      pattern: at('draft'),
      auth: 'studio',
      handle: ({ params, body }) => {
        const b = parse(Draft, body);
        return mapped(() => casino.draft(params[0]!, b.viewer, b.bets));
      },
    },
    {
      method: 'POST',
      pattern: at('presence'),
      auth: 'studio',
      handle: ({ params, body }) => {
        const b = parse(Presence, body);
        return mapped(() => casino.presence(params[0]!, b.viewer, b.game));
      },
    },
    // Spectators (public): follow a player (their revealed stages after a cursor), who is playing now. Long-poll.
    {
      method: 'GET',
      pattern: at('watch'),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() =>
          casino.watch(
            params[0]!,
            url.searchParams.get('player') ?? '',
            afterOf(url),
            waitOf(url),
          ),
        ),
    },
    {
      method: 'GET',
      pattern: at('live'),
      auth: 'studio',
      handle: ({ params, url }) =>
        mapped(() => casino.livePlayers(params[0]!, afterOf(url), waitOf(url))),
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
