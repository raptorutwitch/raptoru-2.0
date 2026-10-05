// ASTRA-P1-019 lot 2 — Production players set up from Studio (not from the Extension Lab): the Bonk
// overlay, Soundboard player and TTS source of the Production profile are served with their own
// tokens, and a live player turns its module from offline to ready on the Production Core.
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every Studio path of this file lives in a throw-away data root (never the developer's Lab runtime).
vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');
  process.env.RAPTORU_DATA_ROOT = mkdtempSync(
    j(tmpdir(), 'raptoru-players-test-'),
  );
});

import { BonkRuntime } from '../src/bonk-lab/runtime.js';
import {
  productionConfig,
  PRODUCTION_ENV,
} from '../src/prod-transport/profile.js';
import { createProductionRuntimes } from '../src/prod-transport/production.js';
import { CHANNEL, pairedStudio, type Cleanups } from './prod-fixture.js';

const cleanups: Cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ORIGIN = 'http://127.0.0.1:4100';
const CA = join(
  import.meta.dirname,
  'fixtures',
  'tls',
  'localhost-test-only.crt',
);

type Handler = {
  handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    url: URL,
  ): Promise<boolean>;
};

/** One request to a runtime's own routes (players, status), as OBS / the Studio page send them. */
async function hit(
  runtime: Handler,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
) {
  const server = createServer(
    (req, res) => void runtime.handle(req, res, new URL(req.url!, ORIGIN)),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    // node:http, not fetch: fetch never sends a custom Host header (the runtimes check it).
    return await new Promise<{ status: number; body: Record<string, unknown> }>(
      (resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path,
            method,
            headers: {
              host: '127.0.0.1:4100',
              'content-type': 'application/json',
              ...headers,
            },
          },
          (res) => {
            let raw = '';
            res.on('data', (c) => (raw += String(c)));
            res.on('end', () =>
              resolve({ status: res.statusCode!, body: JSON.parse(raw) }),
            );
          },
        );
        req.on('error', reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      },
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; message: string }) => e.code ?? e.message,
  );

async function production() {
  const p = await pairedStudio(cleanups);
  const check = await productionConfig({
    [PRODUCTION_ENV.url]: p.net.url(),
    [PRODUCTION_ENV.ca]: CA,
  });
  if (!check.ok) throw new Error(check.message);
  const runtimes = await createProductionRuntimes(ORIGIN, p.dir, {
    config: check.config,
    installation: p.installation,
  });
  cleanups.push(async () => {
    for (const r of [runtimes.bonk, runtimes.sound, runtimes.tts]) r.stop();
  });
  return { ...p, ...runtimes };
}

const STUDIO = { 'x-raptoru-studio': '1' };

