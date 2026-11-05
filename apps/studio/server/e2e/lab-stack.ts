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
const { chainRelays, createStudioServer, EXTENSION_DIR } =
  await import('../src/index.js');
const { miniGamesRelay } = await import('../src/mini-games/relay.js');
const { moduleSettingsRelay } = await import('../src/module-settings/relay.js');
const { modulesRelay } = await import('../src/modules/relay.js');
const { createTestLab } = await import('../src/test-lab/test-lab.js');
const { LabEbs } = await import('../src/extension-lab/lab-ebs.js');
const { labProxy, localLabCoreClient } =
  await import('../src/lab-moderation/proxy.js');

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

// Halloween shop: open, 12 Bonbons for « Viewer Lab » (a Studio grant), 5 000 test Jetons to exchange. No overlay
// heartbeat: the shop shows itself offline (nothing sellable), as it does when Studio's overlay is closed.
for (const [path, body] of [
  ['/v1/lab/events/channels/900100/settings', { enabled: true }],
  [
    '/v1/lab/events/grant',
    {
      idempotency_key: '00000000-0000-4000-8000-00000000e2e1',
      channel_id: '900100',
      viewer: '900101',
      amount: 12,
      reason: 'grant',
    },
  ],
] as const) {
  const r = await fetch(`${coreUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`E2E Halloween seed refused: ${await r.text()}`);
}
await db.query(
  `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
   values ('900100', '900101', 5000, 0, 0, now())
   on conflict (channel_id, viewer_id) do update set tokens = excluded.tokens`,
);

// A viewer the channel has seen (Twitch name), never given any Bonbons: Studio's « Trouver un viewer » / credit.
await db.query(
  `insert into lab_viewers (channel_id, viewer_id, display_name, first_seen, last_seen)
   values ('900100', '57012345', 'Kirito_TV', now(), now()) on conflict do nothing`,
);

// Défis (fictional source data for the « Défis » e2e): three finished Random Ban of Fictif_Defis (its own viewer, so
// the other tests' viewers keep an empty inventory), yesterday.
await db.query(
  `insert into lab_viewers (channel_id, viewer_id, display_name, first_seen, last_seen)
   values ('900100', '57099999', 'Fictif_Defis', now(), now()) on conflict do nothing`,
);
for (const [i, status] of (
  ['confirmed', 'confirmed', 'flop'] as const
).entries())
  await db.query(
    `insert into rb_requests (request_id, channel_id, source, source_ref, mode, buyer_id, buyer_login, buyer_name, status,
       created_at, updated_at)
     values ($1::uuid, '900100', 'chat', $1::text, 'real', '57099999', 'fictif_defis', 'Fictif_Defis', $2,
       now() - interval '1 day', now() - interval '1 day')`,
    [`00000000-0000-4000-8000-0000000c4a1${i}`, status],
  );

const { ProgressionRelay } = await import('../src/progression/relay.js');
const { CosmeticsRelay } = await import('../src/cosmetics/relay.js');
const { ChallengesRelay } = await import('../src/challenges/relay.js');
const ext = await LabEbs.create(EXTENSION_DIR);
const labCore = localLabCoreClient(coreUrl, secret);
ext.connectLab(labCore);
// TTS V2 in the Extension Lab: the Studio TTS worker (journal + this Lab Core only; the voice is the player page's,
// never opened here). Without it the Lab EBS offers the V1 form.
{
  const { TtsWorker, localTtsCoreClient } =
    await import('../src/tts-lab/worker.js');
  const { mkdtemp: mk } = await import('node:fs/promises');
  const { tmpdir: td } = await import('node:os');
  const { join: j } = await import('node:path');
  const dir = await mk(j(td(), 'e2e-tts-'));
  const ttsWorker = await TtsWorker.open(
    j(dir, 'journal.json'),
    localTtsCoreClient(coreUrl, secret),
  );
  ext.connectTts(ttsWorker);
  // A FICTIONAL TTS player (no page, no sound): its heartbeat makes the TTS purchasable in this isolated Lab, as a
  // real player page would; what it is handed is never played (the end guard releases it, as in Studio).
  setInterval(() => {
    void ttsWorker
      .playerHeartbeat('e2e-player-fictif', 12)
      .then(() => ttsWorker.tick())
      .catch(() => undefined);
  }, 2_000).unref();
}
// Soundboard in the Extension Lab: the Studio sound worker (journal + this Lab Core only) and a FICTIONAL player (no
// page, never any sound) whose heartbeat makes the sounds purchasable, as a real player page would.
{
  const { SoundWorker, localSoundCoreClient } =
    await import('../src/sound-lab/worker.js');
  const { mkdtemp: mk } = await import('node:fs/promises');
  const { tmpdir: td } = await import('node:os');
  const { join: j } = await import('node:path');
  const dir = await mk(j(td(), 'e2e-sound-'));
  const soundWorker = await SoundWorker.open(
    j(dir, 'journal.json'),
    localSoundCoreClient(coreUrl, secret),
  );
  ext.connectSound(soundWorker);
  setInterval(() => {
    void soundWorker
      .playerHeartbeat('e2e-player-fictif', true)
      .then(() => soundWorker.tick())
      .catch(() => undefined);
  }, 2_000).unref();
}
// Studio's Halloween and Tombola tabs, on the same Lab Core (temporary data folder, gone with the process).
const { mkdtemp, writeFile } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { HalloweenRuntime } = await import('../src/halloween/runtime.js');
const { RaffleRuntime } = await import('../src/raffle-lab/runtime.js');
const data = await mkdtemp(join(tmpdir(), 'e2e-stack-'));
const origin = `http://127.0.0.1:${port}`;
const halloween = new HalloweenRuntime({
  origin,
  dir: join(data, 'halloween'),
  pageDir: join(import.meta.dirname, '..', 'halloween-overlay'),
  core: labCore,
  environment: 'lab',
  channelId: '900100',
  studioId: 'studio-e2e-stack',
  fromMain: () => false,
});
await halloween.start();
const raffle = await RaffleRuntime.create({
  channelId: '900100',
  core: labCore,
  origin,
  dir: join(data, 'raffle'),
  overlayDir: join(import.meta.dirname, '..', 'raffle-overlay'),
});
const studio = createStudioServer({
  lab: createTestLab(),
  onShutdown: () => {},
  extLab: ext,
  // Studio's « Modération » tab (the D4 console with Studio as the actor): the same /api/lab relay as the real Studio,
  // without players (no TTS / Soundboard worker on this stack).
  labApi: labProxy({
    channelId: '900100',
    core: labCore,
    players: async () => ({}),
    identities: () => [],
  }),
  raffle,
  // Mini-games, bounded settings (H10 / H12 / H14) and the module host: the same relay chain as the real Studio.
  relays: chainRelays(
    miniGamesRelay(labCore, '900100'),
    moduleSettingsRelay(labCore, '900100'),
    modulesRelay(labCore, '900100', { labPlayer: true }),
  ),
  halloween,
  // Progression (docs/PROGRESSION.md): Studio's panel relay to this Lab Core.
  progression: new ProgressionRelay({ core: labCore, environment: 'lab' }),
  // Boutique cosmétique V1: Studio's « Boutique » tab relay to this Lab Core.
  cosmetics: new CosmeticsRelay({ core: labCore, environment: 'lab' }),
  // Défis: Studio's « Défis » tab relay to this Lab Core.
  challenges: new ChallengesRelay({ core: labCore, environment: 'lab' }),
});
// The browser tests that need the Lab Core itself (a simulated live, a chat message) read where it is here.
await writeFile(
  join(tmpdir(), `raptoru-e2e-core-${port}.json`),
  JSON.stringify({ url: coreUrl, secret }),
);
studio.listen(port, '127.0.0.1', () =>
  console.log(
    `[e2e] Extension Lab on http://127.0.0.1:${port}/ext/ (Lab Core ${coreUrl}, in-memory)`,
  ),
);

const stop = () => {
  halloween.stop();
  studio.close();
  core.close();
  void db.close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
