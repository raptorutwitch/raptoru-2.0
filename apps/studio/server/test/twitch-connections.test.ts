import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TWITCH_OAUTH_PROFILES } from '@raptoru/schemas';
import {
  createTwitchConnections,
  type TwitchConnectionsDeps,
} from '../src/twitch-oauth/twitch-connections.js';

const temporary: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
  event(value: unknown) {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'studio-oauth-test-'));
  temporary.push(dir);
  await mkdir(join(dir, 'dist', 'scripts'), { recursive: true });
  await writeFile(
    join(dir, 'dist', 'scripts', 'twitch-auth.js'),
    '// mock, never executed',
  );
  const file = join(dir, 'bot.json');
  const token = {
    accessToken: 'fake-access-for-tests',
    refreshToken: 'fake-refresh-for-tests',
    userId: TWITCH_OAUTH_PROFILES.bot.expectedUserId,
    login: 'lecroupier_',
    scopes: [...TWITCH_OAUTH_PROFILES.bot.scopes],
    expiresAt: Date.now() + 3600_000,
  };
  await writeFile(file, JSON.stringify(token));
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          client_id: 'test-client',
          user_id: token.userId,
          login: token.login,
          scopes: token.scopes,
          expires_in: 3600,
        }),
      ),
  );
  const child = new FakeChild();
  const spawn = vi.fn(
    (...args: Parameters<NonNullable<TwitchConnectionsDeps['spawn']>>) => {
      void args;
      return child as unknown as ChildProcess;
    },
  );
  const canAuthorize = vi.fn((): { ok: boolean; reason?: string } => ({
    ok: true,
  }));
  const deps: TwitchConnectionsDeps = {
    clientId: 'test-client',
    tokenFiles: { bot: file, broadcaster: join(dir, 'broadcaster.json') },
    botDir: dir,
    envFile: join(dir, 'mock.env'),
    fetch: fetchMock as typeof fetch,
    spawn,
    canAuthorize,
    env: {},
  };
  return {
    dir,
    file,
    token,
    fetchMock,
    child,
    spawn,
    canAuthorize,
    deps,
    service: createTwitchConnections(deps),
  };
}

function request(
  method: string,
  role?: string,
  header = true,
): IncomingMessage {
  const req = Readable.from([JSON.stringify({ role })]) as IncomingMessage;
  req.method = method;
  req.headers = header ? { 'x-raptoru-studio': '1' } : {};
  return req;
}

function response() {
  let status = 0;
  let body: unknown;
  const res = {
    writeHead(code: number) {
      status = code;
    },
    end(text: string) {
      body = JSON.parse(text);
    },
  } as unknown as ServerResponse;
  return { res, result: () => ({ status, body }) };
}

