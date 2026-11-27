import type { LabCall, LabCallError } from './lab-internal.js';

// Chaos V2 lot 2 (docs/chaos/CONTRAT_LOT2.md § 2.4) — the extension's door to the Core's `chaos` module (in-process
// routes, http/chaos-routes.ts). The viewer is the verified JWT's identity, never a body field; a purchase needs the
// shared identity and the client's Idempotency-Key (one per intent). The state and a quote are open to an anonymous
// viewer too (no balance, no personal rule). The Core decides every price, rule and refusal.

type Json = Record<string, unknown>;
export interface ChaosCaller {
  id: string;
  display_name: string;
}

const pick = (b: Json, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]),
  );

export async function chaosExt(
  core: LabCall,
  channelId: string,
  method: string,
  path: string,
  body: Json | undefined,
  viewer: ChaosCaller | null,
  idempotencyKey?: string,
): Promise<{ status: number; body: Json }> {
  const base = `/v1/lab/chaos/${channelId}`;
  const ok = async (p: string, payload?: Json) => ({
    status: 200,
    body: { ok: true, ...(await core<Json>(p, payload)) } as Json,
  });
  const fail = (status: number, code: string) => ({
    status,
    body: { ok: false, error: code, code },
  });
  const b = body ?? {};
  try {
    if (method === 'GET' && path === '/chaos/state')
      return await ok(
        `${base}/state${viewer ? `?viewer_id=${encodeURIComponent(viewer.id)}&viewer_name=${encodeURIComponent(viewer.display_name)}` : ''}`,
      );
    if (method === 'POST' && path === '/chaos/quote')
      return await ok(`${base}/quote`, {
        ...pick(b, ['effect', 'choice', 'credit_id']),
        viewer,
      });
    if (method === 'POST' && path === '/chaos/buy') {
      if (!viewer) return fail(403, 'identity_required');
      if (!idempotencyKey) return fail(400, 'idempotency_key_required');
      return await ok(`${base}/buy`, {
        ...pick(b, ['effect', 'choice', 'expected_price', 'credit_id']),
        viewer,
        idempotency_key: idempotencyKey,
      });
    }
    return fail(404, 'not_available');
  } catch (e) {
    const err = e as Partial<LabCallError>;
    if (typeof err.status !== 'number') throw e;
    return {
      status: err.status,
      body: {
        ...(err.body ?? {}),
        ok: false,
        error: err.message ?? 'error',
        code: String(err.body?.code ?? err.message ?? 'error'),
      },
    };
  }
}
