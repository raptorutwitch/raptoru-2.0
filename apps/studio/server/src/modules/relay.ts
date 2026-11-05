import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// The module host, relayed ONCE for every module (architecture socle): Studio → the profile's Core (the Lab Core, or
// the Production Core through the paired installation's cockpit, which forces the broadcaster's identity). Studio adds
// its own actor and forwards only the fields the Core validates; it decides nothing.

const MAX_BODY = 16 * 1024;
const STUDIO_ACTOR = { id: 'studio', role: 'broadcaster', via: 'studio' };
const ID = '[a-z][a-z0-9_]{1,40}';
const ACTION = '[a-z][a-z0-9_]{0,40}';

/**
 * `labPlayer`: Studio may act as a FICTIONAL player of the modules that hand their actions to a player (claim, then
 * report) — the Lab only: on the Production profile a « played » report would close a real paid action nobody saw.
 */
export function modulesRelay(
  core: LabCoreCall,
  channelId: string,
  o: { labPlayer?: boolean } = {},
) {
  const base = `/v1/lab/modules/${channelId}`;
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const p = url.pathname;
    if (p !== '/api/modules' && !p.startsWith('/api/modules/')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-raptoru-studio'] !== '1')
      return (reply(403, { error: 'forbidden' }), true);
    const body = async () => {
      let raw = '';
      for await (const chunk of req) {
        raw += String(chunk);
        if (raw.length > MAX_BODY)
          throw Object.assign(new Error('body_too_large'), { status: 413 });
      }
      return JSON.parse(raw || '{}') as Record<string, unknown>;
    };
    const sub = p.slice('/api/modules'.length);
    const get = req.method === 'GET';
    let m: RegExpExecArray | null;
    try {
      if (get && sub === '')
        return (
          reply(200, {
            ...(await core<Record<string, unknown>>(base)),
            lab_player: !!o.labPlayer,
          }),
          true
        );
      // The fictional player (Lab): the SAME door as a real OBS executor — claim (lease), then report.
      if (!get && (m = new RegExp(`^/(${ID})/(claim|report)$`).exec(sub))) {
        if (!o.labPlayer) return (reply(404, { error: 'not_found' }), true);
        const b = await body();
        return (
          reply(
            200,
            await core(
              `${base}/${m[1]}/${m[2]}`,
              m[2] === 'claim'
                ? { player: 'studio-lab-fictif' }
                : { activity_id: b.activity_id, status: b.status },
            ),
          ),
          true
        );
      }
      if (get && sub === '/activity') {
        const q = new URLSearchParams();
        for (const k of ['module', 'viewer', 'limit']) {
          const v = url.searchParams.get(k);
          if (v) q.set(k, v);
        }
        return (reply(200, await core(`${base}/activity?${q}`)), true);
      }
      if (!get && sub === '/refund') {
        const b = await body();
        return (
          reply(
            200,
            await core(`${base}/refund`, {
              actor: STUDIO_ACTOR,
              activity_id: b.activity_id,
              reason: b.reason,
            }),
          ),
          true
        );
      }
      if (get && (m = new RegExp(`^/(${ID})/status$`).exec(sub)))
        return (reply(200, await core(`${base}/${m[1]}/status`)), true);
      if (!get && (m = new RegExp(`^/(${ID})/admin/(${ACTION})$`).exec(sub))) {
        const b = await body();
        return (
          reply(
            200,
            await core(`${base}/${m[1]}/admin/${m[2]}`, {
              actor: STUDIO_ACTOR,
              input: b.input ?? null,
            }),
          ),
          true
        );
      }
      return (reply(404, { error: 'not_found' }), true);
    } catch (e) {
      const err = e as {
        status?: number;
        body?: Record<string, unknown>;
        message: string;
      };
      reply(err.status && err.status < 600 ? err.status : 502, {
        ...(err.body ?? {}),
        error: err.body?.error ?? err.message,
      });
      return true;
    }
  };
}
