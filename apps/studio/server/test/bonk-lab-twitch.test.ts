import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BonkLabService } from '../../../core-api/src/bonk-lab/bonk-lab-service.js';
import { TwitchViewerCatalog } from '../../../core-api/src/bonk-lab/twitch-viewer.js';
import { bonkLabRoutes } from '../../../core-api/src/http/bonk-lab-routes.js';
import { HttpError } from '../../../core-api/src/http/server.js';
import { setup } from '../../../core-api/test/helpers.js';
import { ViewerAuth } from '../src/bonk-lab/viewer-auth.js';
import { BonkWorker, localCoreClient } from '../src/bonk-lab/worker.js';
import { LabEbs } from '../src/extension-lab/lab-ebs.js';
import { EXTENSION_DIR } from '../src/index.js';

const SECRET = 'studio-test-secret-twitch';
const VIEWER = '83603689';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Fake Twitch: OAuth + Get Users + Get User Emotes. No network. */
const fakeTwitch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.href === 'https://id.twitch.tv/oauth2/token')
    return new URLSearchParams(String(init?.body)).get('code') === 'bad'
      ? json(400, {})
      : json(200, {
          access_token: 'AT-secret-1',
          refresh_token: 'RT-secret-1',
          expires_in: 3600,
        });
  if (url.href === 'https://id.twitch.tv/oauth2/validate')
    return json(200, {
      client_id: 'cid',
      login: 'raptoru_',
      user_id: VIEWER,
      scopes: ['user:read:emotes'],
    });
  if (url.href === 'https://id.twitch.tv/oauth2/revoke') return json(200, {});
  if (url.pathname === '/helix/users')
    return json(200, {
      data: url.searchParams.getAll('id').map((id) => ({
        id,
        login: id === VIEWER ? 'raptoru_' : `chan${id}`,
        display_name: id === VIEWER ? 'Raptoru_' : `Chan${id}`,
        profile_image_url: `https://static-cdn.jtvnw.net/jtv_user_pictures/${id}.png`,
      })),
    });
  if (url.pathname === '/helix/chat/emotes/user')
    return json(200, {
      data: [
        {
          id: 'emotesv2_anim1',
          name: 'raptorDance',
          emote_type: 'subscriptions',
          emote_set_id: '301',
          owner_id: VIEWER,
          format: ['static', 'animated'],
        },
        {
          id: '25',
          name: 'Kappa',
          emote_type: 'globals',
          emote_set_id: '0',
          owner_id: '0',
          format: ['static'],
        },
      ],
      pagination: {},
    });
  return json(404, {});
}) as typeof fetch;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

const labToken = (role: string, shared = true) =>
  `Bearer lab.${Buffer.from(JSON.stringify({ role, identity_shared: shared })).toString('base64url')}`;

async function fixture() {
  const core = await setup();
  core.clock.set(new Date());
  const viewers = new TwitchViewerCatalog(
    core.db,
    core.clock,
    { clientId: 'cid', clientSecret: 'csecret' },
    fakeTwitch,
  );
  const routes = bonkLabRoutes(
    new BonkLabService(core.db, core.clock, viewers),
    viewers,
  );
  // Minimal Lab Core dispatcher (same routes as local-server.ts).
  const server: Server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${SECRET}`)
      return send(401, { error: 'unauthorized' });
    const route = routes.find(
      (r) => r.method === req.method && r.pattern.test(url.pathname),
    );
    if (!route) return send(404, { error: 'not_found' });
    let text = '';
    for await (const chunk of req) text += String(chunk);
    try {
      send(
        200,
        await route.handle({
          params: route.pattern.exec(url.pathname)!.slice(1),
          url,
          body: text ? JSON.parse(text) : undefined,
        }),
      );
    } catch (e) {
      if (e instanceof HttpError) send(e.status, e.body);
      else send(500, { error: String(e) });
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  const client = localCoreClient(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    SECRET,
  );
  const dir = await mkdtemp(join(process.cwd(), '.runtime-bonk-twitch-test-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const worker = await BonkWorker.open(join(dir, 'journal.json'), client);
  worker.setObs(true, true);
  await worker.rendererHeartbeat('renderer-1');
  await worker.tick();
  const port = await freePort();
  const auth = new ViewerAuth(client, port);
  cleanups.push(async () => auth.stop());
  const lab = await LabEbs.create(EXTENSION_DIR);
  lab.connectBonk(worker, auth);
  let key = 0;
  const call = (
    role: string,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ) =>
    lab.handle(method, path, body, {
      authorization: labToken(role),
      idempotencyKey: method === 'POST' ? `k-${++key}` : undefined,
    });
  const connect = async (code = 'good') => {
    const { body } = await call('viewer', 'POST', '/emotes/oauth/start', {});
    const state = new URL(String(body.authorization_url)).searchParams.get(
      'state',
    )!;
    // What Twitch does after the viewer approves: redirect the browser to the registered callback.
    return fetch(
      `http://127.0.0.1:${port}/callback?code=${code}&state=${state}`,
    );
  };
  /** What the extension does while « syncing »: read again until the catalog is there (bounded). */
  const synced = async () => {
    for (let i = 0; i < 40; i++) {
      const body = (await call('viewer', 'GET', '/emotes')).body;
      if (body.twitch_status !== 'syncing') return body;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('still syncing');
  };
  return { call, connect, synced, auth, worker };
}

