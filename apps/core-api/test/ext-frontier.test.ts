import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreConfig } from '../src/config.js';
import { createPublicFrontier } from '../src/ext/public-frontier.js';
import { RateLimiter } from '../src/ext/rate-limit.js';
import {
  ExtAuthError,
  signExtensionJwt,
  verifyExtensionJwt,
} from '../src/ext/twitch-jwt.js';
import { createApp } from '../src/http/server.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { setup } from './helpers.js';

// ASTRA-P1-006 (minimal public frontier) + ASTRA-P1-019 cockpit: the Core behind a real Twitch
// Extension JWT, the Lab routes never served, the Studio cockpit over the installation credential.

const CHANNEL = '83603689';
const SECRET = randomBytes(32);
const nowS = () => Math.floor(Date.now() / 1000);
const token = (claims: Record<string, unknown>, secret = SECRET) =>
  signExtensionJwt(
    {
      exp: nowS() + 600,
      opaque_user_id: `U${randomUUID().slice(0, 8)}`,
      channel_id: CHANNEL,
      role: 'viewer',
      ...claims,
    },
    secret,
  );

describe('Twitch Extension JWT', () => {
  const verify = (t: string) =>
    verifyExtensionJwt(`Bearer ${t}`, { secret: SECRET, channelId: CHANNEL });

  it('accepts a signed token; the user id only when shared', () => {
    expect(verify(token({ user_id: '4242' }))).toMatchObject({
      role: 'viewer',
      userId: '4242',
      channelId: CHANNEL,
    });
    expect(verify(token({})).userId).toBeNull();
  });

  it.each([
    ['another secret', () => token({}, randomBytes(32)), 'invalid_token'],
    ['expired', () => token({ exp: nowS() - 120 }), 'token_expired'],
    ['another channel', () => token({ channel_id: '1' }), 'wrong_channel'],
    ['unknown role', () => token({ role: 'admin' }), 'invalid_token'],
    [
      'alg none',
      () => {
        const [, p] = token({}).split('.');
        const h = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
          'base64url',
        );
        return `${h}.${p}.x`;
      },
      'invalid_token',
    ],
  ])('refuses a token: %s', (_, make, code) => {
    expect(() => verify(make())).toThrow(new ExtAuthError(code));
  });

  it('refuses a missing or non-JWT authorization', () => {
    expect(() =>
      verifyExtensionJwt(undefined, { secret: SECRET, channelId: CHANNEL }),
    ).toThrow(new ExtAuthError('unauthorized'));
    expect(() =>
      verifyExtensionJwt('Bearer lab.eyJyb2xlIjoidmlld2VyIn0', {
        secret: SECRET,
        channelId: CHANNEL,
      }),
    ).toThrow(new ExtAuthError('unauthorized'));
  });
});

