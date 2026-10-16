import type { IncomingMessage, ServerResponse } from 'node:http';
import { LAB_CHANNEL_ID, type LabCoreCall } from '../lab-moderation/proxy.js';

// Roulette and Slot V1 in Studio (docs/ROULETTE_SLOT_PARITY.md). Core decides and stores everything; this
// relay only maps the « Simulation de stream » panel's two calls to the Lab Core: the switch « Mini-jeux »
// and its state (with the last plays). Lab profile only.

const MAX_BODY = 1024;

export function miniGamesRelay(core: LabCoreCall) {
  const base = `/v1/lab/mini-games/${LAB_CHANNEL_ID}`;
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/mini-games/')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-raptoru-studio'] !== '1')
      return (reply(403, { error: 'forbidden' }), true);
    const p = url.pathname.slice('/api/mini-games'.length);
    try {
      if (req.method === 'GET' && p === '/state')
        return (reply(200, await core(`${base}/state`)), true);
      if (req.method === 'POST' && p === '/settings') {
        let raw = '';
        for await (const chunk of req) {
          raw += String(chunk);
          if (raw.length > MAX_BODY)
            return (reply(413, { error: 'body_too_large' }), true);
        }
        const body = JSON.parse(raw || '{}') as { enabled?: unknown };
        // Only the switch reaches Core (it validates it).
        return (
          reply(200, await core(`${base}/settings`, { enabled: body.enabled })),
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
