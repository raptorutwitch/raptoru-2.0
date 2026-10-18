import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fileTokenStore,
  TWITCH_TOKEN_URL,
  TWITCH_VALIDATE_URL,
  TwitchAuth,
  type StoredToken,
  type TokenStore,
} from '../src/twitch/auth.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    if (!dir.startsWith(join(tmpdir(), 'raptoru-oauth-safety-')))
      throw new Error('unsafe cleanup');
    await rm(dir, { recursive: true, force: true });
  }
});
const stored = (): StoredToken => ({
  accessToken: 'fixture-a1',
  refreshToken: 'fixture-r1',
  userId: '100',
  login: 'fixture',
  expiresAt: Date.now() + 3_600_000,
  scopes: ['user:read:chat'],
});
const validation = (extra: Record<string, unknown> = {}) => ({
  client_id: 'fixture-client',
  user_id: '100',
  login: 'fixture',
  scopes: ['user:read:chat'],
  expires_in: 3600,
  ...extra,
});
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers });

function service() {
  let issued = 1;
  let refreshStatus = 200;
  let retryAfter: string | null = '5';
  let nextInfo: Record<string, unknown> = {};
  let validationAfterRefreshStatus = 200;
  const refreshTokens: string[] = [];
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === TWITCH_TOKEN_URL) {
        const params = init?.body as URLSearchParams;
        refreshTokens.push(params.get('refresh_token')!);
        if (refreshStatus !== 200)
          return json(
            {},
            refreshStatus,
            retryAfter === null ? undefined : { 'retry-after': retryAfter },
          );
        issued++;
        return json({
          access_token: `fixture-a${issued}`,
          refresh_token: `fixture-r${issued}`,
          expires_in: 3600,
        });
      }
      if (String(input) !== TWITCH_VALIDATE_URL)
        throw new Error('unexpected network request');
      const access = (
        init?.headers as Record<string, string>
      ).authorization!.replace('OAuth ', '');
      if (access !== 'fixture-a1' && validationAfterRefreshStatus !== 200)
        return json({}, validationAfterRefreshStatus);
      return json(validation(access === 'fixture-a1' ? {} : nextInfo));
    },
  ) as typeof fetch;
  return {
    fetcher,
    refreshTokens,
    setRefreshStatus: (status: number) => {
      refreshStatus = status;
    },
    setRetryAfter: (value: string | null) => {
      retryAfter = value;
    },
    setNextInfo: (info: Record<string, unknown>) => {
      nextInfo = info;
    },
    setValidationStatus: (status: number) => {
      validationAfterRefreshStatus = status;
    },
  };
}

function memory(initial = stored()) {
  let token: StoredToken | null = initial;
  return {
    load: async () => token,
    save: vi.fn(async (next: StoredToken) => {
      token = next;
    }),
  } satisfies TokenStore;
}
function auth(
  store: TokenStore,
  fetcher: typeof fetch,
  now = Date.now,
  onFailure?: (code: string) => void,
) {
  return new TwitchAuth({
    clientId: 'fixture-client',
    clientSecret: 'fixture-secret',
    expectedUserId: '100',
    requiredScopes: ['user:read:chat'],
    store,
    fetch: fetcher,
    now,
    log: () => {},
    onFailure,
  });
}
async function file() {
  const dir = await mkdtemp(join(tmpdir(), 'raptoru-oauth-safety-'));
  dirs.push(dir);
  const path = join(dir, 'fixture-token.json');
  const store = fileTokenStore(path);
  await store.save(stored());
  return { dir, path, store };
}

