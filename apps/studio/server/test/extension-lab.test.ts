import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { LabEbs, type LabRole } from '../src/extension-lab/lab-ebs.js';
import { extensionFile } from '../src/extension-lab/serve.js';
import { TWITCH_EXT_MOCK_PATH } from '../src/extension-lab/twitch-mock.js';
import { createStudioServer, EXTENSION_DIR } from '../src/index.js';

const token = (role: LabRole, identityShared = true) =>
  `Bearer lab.${Buffer.from(JSON.stringify({ role, identity_shared: identityShared })).toString('base64url')}`;

let key = 0;
const call = (
  lab: LabEbs,
  role: LabRole,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  options: { identityShared?: boolean; idempotencyKey?: string } = {},
) =>
  lab.handle(method, path, body, {
    authorization: token(role, options.identityShared),
    idempotencyKey:
      options.idempotencyKey ?? (method === 'POST' ? `k-${++key}` : undefined),
  });

const newLab = (now = () => new Date('2026-09-27T20:00:00Z')) =>
  LabEbs.create(EXTENSION_DIR, now);

describe('Extension Lab: serving the production extension', () => {
  it('serves the real files, swapping only the Twitch helper and the runtime config', async () => {
    for (const page of [
      'panel.html',
      'mobile.html',
      'video_component.html',
      'config.html',
    ]) {
      const file = await extensionFile(EXTENSION_DIR, `/ext/${page}`);
      expect(file.status, page).toBe(200);
      expect(String(file.body)).toContain(TWITCH_EXT_MOCK_PATH);
      expect(String(file.body)).not.toContain('extension-files.twitch.tv');
    }
    const runtime = await extensionFile(
      EXTENSION_DIR,
      '/ext/shared/runtime-config.js',
    );
    expect(String(runtime.body)).toContain("apiBase: '/ext-lab/api'");
    expect(String(runtime.body)).not.toContain('raptoru.fr');
    const sound = await extensionFile(
      EXTENSION_DIR,
      '/ext/assets/sounds/boop.mp3',
    );
    expect(sound).toMatchObject({ status: 200, contentType: 'audio/mpeg' });
    for (const evil of [
      '/ext/../package.json',
      '/ext/..%2F..%2Fpackage.json',
      '/ext/',
    ])
      expect((await extensionFile(EXTENSION_DIR, evil)).status).toBe(404);
  });
});

