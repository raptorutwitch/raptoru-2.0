import type { LabCall } from './lab-internal.js';

// Commands V2 on the viewer frontier: the public list and « Modération › Commandes », for the verified extension token
// (never a field of the request). Reads name the caller (`as`, `as_role`), writes carry it as the actor; Core resolves the
// effective role, the team rights, the locks and the versions. Served by the Lab environment for now (Production keeps
// commands_public off); the frontier's copy of what the historical Lab façade did in Studio.

type Json = Record<string, unknown>;
type Reply = { status: number; body: Json };

export interface CommandsActor {
  id: string;
  login: string;
  display_name: string;
  role: 'viewer' | 'moderator' | 'broadcaster';
  via: 'extension';
}

const UUID = /^[0-9a-f-]{36}$/;
const pick = (b: Json | undefined, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => b && k in b).map((k) => [k, b![k]]));
const fail = (status: number, error: string): Reply => ({
  status,
  body: { ok: false, error },
});

export async function commandsPublic(
  core: LabCall,
  channelId: string,
): Promise<Reply> {
  try {
    return {
      status: 200,
      body: {
        ok: true,
        ...(await core<Json>(`/v1/lab/commands/${channelId}/public`)),
      },
    };
  } catch {
    return fail(503, 'commands_unavailable');
  }
}

export async function commandsTeam(
  core: LabCall,
  channelId: string,
  method: string,
  rawPath: string,
  body: Json | undefined,
  actor: CommandsActor,
): Promise<Reply> {
  // Viewers never reach « Modération » (Core refuses them too: team_only).
  if (actor.role === 'viewer') return fail(403, 'team_only');
  const base = `/v1/lab/commands/${channelId}`;
  const path = rawPath.split('?')[0]!.slice('/commands/v2'.length);
  const as = `as=${encodeURIComponent(actor.id)}&as_role=${actor.role}`;
  const seg = path.split('/').filter(Boolean); // e.g. ['commands', id, 'update']
  const id = seg[1] ?? '';
  const ok = async (p: string, payload?: Json): Promise<Reply> => ({
    status: 200,
    body: await core<Json>(p, payload),
  });
  try {
    if (method === 'GET' && path === '/me') return await ok(`${base}/me?${as}`);
    if (method === 'GET' && path === '/list') return await ok(`${base}?${as}`);
    if (method === 'POST' && path === '/commands')
      return await ok(base, { actor, ...pick(body, ['config']) });
    if (seg[0] !== 'commands' || !UUID.test(id)) return fail(404, 'not_found');
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
    return fail(404, 'not_found');
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
}
