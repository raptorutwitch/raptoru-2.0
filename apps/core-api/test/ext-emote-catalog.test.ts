import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import { ThirdPartyEmotes } from '../src/bonk-lab/third-party-emotes.js';
import type { CoreConfig } from '../src/config.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { createPublicFrontier } from '../src/ext/public-frontier.js';
import { signExtensionJwt } from '../src/ext/twitch-jwt.js';
import { createApp } from '../src/http/server.js';
import { createTestDb, FakeClock } from './helpers.js';

// Bonk's PUBLIC 7TV / BTTV / FFZ catalogs (EMOTE_CATALOG_CHANNEL_ID): one Core option, the same in the Lab and in
// Production, OFF by default. Off: the session's Bonk catalog is exactly as before (empty). On: the extension gets the
// channel's public catalogs, read with plain GETs — no token, no credential, no account.

const CHANNEL = '900100';
const SECRET = randomBytes(32);
const PUBLIC: Record<string, unknown> = {
  'https://7tv.io/v3/emote-sets/global': { emotes: [] },
  'https://7tv.io/v3/users/twitch/83603689': {
    user: { display_name: 'Raptoru_' },
    emote_set: {
      emotes: [
        {
          id: '89abcdef0123456789abcdef',
          name: 'PepoReel',
          data: { animated: false },
        },
      ],
    },
  },
  'https://api.betterttv.net/3/cached/emotes/global': [],
  'https://api.betterttv.net/3/cached/users/twitch/83603689': {
    channelEmotes: [
      { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', code: 'BttvReel', imageType: 'png' },
    ],
    sharedEmotes: [],
  },
  'https://api.frankerfacez.com/v1/set/global': { default_sets: [], sets: {} },
  'https://api.frankerfacez.com/v1/room/id/83603689': { sets: {} },
};

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function sessionBonk(emoteChannel: string | null) {
  const calls: {
    url: string;
    method: string;
    headers: Record<string, string>;
  }[] = [];
  const publicFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    if (!(url in PUBLIC)) throw new Error(`no_network: ${url}`);
    return new Response(JSON.stringify(PUBLIC[url]), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const db = await createTestDb();
  const clock = new FakeClock(new Date());
  const core = createCore(
    db,
    clock,
    new DevFakeCreditProvider(),
    undefined,
    null,
    undefined,
    {
      broadcasterId: CHANNEL,
      emoteCatalog: emoteChannel
        ? new ThirdPartyEmotes(emoteChannel, clock, publicFetch)
        : null,
    },
  );
  const frontier = createPublicFrontier(core, db, clock, {
    TWITCH_CHANNEL_ID: CHANNEL,
    TWITCH_CHANNEL_LOGIN: 'raptoru_lab',
    TWITCH_EXTENSION_SECRET: SECRET.toString('base64'),
    CORE_ENVIRONMENT: 'lab',
  } as CoreConfig)!;
  const server = createApp({
    ...core,
    botSecret: 'bot-test-secret-0123',
    studioSecret: 'studio-test-secret-0123',
    labRoutes: false,
    ...frontier.deps,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const jwt = signExtensionJwt(
    {
      exp: Math.floor(Date.now() / 1000) + 600,
      opaque_user_id: 'U900101',
      user_id: '900101',
      channel_id: CHANNEL,
      role: 'viewer',
    },
    SECRET,
  );
  const res = await fetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/ext/session`,
    {
      headers: { authorization: `Bearer ${jwt}` },
    },
  );
  const body = (await res.json()) as {
    modules: {
      id: string;
      emote_catalog?: { groups: { id: string; emotes: { id: string }[] }[] };
    }[];
  };
  return { bonk: body.modules.find((m) => m.id === 'bonk')!, calls };
}

describe('Bonk public emote catalogs (EMOTE_CATALOG_CHANNEL_ID)', () => {
  it('off by default: the Bonk catalog is empty, as before, and nothing is fetched', async () => {
    const { bonk, calls } = await sessionBonk(null);
    expect(bonk.emote_catalog).toEqual({ groups: [] });
    expect(calls).toEqual([]);
  });

  it('on: the channel’s public 7TV / BTTV catalogs, read with GETs and no credential', async () => {
    const { bonk, calls } = await sessionBonk('83603689');
    const groups = bonk.emote_catalog!.groups;
    expect(groups.map((g) => g.id)).toEqual(['7tv-channel', 'bttv-channel']);
    expect(groups[0]!.emotes[0]!.id).toBe('7tv:89abcdef0123456789abcdef');
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.method).toBe('GET');
      expect(
        Object.keys(c.headers).filter((h) =>
          /authorization|client-id|cookie/i.test(h),
        ),
      ).toEqual([]);
    }
  });
});
