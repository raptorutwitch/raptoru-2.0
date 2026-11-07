import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Refonte H10 / H12 / H14 — Studio relays the module settings and the Daily steps to the profile's Core (the Lab Core,
// or the Production Core through the cockpit of the paired installation). Studio decides nothing: only the fields the
// Core validates are sent.

const MAX_BODY = 8 * 1024;

export function moduleSettingsRelay(core: LabCoreCall, channelId: string) {
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const p = url.pathname;
    if (p !== '/api/module-settings' && p !== '/api/daily/config') return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-raptoru-studio'] !== '1')
      return (reply(403, { error: 'forbidden' }), true);
    const path =
      p === '/api/daily/config'
        ? '/v1/lab/daily/config'
        : `/v1/lab/module-settings/${channelId}`;
    try {
      if (req.method === 'GET') return (reply(200, await core(path)), true);
      if (req.method !== 'POST')
        return (reply(405, { error: 'method_not_allowed' }), true);
      let raw = '';
      for await (const chunk of req) {
        raw += String(chunk);
        if (raw.length > MAX_BODY)
          return (reply(413, { error: 'body_too_large' }), true);
      }
      const b = JSON.parse(raw || '{}') as Record<string, unknown>;
      const body =
        p === '/api/daily/config'
          ? { steps: b.steps }
          : { key: b.key, value: b.value };
      return (reply(200, await core(path, body)), true);
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
      return true;
    }
  };
}
