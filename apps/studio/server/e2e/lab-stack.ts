// Isolated stack for the browser E2E (ASTRA-P1-018), started by Playwright (playwright.config.ts):
// - the REAL Lab Core assembly (core-api createLabCore) on an in-memory PostgreSQL (PGlite): nothing
//   on disk, no Docker, no real data, gone when the process exits;
// - the REAL Extension Lab EBS and Studio routes (createStudioServer: /ext/* = the production
//   extension files, /ext-lab/api = the Lab EBS), connected to that Core with a random secret.
// No Twitch: the Extension runs with the local helper simulation (labRole=viewer|moderator…).
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';

const port = Number(process.env.E2E_PORT ?? 4399);
// Imported after this flag: the Studio module must not start the real Studio (runtime, Core, PIDs).
process.env.STUDIO_SERVER_NO_LISTEN = '1';
// Studio only answers requests addressed to its own host:port (anti DNS-rebinding guard).
process.env.PORT = String(port);
const { createStudioServer, EXTENSION_DIR } = await import('../src/index.js');
const { createTestLab } = await import('../src/test-lab/test-lab.js');
const { LabEbs } = await import('../src/extension-lab/lab-ebs.js');
const { localLabCoreClient } = await import('../src/lab-moderation/proxy.js');

const db = createPgliteDb(
  new PGlite({
    parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
  }),
);
await migrate(db, 'lab');
const secret = randomBytes(32).toString('hex');
const { server: core } = createLabCore({ db, clock: systemClock, secret });
await new Promise<void>((r) => core.listen(0, '127.0.0.1', r));
const coreUrl = `http://127.0.0.1:${(core.address() as AddressInfo).port}`;

// Seed, as Studio does it (Core HTTP, Studio actor): one public Commands V2 command.
const res = await fetch(`${coreUrl}/v1/lab/commands/900100`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${secret}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
    config: {
      name: 'e2etest',
      description: 'Commande du test E2E',
      reply: { mode: 'reply', text: 'E2E ok', to: 'none' },
    },
  }),
});
if (!res.ok)
  throw new Error(`E2E seed refused by the Lab Core: ${await res.text()}`);

const ext = await LabEbs.create(EXTENSION_DIR);
ext.connectLab(localLabCoreClient(coreUrl, secret));
const studio = createStudioServer(createTestLab(), () => {}, ext);
studio.listen(port, '127.0.0.1', () =>
  console.log(
    `[e2e] Extension Lab on http://127.0.0.1:${port}/ext/ (Lab Core ${coreUrl}, in-memory)`,
  ),
);

const stop = () => {
  studio.close();
  core.close();
  void db.close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