describe('Bonk Lab: real Twitch viewer identity → personal catalog → Core-validated Twitch Bonk', () => {
  it('OAuth through the extension flow links the viewer; the Lab viewer becomes that Twitch account', async () => {
    const f = await fixture();
    const before = (await f.call('viewer', 'GET', '/session')).body;
    expect(before).toMatchObject({
      twitch_user_id: '900101',
      emotes: { twitch_connected: false },
    });

    const start = (await f.call('viewer', 'POST', '/emotes/oauth/start', {}))
      .body;
    const authorize = new URL(String(start.authorization_url));
    expect(authorize.origin + authorize.pathname).toBe(
      'https://id.twitch.tv/oauth2/authorize',
    );
    expect(authorize.searchParams.get('scope')).toBe('user:read:emotes');
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3789/callback',
    );

    const callback = await f.connect();
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain('Connexion Twitch réussie');

    const session = (await f.call('viewer', 'GET', '/session')).body;
    expect(session).toMatchObject({
      twitch_user_id: VIEWER,
      user_login: 'raptoru_',
      viewer_login: 'Raptoru_',
      emotes: { twitch_connected: true },
    });
    // Other roles keep their fictitious identities.
    expect(
      (await f.call('moderator', 'GET', '/session')).body.twitch_user_id,
    ).toBe('900102');
    // No token anywhere in what the extension receives.
    expect(JSON.stringify(session)).not.toMatch(/AT-secret|RT-secret|csecret/);
  });

  it('personal catalog in picker format (per channel, globals last; emoji come from the extension bank); Twitch Bonk validated by Core', async () => {
    const f = await fixture();
    await f.connect();
    // Right after the link: the catalog is being loaded (same state as /v1/ext), then ready.
    expect((await f.call('viewer', 'GET', '/emotes')).body).toMatchObject({
      twitch_connected: true,
      twitch_status: 'syncing',
    });
    const emotes = await f.synced();
    expect(emotes).toMatchObject({
      twitch_connected: true,
      twitch_status: 'ready',
      twitch_login: 'Raptoru_',
    });
    const groups = emotes.groups as {
      id: string;
      scope?: string;
      channel_login?: string;
      emotes: { id: string; image_url?: string; animated?: boolean }[];
    }[];
    expect(groups.map((g) => g.id)).toEqual([
      `twitch-channel-${VIEWER}`,
      'twitch-global',
    ]);
    expect(groups[0]).toMatchObject({
      channel_login: 'raptoru_',
      scope: 'channel',
    });
    expect(groups[0]!.emotes[0]).toMatchObject({
      id: 'twitch:emotesv2_anim1',
      image_url:
        'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_anim1/animated/dark/3.0',
      static_url:
        'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_anim1/static/dark/3.0',
      animated: true,
    });

    // The real extension payload, with a hostile URL added: Core ignores it and builds its own.
    const bonk = (
      await f.call('viewer', 'POST', '/actions/tokens', {
        module_id: 'bonk',
        payload: {
          target_login: 'streamer',
          emotes: ['twitch:emotesv2_anim1'],
          emote_source: 'twitch',
          emote_glyph: null,
          image_url: 'https://evil.example/x.png',
        },
      })
    ).body;
    expect(bonk).toMatchObject({
      ok: true,
      status: 'queued',
      test_mode: true,
      payment_mode: 'simulated',
      charged: false,
    });
    expect(bonk.interaction).toMatchObject({
      provider: 'twitch',
      viewer_id: VIEWER,
      emote_id: 'twitch:emotesv2_anim1',
      emote_url:
        'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_anim1/animated/dark/3.0',
      real_debited: 0,
    });
    const notMine = await f.call('viewer', 'POST', '/actions/tokens', {
      module_id: 'bonk',
      payload: { emotes: ['twitch:emotesv2_notmine'], emote_source: 'twitch' },
    });
    expect(notMine.body).toMatchObject({
      ok: false,
      error: 'emote_not_in_catalog',
    });
    // Twemoji keeps working.
    const twemoji = await f.call('viewer', 'POST', '/actions/tokens', {
      module_id: 'bonk',
      payload: {
        emotes: ['unicode:1f600'],
        emote_source: 'unicode',
        emote_glyph: '😀',
      },
    });
    expect(twemoji.body).toMatchObject({ ok: true, status: 'queued' });
  });

  it('a forged callback links nothing; disconnect revokes and returns to the Lab identity', async () => {
    const f = await fixture();
    await f.call('viewer', 'POST', '/emotes/oauth/start', {});
    const port = (f.auth as unknown as { port: number }).port;
    const forged = await fetch(
      `http://127.0.0.1:${port}/callback?code=good&state=forged`,
    );
    expect(forged.status).toBe(400);
    expect(
      (await f.call('viewer', 'GET', '/session')).body.twitch_user_id,
    ).toBe('900101');

    await f.connect();
    expect(
      (await f.call('viewer', 'GET', '/session')).body.twitch_user_id,
    ).toBe(VIEWER);
    expect(
      (await f.call('viewer', 'POST', '/emotes/oauth/disconnect', {})).body,
    ).toMatchObject({ ok: true, revoked: true });
    const after = (await f.call('viewer', 'GET', '/session')).body;
    expect(after).toMatchObject({
      twitch_user_id: '900101',
      emotes: { twitch_connected: false },
    });
  });
});

