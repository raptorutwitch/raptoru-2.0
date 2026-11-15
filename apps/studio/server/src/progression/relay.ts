import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Progression native (docs/PROGRESSION.md) — Studio's panel relay to the profile's Core (the Lab Core, or the
// Production Core through the paired installation). Studio only relays: the Core decides and records everything,
// and reads WizeBot itself (raptoru.fr's public export, the site holding the read-only WizeBot key; Studio never does).

export class ProgressionRelay {
  constructor(
    private readonly d: {
      core: LabCoreCall | null;
      environment: 'lab' | 'production' | null;
    },
  ) {}

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/progression'
      : '/v1/lab/progression';
  }

  private async body(req: IncomingMessage, max = 64 * 1024) {
    let raw = '';
    for await (const c of req) {
      raw += c;
      if (raw.length > max)
        throw Object.assign(new Error('body_too_large'), { status: 413 });
    }
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const p = url.pathname;
    if (!p.startsWith('/api/progression/')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-raptoru-studio'] !== '1') {
      reply(403, { error: 'forbidden' });
      return true;
    }
    const core = this.d.core;
    if (!core) {
      reply(503, { error: 'core_unavailable' });
      return true;
    }
    try {
      const route = `${req.method} ${p}`;
      const q = (name: string) =>
        encodeURIComponent((url.searchParams.get(name) ?? '').slice(0, 40));
      const viewer =
        /^\/api\/progression\/viewers\/(\d{1,32})(\/history)?$/.exec(p);
      const by = /^(xp|watch|messages)$/.exec(url.searchParams.get('by') ?? '');
      const period = /^(all|week|month)$/.exec(
        url.searchParams.get('period') ?? '',
      );
      const reads: Record<string, string> = {
        'GET /api/progression/leaderboard': `/leaderboard?by=${by?.[0] ?? 'xp'}&period=${period?.[0] ?? 'all'}&limit=100`,
        'GET /api/progression/state': '/settings',
        'GET /api/progression/viewers': `/viewers?q=${q('q')}`,
        'GET /api/progression/import/status': '/import/status',
        'GET /api/progression/import/waiting': `/import/waiting?q=${q('q')}`,
        'GET /api/progression/level-v2': '/level-v2',
        'GET /api/progression/levelups': '/levelups',
        // « Viewers avec son activé » (read-only) and the last pseudo refresh from Twitch.
        'GET /api/progression/prefs/sound': '/prefs/sound',
        'GET /api/progression/names': '/names',
        // The latest announcements and their synchronized sound (the test's proof).
        'GET /api/progression/announcements': '/announcements',
      };
      if (reads[route])
        return (reply(200, await core(`${this.base}${reads[route]}`)), true);
      if (req.method === 'GET' && viewer)
        return (
          reply(
            200,
            await core(`${this.base}/viewers/${viewer[1]}${viewer[2] ?? ''}`),
          ),
          true
        );
      const writes: Record<string, string> = {
        'POST /api/progression/settings': '/settings',
        'POST /api/progression/rewards': '/rewards',
        'POST /api/progression/grant': '/grant',
        'POST /api/progression/revoke': '/revoke',
        'POST /api/progression/adjust': '/adjust',
        'POST /api/progression/import/attach': '/import/attach',
        'POST /api/progression/import/resolve': '/import/resolve',
        'POST /api/progression/import/revert': '/import/revert',
        // Level Up V2: the guarded activation / undo (the typed confirmation travels to Core, which checks it).
        'POST /api/progression/level-v2/simulate': '/level-v2/simulate',
        'POST /api/progression/level-v2/activate': '/level-v2/activate',
        'POST /api/progression/level-v2/revert': '/level-v2/revert',
        // « Tester un Level Up » › a real « [TEST] » line in the chat (typed confirmation, checked by Core).
        'POST /api/progression/level-v2/test-chat': '/level-v2/test-chat',
        // The rankings' pseudos from Twitch, by the stable id (the Core also runs it daily).
        'POST /api/progression/names/refresh': '/names/refresh',
      };
      const notify = /^\/api\/progression\/viewers\/(\d{1,32})\/notify$/.exec(
        p,
      );
      if (req.method === 'POST' && notify)
        return (
          reply(
            200,
            await core(
              `${this.base}/viewers/${notify[1]}/notify`,
              await this.body(req),
            ),
          ),
          true
        );
      // The first extension's sound choices (its export, a few thousand rows at most): a larger body for this route only.
      if (route === 'POST /api/progression/prefs/import')
        return (
          reply(
            200,
            await core(
              `${this.base}/prefs/import`,
              await this.body(req, 4 * 1024 * 1024),
            ),
          ),
          true
        );
      if (writes[route])
        return (
          reply(
            200,
            await core(`${this.base}${writes[route]}`, await this.body(req)),
          ),
          true
        );
      if (
        route === 'POST /api/progression/import/wizebot' ||
        route === 'POST /api/progression/import/wizebot/dry-run'
      )
        return (
          reply(
            200,
            await core(
              `${this.base}/import/wizebot`,
              { dry_run: route.endsWith('/dry-run') },
              // The Core reads ~6 000 WizeBot rows and imports them in one transaction.
              { timeoutMs: 180_000 },
            ),
          ),
          true
        );
      reply(404, { error: 'not_found' });
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
