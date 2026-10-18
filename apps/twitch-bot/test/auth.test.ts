import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  fileTokenStore,
  TWITCH_TOKEN_URL,
  TWITCH_VALIDATE_URL,
  TwitchAuth,
  type StoredToken,
  type TokenStore,
} from '../src/twitch/auth.js';
import { createHelix, HelixError } from '../src/twitch/helix.js';

const SECRET = 'client-secret-xyz';
const HOUR = 3_600_000;

/** Fake id.twitch.tv + api.twitch.tv. Valid access tokens are listed in `valid`. */
function fakeTwitch(
  opts: { scopes?: string[]; refresh?: 'ok' | 'rejected' | 'down' } = {},
) {
  const valid = new Set(['at-1']);
  let issued = 1;
  const calls = { validate: 0, refresh: 0, helix: [] as string[] };
  let refreshMode = opts.refresh ?? 'ok';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  const fetchImpl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url === TWITCH_VALIDATE_URL) {
        calls.validate++;
        const token = headers.authorization!.replace('OAuth ', '');
        return valid.has(token)
          ? json({
              login: 'raptoru_',
              client_id: 'client-id',
              user_id: '100',
              expires_in: 4 * 3600,
              scopes: opts.scopes ?? ['moderator:read:chatters'],
            })
          : json({ status: 401, message: 'invalid access token' }, 401);
      }
      if (url === TWITCH_TOKEN_URL) {
        calls.refresh++;
        if (refreshMode === 'rejected')
          return json({ status: 400, message: 'Invalid refresh token' }, 400);
        if (refreshMode === 'down')
          return json({ message: 'unavailable' }, 503);
        issued++;
        valid.add(`at-${issued}`);
        return json({
          access_token: `at-${issued}`,
          refresh_token: `rt-${issued}`,
          expires_in: 4 * 3600,
          scope: opts.scopes ?? ['moderator:read:chatters'],
        });
      }
      const token = headers.authorization!.replace('Bearer ', '');
      calls.helix.push(token);
      if (!valid.has(token)) return json({ message: 'invalid token' }, 401);
      return json({ data: [], pagination: {}, total: 0 });
    },
  );

  return {
    fetchImpl,
    calls,
    revoke: (token: string) => valid.delete(token),
    setRefresh: (mode: 'ok' | 'rejected' | 'down') => (refreshMode = mode),
  };
}

function memoryStore(
  initial: Partial<StoredToken> = {},
): TokenStore & { saved: StoredToken[] } {
  let current: StoredToken | null = {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    scopes: ['moderator:read:chatters'],
    expiresAt: Date.now() + 4 * HOUR,
    userId: '100',
    login: 'raptoru_',
    ...initial,
  };
  const saved: StoredToken[] = [];
  return {
    saved,
    load: async () => current,
    save: async (t) => {
      saved.push(t);
      current = t;
    },
  };
}

function newAuth(
  twitch: ReturnType<typeof fakeTwitch>,
  store: TokenStore,
  logs: string[] = [],
  now = Date.now,
) {
  return new TwitchAuth({
    clientId: 'client-id',
    expectedUserId: '100',
    clientSecret: SECRET,
    store,
    requiredScopes: ['moderator:read:chatters'],
    fetch: twitch.fetchImpl as typeof fetch,
    now,
    log: (...args) => logs.push(args.join(' ')),
  });
}