describe('Bonk Lab façade: a failed catalog reload never empties the picker', () => {
  it('Core unreachable on a refresh (e.g. a timeout) keeps the last good Twitch catalog', async () => {
    const f = await fixture();
    await f.connect();
    const ok = await f.synced();
    const twitchGroups = (b: Record<string, unknown>) =>
      (b.groups as { source: string }[]).filter((g) => g.source === 'twitch')
        .length;
    expect(twitchGroups(ok)).toBe(2);
    // The next Core call fails like a live timeout (a slow Helix reload is Core's: it answers with the
    // stored catalog after 6 s).
    f.auth.emotes = () =>
      Promise.reject(new Error('The operation was aborted due to timeout'));
    const refreshed = (await f.call('viewer', 'POST', '/emotes/refresh', {}))
      .body;
    expect(refreshed).toMatchObject({
      twitch_connected: true,
      twitch_status: 'ready',
      twitch_error: 'core_unavailable',
    });
    expect(twitchGroups(refreshed)).toBe(2);
    expect(twitchGroups((await f.call('viewer', 'GET', '/emotes')).body)).toBe(
      2,
    );
    // The session's module catalog keeps them too (first render source).
    const session = (await f.call('viewer', 'GET', '/session')).body;
    const bonk = (
      session.modules as {
        id: string;
        emote_catalog?: { groups: { source: string }[] };
      }[]
    ).find((m) => m.id === 'bonk')!;
    expect(
      bonk.emote_catalog!.groups.filter((g) => g.source === 'twitch'),
    ).toHaveLength(2);
  });
});
