// LOCAL TEST CORE — NEVER PRODUCTION (ASTRA-P1-019 lot 2, manual validation of the Studio
// Production profile). An in-memory Core (PGlite, every schema, fictitious data only) served over
// HTTPS on 127.0.0.1 with the test-only certificate of apps/studio/server/test/fixtures/tls.
// Nothing is written anywhere: stopping it (Ctrl+C) forgets everything.
//
//   npm run test:local-https-core -w @raptoru/core-api
//
// Commands (stdin): pair <code> | revoke <installation id> | list | bonk | sound [sound id] |
// tts <text> | stop-sound | stop-tts | status | help
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createHandler } from '../../src/http/server.js';
import { setup } from '../helpers.js';

const PORT = Number(process.env.LOCAL_TEST_CORE_PORT ?? 4443);
const TLS = join(
  import.meta.dirname,
  '../../../studio/server/test/fixtures/tls',
);
const CHANNEL = '900100';
const VIEWER = { id: '900101', display_name: 'Viewer Test' };

const core = await setup();
// Real time (leases, expiry) for a manual session.
core.clock.set(new Date());
setInterval(() => core.clock.set(new Date()), 100).unref();

const server = createServer(
  {
    key: readFileSync(join(TLS, 'localhost-test-only.key')),
    cert: readFileSync(join(TLS, 'localhost-test-only.crt')),
  },
  createHandler({
    ...core,
    botSecret: 'local-test-bot-secret',
    studioSecret: 'local-test-studio-secret',
  }),
);
server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `LOCAL TEST CORE (never production) on https://127.0.0.1:${PORT}`,
  );
  console.log('Studio, before `npm run studio`:');
  console.log(
    `  $env:RAPTORU_PRODUCTION_CORE_URL = "https://127.0.0.1:${PORT}"`,
  );
  console.log(
    `  $env:RAPTORU_PRODUCTION_CA_FILE = "${join(TLS, 'localhost-test-only.crt')}"`,
  );
  console.log('Type `help` for the commands.');
});

let seq = 0;
const key = (p: string) => `${p}-${Date.now()}-${++seq}`;
const run: Record<string, (args: string[]) => Promise<unknown>> = {
  help: async () =>
    'pair <code> | revoke <id> | list | bonk | sound [id] | tts <text> | stop-sound | stop-tts | status',
  pair: async ([code]) =>
    core.studioInstallations.register(code ?? '', 'Studio (test local)'),
  revoke: async ([id]) => core.studioInstallations.revoke(id ?? ''),
  list: async () => core.studioInstallations.list(),
  bonk: async () =>
    (
      await core.bonkLab.admit({
        idempotency_key: key('bonk'),
        channel_id: CHANNEL,
        viewer: VIEWER,
        lab_session_id: 'local-test-core',
        emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
      })
    ).interaction.interaction_id,
  sound: async ([id]) =>
    (
      await core.soundLab.admit({
        idempotency_key: key('sound'),
        channel_id: CHANNEL,
        viewer: VIEWER,
        lab_session_id: 'local-test-core',
        sound_id: id ?? 'boop',
        payment_method: 'tokens',
      })
    ).interaction.interaction_id,
  tts: async (words) =>
    (
      await core.ttsLab.admit({
        idempotency_key: key('tts'),
        channel_id: CHANNEL,
        viewer: VIEWER,
        lab_session_id: 'local-test-core',
        text: words.join(' ') || 'Test du profil Production de Raptoru Studio',
        payment_method: 'tokens',
      })
    ).interaction.interaction_id,
  'stop-sound': async () => {
    const playing = (await core.soundLab.recent(CHANNEL, 20)).filter((i) =>
      ['executing', 'queued'].includes(i.status),
    );
    for (const i of playing)
      await core.db.tx((q) =>
        core.soundLab.applyModeration(
          q,
          CHANNEL,
          {
            action: 'cancel',
            module: 'soundboard',
            interaction_id: i.interaction_id,
            refund: false,
          },
          { id: 'local-test', role: 'broadcaster', via: 'studio' },
          'broadcaster',
        ),
      );
    return `${playing.length} sound(s) cancelled`;
  },
  'stop-tts': async () =>
    core.ttsLab.moderate(CHANNEL, {
      action: 'stop_current',
      actor: 'local-test',
      refund: false,
    }),
  status: async () => ({
    bonk: (await core.bonkLab.recent(CHANNEL, null, 3)).map((i) => i.status),
    sound: (await core.soundLab.recent(CHANNEL, 3)).map((i) => i.status),
    tts: (
      await core.ttsLab
        .get(
          (
            await core.db.query<{ interaction_id: string }>(
              'select interaction_id from tts_lab_interactions order by created_at desc limit 1',
            )
          )[0]?.interaction_id ?? '00000000-0000-4000-8000-000000000000',
        )
        .catch(() => null)
    )?.status,
  }),
};

createInterface({ input: process.stdin }).on('line', (line) => {
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (!cmd) return;
  const fn = run[cmd];
  if (!fn) return console.log('unknown command (help)');
  fn(args).then(
    (out) => console.log(out),
    (e: Error) => console.log(`refused: ${e.message}`),
  );
});
