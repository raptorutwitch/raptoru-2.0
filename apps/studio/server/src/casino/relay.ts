import type { IncomingMessage, ServerResponse } from 'node:http';
import { LAB_CHANNEL_ID, type LabCoreCall } from '../lab-moderation/proxy.js';

// Casino in Studio (docs/CASINO.md § 8): the Core decides and stores everything; this relay only maps the « Casino »
// page's READS to the Core's admin routes (state, figures, rounds in progress, the last rounds, the refused ones, one
// round's technical detail). Its settings go through the generic /api/module-settings. Never a spin: the Core's
// cockpit refuses every casino path but `admin/…` (a Studio installation never plays for a viewer).

const ROUND = /^\/rounds\/([0-9a-f-]{36})$/;
/** One player's history (« Dernières parties » grouped by player), by pages: `before` = `<ISO date>|<round id>`. */
const PLAYER = /^\/players\/(\d{1,32})\/rounds$/;
const BEFORE = /^[0-9T:.\-+Z]{10,40}\|[0-9a-f-]{36}$/;

/** `channelId`: the Lab channel, or the main Core's channel through the production cockpit. */
export function casinoRelay(core: LabCoreCall, channelId = LAB_CHANNEL_ID) {
  const base = `/v1/lab/casino/${channelId}/admin`;
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/casino/')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-raptoru-studio'] !== '1')
      return (reply(403, { error: 'forbidden' }), true);
    const p = url.pathname.slice('/api/casino'.length);
    try {
      if (req.method === 'GET' && p === '/state')
        return (reply(200, await core(`${base}/state`)), true);
      // The blackjack tables (read only: the Core runs them).
      if (req.method === 'GET' && p === '/bj')
        return (reply(200, await core(`${base}/bj`)), true);
      const m = ROUND.exec(p);
      if (req.method === 'GET' && m)
        return (reply(200, await core(`${base}/rounds/${m[1]}`)), true);
      const player = PLAYER.exec(p);
      if (req.method === 'GET' && player) {
        const q = new URLSearchParams();
        const before = url.searchParams.get('before');
        if (before && BEFORE.test(before)) q.set('before', before);
        const limit = Number(url.searchParams.get('limit'));
        if (Number.isInteger(limit) && limit > 0)
          q.set('limit', String(Math.min(limit, 100)));
        const qs = q.toString();
        return (
          reply(
            200,
            await core(
              `${base}/players/${player[1]}/rounds${qs ? `?${qs}` : ''}`,
            ),
          ),
          true
        );
      }
      reply(404, { error: 'not_found' });
    } catch (e) {
      const err = e as {
        status?: number;
        body?: Record<string, unknown>;
        message: string;
      };
      reply(err.status ?? 503, {
        ...(err.body ?? {}),
        error: err.body?.error ?? err.message,
      });
    }
    return true;
  };
}
