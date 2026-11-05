// The Lab of the target architecture (decision of 05/11/2026), for the browser E2E: the MAIN Core — the same assembly
// as Production (core-api createMainCore / createMainServer), its production schema, CORE_ENVIRONMENT=lab and its guards
// — on an in-memory PostgreSQL (PGlite), and Studio in front of it with the Extension Lab on the Core's real /v1/ext
// (Studio signs the Lab JWT and relays: no Lab EBS). Fictional data only (core-api/src/lab/fixtures.ts); no Twitch, no
// OBS, no network. No Studio player is connected on purpose: what needs one is refused by the Core, as in Production
// with Studio closed.
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { systemClock } from '../../../core-api/src/clock.js';
import { loadConfig } from '../../../core-api/src/config.js';
import { DeferredWalletCreditProvider } from '../../../core-api/src/daily/credits.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { labEconomy } from '../../../core-api/src/economy/economy.js';
import { labEnvironmentProblems } from '../../../core-api/src/lab/environment.js';
import { seedLabFixtures } from '../../../core-api/src/lab/fixtures.js';
import {
  createMainCore,
  createMainServer,
} from '../../../core-api/src/main-server.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';

const port = Number(process.env.E2E_CORE_LAB_PORT ?? 4389);
const fatal = (what: string, e: unknown) => {
  console.error(
    `[e2e-core-lab] ${what}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
  );
  process.exit(1);
};
process.on('uncaughtException', (e) => fatal('uncaughtException', e));
process.on('unhandledRejection', (e) => fatal('unhandledRejection', e));
process.env.STUDIO_SERVER_NO_LISTEN = '1';
process.env.PORT = String(port);
const { createStudioServer } = await import('../src/index.js');
const { createTestLab } = await import('../src/test-lab/test-lab.js');

const extensionSecret = randomBytes(32);
// The Lab Core's configuration as its .env.lab would give it, and its own guards (they must accept it).
const config = loadConfig({
  CORE_ENVIRONMENT: 'lab',
  DATABASE_URL: 'postgres://127.0.0.1/pglite_core_lab',
  TWITCH_CHANNEL_ID: '900100',
  TWITCH_CHANNEL_LOGIN: 'raptoru_lab',
  BOT_SECRET: randomBytes(24).toString('hex'),
  STUDIO_SECRET: randomBytes(24).toString('hex'),
  TWITCH_EXTENSION_SECRET: extensionSecret.toString('base64'),
});
const refused = labEnvironmentProblems(config);
if (refused.length) fatal('lab configuration refused', refused.join(' ; '));

const db = createPgliteDb(
  new PGlite({
    parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
  }),
);
await migrate(db, 'prod');
await seedLabFixtures(db, { viewerTokens: 20_000 });

const core = createMainCore(
  db,
  systemClock,
  config,
  labEconomy,
  new DeferredWalletCreditProvider(),
);
const { server, frontier } = createMainServer(core, db, systemClock, config);
frontier?.start();
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const coreUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
// The tests' own door to the Lab Core (fixtures, checks): the URL only, never a secret.
console.log(`[e2e-core-lab] main Core (lab) on ${coreUrl}`);

// Studio's PRODUCTION transport, as the installed Studio uses it against the VPS, here against the Lab Core: an
// installation paired in the Lab Core's own table, the credential bound to that origin, plain HTTP allowed on loopback
// only (labLoopback). The TTS worker is Production's (/v1/studio/tts); its player is FICTIONAL (no page, no sound: it
// reports started → completed). « Studio » is closed at start; the tests open / close it (E2E_CORE_LAB_PORT + 1).
const { mkdtemp } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { createServer } = await import('node:http');
const { loadOrCreateInstallation } =
  await import('../src/prod-transport/installation.js');
const { prodCoreClient } = await import('../src/prod-transport/core-client.js');
const { TtsWorker } = await import('../src/tts-lab/worker.js');
const dir = await mkdtemp(join(tmpdir(), 'e2e-core-lab-'));
const installation = await loadOrCreateInstallation(
  join(dir, 'installation.json'),
  { coreOrigin: coreUrl, caSha256: null },
);
await core.studioInstallations!.register(
  installation.pairingCode,
  'Studio Lab (E2E)',
);
const ttsWorker = await TtsWorker.open(
  join(dir, 'tts-journal.json'),
  prodCoreClient({ url: coreUrl, installation, labLoopback: true }),
  {
    base: '/v1/studio/tts',
    studioId: installation.installationId,
    channel: '900100',
    configBase: '/v1/studio/cockpit/tts',
  },
);
let studioOpen: ReturnType<typeof setInterval> | null = null;
const openStudio = () => {
  if (studioOpen) return;
  const player = 'e2e-core-lab-player';
  let busy = false;
  studioOpen = setInterval(() => {
    if (busy) return;
    busy = true;
    void ttsWorker
      .playerHeartbeat(player, 12)
      .then(() => ttsWorker.tick())
      .then(() => ttsWorker.command(player))
      .then(async (order) => {
        if (!order || !('play' in order)) return;
        const { interaction_id: id, delivery } = order.play;
        await ttsWorker.playerAck(id, delivery.attempt_id!, player, 'started');
        await ttsWorker.playerAck(
          id,
          delivery.attempt_id!,
          player,
          'completed',
        );
      })
      .catch((e: Error) =>
        console.error(`[e2e-core-lab] tts worker: ${e.message}`),
      )
      .finally(() => (busy = false));
  }, 500);
};
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/studio/open') openStudio();
  else if (req.method === 'POST' && req.url === '/studio/close') {
    if (studioOpen) clearInterval(studioOpen);
    studioOpen = null;
  } else {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(204).end();
}).listen(port + 1, '127.0.0.1');

const studio = createStudioServer({
  lab: createTestLab(),
  onShutdown: () => {},
  labFrontier: { coreUrl, extensionSecret, channelId: '900100' },
});
studio.listen(port, '127.0.0.1', () =>
  console.log(
    `[e2e-core-lab] Studio + Extension Lab on http://127.0.0.1:${port}/ext/ (main Core ${coreUrl})`,
  ),
);
