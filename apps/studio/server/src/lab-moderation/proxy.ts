import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LabActor, LabModerationCommand } from '@raptoru/schemas';

// Moderation V2 cockpit + TTS configuration + Lab test wallet, for the Studio UI. The Studio
// server only relays to the local Lab Core (which decides, validates, stores and audits): no state
// here. Routes: /api/lab/* — same host, Studio header (like every Studio API).

export type LabCoreCall = <T>(
  path: string,
  body?: unknown,
  options?: { timeoutMs?: number },
) => Promise<T>;

const PREFIXES = [
  '/v1/lab/moderation/',
  '/v1/lab/wallet/',
  '/v1/lab/tts/rules',
];

/** Local Lab Core only, moderation / wallet / TTS rules routes only. */
export function localLabCoreClient(base: string, secret: string): LabCoreCall {
  const url = new URL(base);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/' ||
    !secret
  )
    throw new Error('local_lab_core_required');
  return async <T>(
    path: string,
    body?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<T> => {
    if (!PREFIXES.some((p) => path.startsWith(p)))
      throw new Error('lab_route_required');
    const res = await fetch(new URL(path, url), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 4000),
    });
    const result = (await res.json()) as T & { error?: string };
    if (!res.ok)
      throw Object.assign(new Error(result.error ?? 'core_unavailable'), {
        status: res.status,
        body: result,
      });
    return result;
  };
}

export const LAB_CHANNEL_ID = '900100';
/** The Studio operator: the broadcaster's own cockpit. */
export const STUDIO_ACTOR: LabActor = {
  id: 'studio',
  role: 'broadcaster',
  via: 'studio',
};

export interface LabProxyDeps {
  core: LabCoreCall;
  /** Live players / workers as seen by this Studio (not stored in Core). */
  players: () => Promise<Record<string, unknown>>;
  /** Viewers the Lab can act as (fictitious identities + the linked Twitch account). */
  identities: () => { id: string; label: string }[];
  /** Called after a change the extension façade caches (wallet, module states). */
  onChange?: () => void;
}

export function labProxy(d: LabProxyDeps) {
  const C = LAB_CHANNEL_ID;
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/lab/')) return false;
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
      let body: Record<string, unknown> = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += String(chunk);
          if (raw.length > 8192)
            throw Object.assign(new Error('body_too_large'), { status: 413 });
        }
        body = JSON.parse(raw || '{}');
      }
      const p = url.pathname.slice('/api/lab'.length);
      const get = req.method === 'GET';
      let m: RegExpExecArray | null;
      if (get && p === '/overview') {
        const [overview, players] = await Promise.all([
          d.core(`/v1/lab/moderation/${C}/overview`),
          d.players().catch(() => ({})),
        ]);
        reply(200, { ...(overview as object), players });
      } else if (get && p === '/search')
        reply(
          200,
          await d.core(
            `/v1/lab/moderation/${C}/search?q=${encodeURIComponent(url.searchParams.get('q') ?? '')}`,
          ),
        );
      else if (get && (m = /^\/viewers\/(\d{1,32})$/.exec(p)))
        reply(200, await d.core(`/v1/lab/moderation/${C}/viewers/${m[1]}`));
      else if (get && p === '/audit') {
        const qs = new URLSearchParams();
        for (const k of ['module', 'viewer', 'limit']) {
          const v = url.searchParams.get(k);
          if (v) qs.set(k, v);
        }
        reply(200, await d.core(`/v1/lab/moderation/${C}/audit?${qs}`));
      } else if (!get && p === '/actions') {
        const out = await d.core(`/v1/lab/moderation/${C}/actions`, {
          actor: STUDIO_ACTOR,
          command: body.command as LabModerationCommand,
        });
        d.onChange?.();
        reply(200, out);
      } else if (get && p === '/tts/rules')
        reply(200, await d.core('/v1/lab/tts/rules'));
      else if (!get && p === '/tts/rules') {
        const out = await d.core('/v1/lab/tts/rules', {
          actor: STUDIO_ACTOR,
          rules: body.rules,
          reason: body.reason,
        });
        d.onChange?.();
        reply(200, out);
      } else if (!get && p === '/tts/rules/reset') {
        const out = await d.core('/v1/lab/tts/rules/reset', {
          actor: STUDIO_ACTOR,
          reason: body.reason,
        });
        d.onChange?.();
        reply(200, out);
      } else if (get && p === '/identities')
        reply(200, { identities: d.identities() });
      else if (get && (m = /^\/wallet\/(\d{1,32})$/.exec(p)))
        reply(200, await d.core(`/v1/lab/wallet/${C}/${m[1]}`));
      else if (!get && p === '/wallet') {
        const out = await d.core(`/v1/lab/wallet/${C}`, {
          ...body,
          actor: STUDIO_ACTOR,
        });
        d.onChange?.();
        reply(200, out);
      } else reply(404, { error: 'not_found' });
    } catch (e) {
      const err = e as {
        status?: number;
        body?: Record<string, unknown>;
        message: string;
      };
      reply(err.status ?? 503, {
        ...(err.body ?? {}),
        error: err.body?.error ?? err.message,
      });
    }
    return true;
  };
}
