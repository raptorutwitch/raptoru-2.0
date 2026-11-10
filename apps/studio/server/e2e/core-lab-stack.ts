// The Lab of the target architecture (decision of 05/11/2026), for the browser E2E: the MAIN Core — the same assembly
// as Production (core-api createMainCore / createMainServer), its production schema, CORE_ENVIRONMENT=lab and its guards
// — on an in-memory PostgreSQL (PGlite), and Studio in front of it exactly as `npm run studio` wires it on that Core:
// workers over Studio's Production transport, every screen through the cockpit, the Extension Lab on the Core's real
// /v1/ext (Studio signs the Lab JWT and relays). Fictional data only; no Twitch, no OBS, no network.
// E2E_CORE_LAB_PLAYERS=1 (default stack): fictional players connected from the start; otherwise « Studio » is closed
// and the tests open / close it (port + 1).
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const playersAtStart = process.env.E2E_CORE_LAB_PLAYERS === '1';
const log = (what: string, e: unknown) =>
  console.error(
    `[e2e-core-lab] ${what}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
  );
const fatal = (what: string, e: unknown) => {
  log(what, e);
  process.exit(1);
};
process.on('uncaughtException', (e) => fatal('uncaughtException', e));
process.on('unhandledRejection', (e) => fatal('unhandledRejection', e));
process.env.STUDIO_SERVER_NO_LISTEN = '1';
process.env.PORT = String(port);
const { chainRelays, createStudioServer } = await import('../src/index.js');
const { createTestLab } = await import('../src/test-lab/test-lab.js');
const { miniGamesRelay } = await import('../src/mini-games/relay.js');
const { moduleSettingsRelay } = await import('../src/module-settings/relay.js');
const { modulesRelay } = await import('../src/modules/relay.js');
const { labProxy } = await import('../src/lab-moderation/proxy.js');
const { HalloweenRuntime } = await import('../src/halloween/runtime.js');
const { RaffleRuntime } = await import('../src/raffle-lab/runtime.js');
const { ProgressionRelay } = await import('../src/progression/relay.js');
const { CosmeticsRelay } = await import('../src/cosmetics/relay.js');
const { ChallengesRelay } = await import('../src/challenges/relay.js');
const { loadOrCreateInstallation } =
  await import('../src/prod-transport/installation.js');
const { prodCoreClient } = await import('../src/prod-transport/core-client.js');
const { cockpitClient } = await import('../src/prod-transport/production.js');
const { TtsWorker } = await import('../src/tts-lab/worker.js');
const { SoundWorker } = await import('../src/sound-lab/worker.js');
const { BonkWorker } = await import('../src/bonk-lab/worker.js');
const { ChannelPointsRuntime } =
  await import('../src/channel-points/runtime.js');
const { EffectsPlayer } = await import('../src/effects/player.js');
const { AlertMediaStore } = await import('../src/alerts/media-store.js');
const { AlertsRuntime } = await import('../src/alerts/runtime.js');
const { LabChatIngress } = await import('../src/lab-chat/ingress.js');
const { CoreLabPanel, labChatIdentities } =
  await import('../src/extension-lab/core-lab-panel.js');

const CHANNEL = '900100';
const extensionSecret = randomBytes(32);
const siteToken = randomBytes(24).toString('hex');
// The Core's port is fixed: the fictional Twitch's OAuth comes back to it.
const corePort = port + 3;
// The Lab Core's configuration as its generated environment gives it, and its own guards (they must accept it).
const config = loadConfig({
  CORE_ENVIRONMENT: 'lab',
  PORT: String(corePort),
  DATABASE_URL: 'postgres://127.0.0.1/pglite_core_lab',
  TWITCH_CHANNEL_ID: CHANNEL,
  TWITCH_CHANNEL_LOGIN: 'raptoru_lab',
  BOT_SECRET: randomBytes(24).toString('hex'),
  STUDIO_SECRET: randomBytes(24).toString('hex'),
  TWITCH_EXTENSION_SECRET: extensionSecret.toString('base64'),
  SITE_TOKEN: siteToken,
  CAUTION_CHAT: 'true',
  VOTEKICK_CHAT: 'true',
  SPOTIFY_CHAT: 'true',
});
const refused = labEnvironmentProblems(config);
if (refused.length) fatal('lab configuration refused', refused.join(' ; '));

const db = createPgliteDb(
  new PGlite({
    parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
  }),
);
await migrate(db, 'main-lab');
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
await new Promise<void>((r) => server.listen(corePort, '127.0.0.1', r));
const coreUrl = `http://127.0.0.1:${corePort}`;

// Studio's PRODUCTION transport, as the installed Studio uses it against the VPS: an installation paired in the Lab
// Core's own table, the credential bound to that origin, plain HTTP on loopback only (labLoopback).
const dir = await mkdtemp(join(tmpdir(), 'e2e-core-lab-'));
const installation = await loadOrCreateInstallation(
  join(dir, 'installation.json'),
  { coreOrigin: coreUrl, caSha256: null },
);
await core.studioInstallations.register(
  installation.pairingCode,
  'Studio Lab (E2E)',
);
const transport = prodCoreClient({
  url: coreUrl,
  installation,
  labLoopback: true,
});
const labCore = cockpitClient(transport);
const studioId = installation.installationId;
const wiring = (module: 'tts' | 'sound' | 'bonk') => ({
  base: `/v1/studio/${module}`,
  studioId,
  channel: CHANNEL,
  configBase: `/v1/studio/cockpit/${module}`,
});

// Seed, as Studio does it (the same fictional data as the historical stack).
const actor = { id: 'studio', role: 'broadcaster', via: 'studio' };
await labCore(`/v1/lab/commands/${CHANNEL}`, {
  actor,
  config: {
    name: 'e2etest',
    description: 'Commande du test E2E',
    reply: { mode: 'reply', text: 'E2E ok', to: 'none' },
  },
});
await labCore(`/v1/lab/events/channels/${CHANNEL}/settings`, { enabled: true });
await labCore('/v1/lab/events/grant', {
  idempotency_key: '00000000-0000-4000-8000-00000000e2e1',
  channel_id: CHANNEL,
  viewer: '900101',
  amount: 12,
  reason: 'grant',
});
// The historical specs' balance; the Studio open / closed tests need one TTS's price (20 000 from the fixture).
if (playersAtStart)
  await db.query(
    `update lab_wallets set tokens = 5000 where channel_id = '900100' and viewer_id = '900101'`,
  );
for (const [id, name] of [
  ['57012345', 'Kirito_TV'],
  ['57099999', 'Fictif_Defis'],
] as const) {
  await db.query(
    `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3) on conflict do nothing`,
    [id, name.toLowerCase(), name],
  );
  await db.query(
    `insert into lab_viewers (channel_id, viewer_id, display_name, first_seen, last_seen)
     values ('900100', $1, $2, now(), now()) on conflict do nothing`,
    [id, name],
  );
}
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

// The Production workers, with FICTIONAL players (no page, no sound, no OBS): they report what they are handed as played.
const ttsWorker = await TtsWorker.open(
  join(dir, 'tts.json'),
  transport,
  wiring('tts'),
);
const soundWorker = await SoundWorker.open(
  join(dir, 'sound.json'),
  transport,
  wiring('sound'),
);
const bonkWorker = await BonkWorker.open(
  join(dir, 'bonk.json'),
  transport,
  wiring('bonk'),
);
bonkWorker.setObs(true, true);
const player = 'e2e-core-lab-player';
const cycles: (() => Promise<void>)[] = [
  async () => {
    await ttsWorker.playerHeartbeat(player, 12);
    await ttsWorker.tick();
    const order = await ttsWorker.command(player);
    if (!order || !('play' in order)) return;
    const { interaction_id: id, delivery } = order.play;
    await ttsWorker.playerAck(id, delivery.attempt_id!, player, 'started');
    await ttsWorker.playerAck(id, delivery.attempt_id!, player, 'completed');
  },
  async () => {
    await soundWorker.playerHeartbeat(player, true);
    await soundWorker.tick();
    for (
      let s = await soundWorker.command(player);
      s;
      s = await soundWorker.command(player)
    ) {
      const attempt = s.delivery.attempt_id!;
      await soundWorker.playerAck(s.interaction_id, attempt, player, 'started');
      await soundWorker.playerAck(
        s.interaction_id,
        attempt,
        player,
        'completed',
      );
    }
  },
  async () => {
    await bonkWorker.rendererHeartbeat(player);
    await bonkWorker.tick();
    for (
      let s = await bonkWorker.command(player);
      s;
      s = await bonkWorker.command(player)
    ) {
      const attempt = s.delivery.attempt_id!;
      await bonkWorker.rendererAck(
        s.interaction_id,
        attempt,
        player,
        'started',
      );
      await bonkWorker.rendererAck(
        s.interaction_id,
        attempt,
        player,
        'completed',
      );
    }
  },
];
let studioOpen: ReturnType<typeof setInterval>[] = [];
const openStudio = () => {
  if (studioOpen.length) return;
  studioOpen = cycles.map((cycle) => {
    let busy = false;
    return setInterval(() => {
      if (busy) return;
      busy = true;
      void cycle()
        .catch((e: Error) => log('worker', e.message))
        .finally(() => (busy = false));
    }, 500);
  });
};
if (playersAtStart) openStudio();
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/studio/open') openStudio();
  else if (req.method === 'POST' && req.url === '/studio/close') {
    studioOpen.forEach(clearInterval);
    studioOpen = [];
  } else {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(204).end();
}).listen(port + 1, '127.0.0.1');