describe('Twitch auth', () => {
  it('a still-valid token is used as is (no refresh)', async () => {
    const twitch = fakeTwitch();
    const auth = newAuth(twitch, memoryStore());
    expect(await auth.init()).toMatchObject({
      state: 'ready',
      login: 'raptoru_',
      userId: '100',
      hasRefreshToken: true,
    });
    expect(await auth.getAccessToken()).toBe('at-1');
    expect(twitch.calls.refresh).toBe(0);
  });

  it('an expired token is refreshed at startup and the new refresh token is stored', async () => {
    const twitch = fakeTwitch();
    twitch.revoke('at-1'); // expired: Twitch now answers 401 on validate
    const store = memoryStore({ expiresAt: Date.now() - HOUR });
    const auth = newAuth(twitch, store);
    await auth.init();

    expect(await auth.getAccessToken()).toBe('at-2');
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]).toMatchObject({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
    });
  });

  it('refreshes proactively shortly before expiry', async () => {
    const twitch = fakeTwitch();
    let now = Date.now();
    const auth = newAuth(twitch, memoryStore(), [], () => now);
    await auth.init();
    now += 4 * HOUR - 5 * 60_000; // 5 min left < 10 min margin
    expect(await auth.getAccessToken()).toBe('at-2');
    expect(twitch.calls.refresh).toBe(1);
  });

  it('concurrent callers share a single refresh', async () => {
    const twitch = fakeTwitch();
    let now = Date.now();
    const auth = newAuth(twitch, memoryStore(), [], () => now);
    await auth.init();
    now += 5 * HOUR;
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => auth.getAccessToken()),
    );
    expect(new Set(tokens)).toEqual(new Set(['at-2']));
    expect(twitch.calls.refresh).toBe(1);
  });

  it('a rejected refresh is final: clear error, no refresh loop', async () => {
    const twitch = fakeTwitch({ refresh: 'rejected' });
    twitch.revoke('at-1');
    const auth = newAuth(twitch, memoryStore());
    await expect(auth.init()).rejects.toMatchObject({
      code: 'refresh_rejected',
    });
    expect(auth.status()).toMatchObject({ state: 'failed' });

    for (let i = 0; i < 5; i++)
      await expect(auth.getAccessToken()).rejects.toBeInstanceOf(AuthError);
    expect(await auth.handleUnauthorized('at-1')).toBe(false);
    expect(twitch.calls.refresh).toBe(1);
  });

  it('a Twitch outage during refresh is not final', async () => {
    const twitch = fakeTwitch({ refresh: 'down' });
    let now = Date.now();
    const auth = newAuth(twitch, memoryStore(), [], () => now);
    await auth.init();
    now += 5 * HOUR;
    await expect(auth.getAccessToken()).rejects.toMatchObject({
      code: 'twitch_unavailable',
    });
    expect(auth.status().state).toBe('ready');
    twitch.setRefresh('ok');
    expect(await auth.getAccessToken()).toBe('at-2');
  });

  it('refuses a token without the required scope', async () => {
    const twitch = fakeTwitch({ scopes: ['user:read:chat'] });
    const auth = newAuth(twitch, memoryStore());
    await expect(auth.init()).rejects.toMatchObject({ code: 'missing_scopes' });
  });

  it('asks for twitch:auth when no token is stored', async () => {
    const auth = newAuth(fakeTwitch(), {
      load: async () => null,
      save: async () => {},
    });
    await expect(auth.init()).rejects.toMatchObject({ code: 'no_token' });
  });

  it('never writes tokens or the client secret to logs or error messages', async () => {
    const logs: string[] = [];
    const twitch = fakeTwitch();
    twitch.revoke('at-1');
    const auth = newAuth(twitch, memoryStore({ expiresAt: 0 }), logs);
    await auth.init();
    twitch.setRefresh('rejected');
    await auth.refresh().catch((e: Error) => logs.push(e.message));
    const text = logs.join('\n') + JSON.stringify(auth.status());
    for (const secret of ['at-1', 'at-2', 'rt-1', 'rt-2', SECRET])
      expect(text).not.toContain(secret);
  });
});

describe('Helix with TwitchAuth', () => {
  const helixFor = (twitch: ReturnType<typeof fakeTwitch>, auth: TwitchAuth) =>
    createHelix(
      {
        clientId: 'client-id',
        getAccessToken: () => auth.getAccessToken(),
        handleUnauthorized: (t) => auth.handleUnauthorized(t),
      },
      twitch.fetchImpl as typeof fetch,
    );

  it('a 401 (token revoked early) triggers one refresh and one retry', async () => {
    const twitch = fakeTwitch();
    const auth = newAuth(twitch, memoryStore());
    await auth.init();
    twitch.revoke('at-1');
    await helixFor(twitch, auth).getChattersPage('100', '100', null);
    expect(twitch.calls.helix).toEqual(['at-1', 'at-2']);
    expect(twitch.calls.refresh).toBe(1);
  });

  it('a dead refresh token surfaces as HelixError 401 (worker stops), without looping', async () => {
    const twitch = fakeTwitch();
    const auth = newAuth(twitch, memoryStore());
    await auth.init();
    twitch.revoke('at-1');
    twitch.setRefresh('rejected');
    const helix = helixFor(twitch, auth);
    await expect(
      helix.getChattersPage('100', '100', null),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      helix.getChattersPage('100', '100', null),
    ).rejects.toMatchObject({ status: 401 });
    expect(twitch.calls.refresh).toBe(1);
    expect(twitch.calls.helix).toEqual(['at-1']);
  });

  it('403 from Get Chatters (owner is not broadcaster nor mod) is not retried nor refreshed', async () => {
    const twitch = fakeTwitch();
    const auth = newAuth(twitch, memoryStore());
    await auth.init();
    const forbidden = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'user is not a moderator' }), {
          status: 403,
        }),
    );
    const helix = createHelix(
      {
        clientId: 'c',
        getAccessToken: () => auth.getAccessToken(),
        handleUnauthorized: (t) => auth.handleUnauthorized(t),
      },
      forbidden as unknown as typeof fetch,
    );
    const error = await helix
      .getChattersPage('100', '999', null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HelixError);
    expect(error).toMatchObject({ status: 403 });
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(twitch.calls.refresh).toBe(0);
  });
});

describe('token file store', () => {
  it('persists atomically (no temp file left) and round-trips the rotated refresh token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'raptoru-auth-'));
    const path = join(dir, '.twitch-tokens.json');
    const store = fileTokenStore(path);
    expect(await store.load()).toBeNull();

    const token: StoredToken = {
      accessToken: 'a',
      refreshToken: 'r1',
      scopes: ['s'],
      expiresAt: 1,
      userId: '1',
      login: 'x',
    };
    await store.save(token);
    await Promise.all([
      store.save({ ...token, refreshToken: 'r2' }),
      store.save({ ...token, refreshToken: 'r3' }),
    ]);

    expect(await readdir(dir)).toEqual(['.twitch-tokens.json']);
    const loaded = JSON.parse(await readFile(path, 'utf8')) as StoredToken;
    expect(['r2', 'r3']).toContain(loaded.refreshToken);
  });
});