describe('Extension Lab: local EBS contract', () => {
  it('refuses calls without a lab token; the session reflects role, identity and the real sound catalog', async () => {
    const lab = await newLab();
    expect(await lab.handle('GET', '/session', undefined, {})).toMatchObject({
      status: 401,
      body: { ok: false, error: 'unauthorized' },
    });
    const viewer = (await call(lab, 'viewer', 'GET', '/session')).body;
    expect(viewer).toMatchObject({
      ok: true,
      environment: 'lab',
      role: 'viewer',
      identity_shared: true,
      twitch_user_id: '900101',
      wallet: { points: 12000, available: 12000 },
    });
    const soundboard = (
      viewer.modules as { id: string; sounds?: unknown[] }[]
    ).find((m) => m.id === 'soundboard')!;
    expect(soundboard.sounds!.length).toBeGreaterThan(60); // every mp3 of the extension
    expect(
      (viewer.moderation as { tts: { can_moderate: boolean } }).tts
        .can_moderate,
    ).toBe(false);
    const mod = (await call(lab, 'moderator', 'GET', '/session')).body;
    expect(
      (mod.moderation as { tts: { can_moderate: boolean } }).tts.can_moderate,
    ).toBe(true);
    const anonymous = (
      await call(lab, 'viewer', 'GET', '/session', undefined, {
        identityShared: false,
      })
    ).body;
    expect(anonymous).toMatchObject({
      identity_shared: false,
      twitch_user_id: null,
      wallet: { unavailable: true },
    });
  });

  it('spending jetons: fictitious wallet, stage event, insufficient funds, idempotent retry', async () => {
    const lab = await newLab();
    const sound = await call(lab, 'viewer', 'POST', '/actions/tokens', {
      module_id: 'soundboard',
      payload: { sound_id: 'boop' },
    });
    expect(sound.body).toMatchObject({
      ok: true,
      status: 'settled',
      cost: 500,
    });
    // Same Idempotency-Key (client retry): same answer, charged once.
    const retry1 = await call(
      lab,
      'viewer',
      'POST',
      '/actions/tokens',
      {
        module_id: 'bonk',
        payload: { emotes: ['preview:twitch-global:kappa'] },
      },
      { idempotencyKey: 'same' },
    );
    const retry2 = await call(
      lab,
      'viewer',
      'POST',
      '/actions/tokens',
      {
        module_id: 'bonk',
        payload: { emotes: ['preview:twitch-global:kappa'] },
      },
      { idempotencyKey: 'same' },
    );
    expect(retry2).toEqual(retry1);
    const state = lab.snapshot();
    expect(state.wallets.viewer).toBe(12000 - 500 - 200);
    expect(state.events.map((e) => [e.kind, e.cost])).toEqual([
      ['soundboard', 500],
      ['bonk', 200],
    ]);
    expect(state.events[0]!.effect).toMatchObject({
      url: 'assets/sounds/boop.mp3',
    });
    expect(state.events[1]!.effect).toMatchObject({ label: 'Kappa' });

    lab.control('wallet', { role: 'viewer', amount: 100 });
    expect(
      (
        await call(lab, 'viewer', 'POST', '/actions/tokens', {
          module_id: 'soundboard',
          payload: { sound_id: 'boop' },
        })
      ).body,
    ).toEqual({ ok: false, error: 'insufficient_tokens' });
    expect(lab.snapshot().wallets.viewer).toBe(100);
    // Identity not shared: nothing can be spent.
    expect(
      (
        await call(
          lab,
          'viewer',
          'POST',
          '/actions/tokens',
          { module_id: 'soundboard', payload: { sound_id: 'boop' } },
          { identityShared: false },
        )
      ).body,
    ).toEqual({ ok: false, error: 'identity_required' });
  });

  it('TTS approval flow, moderation rights, module switch and raffle', async () => {
    let now = new Date('2026-09-27T20:00:00Z').getTime();
    const lab = await newLab(() => new Date(now));
    // Viewer cannot moderate.
    expect(
      (
        await call(lab, 'viewer', 'POST', '/moderation/tts/settings', {
          mode: 'approval',
        })
      ).status,
    ).toBe(403);
    await call(lab, 'broadcaster', 'POST', '/moderation/tts/settings', {
      mode: 'approval',
    });
    const submitted = await call(lab, 'viewer', 'POST', '/actions/tokens', {
      module_id: 'tts',
      payload: { text: 'Salut le lab' },
    });
    expect(submitted.body).toMatchObject({ status: 'pending_review', cost: 0 });
    // Nothing consumed while waiting (what the extension tells the viewer).
    expect(lab.snapshot().wallets.viewer).toBe(12000);
    const pending = (
      (await call(lab, 'moderator', 'GET', '/session')).body.moderation as {
        tts: { pending: { submission_id: string }[] };
      }
    ).tts.pending;
    expect(pending).toHaveLength(1);
    await call(
      lab,
      'moderator',
      'POST',
      `/moderation/tts/submissions/${pending[0]!.submission_id}/approve`,
      {},
    );
    expect(lab.snapshot().events.map((e) => e.kind)).toEqual([
      'tts_submitted',
      'tts',
    ]);
    expect(lab.snapshot().wallets.viewer).toBe(12000 - 7500); // charged on approval
    // A refused TTS consumes nothing.
    const second = await call(lab, 'viewer', 'POST', '/actions/tokens', {
      module_id: 'tts',
      payload: { text: 'Refusé' },
    });
    await call(
      lab,
      'moderator',
      'POST',
      `/moderation/tts/submissions/${second.body.reference_id}/reject`,
      {},
    );
    expect(lab.snapshot().wallets.viewer).toBe(12000 - 7500);
    expect(lab.snapshot().events[1]!.effect).toMatchObject({
      text: 'Salut le lab',
    });

    await call(lab, 'moderator', 'POST', '/moderation/modules', {
      module_id: 'bonk',
      enabled: false,
    });
    expect(
      (
        await call(lab, 'viewer', 'POST', '/actions/tokens', {
          module_id: 'bonk',
          payload: { emotes: ['x'] },
        })
      ).body,
    ).toEqual({ ok: false, error: 'module_disabled' });

    expect(
      (await call(lab, 'viewer', 'POST', '/actions/raffle', {})).body,
    ).toEqual({ ok: false, error: 'raffle_closed' });
    lab.control('raffle-open', { seconds: 60 });
    expect(
      (await call(lab, 'viewer', 'POST', '/actions/raffle', {})).body,
    ).toMatchObject({ joined: true, duplicate: false });
    expect(
      (await call(lab, 'viewer', 'POST', '/actions/raffle', {})).body,
    ).toMatchObject({ joined: true, duplicate: true });
    expect(
      (await call(lab, 'viewer', 'GET', '/session')).body.raffle,
    ).toMatchObject({
      open: true,
      joined: true,
      participant_count: 1,
      ends_in_s: 60,
    });
    now += 61_000; // the window closes by itself
    expect(lab.snapshot().raffle.open).toBe(false);
  });
});

describe('Extension Lab: HTTP routes', () => {
  const get = (
    port: number,
    path: string,
    headers: Record<string, string> = {},
    method = 'GET',
    body?: string,
  ) =>
    new Promise<{
      status: number;
      headers: Record<string, unknown>;
      body: string;
    }>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method,
          headers: { host: '127.0.0.1:4100', ...headers },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: data,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });

  it('extension pages are frameable by the Studio only; the lab API needs a lab token, lab state the Studio header', async () => {
    const lab = await newLab();
    const server = createStudioServer({} as never, () => {}, lab);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    const page = await get(port, '/ext/panel.html');
    expect(page.status).toBe(200);
    expect(page.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(String(page.headers['content-security-policy'])).toContain(
      "connect-src 'self'",
    );

    expect((await get(port, '/ext-lab/api/session')).status).toBe(401);
    const spend = await get(
      port,
      '/ext-lab/api/actions/tokens',
      {
        authorization: token('viewer'),
        'content-type': 'application/json',
        'idempotency-key': 'h1',
      },
      'POST',
      JSON.stringify({
        module_id: 'soundboard',
        payload: { sound_id: 'boop' },
      }),
    );
    expect(JSON.parse(spend.body)).toMatchObject({ ok: true, cost: 500 });

    expect((await get(port, '/api/ext-lab/state')).status).toBe(403);
    const state = JSON.parse(
      (await get(port, '/api/ext-lab/state', { 'x-raptoru-studio': '1' })).body,
    );
    expect(state.events).toHaveLength(1);
    await new Promise((r) => server.close(r));
  });
});