const origin = `http://127.0.0.1:${port}`;
const halloween = new HalloweenRuntime({
  origin,
  dir: join(dir, 'halloween'),
  pageDir: join(import.meta.dirname, '..', 'halloween-overlay'),
  core: labCore,
  environment: 'lab',
  channelId: CHANNEL,
  studioId,
  fromMain: () => false,
});
await halloween.start();
const raffle = await RaffleRuntime.create({
  channelId: CHANNEL,
  core: labCore,
  origin,
  dir: join(dir, 'raffle'),
  overlayDir: join(import.meta.dirname, '..', 'raffle-overlay'),
});
// The Lab's tools as `npm run studio` wires them on this Core: the module runtimes in their Lab mode (Spotify simulator,
// Roue du Sub simulators; no OBS here), the chat simulator (no adapter: the real Twitch chat cannot start), the panel.
const points = await ChannelPointsRuntime.create({
  core: labCore,
  environment: 'lab',
  channelId: CHANNEL,
  origin,
  dir: join(dir, 'channel-points'),
  obs: () => null,
  effects: await EffectsPlayer.create({
    dir: await mkdtemp(join(dir, 'effects-')),
    origin,
    media: await AlertMediaStore.open(join(dir, 'effects-media')),
    playerDir: join(import.meta.dirname, '..', 'effects-player'),
    uploadsDir: join(dir, 'effects-uploads'),
  }),
  spotifyDir: join(dir, 'spotify-lab'),
  // Music Hub: the OBS music overlays (their page; no OBS here: the install assistant says so).
  musicOverlayDir: join(import.meta.dirname, '..', 'music-overlay'),
  twitch: () => ({ scope: false, adapter_running: false }),
});
points.start();
const alerts = await AlertsRuntime.create({
  channelId: CHANNEL,
  core: labCore,
  environment: 'lab',
  origin,
  dir: join(dir, 'alerts'),
  playerDir: join(import.meta.dirname, '..', 'alerts-player'),
  media: await AlertMediaStore.open(join(dir, 'alerts-media')),
});
const labChat = await LabChatIngress.create({
  core: labCore,
  origin,
  dir: join(dir, 'lab-chat'),
  identities: labChatIdentities,
});
const studio = createStudioServer({
  lab: createTestLab(),
  onShutdown: () => {},
  labFrontier: { coreUrl, extensionSecret, channelId: CHANNEL },
  labPanel: new CoreLabPanel(labCore, CHANNEL),
  labChat,
  points,
  labApi: labProxy({
    channelId: CHANNEL,
    core: labCore,
    players: async () => ({}),
    identities: labChatIdentities,
  }),
  raffle,
  alerts,
  relays: chainRelays(
    miniGamesRelay(labCore, CHANNEL),
    moduleSettingsRelay(labCore, CHANNEL),
    modulesRelay(labCore, CHANNEL, { labPlayer: true }),
  ),
  halloween,
  progression: new ProgressionRelay({ core: labCore, environment: 'lab' }),
  cosmetics: new CosmeticsRelay({ core: labCore, environment: 'lab' }),
  challenges: new ChallengesRelay({ core: labCore, environment: 'lab' }),
});

