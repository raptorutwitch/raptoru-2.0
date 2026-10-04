import { LAB_CHANNEL_ID, type LabCoreCall } from '../lab-moderation/proxy.js';

// Commands V2 — extension façade (phase E, « Modération › Commandes »). The caller is the identity
// of the verified extension token (never the Studio operator, never a field of the request): reads
// name it as the reader (`as`, `as_role`), writes carry it as the actor. Core resolves the effective
// role (moderator / supermod via Lab staff / the streamer), applies the team rights field by field
// with their bounds, the command lock, the module locks and the versions. Nothing is decided here.

export interface ExtensionActor {
  id: string;
  login: string;
  display_name: string;
  role: 'viewer' | 'moderator' | 'broadcaster';
  via: 'extension';
}
type Json = Record<string, unknown>;
type Reply = { status: number; body: unknown };

const UUID = /^[0-9a-f-]{36}$/;
const pick = (b: Json | undefined, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => b && k in b).map((k) => [k, b![k]]));

export function commandsFacade(core: LabCoreCall) {
  const base = `/v1/lab/commands/${LAB_CHANNEL_ID}`;
  return async function call(
    method: string,
    rawPath: string,
    body: Json | undefined,
    actor: ExtensionActor,
  ): Promise<Reply> {
    // Viewers never reach « Modération » (Core refuses them too: team_only).
    if (actor.role === 'viewer')
      return { status: 403, body: { ok: false, error: 'team_only' } };
    const path = rawPath.split('?')[0]!.slice('/commands/v2'.length);
    const as = `as=${encodeURIComponent(actor.id)}&as_role=${actor.role}`;
    const seg = path.split('/').filter(Boolean); // e.g. ['commands', id, 'update']
    const id = seg[1] ?? '';
    const ok = async (p: string, payload?: Json) => ({
      status: 200,
      body: await core<unknown>(p, payload),
    });
    try {
      if (method === 'GET' && path === '/me')
        return await ok(`${base}/me?${as}`);
      if (method === 'GET' && path === '/list')
        return await ok(`${base}?${as}`);
      if (method === 'POST' && path === '/commands')
        return await ok(base, { actor, ...pick(body, ['config']) });
      if (seg[0] !== 'commands' || !UUID.test(id))
        return { status: 404, body: { ok: false, error: 'not_found' } };
      if (method === 'GET' && seg.length === 2)
        return await ok(`${base}/${id}?${as}`);
      // The command's recent activity: uses and refusals (with their sends) and its last changes.
      if (method === 'GET' && seg[2] === 'activity' && seg.length === 3) {
        const [inv, hist] = await Promise.all([
          core<Json>(`${base}/invocations?${as}&command_id=${id}&limit=15`),
          core<Json>(`${base}/${id}/history?${as}&limit=8`),
        ]);
        return {
          status: 200,
          body: { invocations: inv.invocations, changes: hist.entries },
        };
      }
      if (method === 'POST' && seg[2] === 'update' && seg.length === 3)
        return await ok(`${base}/${id}/update`, {
          actor,
          ...pick(body, ['expected_version', 'changes']),
        });
      if (method === 'POST' && seg[2] === 'delete' && seg.length === 3)
        return await ok(`${base}/${id}/delete`, {
          actor,
          ...pick(body, ['expected_version']),
        });
      return { status: 404, body: { ok: false, error: 'not_found' } };
    } catch (e) {
      const err = e as { status?: number; body?: Json; message: string };
      return {
        status: err.status ?? 503,
        body: {
          ...(err.body ?? {}),
          ok: false,
          error: err.body?.error ?? err.message,
        },
      };
    }
  };
}