describe('strict runtime token validation and refresh', () => {
  it.each([
    ['wrong_account', { user_id: '999' }],
    ['wrong_client', { client_id: 'other-client' }],
    ['not_user_token', { user_id: undefined, login: undefined }],
    ['missing_scopes', { scopes: [] }],
    ['invalid_token_info', { expires_in: 0 }],
  ])(
    'rejects a refreshed %s grant before using or saving it',
    async (code, info) => {
      const remote = service();
      const store = memory();
      const failure = vi.fn();
      const instance = auth(store, remote.fetcher, Date.now, failure);
      await instance.init();
      remote.setNextInfo(info);
      await expect(instance.refresh()).rejects.toMatchObject({ code });
      expect(store.save).not.toHaveBeenCalled();
      expect(instance.status()).toMatchObject({ state: 'failed' });
      await expect(instance.getAccessToken()).rejects.toMatchObject({ code });
      expect(failure).toHaveBeenCalledExactlyOnceWith(code);
    },
  );

  it('never reports or returns a never-validated token after a transient init failure', async () => {
    const fetcher = vi.fn(async () => json({}, 503)) as typeof fetch;
    const instance = auth(memory(), fetcher);
    await expect(instance.init()).rejects.toMatchObject({
      code: 'twitch_unavailable',
    });
    expect(instance.status()).toMatchObject({
      state: 'pending_validation',
      lastValidatedAt: null,
    });
    await expect(instance.getAccessToken()).rejects.toMatchObject({
      code: 'twitch_unavailable',
    });
  });

  it.each([
    ['7', 7000],
    [null, 5000],
  ] as const)(
    'respects refresh 429 Retry-After %s without another POST until the deadline',
    async (retryAfter, delay) => {
      const remote = service();
      let now = Date.now();
      const failure = vi.fn();
      const instance = auth(memory(), remote.fetcher, () => now, failure);
      await instance.init();
      remote.setRefreshStatus(429);
      remote.setRetryAfter(retryAfter);
      await expect(instance.refresh()).rejects.toMatchObject({
        code: 'twitch_unavailable',
      });
      remote.setRefreshStatus(200);
      now += delay - 1;
      await expect(instance.refresh()).rejects.toMatchObject({
        code: 'twitch_unavailable',
      });
      expect(remote.refreshTokens).toHaveLength(1);
      now += 1;
      expect((await instance.refresh()).accessToken).toBe('fixture-a2');
      expect(remote.refreshTokens).toHaveLength(2);
      expect(failure).not.toHaveBeenCalled();
    },
  );

  it('preserves a rotated refresh token through validation outage and a process restart', async () => {
    const remote = service();
    const { store } = await file();
    const first = auth(store, remote.fetcher);
    await first.init();
    remote.setValidationStatus(429);
    await expect(first.refresh()).rejects.toMatchObject({
      code: 'twitch_unavailable',
    });
    expect(first.status().state).toBe('pending_validation');
    expect(await store.load()).toMatchObject({
      accessToken: 'fixture-a1',
      refreshToken: 'fixture-r1',
      pendingRefreshToken: 'fixture-r2',
    });
    remote.setValidationStatus(200);
    const restarted = auth(store, remote.fetcher);
    await restarted.init();
    expect(remote.refreshTokens).toEqual(['fixture-r1', 'fixture-r2']);
    expect(await restarted.getAccessToken()).toBe('fixture-a3');
    expect((await store.load())?.pendingRefreshToken).toBeUndefined();
    expect(restarted.status().lastValidatedAt).not.toBeNull();
  });

  it('ignores an older validation GET completed after a refresh saved its rotated grant', async () => {
    const remote = service();
    const store = memory();
    const instance = auth(store, remote.fetcher);
    await instance.init();
    let release!: (value: Response) => void;
    const delayed = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const original = remote.fetcher as ReturnType<typeof vi.fn>;
    original.mockImplementationOnce(() => delayed);
    const oldValidation = instance.validate();
    await instance.refresh();
    release(json(validation()));
    await oldValidation;
    expect(await instance.getAccessToken()).toBe('fixture-a2');
    await instance.refresh();
    expect(remote.refreshTokens).toEqual(['fixture-r1', 'fixture-r2']);
  });
});

describe('cooperative token-file locking and compare-and-swap', () => {
  it('shares a refresh between independent instances and adopts the saved rotation', async () => {
    const remote = service();
    const { path, store, dir } = await file();
    const first = auth(store, remote.fetcher);
    const second = auth(fileTokenStore(path), remote.fetcher);
    await Promise.all([first.init(), second.init()]);
    const values = await Promise.all([first.refresh(), second.refresh()]);
    expect(values.map((token) => token.accessToken)).toEqual([
      'fixture-a2',
      'fixture-a2',
    ]);
    expect(remote.refreshTokens).toEqual(['fixture-r1']);
    expect(await readdir(dir)).toEqual(['fixture-token.json']);
  });

  it('prevents an old runtime from overwriting a newly authorized grant', async () => {
    const remote = service();
    const { store } = await file();
    const instance = auth(store, remote.fetcher);
    await instance.init();
    const before = await store.load();
    await store.save({
      ...stored(),
      accessToken: 'new-authorization-access',
      refreshToken: 'new-authorization-refresh',
      scopes: ['user:read:chat', 'user:write:chat'],
      revision: 'new-authorization',
    });
    const current = await store.load();
    await expect(store.saveIfCurrent!(before, stored())).rejects.toMatchObject({
      code: 'store_conflict',
    });
    await instance.refresh();
    expect(remote.refreshTokens).toEqual([]);
    expect(await store.load()).toEqual(current);
    expect(await instance.getAccessToken()).toBe('new-authorization-access');
  });

  it('does not overwrite missing or malformed files with an old in-memory grant', async () => {
    const remote = service();
    const { path, store } = await file();
    const instance = auth(store, remote.fetcher);
    await instance.init();
    await writeFile(path, '{broken-json');
    await expect(instance.refresh()).rejects.toMatchObject({
      code: 'invalid_store',
    });
    expect(await readFile(path, 'utf8')).toBe('{broken-json');
    expect(remote.refreshTokens).toEqual([]);
  });

  it('does not recreate a token file removed after init', async () => {
    const remote = service();
    const { path, store } = await file();
    const instance = auth(store, remote.fetcher);
    await instance.init();
    await rm(path);
    await expect(instance.refresh()).rejects.toMatchObject({
      code: 'store_conflict',
    });
    expect(await store.load()).toBeNull();
    expect(remote.refreshTokens).toEqual([]);
  });

  it('never evicts an abandoned lock even when two contenders see it together', async () => {
    const { path, store } = await file();
    const before = await store.load();
    await writeFile(`${path}.lock`, 'abandoned-fixture-lock');
    const stores = [
      fileTokenStore(path, { lockTimeoutMs: 1 }),
      fileTokenStore(path, { lockTimeoutMs: 1 }),
    ];
    const results = await Promise.allSettled(
      stores.map((candidate) => candidate.save(stored())),
    );
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    for (const result of results) {
      if (result.status !== 'rejected')
        throw new Error('unexpected lock acquisition');
      expect(result.reason).toMatchObject({ code: 'store_busy' });
    }
    expect(await store.load()).toEqual(before);
    expect(await readFile(`${path}.lock`, 'utf8')).toBe(
      'abandoned-fixture-lock',
    );
  });
});
