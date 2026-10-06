// Shared fixture of the future-prod transport tests (ASTRA-P1-019 lots 1–2): a real Core handler
// (PGlite) served over HTTPS with the test-only certificate of test/fixtures/tls (trusted by the
// client only), on a fixed port that a test can take down and bring back (network cut).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpsServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { CoreConfig } from '../../../core-api/src/config.js';
import { createPublicFrontier } from '../../../core-api/src/ext/public-frontier.js';
import { createHandler } from '../../../core-api/src/http/server.js';
import { setup, type TestCore } from '../../../core-api/test/helpers.js';
import { prodCoreClient } from '../src/prod-transport/core-client.js';
import {
  loadOrCreateInstallation,
  type CoreBinding,
} from '../src/prod-transport/installation.js';

const TLS = join(import.meta.dirname, 'fixtures', 'tls');
export const cert = readFileSync(join(TLS, 'localhost-test-only.crt'));
export const key = readFileSync(join(TLS, 'localhost-test-only.key'));
export const certSha256 = createHash('sha256').update(cert).digest('hex');
export const CHANNEL = '900100';

export type Cleanups = (() => Promise<unknown>)[];

export async function httpsCore(core: TestCore, cleanups: Cleanups) {
  // The public Core's Studio cockpit (/v1/studio/cockpit) for the test channel, like the staging Core.
  const frontier = createPublicFrontier(core, core.db, core.clock, {
    TWITCH_CHANNEL_ID: CHANNEL,
    TWITCH_CHANNEL_LOGIN: 'lab',
    CORE_ENVIRONMENT: 'staging',
  } as CoreConfig);
  const handler = createHandler({
    ...core,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
    ...frontier?.deps,
  });
  let server: Server | null = null;
  let port = 0;
  const up = async () => {
    server = createHttpsServer({ key, cert }, handler);
    await new Promise<void>((r) => server!.listen(port, '127.0.0.1', r));
    port = (server!.address() as AddressInfo).port;
  };
  const down = async () => {
    const s = server;
    server = null;
    if (!s) return;
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  };
  await up();
  cleanups.push(down);
  return {
    url: () => `https://127.0.0.1:${port}`,
    origin: () => `https://127.0.0.1:${port}`,
    up,
    down,
  };
}

export async function tempDir(cleanups: Cleanups) {
  const dir = await mkdtemp(
    join(process.cwd(), '.runtime-prod-transport-test-'),
  );
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Core + HTTPS + a paired installation bound to that Core and the test certificate. */
export async function pairedStudio(cleanups: Cleanups) {
  const core = await setup();
  core.clock.set(new Date());
  const net = await httpsCore(core, cleanups);
  const dir = await tempDir(cleanups);
  const binding: CoreBinding = {
    coreOrigin: net.origin(),
    caSha256: certSha256,
  };
  const identityFile = join(dir, 'studio-installation.json');
  const installation = await loadOrCreateInstallation(identityFile, binding);
  await core.studioInstallations.register(installation.pairingCode, 'PC test');
  const client = (over: Partial<Parameters<typeof prodCoreClient>[0]> = {}) =>
    prodCoreClient({ url: net.url(), installation, ca: cert, ...over });
  return { core, net, dir, binding, identityFile, installation, client };
}