describe('Production players (set up from the Studio tab)', () => {
  it('Soundboard: the Production player is exposed with its own token; once live, the module goes from offline to ready', async () => {
    const f = await production();
    const status = await hit(f.sound, 'GET', '/api/sound-lab/status', STUDIO);
    expect(status.body).toMatchObject({
      enabled: true,
      ready: false,
      playerUrl: `${ORIGIN}/sound-lab/player.html#${f.sound.worker.token}`,
    });
    const admit = () =>
      f.core.soundLab.admit({
        idempotency_key: `k-${Math.random()}`,
        channel_id: CHANNEL,
        viewer: { id: '900101', display_name: 'Viewer Test' },
        lab_session_id: 'public-ebs',
        sound_id: 'boop',
        payment_method: 'tokens',
      });
    await f.sound.worker.tick();
    expect(await code(admit())).toBe('player_offline');
    // The player page loaded (OBS or the Studio card) with its token, audio enabled by a click.
    expect(
      (
        await hit(
          f.sound,
          'POST',
          '/sound-lab/player/heartbeat',
          { 'x-sound-token': f.sound.worker.token },
          { player: 'player-prod', audio: true },
        )
      ).status,
    ).toBe(200);
    expect(f.sound.worker.ready).toBe(true);
    // The worker reports to Core at most every 2 s.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2500);
    await f.sound.worker.tick();
    vi.restoreAllMocks();
    expect(await code(admit())).toBe('ok');
  });

  it('TTS: the Production OBS source is exposed with its own token; once live, offline → ready', async () => {
    const f = await production();
    const status = await hit(f.tts, 'GET', '/api/tts-lab/status', STUDIO);
    expect(status.body).toMatchObject({
      enabled: true,
      ready: false,
      overlayUrl: `${ORIGIN}/tts-lab/player.html#${f.tts.worker.token}`,
    });
    const admit = () =>
      f.core.ttsLab.admit({
        idempotency_key: `k-${Math.random()}`,
        channel_id: CHANNEL,
        viewer: { id: '900101', display_name: 'Viewer Test' },
        lab_session_id: 'public-ebs',
        text: 'Bonjour depuis le profil Production',
        payment_method: 'tokens',
      });
    await f.tts.worker.tick();
    expect(await code(admit())).toBe('player_offline');
    expect(
      (
        await hit(
          f.tts,
          'POST',
          '/tts-lab/player/heartbeat',
          { 'x-tts-token': f.tts.worker.token },
          { player: 'player-prod', voices: 12 },
        )
      ).status,
    ).toBe(200);
    // The worker reports to Core at most every 2 s.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2500);
    await f.tts.worker.tick();
    vi.restoreAllMocks();
    expect(await code(admit())).toBe('ok');
  });

  it('Bonk: the Production overlay is exposed with its own token; OBS + live overlay → ready', async () => {
    const f = await production();
    const status = await hit(f.bonk, 'GET', '/api/bonk-lab/status', STUDIO);
    expect(status.body).toMatchObject({
      enabled: true,
      ready: false,
      overlayUrl: `${ORIGIN}/bonk-lab/overlay.html#${f.bonk.worker.token}`,
    });
    const admit = () =>
      f.core.bonkLab.admit({
        idempotency_key: `k-${Math.random()}`,
        channel_id: CHANNEL,
        viewer: { id: '900101', display_name: 'Viewer Test' },
        lab_session_id: 'public-ebs',
        emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
      });
    await f.bonk.worker.tick();
    expect(await code(admit())).toBe('obs_offline');
    // OBS connected with the « Raptoru Bonk Lab » source on this URL (real OBS: the Studio card).
    f.bonk.worker.setObs(true, true);
    expect(
      (
        await hit(
          f.bonk,
          'POST',
          '/bonk-lab/renderer/heartbeat',
          { 'x-bonk-token': f.bonk.worker.token },
          { renderer: 'renderer-prod' },
        )
      ).status,
    ).toBe(200);
    // The worker reports to Core at most every 2 s.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2500);
    await f.bonk.worker.tick();
    vi.restoreAllMocks();
    expect(await code(admit())).toBe('ok');
  });

  it('back to Lab: the Lab players keep their own tokens and journals, no collision with Production', async () => {
    process.env.BONK_LAB_CORE_URL = 'http://127.0.0.1:1';
    process.env.BONK_LAB_SECRET = 'lab-secret';
    cleanups.push(async () => {
      delete process.env.BONK_LAB_CORE_URL;
      delete process.env.BONK_LAB_SECRET;
    });
    const labBefore = await BonkRuntime.create(ORIGIN);
    const f = await production();
    labBefore.stop();
    const labAfter = await BonkRuntime.create(ORIGIN); // the Lab profile restarted
    cleanups.push(async () => labAfter.stop());
    expect(labAfter.worker.token).toBe(labBefore.worker.token);
    expect(labAfter.worker.token).not.toBe(f.bonk.worker.token);
    expect(labAfter.overlayUrl).not.toBe(f.bonk.overlayUrl);
    // A Lab overlay never animates the Production runtime, and the reverse.
    for (const [runtime, token] of [
      [f.bonk, labAfter.worker.token],
      [labAfter, f.bonk.worker.token],
    ] as const)
      expect(
        (
          await hit(
            runtime,
            'POST',
            '/bonk-lab/renderer/heartbeat',
            { 'x-bonk-token': token },
            { renderer: 'renderer-x' },
          )
        ).body,
      ).toEqual({ error: 'forbidden' }); // the token, not the origin
  });
});
