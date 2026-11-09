import type { LabCall, LabCallError } from './lab-internal.js';

// Music Hub (docs/music/MUSIC_HUB_STATE.md) — the viewer frontier's music doors, on the in-process routes of
// http/music-ext-routes.ts. The caller is the verified JWT's identity, never a field of the request: a viewer searches,
// asks, and withdraws ITS OWN requests; the team's actions carry the caller as actor and Core checks each permission.

type Json = Record<string, unknown>;
export interface MusicCaller {
  id: string;
  login: string;
  display_name: string;
  role: 'viewer' | 'moderator' | 'broadcaster';
}

const UUID = /^[0-9a-f-]{36}$/;
const KEY = /^[A-Za-z0-9_:-]{8,128}$/;

export async function musicExt(
  core: LabCall,
  channelId: string,
  method: string,
  rawPath: string,
  body: Json | undefined,
  caller: MusicCaller | null,
  team: boolean,
  idempotencyKey: string | undefined,
): Promise<{ status: number; body: Json }> {
  const base = `/v1/lab/spotify-ext/${channelId}`;
  const path = rawPath.split('?')[0]!;
  const ok = async (p: string, payload?: unknown) => ({
    status: 200,
    body: { ok: true, ...(await core<Json>(p, payload)) } as Json,
  });
  const fail = (status: number, error: string) => ({
    status,
    body: { ok: false, error } as Json,
  });
  const viewer = caller
    ? { id: caller.id, login: caller.login, name: caller.display_name }
    : null;
  try {
    // Everyone may look (an anonymous viewer sees the queue without « mes demandes »).
    if (method === 'GET' && path === '/music/state')
      return await ok(`${base}/state`, {
        viewer,
        team: team && !!caller,
        ...(caller ? { role: caller.role } : {}),
      });
    // « Musiques de la soirée »: public like the queue (« toi » only with an identity).
    if (method === 'GET' && path === '/music/history') {
      const before = new URLSearchParams(rawPath.split('?')[1] ?? '').get(
        'before',
      );
      if (before !== null && Number.isNaN(Date.parse(before)))
        return fail(400, 'invalid_before');
      return await ok(`${base}/history`, {
        viewer_id: caller?.id ?? null,
        before: before === null ? null : new Date(before).toISOString(),
      });
    }
    if (!caller) return fail(403, 'identity_required');
    if (method === 'POST' && path === '/music/search')
      return await ok(`${base}/search`, {
        viewer_id: caller.id,
        query: String(body?.query ?? ''),
      });
    const search = /^\/music\/search\/([^/]+)$/.exec(path);
    if (method === 'GET' && search) {
      if (!UUID.test(search[1]!)) return fail(400, 'invalid_search');
      return await ok(`${base}/search/${search[1]}`);
    }
    if (method === 'POST' && path === '/music/request') {
      if (!idempotencyKey || !KEY.test(idempotencyKey))
        return fail(400, 'idempotency_key_required');
      return await ok(`${base}/request`, {
        viewer,
        track_id: String(body?.track_id ?? ''),
        key: idempotencyKey,
        expected_price:
          typeof body?.expected_price === 'number' ? body.expected_price : null,
      });
    }
    if (method === 'POST' && path === '/music/cancel') {
      const id = String(body?.request_id ?? '');
      if (!UUID.test(id)) return fail(400, 'invalid_request');
      return await ok(`${base}/cancel`, {
        viewer: { id: caller.id, name: caller.display_name },
        request_id: id,
      });
    }
    if (method === 'POST' && path === '/music/moderate') {
      if (!team || caller.role === 'viewer') return fail(403, 'team_only');
      if (!idempotencyKey || !KEY.test(idempotencyKey))
        return fail(400, 'idempotency_key_required');
      return await ok(`${base}/moderate`, {
        actor: { ...caller, via: 'extension' },
        key: idempotencyKey,
        command: body?.command,
      });
    }
    // Music Hub: a viewer's paid skip — any identified viewer (the team too: its own free skip is the moderation's).
    if (method === 'POST' && path === '/music/skip') {
      if (!idempotencyKey || !KEY.test(idempotencyKey))
        return fail(400, 'idempotency_key_required');
      return await ok(`${base}/viewer-skip`, {
        viewer,
        key: idempotencyKey,
        expected_price:
          typeof body?.expected_price === 'number' ? body.expected_price : null,
      });
    }
    const skip = /^\/music\/skip\/([^/]+)$/.exec(path);
    if (method === 'GET' && skip) {
      if (!UUID.test(skip[1]!)) return fail(400, 'invalid_skip');
      return await ok(`${base}/viewer-skip/result`, {
        viewer_id: caller.id,
        id: skip[1],
      });
    }
    const control = /^\/music\/controls\/([^/]+)$/.exec(path);
    if (method === 'GET' && control) {
      if (!team) return fail(403, 'team_only');
      if (!UUID.test(control[1]!)) return fail(400, 'invalid_job');
      return await ok(`${base}/controls/${control[1]}`);
    }
    return fail(404, 'not_found');
  } catch (e) {
    const err = e as LabCallError;
    if (typeof err.status === 'number')
      return {
        status: err.status,
        body: { ok: false, ...(err.body ?? { error: 'core_error' }) },
      };
    throw e;
  }
}