describe('Studio Twitch connections: passive diagnostics and explicit operations only', () => {
  it('starts NON VÉRIFIÉ with a future expiry and never validates, refreshes or spawns on status', async () => {
    const f = await fixture();
    const status = f.service.status();
    expect(status.accounts[0]?.state).toBe('unverified');
    expect(status.accounts[0]?.validated_at).toBeNull();
    expect(status.roles_checked).toBe(false);
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.spawn).not.toHaveBeenCalled();
    expect(JSON.stringify(status)).not.toContain(f.token.accessToken);
    expect(JSON.stringify(status)).not.toContain(f.token.refreshToken);
  });

  it('explicit verification calls GET /validate only and never changes the token file', async () => {
    const f = await fixture();
    const before = await readFile(f.file, 'utf8');
    await f.service.verify('bot');
    expect(f.fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://id.twitch.tv/oauth2/validate',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(await readFile(f.file, 'utf8')).toBe(before);
    expect(f.service.status().accounts[0]).toMatchObject({
      state: 'ready',
      validated: { user_id: f.token.userId },
      missing_scopes: [],
    });
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it.each([
    [{ client_id: 'other-app' }, 'wrong_client'],
    [{ user_id: '999' }, 'wrong_account'],
    [{ user_id: undefined, login: undefined }, 'not_user_token'],
    [{ scopes: ['user:read:chat'] }, 'missing_scopes'],
  ])(
    'reports client, identity, token type and missing scopes without upstream values: %s',
    async (change, code) => {
      const f = await fixture();
      f.fetchMock.mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              client_id: 'test-client',
              user_id: f.token.userId,
              login: 'lecroupier_',
              expires_in: 3600,
              scopes: f.token.scopes,
              ...change,
            }),
          ),
      );
      await f.service.verify('bot');
      expect(f.service.status().accounts[0]?.state).toBe(code);
    },
  );

  it('marks an expired/rejected token without trying POST /token, retaining the file', async () => {
    const f = await fixture();
    await writeFile(
      f.file,
      JSON.stringify({ ...f.token, expiresAt: Date.now() - 1000 }),
    );
    expect(f.service.status().accounts[0]).toMatchObject({
      state: 'unverified',
      stored_expired: true,
    });
    f.fetchMock.mockImplementationOnce(
      async () => new Response('not exposed', { status: 401 }),
    );
    await f.service.verify('bot');
    expect(f.service.status().accounts[0]?.state).toBe('invalid_token');
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(f.file, 'utf8')).refreshToken).toBe(
      f.token.refreshToken,
    );
  });

  it('reports a network failure safely and does not retry from subsequent GET status', async () => {
    const f = await fixture();
    f.fetchMock.mockRejectedValueOnce(new Error(f.token.accessToken));
    await f.service.verify('bot');
    const status = f.service.status();
    expect(status.accounts[0]?.state).toBe('twitch_unavailable');
    expect(JSON.stringify(status)).not.toContain(f.token.accessToken);
    f.service.status();
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates validation when any token file content changes', async () => {
    const f = await fixture();
    await f.service.verify('bot');
    await writeFile(
      f.file,
      JSON.stringify({ ...f.token, accessToken: 'fake-replacement-access' }),
    );
    expect(f.service.status().accounts[0]).toMatchObject({
      state: 'unverified',
      validated_at: null,
      validated: null,
    });
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains the last successful validation while clearly reporting a later transient failure', async () => {
    const f = await fixture();
    let now = Date.now();
    const service = createTwitchConnections({ ...f.deps, now: () => now });
    await service.verify('bot');
    const validatedAt = service.status().accounts[0]!.validated_at;
    now += 60_000;
    f.fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await service.verify('bot');
    expect(service.status().accounts[0]).toMatchObject({
      state: 'twitch_unavailable',
      validated_at: validatedAt,
      checked_at: new Date(now).toISOString(),
      validated: { user_id: f.token.userId },
    });
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('distinguishes the exact six-scope consent profile from redemption read capability', async () => {
    const f = await fixture();
    const profile = TWITCH_OAUTH_PROFILES.broadcaster;
    const scopes = profile.scopes.filter(
      (scope) => scope !== 'channel:read:redemptions',
    );
    await writeFile(
      f.deps.tokenFiles.broadcaster,
      JSON.stringify({
        ...f.token,
        userId: profile.expectedUserId,
        login: profile.login,
        scopes,
      }),
    );
    f.fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          client_id: 'test-client',
          user_id: profile.expectedUserId,
          login: profile.login,
          scopes,
          expires_in: 3600,
        }),
      ),
    );
    await f.service.verify('broadcaster');
    const account = f.service.status().accounts[1]!;
    expect(account.state).toBe('missing_scopes');
    expect(account.missing_scopes).toEqual(['channel:read:redemptions']);
    expect(
      account.features.find(
        (feature) => feature.scope === 'channel:read:redemptions',
      )?.scope_present,
    ).toBe(true);
  });

  it('never calls an interrupted rotation ready just because the previous access token still validates', async () => {
    const f = await fixture();
    const pendingRefreshToken = 'fake-pending-refresh-only-for-tests';
    await writeFile(
      f.file,
      JSON.stringify({ ...f.token, pendingRefreshToken }),
    );
    const before = await readFile(f.file, 'utf8');
    await f.service.verify('bot');
    const status = f.service.status();
    expect(status.accounts[0]?.state).toBe('pending_validation');
    expect(JSON.stringify(status)).not.toContain(pendingRefreshToken);
    expect(await readFile(f.file, 'utf8')).toBe(before);
    expect(f.fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://id.twitch.tv/oauth2/validate',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('spawns OAuth only for an explicit protected POST, then returns a safe clickable URL', async () => {
    const f = await fixture();
    const out = response();
    await f.service.handle(
      request('POST', 'bot'),
      out.res,
      new URL('http://localhost/api/twitch-connections/authorize'),
    );
    expect(out.result().status).toBe(200);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.spawn.mock.calls[0]?.[1]).toContain('--studio');
    expect(f.service.authorizing).toBe(true);
    f.child.event({
      type: 'authorization',
      role: 'bot',
      url: 'https://id.twitch.tv/oauth2/authorize?client_id=test-client&scope=user%3Aread%3Achat&state=mock',
    });
    expect(f.service.status().flow).toMatchObject({
      state: 'waiting',
      role: 'bot',
    });
    expect(f.fetchMock).not.toHaveBeenCalled();
    f.child.event({ type: 'complete', role: 'bot' });
    expect(f.service.status().flow?.state).toBe('complete');
    expect(f.service.authorizing).toBe(true);
    f.child.emit('close', 0);
    expect(f.service.authorizing).toBe(false);
    await vi.waitFor(() =>
      expect(f.service.status().accounts[0]?.state).toBe('ready'),
    );
    expect(f.fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://id.twitch.tv/oauth2/validate',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('blocks active consumers, a concurrent OAuth and verification during OAuth', async () => {
    const f = await fixture();
    f.canAuthorize.mockReturnValueOnce({ ok: false, reason: 'stop consumers' });
    expect(() => f.service.authorize('bot')).toThrow('consumers_active');
    expect(f.spawn).not.toHaveBeenCalled();
    f.service.authorize('bot');
    expect(() => f.service.authorize('broadcaster')).toThrow('busy');
    await expect(f.service.verify('bot')).rejects.toThrow('busy');
    f.service.cancel();
    expect(f.child.kill).toHaveBeenCalled();
    expect(f.service.authorizing).toBe(true);
    expect(f.service.status().flow?.state).toBe('cancelled');
    f.child.emit('close', 0);
    expect(f.service.authorizing).toBe(false);
  });

  it('refuses a shared token file for the two roles without spawning or changing the file', async () => {
    const f = await fixture();
    const before = await readFile(f.file, 'utf8');
    const service = createTwitchConnections({
      ...f.deps,
      tokenFiles: { bot: f.file, broadcaster: f.file },
    });
    expect(service.status()).toMatchObject({ authorization_allowed: false });
    expect(service.status().authorization_blocked_reason).toContain(
      'distincts',
    );
    expect(() => service.authorize('bot')).toThrow('token_path_conflict');
    expect(f.spawn).not.toHaveBeenCalled();
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });

  it('rejects hostile authorization URLs and never exposes stderr / raw CLI errors', async () => {
    const f = await fixture();
    f.service.authorize('bot');
    f.child.stderr.write(f.token.accessToken);
    f.child.event({
      type: 'authorization',
      role: 'bot',
      url: 'https://evil.example/oauth2/authorize?client_id=test-client',
    });
    expect(f.service.status().flow).toEqual({
      role: 'bot',
      state: 'error',
      code: 'invalid_cli_response',
    });
    expect(JSON.stringify(f.service.status())).not.toContain(
      f.token.accessToken,
    );
    f.child.emit('close', 1);
  });

  it('expires pending authorization and remains locked until the child closes', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    f.service.authorize('broadcaster');
    expect(f.spawn.mock.calls[0]?.[1]).toContain('--broadcaster');
    vi.advanceTimersByTime(11 * 60_000);
    expect(f.service.status().flow?.state).toBe('expired');
    expect(f.service.authorizing).toBe(true);
    f.child.emit('close', 1);
  });

  it('rejects missing CSRF headers and invalid roles without starting OAuth or making Twitch calls', async () => {
    const f = await fixture();
    for (const [header, role, expected] of [
      [false, 'bot', 403],
      [true, 'other', 400],
    ] as const) {
      const out = response();
      await f.service.handle(
        request('POST', role, header),
        out.res,
        new URL('http://localhost/api/twitch-connections/authorize'),
      );
      expect(out.result().status).toBe(expected);
    }
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
});
