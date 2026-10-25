import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/server.js';
import { helixLive, opsStatus, type HelixLive } from '../src/ops/status.js';
import { setup } from './helpers.js';

// GET /v1/ops/status (docs/CICD.md): what a deployment reads before and after touching Production. Read-only, its own
// token; a source that cannot answer is « unknown », never « offline ».

const TOKEN = 'ops-test-token-0123456789abcdef0123';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fixture(helix: HelixLive | null, withOps = true) {
  const core = await setup();
  core.clock.set(new Date());
  const server = createApp({
    ...core,
    labRoutes: false,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
    ops: withOps
      ? {
          token: TOKEN,
          status: () =>
            opsStatus({
              session: () => core.streams.current(),
              helix,
              bot: () => core.botInstances.status(),
              db: core.db,
              commit: '36a4ceca5ca98fe8c05fc7071b216fee9b149352',
              startedAt: new Date('2026-10-25T00:00:00Z'),
              now: () => core.clock.now(),
            }),
        }
      : undefined,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (auth?: string) => {
    const res = await fetch(`${base}/v1/ops/status`, {
      headers: auth ? { authorization: auth } : {},
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
    return { status: res.status, body: (await res.json()) as any };
  };
  return { core, get };
}

describe('GET /v1/ops/status', () => {
  it('does not exist without OPS_TOKEN; refuses a missing or wrong token (bot and Studio secrets included)', async () => {
    expect(
      (await (await fixture(null, false)).get(`Bearer ${TOKEN}`)).status,
    ).toBe(404);
    const { get } = await fixture(null);
    expect((await get()).status).toBe(401);
    expect((await get('Bearer bot-test-secret')).status).toBe(401);
    expect((await get('Bearer studio-test-secret')).status).toBe(401);
    expect((await get(`Bearer ${TOKEN}x`)).status).toBe(401);
    expect((await get(`Bearer ${TOKEN}`)).status).toBe(200);
  });

  it('commit, both live sources, the bot lease with its Twitch / EventSub health, the migrations recorded', async () => {
    let live = false;
    const { core, get } = await fixture(async () => ({
      live,
      startedAt: live ? '2026-10-25T18:00:00Z' : null,
    }));
    let s = (await get(`Bearer ${TOKEN}`)).body;
    expect(s.commit).toBe('36a4ceca5ca98fe8c05fc7071b216fee9b149352');
    expect(s.live).toEqual({
      session: { live: false, since: null },
      helix: { live: false, since: null },
    });
    expect(s.bot).toMatchObject({ state: 'none', version: null });
    expect(Array.isArray(s.migrations) || s.migrations === null).toBe(true);

    await core.streams.online({
      streamId: 's1',
      startedAt: new Date('2026-10-25T18:00:00Z'),
    });
    live = true;
    await core.botInstances.lease({
      instanceId: 'vps-1',
      host: 'vps',
      version: '36a4ceca5ca9',
      startedAt: new Date().toISOString(),
      health: {
        eventSubBot: true,
        eventSubBroadcaster: true,
        broadcasterToken: true,
      },
      flags: { CHAT_GAMES: true },
    });
    s = (await get(`Bearer ${TOKEN}`)).body;
    expect(s.live.session.live).toBe(true);
    expect(s.live.helix).toEqual({ live: true, since: '2026-10-25T18:00:00Z' });
    expect(s.bot).toMatchObject({
      state: 'active',
      version: '36a4ceca5ca9',
      health: {
        eventSubBot: true,
        eventSubBroadcaster: true,
        broadcasterToken: true,
      },
      standby: 0,
    });
  });

  it('a source that cannot answer is unknown (live: null), never offline', async () => {
    const { get } = await fixture(async () => {
      throw new Error('twitch_streams_503');
    });
    const s = (await get(`Bearer ${TOKEN}`)).body;
    expect(s.live.helix).toEqual({ live: null, error: 'twitch_streams_503' });
    expect(
      (await (await fixture(null)).get(`Bearer ${TOKEN}`)).body.live.helix,
    ).toEqual({
      live: null,
      error: 'not_configured',
    });
  });
});

describe('helixLive', () => {
  const app = { clientId: 'cid', clientSecret: 'csecret' };
  const twitch = (streams: unknown[], status = 200) => {
    const calls: string[] = [];
    const impl = (async (input: string | URL) => {
      const url = String(input);
      calls.push(url.replace(/\?.*/, ''));
      if (url.startsWith('https://id.twitch.tv/oauth2/token'))
        return new Response(
          JSON.stringify({ access_token: 'app-token', expires_in: 3600 }),
        );
      return new Response(JSON.stringify({ data: streams }), { status });
    }) as typeof fetch;
    return { impl, calls };
  };

  it('live only for a stream of type live; the app token is reused', async () => {
    const off = twitch([]);
    const ask = helixLive(app, '83603689', off.impl);
    expect(await ask()).toEqual({ live: false, startedAt: null });
    await ask();
    expect(off.calls.filter((c) => c.includes('oauth2'))).toHaveLength(1);
    const on = twitch([{ type: 'live', started_at: '2026-10-25T18:00:00Z' }]);
    expect(await helixLive(app, '83603689', on.impl)()).toEqual({
      live: true,
      startedAt: '2026-10-25T18:00:00Z',
    });
  });

  it('an error from Twitch throws (reported unknown), never « offline »', async () => {
    await expect(
      helixLive(app, '83603689', twitch([], 503).impl)(),
    ).rejects.toThrow('twitch_streams_503');
  });
});
