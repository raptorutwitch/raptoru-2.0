import type { LabCall } from './lab-internal.js';

// Roue du Sub V2, lot R8 — the viewer frontier's façade on the main Core (the Lab twin: Studio's
// extension-lab/sub-wheel-facade.ts, same paths). The caller is the verified JWT's identity, never a field of the
// request: a viewer reads and accepts ITS OWN tours; the team part carries the caller as actor and Core checks
// subWheelDraw / subWheelGrant and journals. Reached through the in-process Lab routes of this Core's wheel.

type Json = Record<string, unknown>;
export interface SubWheelActor {
  id: string;
  login: string;
  display_name: string;
  role: 'viewer' | 'moderator' | 'broadcaster';
  via: 'extension';
}

const UUID = /^[0-9a-f-]{36}$/;

export async function subWheelExt(
  core: LabCall,
  channelId: string,
  method: string,
  rawPath: string,
  body: Json | undefined,
  actor: SubWheelActor | null,
): Promise<{ status: number; body: Json }> {
  const base = `/v1/lab/sub-wheel/${channelId}`;
  const path = rawPath.split('?')[0]!;
  const ok = async (p: string, payload?: Json) => ({
    status: 200,
    body: { ok: true, data: await core<unknown>(p, payload) } as Json,
  });
  try {
    if (!actor)
      return { status: 403, body: { ok: false, error: 'identity_required' } };
    if (method === 'GET' && path === '/sub-wheel/me')
      return await ok(`${base}/viewers/${actor.id}`);
    if (method === 'POST' && path === '/sub-wheel/me/accept')
      return await ok(`${base}/viewers/${actor.id}/accept`, {
        login: actor.login,
      });
    if (path.startsWith('/sub-wheel/team/') && method === 'POST') {
      if (actor.role === 'viewer')
        return { status: 403, body: { ok: false, error: 'team_only' } };
      if (path === '/sub-wheel/team/rights')
        return await ok(`${base}/team/rights`, { actor });
      const req = /^\/sub-wheel\/team\/spins\/([^/]+)\/request$/.exec(path);
      if (req && UUID.test(req[1]!))
        return await ok(`/v1/lab/sub-wheel/spins/${req[1]}/request`, { actor });
      if (path === '/sub-wheel/team/grant') {
        const b = body ?? {};
        return await ok(`${base}/grant`, {
          key: b.key,
          viewer: b.viewer,
          tier: b.tier,
          months: b.months,
          note: b.note,
          actor,
        });
      }
    }
    return { status: 404, body: { ok: false, error: 'not_available' } };
  } catch (e) {
    const err = e as { status?: number; message: string };
    return {
      status: err.status ?? 503,
      body: { ok: false, error: err.message },
    };
  }
}
