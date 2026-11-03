import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Défis (docs/CHALLENGES.md) — Studio's « Défis » tab relay to the profile's Core (the Lab Core, or the Production Core
// through the paired installation). Studio only relays: the Core checks every definition, counts and pays.
// /api/challenges[/<sub>] → <base>[/<sub>], for the Core's own sub-paths only.

const MAX_BODY = 16 * 1024;
const SUB =
  /^(\/(meta|runs|run|preview|[a-z0-9][a-z0-9_-]{0,47}(\/(delete|status|revoke))?))?$/;

export class ChallengesRelay {
  constructor(
    private readonly d: {
      core: LabCoreCall | null;
      environment: 'lab' | 'production' | null;
    },
  ) {}

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const p = url.pathname;
    if (p !== '/api/challenges' && !p.startsWith('/api/challenges/'))
      return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-raptoru-studio'] !== '1')
      return (reply(403, { error: 'forbidden' }), true);
    const core = this.d.core;
    if (!core) return (reply(503, { error: 'core_unavailable' }), true);
    const sub = p.slice('/api/challenges'.length);
    if (!SUB.test(sub) || (req.method !== 'GET' && req.method !== 'POST'))
      return (reply(404, { error: 'not_found' }), true);
    const base =
      this.d.environment === 'production'
        ? '/v1/studio/challenges'
        : '/v1/lab/challenges';
    try {
      let body: unknown;
      if (req.method === 'POST') {
        let raw = '';
        for await (const c of req) {
          raw += c;
          if (raw.length > MAX_BODY)
            return (reply(413, { error: 'body_too_large' }), true);
        }
        body = raw ? JSON.parse(raw) : {};
      }
      // A recount may take a moment on a large history.
      reply(
        200,
        await core(`${base}${sub}`, body, {
          timeoutMs: sub === '/run' || sub.endsWith('/status') ? 30_000 : 8000,
        }),
      );
    } catch (e) {
      const err = e as { status?: number; message?: string; body?: unknown };
      reply(
        err.status && err.status < 600 ? err.status : 502,
        (err.body as object) ?? { error: err.message ?? 'core_unavailable' },
      );
    }
    return true;
  }
}