// The specs' own door to the Lab Core (a simulated live, fixtures): a test-only shim speaking their /v1/lab/* vocabulary,
// through the cockpit (never a second way in).
const secret = randomBytes(32).toString('hex');
const shim = createServer((req, res) => {
  void (async () => {
    if (req.headers.authorization !== `Bearer ${secret}`) {
      res.writeHead(401).end();
      return;
    }
    let text = '';
    for await (const chunk of req) text += String(chunk);
    const answer = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // raptoru.fr's doors (the Lab Core used to serve them behind its secret): the Core's own HTTP routes, the site's token.
    if (!req.url!.startsWith('/v1/lab/')) {
      const r = await fetch(coreUrl + req.url!, {
        method: req.method!,
        headers: {
          authorization: `Bearer ${siteToken}`,
          'content-type': 'application/json',
          ...(req.headers['idempotency-key']
            ? { 'idempotency-key': String(req.headers['idempotency-key']) }
            : {}),
        },
        ...(text ? { body: text } : {}),
      });
      return answer(r.status, await r.json().catch(() => ({})));
    }
    await labCore<unknown>(req.url!, text ? JSON.parse(text) : undefined).then(
      (body) => answer(200, body),
      (e: { status?: number; body?: unknown; message: string }) =>
        answer(e.status ?? 500, e.body ?? { error: e.message }),
    );
  })().catch((e) => log('shim', e));
});
await new Promise<void>((r) => shim.listen(0, '127.0.0.1', r));
await writeFile(
  join(tmpdir(), `raptoru-e2e-core-${port}.json`),
  JSON.stringify({
    url: `http://127.0.0.1:${(shim.address() as AddressInfo).port}`,
    secret,
  }),
);
studio.listen(port, '127.0.0.1', () =>
  console.log(
    `[e2e-core-lab] Studio + Extension Lab on http://127.0.0.1:${port}/ext/ (main Core ${coreUrl})`,
  ),
);
