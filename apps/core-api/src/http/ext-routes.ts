import type { ExtFacade } from '../ext/ext-facade.js';
import { HttpError, type Route } from './server.js';

// ASTRA-P1-006 (minimal): /v1/ext/* — the Twitch Extension's API on the Core. Authenticated by the
// server ('extension' tier: Twitch JWT verified, rate limited); the façade answers with the contract
// the extension already speaks (apiBase = https://<core>/v1/ext).

export function extRoutes(facade: ExtFacade): Route[] {
  const handle =
    (method: 'GET' | 'POST'): Route['handle'] =>
    async ({ params, body, url, caller, idempotencyKey }) => {
      const reply = await facade.handle(
        method,
        `${params[0]}${url.search}`,
        method === 'POST' ? (body as Record<string, unknown>) : undefined,
        caller!,
        idempotencyKey,
      );
      if (reply.status !== 200) throw new HttpError(reply.status, reply.body);
      return reply.body;
    };
  return (['GET', 'POST'] as const).map((method) => ({
    method,
    pattern: /^\/v1\/ext(\/[A-Za-z0-9/_.-]{1,200})$/,
    auth: 'extension' as const,
    handle: handle(method),
  }));
}
