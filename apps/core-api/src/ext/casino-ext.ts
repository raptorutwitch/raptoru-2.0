import type { LabCall } from './lab-internal.js';

// Casino (docs/CASINO.md) — the extension's door to the Core's casino (in-process routes, http/casino-routes.ts). The
// viewer is the verified JWT's identity, never a body field; a spin needs the client's Idempotency-Key (one per intent).
// Reading (state, a round for the spectators and the Replay) is open to every viewer of the extension, anonymous too;
// playing, the history, the progress and the share need the shared identity. The Core decides everything.

type Json = Record<string, unknown>;
export interface CasinoCaller {
  id: string;
  display_name: string;
}

const ROUND = /^\/casino\/rounds\/([0-9a-f-]{36})$/;

export async function casinoExt(
  core: LabCall,
  channelId: string,
  method: string,
  rawPath: string,
  body: Json | undefined,
  viewer: CasinoCaller | null,
  idempotencyKey?: string,
): Promise<{ status: number; body: Json }> {
  const base = `/v1/lab/casino/${channelId}`;
  const [path = '', query = ''] = rawPath.split('?');
  const qs = new URLSearchParams(query);
  const who = viewer
    ? `viewer_id=${encodeURIComponent(viewer.id)}&viewer_name=${encodeURIComponent(viewer.display_name)}`
    : '';
  const ok = async (p: string, payload?: Json) => ({
    status: 200,
    body: { ok: true, ...(await core<Json>(p, payload)) } as Json,
  });
  const b = body ?? {};
  try {
    if (method === 'GET' && path === '/casino/state')
      return await ok(`${base}/state${who ? `?${who}` : ''}`);
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = ROUND.exec(path)))
      return await ok(`${base}/rounds/${m[1]}${who ? `?${who}` : ''}`);
    if (!viewer)
      return { status: 403, body: { ok: false, error: 'identity_required' } };
    if (method === 'GET' && path === '/casino/history') {
      const game = qs.get('game');
      const limit = Number(qs.get('limit') ?? 50);
      return await ok(
        `${base}/history?${who}${game === 'slot' || game === 'roulette' ? `&game=${game}` : ''}&limit=${Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50}`,
      );
    }
    if (
      method === 'POST' &&
      (path === '/casino/slot/spin' || path === '/casino/roulette/spin')
    ) {
      if (!idempotencyKey)
        return {
          status: 400,
          body: { ok: false, error: 'idempotency_key_required' },
        };
      return await ok(`${base}${path.slice('/casino'.length)}`, {
        viewer,
        key: idempotencyKey,
        ...(path === '/casino/slot/spin' ? { bet: b.bet } : { bets: b.bets }),
      });
    }
    if (method === 'POST' && path === '/casino/progress')
      return await ok(`${base}/progress`, {
        viewer,
        round_id: b.round_id,
        step: b.step,
        done: b.done,
      });
    if (method === 'POST' && path === '/casino/share')
      return await ok(`${base}/share`, { viewer, round_id: b.round_id });
    return { status: 404, body: { ok: false, error: 'not_available' } };
  } catch (e) {
    const err = e as { status?: number; body?: Json; message: string };
    if (typeof err.status !== 'number') throw e;
    return {
      status: err.status,
      body: {
        ...(err.body ?? {}),
        ok: false,
        error: err.body?.error ?? err.message,
      },
    };
  }
}
