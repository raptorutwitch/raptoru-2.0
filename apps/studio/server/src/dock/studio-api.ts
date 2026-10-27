import type { IncomingMessage } from 'node:http';
import type { DockHub } from './hub.js';
import type { DockServer } from './server.js';

// Dock OBS V1 (docs/OBS_DOCK.md) — Studio's own panel API (its origin and header checks, done by the caller):
// GET /api/dock → whether the dock runs, its URL for OBS (with the key, for Studio's « copier » only), the open docks
// and the feed status; POST /api/dock/key → a new key (open docks closed). The dock itself never calls these.

export interface DockRuntime {
  server: DockServer;
  hub: DockHub;
  /** Why the dock server is not running (port taken…), or null. */
  error: string | null;
}

export async function dockStudioApi(
  dock: DockRuntime | null,
  req: IncomingMessage,
  url: URL,
): Promise<{ status: number; body: unknown } | null> {
  if (url.pathname !== '/api/dock' && url.pathname !== '/api/dock/key')
    return null;
  if (!dock)
    return { status: 200, body: { available: false, reason: 'no_core' } };
  const info = () => ({
    available: !dock.error,
    reason: dock.error,
    url: dock.error ? null : dock.server.url(),
    clients: dock.server.clients,
    feed: dock.hub.status,
  });
  if (req.method === 'GET' && url.pathname === '/api/dock')
    return { status: 200, body: info() };
  if (req.method === 'POST' && url.pathname === '/api/dock/key') {
    await dock.server.regenerateKey();
    return { status: 200, body: info() };
  }
  return { status: 405, body: { error: 'method_not_allowed' } };
}
