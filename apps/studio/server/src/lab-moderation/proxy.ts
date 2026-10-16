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
  '/v1/lab/raffle/',
  // Single Lab chat ingress (simulator), routed by Core to every module.
  '/v1/lab/chat',
  // Commands V2: « Sortie chat réelle » and the step debug view.
  '/v1/lab/commands/',
  // Jeu des mots V1: panel state / actions and the committed wins stream (OBS sound).
  '/v1/lab/word-game/',
  // Roulette and Slot V1: the switch « Mini-jeux » and the last plays.
  '/v1/lab/mini-games/',
  // Twitch alerts V1: catalogue, queue state, test events, the OBS source's claim / reports.
  '/v1/lab/alerts/',
];

/** Local Lab Core only, moderation / wallet / TTS rules / Tombola / Lab chat routes only. */
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

/** Opens a server-sent events stream of the local Lab Core (same checks; no timeout: it stays open). */
export type LabCoreEvents = (
  path: string,
  signal: AbortSignal,
) => Promise<Response>;

export function localLabCoreEvents(
  base: string,
  secret: string,
): LabCoreEvents {
  localLabCoreClient(base, secret); // same base / secret checks
  return async (path, signal) => {
    if (!PREFIXES.some((p) => path.startsWith(p)))
      throw new Error('lab_route_required');
    const res = await fetch(new URL(path, base), {
      redirect: 'error',
      headers: { authorization: `Bearer ${secret}` },
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`lab_core_${res.status}`);
    return res;
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
  identities: () => { id: string; label: string; login?: string }[];
  /** Called after a change the extension façade caches (wallet, module states). */
  onChange?: () => void;
  /** Channel of the Core (Production: the real channel); Lab default: the Lab channel. */
  channelId?: string;
}

export function labProxy(d: LabProxyDeps) {
  const C = d.channelId ?? LAB_CHANNEL_ID;
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
        const [overview, players, me] = await Promise.all([
          d.core(`/v1/lab/moderation/${C}/overview`),
          d.players().catch(() => ({})),
          d.core(`/v1/lab/moderation/${C}/whoami`, STUDIO_ACTOR),
        ]);
        reply(200, { ...(overview as object), players, me });
      } else if (get && ['/team', '/words'].includes(p))
        reply(200, await d.core(`/v1/lab/moderation/${C}${p}`));
      else if (get && (p === '/interactions' || p === '/ledger')) {
        const qs = new URLSearchParams();
        for (const k of [
          'module',
          'status',
          'viewer',
          'q',
          'period',
          'before',
          'limit',
          'auto',
        ]) {
          const v = url.searchParams.get(k);
          if (v) qs.set(k, v.slice(0, 64));
        }
        reply(200, await d.core(`/v1/lab/moderation/${C}${p}?${qs}`));
      } else if (get && (m = /^\/interactions\/([0-9a-f-]{36})$/.exec(p)))
        reply(
          200,
          await d.core(`/v1/lab/moderation/${C}/interactions/${m[1]}`),
        );
      else if (get && p === '/raffle')
        reply(200, await d.core(`/v1/lab/raffle/${C}/state`));
      else if (get && p === '/search')
        reply(
          200,
          await d.core(
            `/v1/lab/moderation/${C}/search?q=${encodeURIComponent(url.searchParams.get('q') ?? '')}`,
          ),
        );
      else if (get && (m = /^\/viewers\/(\d{1,32})$/.exec(p)))
        reply(200, await d.core(`/v1/lab/moderation/${C}/viewers/${m[1]}`));
      else if (get && p === '/restrictions')
        reply(200, await d.core(`/v1/lab/moderation/${C}/restrictions`));
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
