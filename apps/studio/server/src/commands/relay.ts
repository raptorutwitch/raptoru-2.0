import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  LAB_CHANNEL_ID,
  type LabCoreCall,
  STUDIO_ACTOR,
} from '../lab-moderation/proxy.js';

// Commands V2 in Studio (phase D). Core decides and stores everything (configuration, categories,
// rights, history, invocations, steps); this relay only maps the Studio page's calls to the Lab Core
// routes, one by one, and signs every write as the Studio operator (= the streamer). It never decides
// nor keeps anything. « Sortie chat réelle » and the executor state stay on /api/lab-chat/output.

const UUID = '([0-9a-f-]{36})';
const CAT = '([a-z][a-z0-9_-]{0,23})';
const MAX_BODY = 32 * 1024;

type Json = Record<string, unknown>;
type Reply = { status: number; body: unknown };

/** Only the listed fields of the page's body reach Core (never an actor). */
const pick = (b: Json, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k in b).map((k) => [k, b[k]]));
const qs = (url: URL, keys: string[]) => {
  const q = new URLSearchParams();
  for (const k of keys) {
    const v = url.searchParams.get(k);
    if (v) q.set(k, v.slice(0, 64));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

export function commandsApi(core: LabCoreCall) {
  const base = `/v1/lab/commands/${LAB_CHANNEL_ID}`;
  const actor = STUDIO_ACTOR;
  /** The page's call → Core's answer (errors keep Core's status and body, e.g. 409 version_conflict). */
  return async function call(
    method: string,
    url: URL,
    body: Json,
  ): Promise<Reply> {
    const p = url.pathname.slice('/api/commands'.length);
    const get = method === 'GET';
    let m: RegExpExecArray | null;
    const ok = async (path: string, payload?: Json) => ({
      status: 200,
      body: await core(path, payload),
    });
    if (get && p === '') return ok(base);
    if (!get && p === '') return ok(base, { actor, ...pick(body, ['config']) });
    if (get && p === '/categories') return ok(`${base}/categories`);
    if (!get && p === '/categories')
      return ok(`${base}/categories`, {
        actor,
        ...pick(body, ['name', 'icon', 'color']),
      });
    if (!get && p === '/categories/order')
      return ok(`${base}/categories/order`, {
        actor,
        ...pick(body, ['order']),
      });
    if (!get && (m = new RegExp(`^/categories/${CAT}/update$`).exec(p)))
      return ok(`${base}/categories/${m[1]}/update`, {
        actor,
        ...pick(body, ['name', 'icon', 'color']),
      });
    if (!get && (m = new RegExp(`^/categories/${CAT}/delete$`).exec(p)))
      return ok(`${base}/categories/${m[1]}/delete`, { actor });
    if (get && p === '/rights') return ok(`${base}/rights`);
    if (!get && p === '/rights')
      return ok(`${base}/rights`, {
        actor,
        ...pick(body, ['role', 'expected_version', 'rights']),
      });
    if (get && p === '/history')
      return ok(`${base}/history${qs(url, ['limit'])}`);
    if (get && p === '/invocations')
      return ok(`${base}/invocations${qs(url, ['command_id', 'limit'])}`);
    if (get && p === '/steps')
      return ok(
        `${base}/steps${qs(url, ['status', 'invocation_id', 'limit'])}`,
      );
    // « Tester la commande »: Core's decision, nothing written, nothing sent.
    if (!get && p === '/test')
      return ok(`${base}/test`, {
        actor,
        ...pick(body, ['message', 'viewer']),
      });
    if (get && (m = new RegExp(`^/${UUID}$`).exec(p)))
      return ok(`${base}/${m[1]}`);
    if (get && (m = new RegExp(`^/${UUID}/history$`).exec(p)))
      return ok(`${base}/${m[1]}/history${qs(url, ['limit'])}`);
    if (!get && (m = new RegExp(`^/${UUID}/update$`).exec(p)))
      return ok(`${base}/${m[1]}/update`, {
        actor,
        ...pick(body, ['expected_version', 'changes']),
      });
    if (!get && (m = new RegExp(`^/${UUID}/(delete|reset)$`).exec(p)))
      return ok(`${base}/${m[1]}/${m[2]}`, {
        actor,
        ...pick(body, ['expected_version']),
      });
    return { status: 404, body: { error: 'not_found' } };
  };
}

/** HTTP face of the relay: Studio header required, JSON body (32 KB at most). */
export function commandsRelay(core: LabCoreCall) {
  const call = commandsApi(core);
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (
      url.pathname !== '/api/commands' &&
      !url.pathname.startsWith('/api/commands/')
    )
      return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-raptoru-studio'] !== '1') {
      reply(403, { error: 'forbidden' });
      return true;
    }
    try {
      let body: Json = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += String(chunk);
          if (raw.length > MAX_BODY)
            throw Object.assign(new Error('body_too_large'), { status: 413 });
        }
        body = JSON.parse(raw || '{}') as Json;
      } else if (req.method !== 'GET')
        return (reply(405, { error: 'method_not_allowed' }), true);
      const out = await call(req.method, url, body);
      reply(out.status, out.body);
    } catch (e) {
      const err = e as { status?: number; body?: Json; message: string };
      reply(err.status ?? 503, {
        ...(err.body ?? {}),
        error: err.body?.error ?? err.message,
      });
    }
    return true;
  };
}