describe('rate limiter', () => {
  it('allows the burst, refuses beyond, refills with time', () => {
    let t = 0;
    const limit = new RateLimiter({ capacity: 3, refillPerS: 1 }, () => t);
    expect([1, 2, 3].map(() => limit.take('a'))).toEqual([true, true, true]);
    expect(limit.take('a')).toBe(false);
    expect(limit.take('b')).toBe(true); // another key keeps its own bucket
    t += 1000;
    expect(limit.take('a')).toBe(true);
    expect(limit.take('a', 2)).toBe(false);
  });
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fixture(viewerLimit?: { capacity: number; refillPerS: number }) {
  const core = await setup();
  core.clock.set(new Date());
  const frontier = createPublicFrontier(core, core.db, core.clock, {
    TWITCH_CHANNEL_ID: CHANNEL,
    TWITCH_CHANNEL_LOGIN: 'raptoru_',
    TWITCH_EXTENSION_SECRET: SECRET.toString('base64'),
    CORE_ENVIRONMENT: 'staging',
  } as CoreConfig)!;
  const server = createApp({
    ...core,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
    labRoutes: false,
    ...frontier.deps,
    ext: {
      ...frontier.deps.ext!,
      ...(viewerLimit
        ? {
            limits: {
              ip: { capacity: 1000, refillPerS: 100 },
              viewer: viewerLimit,
            },
          }
        : {}),
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (
    path: string,
    init: {
      body?: unknown;
      headers?: Record<string, string>;
      method?: string;
    } = {},
  ) => {
    const res = await fetch(base + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
      body: (text ? JSON.parse(text) : null) as any,
    };
  };
  const ext = (
    path: string,
    jwt: string,
    body?: unknown,
    key: string = randomUUID(),
  ) =>
    send(`/v1/ext${path}`, {
      body,
      headers: {
        authorization: `Bearer ${jwt}`,
        origin: 'https://abcdef123.ext-twitch.tv',
        ...(body === undefined ? {} : { 'idempotency-key': key }),
      },
    });
  // A paired Studio (installation credential) for the cockpit.
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  await core.studioInstallations.register(`${id}.${sha256(secret)}`, 'PC test');
  const studio = (path: string, body?: unknown) =>
    send(path, {
      body,
      headers: {
        authorization: `Bearer rsi_${id}.${secret}`,
        [STUDIO_PROTOCOL_HEADER]: '1',
      },
    });
  return { core, send, ext, studio };
}

const viewer = (id = '4242', role = 'viewer') => token({ user_id: id, role });
const bonk = (glyph = '😀') => ({
  module_id: 'bonk',
  payload: {
    emote_source: 'unicode',
    emotes: ['unicode:1f600'],
    emote_glyph: glyph,
  },
});

describe('public Core: viewer frontier /v1/ext', () => {
  it('serves no /v1/lab route, even with the Studio secret', async () => {
    const { send } = await fixture();
    const r = await send(`/v1/lab/wallet/${CHANNEL}/4242`, {
      headers: { authorization: 'Bearer studio-test-secret' },
    });
    expect(r.status).toBe(404);
  });

  it('answers the CORS preflight of an extension page only', async () => {
    const { send } = await fixture();
    const ok = await send('/v1/ext/session', {
      method: 'OPTIONS',
      headers: { origin: 'https://abcdef123.ext-twitch.tv' },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(
      'https://abcdef123.ext-twitch.tv',
    );
    expect(ok.headers.get('access-control-allow-headers')).toContain(
      'idempotency-key',
    );
    const other = await send('/v1/ext/session', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses a missing, forged or other-channel token', async () => {
    const { send, ext } = await fixture();
    expect((await send('/v1/ext/session')).body.error).toBe('unauthorized');
    expect((await ext('/session', token({}, randomBytes(32)))).body).toEqual({
      ok: false,
      error: 'invalid_token',
    });
    expect((await ext('/session', token({ channel_id: '1' }))).status).toBe(
      401,
    );
  });

  it('builds the session from the JWT: test wallet, simulated payment, staging', async () => {
    const { ext } = await fixture();
    const r = await ext('/session', viewer());
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(
      'https://abcdef123.ext-twitch.tv',
    );
    expect(r.body).toMatchObject({
      ok: true,
      environment: 'staging',
      test_mode: true,
      payment_mode: 'simulated',
      demo_mode: false,
      identity_shared: true,
      twitch_user_id: '4242',
      viewer_login: 'Viewer 4242',
      channel_id: CHANNEL,
      wallet: { available: 12_000 },
      pending_actions: [],
      credits: { tts: 0, soundboard: 0 },
    });
    expect(r.body.modules.map((m: { id: string }) => m.id)).toEqual([
      'tts',
      'soundboard',
      'bonk',
      'raffle_join',
    ]);
    // Never a Channel Points payment offered.
    for (const m of r.body.modules) expect(m.kinds).not.toContain('redemption');
    expect(
      r.body.modules.find((m: { id: string }) => m.id === 'soundboard').sounds
        .length,
    ).toBeGreaterThan(0);
  });

  it('an unshared identity reads but never spends', async () => {
    const { ext } = await fixture();
    const jwt = token({});
    const s = await ext('/session', jwt);
    expect(s.body).toMatchObject({
      identity_shared: false,
      wallet: { unavailable: true },
    });
    const r = await ext('/actions/tokens', jwt, bonk());
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('identity_required');
  });

  it('Bonk: refused without a ready Studio, then admitted and paid once (simulated)', async () => {
    const { core, ext } = await fixture();
    const jwt = viewer();
    const off = await ext('/actions/tokens', jwt, bonk());
    expect(off.status).toBe(503);
    expect(off.body.error).toBe('studio_offline');

    await core.bonkLab.heartbeat({
      studio_instance_id: 'studio-1',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    const key = randomUUID();
    const r = await ext('/actions/tokens', jwt, bonk(), key);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      module_id: 'bonk',
      payment_mode: 'simulated',
      charged: false,
      cost: 200,
    });
    // Same intention retried: the same interaction, debited once.
    const again = await ext('/actions/tokens', jwt, bonk(), key);
    expect(again.body.reference_id).toBe(r.body.reference_id);
    const s = await ext('/session', jwt);
    expect(s.body.wallet.available).toBe(12_000 - 200);
    expect(s.body.action_receipts[0]).toMatchObject({ action: 'bonk' });
    // The viewer is the JWT's: another viewer keeps a full test wallet.
    expect((await ext('/session', viewer('77'))).body.wallet.available).toBe(
      12_000,
    );
  });

  it('Bonk salve (lot 5, Auto): Core bounds in the session, N shots paid at once, replay-safe, all or nothing', async () => {
    const { core, ext } = await fixture();
    const jwt = viewer();
    const s0 = await ext('/session', jwt);
    expect(
      s0.body.modules.find((m: { id: string }) => m.id === 'bonk').volley,
    ).toEqual({ max_shots: 10, cadence_min_ms: 90, cadence_max_ms: 600 });
    await core.bonkLab.heartbeat({
      studio_instance_id: 'studio-1',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    const shot = (id: string, glyph: string) => ({
      emote_source: 'unicode',
      emote: id,
      emote_glyph: glyph,
    });
    const salve = (shots: unknown[], cadence_ms = 160) => ({
      module_id: 'bonk',
      payload: { shots, cadence_ms },
    });
    const key = randomUUID();
    const body = salve([
      shot('unicode:1f600', '😀'),
      shot('unicode:1f525', '🔥'),
      shot('unicode:1f600', '😀'),
    ]);
    const r = await ext('/actions/tokens', jwt, body, key);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      module_id: 'bonk',
      payment_mode: 'simulated',
      charged: false,
      cost: 600,
      replayed: false,
    });
    expect(r.body.interactions).toHaveLength(3);
    const again = await ext('/actions/tokens', jwt, body, key);
    expect(again.body).toMatchObject({
      volley_id: r.body.volley_id,
      replayed: true,
    });
    expect((await ext('/session', jwt)).body.wallet.available).toBe(
      12_000 - 600,
    );
    // Over the Core bound, or a malformed shot: refused, nothing paid.
    const tooMany = await ext(
      '/actions/tokens',
      jwt,
      salve(Array.from({ length: 11 }, () => shot('unicode:1f600', '😀'))),
    );
    expect(tooMany.body.error).toBe('volley_too_large');
    const bad = await ext('/actions/tokens', jwt, salve([{ emote: 1 }]));
    expect(bad.status).toBe(400);
    expect((await ext('/session', jwt)).body.wallet.available).toBe(
      12_000 - 600,
    );
  });

  it('refuses Channel Points payment and an action without Idempotency-Key', async () => {
    const { ext, send } = await fixture();
    const r = await ext('/actions/redemption', viewer(), {
      module_id: 'tts',
      redemption_id: 'x',
    });
    expect(r.body.error).toBe('unsupported_payment');
    const noKey = await send('/v1/ext/actions/tokens', {
      body: bonk(),
      headers: { authorization: `Bearer ${viewer()}` },
    });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toBe('idempotency_key_required');
  });

  it('moderation: viewers refused, the team reaches the D4 console as itself', async () => {
    const { ext } = await fixture();
    expect((await ext('/moderation/v2/whoami', viewer())).status).toBe(403);
    const mod = await ext('/moderation/v2/whoami', viewer('5555', 'moderator'));
    expect(mod.status).toBe(200);
    expect(mod.body.actor).toMatchObject({
      id: '5555',
      role: 'moderator',
      via: 'extension',
    });
  });

  it('rate limits a viewer flooding the frontier', async () => {
    const { ext } = await fixture({ capacity: 5, refillPerS: 0.001 });
    const jwt = viewer('999');
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++)
      statuses.push((await ext('/emotes', jwt)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
  });
});

describe('Studio cockpit over the installation credential', () => {
  it('relays the Lab cockpit for the Core channel only, as the broadcaster Studio', async () => {
    const { studio, send } = await fixture();
    const overview = await studio(
      `/v1/studio/cockpit/moderation/${CHANNEL}/overview`,
    );
    expect(overview.status).toBe(200);
    expect(overview.body).toHaveProperty('tts');
    const other = await studio('/v1/studio/cockpit/moderation/900100/overview');
    expect(other.status).toBe(403);
    expect((await studio('/v1/studio/cockpit/chat')).status).toBe(404);
    expect((await studio('/v1/studio/cockpit/raffle/entries', {})).status).toBe(
      404,
    );
    // Never with the Studio secret alone.
    const secretOnly = await send(
      `/v1/studio/cockpit/moderation/${CHANNEL}/overview`,
      {
        headers: {
          authorization: 'Bearer studio-test-secret',
          [STUDIO_PROTOCOL_HEADER]: '1',
        },
      },
    );
    expect(secretOnly.status).toBe(401);
  });

  it('Tombola: the Studio starts a stream and a round, a viewer joins from the extension', async () => {
    const { studio, ext } = await fixture();
    const act = (command: Record<string, unknown>) =>
      studio(`/v1/studio/cockpit/raffle/${CHANNEL}/actions`, {
        actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
        command,
      });
    expect((await act({ action: 'stream_start' })).status).toBe(200);
    const launched = await act({ action: 'launch', kind: 'auto' });
    expect(launched.status).toBe(200);
    const jwt = viewer();
    const join = await ext('/actions/raffle', jwt, {});
    expect(join.status).toBe(200);
    expect(join.body).toMatchObject({ joined: true, duplicate: false });
    const state = await ext('/raffle/state', jwt);
    expect(state.status).toBe(200);
    expect(state.body.me).toMatchObject({
      viewer_id: '4242',
      display_name: 'Viewer 4242',
    });
  });

  it('Soundboard config and TTS rules: read and edited by the Studio, seen by the viewers', async () => {
    const { studio, ext } = await fixture();
    const config = await studio('/v1/studio/cockpit/sound/config');
    expect(config.status).toBe(200);
    const sound = config.body.sounds[0];
    const updated = await studio(
      `/v1/studio/cockpit/sound/sounds/${sound.id}`,
      { token_cost: 777, cooldown_ms: 5000, playback_mode: 'queue' },
    );
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      token_cost: 777,
      playback_mode: 'queue',
    });
    const settings = await studio('/v1/studio/cockpit/sound/settings', {
      volume_protection: 'off',
    });
    expect(settings.status).toBe(200);
    // The extension's catalog follows the streamer's prices.
    const s = await ext('/session', viewer());
    expect(
      s.body.modules
        .find((m: { id: string }) => m.id === 'soundboard')
        .sounds.find((x: { id: string }) => x.id === sound.id),
    ).toMatchObject({
      token_cost: 777,
      cooldown_ms: 5000,
      playback_mode: 'queue',
    });
    expect((await studio('/v1/studio/cockpit/tts/rules')).status).toBe(200);
    // Never the Soundboard admission or history through the cockpit.
    expect(
      (await studio('/v1/studio/cockpit/sound/interactions', {})).status,
    ).toBe(404);
  });

  it('the Studio credits a tester (test wallet) whatever actor it claims', async () => {
    const { studio, ext } = await fixture();
    const r = await studio(`/v1/studio/cockpit/moderation/${CHANNEL}/actions`, {
      actor: { id: '1', role: 'viewer', via: 'extension' },
      command: {
        action: 'wallet_adjust',
        viewer_id: '4242',
        currency: 'tokens',
        delta: 5000,
        reason: 'test staging',
      },
    });
    expect(r.status).toBe(200);
    expect((await ext('/session', viewer())).body.wallet.available).toBe(
      17_000,
    );
  });
});

describe('operator: Studio installations over HTTPS (Studio secret)', () => {
  it('pairs, lists and revokes without a shell in the container', async () => {
    const { send } = await fixture();
    const op = { authorization: 'Bearer studio-test-secret' };
    const id = randomUUID();
    const code = `${id}.${sha256(randomBytes(32).toString('base64url'))}`;
    const paired = await send('/v1/admin/studio/installations/pair', {
      body: { pairing_code: code, label: 'PC Antoni' },
      headers: op,
    });
    expect(paired.status).toBe(200);
    expect(paired.body).toMatchObject({
      installation_id: id,
      label: 'PC Antoni',
    });
    const again = await send('/v1/admin/studio/installations/pair', {
      body: { pairing_code: code, label: 'PC Antoni' },
      headers: op,
    });
    expect(again.status).toBe(409);
    const list = await send('/v1/admin/studio/installations', { headers: op });
    expect(
      list.body.installations.map(
        (i: { installation_id: string }) => i.installation_id,
      ),
    ).toContain(id);
    const revoked = await send(`/v1/admin/studio/installations/${id}/revoke`, {
      body: {},
      headers: op,
    });
    expect(revoked.body).toEqual({ revoked: id });
    // Never without the operator secret.
    const anonymous = await send('/v1/admin/studio/installations');
    expect(anonymous.status).toBe(401);
  });
});
