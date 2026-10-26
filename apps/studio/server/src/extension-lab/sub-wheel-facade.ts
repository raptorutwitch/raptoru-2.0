import { type LabCoreCall } from '../lab-moderation/proxy.js';
import type { ExtensionActor } from './commands-facade.js';

// Roue du Sub V2, lot R8 — extension façade of the Lab EBS (the production twin: core-api src/ext/sub-wheel-ext.ts).
// The caller is the verified extension token's identity, never a field of the request: a viewer reads and accepts
// ITS OWN tours only; the team part (moderators, the streamer) carries the caller as actor and Core checks
// « Roue du Sub · Tirer » / « Accorder » (subWheelDraw / subWheelGrant) and journals. Nothing is decided here.

type Json = Record<string, unknown>;
type Reply = { status: number; body: unknown };

const UUID = /^[0-9a-f-]{36}$/;

export function subWheelFacade(core: LabCoreCall, channelId: string) {
  const base = `/v1/lab/sub-wheel/${channelId}`;
  return async function call(
    method: string,
    rawPath: string,
    body: Json | undefined,
    actor: ExtensionActor,
    identityShared: boolean,
  ): Promise<Reply> {
    const path = rawPath.split('?')[0]!;
    const ok = async (p: string, payload?: Json) => ({
      status: 200,
      body: await core<unknown>(p, payload),
    });
    try {
      if (path === '/sub-wheel/me' || path === '/sub-wheel/me/accept') {
        if (!identityShared)
          return {
            status: 403,
            body: { ok: false, error: 'identity_required' },
          };
        if (method === 'GET' && path === '/sub-wheel/me')
          return await ok(`${base}/viewers/${actor.id}`);
        if (method === 'POST' && path === '/sub-wheel/me/accept')
          return await ok(`${base}/viewers/${actor.id}/accept`, {
            login: actor.login,
          });
      }
      if (path.startsWith('/sub-wheel/team/')) {
        if (actor.role === 'viewer')
          return { status: 403, body: { ok: false, error: 'team_only' } };
        if (method !== 'POST')
          return { status: 405, body: { ok: false, error: 'method' } };
        if (path === '/sub-wheel/team/rights')
          return await ok(`${base}/team/rights`, { actor });
        const req = /^\/sub-wheel\/team\/spins\/([^/]+)\/request$/.exec(path);
        if (req && UUID.test(req[1]!))
          return await ok(`/v1/lab/sub-wheel/spins/${req[1]}/request`, {
            actor,
          });
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
  };
}
