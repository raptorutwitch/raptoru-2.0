import { EventEmitter } from 'node:events';
import type {
  createServer,
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  TWITCH_OAUTH_PROFILES,
  hasTwitchScope,
  missingTwitchScopes,
  validateTwitchTokenInfo,
  type TwitchOAuthRole,
} from '@raptoru/schemas';
import { authorizationScopes, loadTwitchAppConfig } from '../src/config.js';
import {
  authorizationErrorEvent,
  runTwitchAuthorization,
  waitForAuthorizationCode,
  type TwitchAuthorizationEvent,
} from '../src/scripts/twitch-auth.js';
import {
  TWITCH_TOKEN_URL,
  type StoredToken,
  type TokenStore,
} from '../src/twitch/auth.js';

const config = (on = false) =>
  loadTwitchAppConfig({
    TWITCH_CLIENT_ID: 'fixture-client',
    TWITCH_CLIENT_SECRET: 'fixture-client-secret',
    TWITCH_BROADCASTER_ID: '83603689',
    DAILY_CHAT_COMMANDS: String(on),
    LOYALTY_CHAT_COMMANDS: String(on),
    LOYALTY_TWITCH_EVENTS: String(on),
    CHANNEL_POINTS_EVENTS: String(on),
    PRESENCE_SHADOW: String(on),
    LAB_CHAT_INGEST: String(on),
    LAB_CHAT_OUTPUT: String(on),
    LAB_ALERTS_FOLLOW: String(on),
    RANDOM_BAN: String(on),
  });
const info = (role: TwitchOAuthRole = 'bot') => ({
  client_id: 'fixture-client',
  user_id: TWITCH_OAUTH_PROFILES[role].expectedUserId,
  login: TWITCH_OAUTH_PROFILES[role].login,
  expires_in: 3600,
  scopes: [...TWITCH_OAUTH_PROFILES[role].scopes] as string[],
});

function memoryStore() {
  let current: StoredToken | null = null;
  const save = vi.fn(async (token: StoredToken) => {
    current = token;
  });
  return { load: async () => current, save } satisfies TokenStore;
}

async function authorize(
  role: TwitchOAuthRole,
  options: {
    on?: boolean;
    response?: unknown;
    deniedExchange?: boolean;
    changeWhileWaiting?: boolean;
  } = {},
) {
  const store = memoryStore();
  const events: TwitchAuthorizationEvent[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url) === TWITCH_TOKEN_URL)
      return new Response(
        JSON.stringify(
          options.deniedExchange
            ? { message: 'fixture-secret-value' }
            : {
                access_token: 'fixture-access',
                refresh_token: 'fixture-refresh',
                expires_in: 3600,
              },
        ),
        { status: options.deniedExchange ? 400 : 200 },
      );
    return new Response(JSON.stringify(options.response ?? info(role)));
  });
  const run = runTwitchAuthorization({
    role,
    config: config(options.on),
    store,
    fetch: fetcher as typeof fetch,
    emit: (event) => events.push(event),
    waitForCode: async ({ onListening }) => {
      onListening();
      if (options.changeWhileWaiting)
        await store.save({
          accessToken: 'other-access',
          refreshToken: 'other-refresh',
          expiresAt: 42,
          login: 'fixture',
          userId: '100',
          scopes: [],
        });
      return 'fixture-code';
    },
  });
  return {
    result: await run.then(() => null, authorizationErrorEvent),
    events,
    store,
    fetcher,
  };
}

describe('approved OAuth profiles and runtime capabilities', () => {
  it('keeps both six-scope profiles independent of every execution switch', async () => {
    for (const role of ['bot', 'broadcaster'] as const) {
      expect(authorizationScopes(role)).toHaveLength(6);
      const off = await authorize(role);
      const on = await authorize(role, { on: true });
      const url = (events: TwitchAuthorizationEvent[]) => {
        const event = events.find((event) => event.type === 'authorization');
        if (event?.type !== 'authorization')
          throw new Error('missing authorization event');
        return new URL(event.url);
      };
      expect(url(off.events).searchParams.get('scope')).toBe(
        authorizationScopes(role).join(' '),
      );
      expect(url(off.events).searchParams.get('scope')).toBe(
        url(on.events).searchParams.get('scope'),
      );
      expect(url(off.events).searchParams.get('force_verify')).toBe('true');
      expect(off.events.at(-1)).toEqual({ type: 'complete', role });
    }
  });

  it('accepts manage for a runtime read while preserving an explicit management requirement', () => {
    expect(
      hasTwitchScope(
        ['channel:manage:redemptions'],
        'channel:read:redemptions',
      ),
    ).toBe(true);
    expect(
      missingTwitchScopes(
        ['channel:manage:redemptions'],
        ['channel:read:redemptions'],
      ),
    ).toEqual([]);
    expect(
      missingTwitchScopes(
        ['channel:read:redemptions'],
        ['channel:manage:redemptions'],
      ),
    ).toEqual(['channel:manage:redemptions']);
    expect(
      validateTwitchTokenInfo(
        { ...info(), scopes: ['channel:manage:redemptions'] },
        {
          clientId: 'fixture-client',
          expectedUserId: TWITCH_OAUTH_PROFILES.bot.expectedUserId,
          requiredScopes: ['channel:read:redemptions'],
        },
      ).scopes,
    ).toEqual(['channel:manage:redemptions']);
  });

  it.each([
    ['wrong_account', { ...info(), user_id: '999' }],
    ['wrong_client', { ...info(), client_id: 'other-client' }],
    [
      'not_user_token',
      { client_id: 'fixture-client', expires_in: 3600, scopes: [] },
    ],
    ['missing_scopes', { ...info(), scopes: [] }],
    ['invalid_token_info', { ...info(), expires_in: 0 }],
  ])('rejects %s before saving anything', async (code, response) => {
    const out = await authorize('bot', { response });
    expect(out.result).toMatchObject({ type: 'error', code });
    expect(out.store.save).not.toHaveBeenCalled();
    expect(out.events.some((event) => event.type === 'complete')).toBe(false);
  });

  it('requires both requested redemption scopes at consent, rather than substituting manage for read', async () => {
    const response = info('broadcaster');
    response.scopes = response.scopes.filter(
      (scope) => scope !== 'channel:read:redemptions',
    );
    const out = await authorize('broadcaster', { response });
    expect(out.result).toMatchObject({ code: 'missing_scopes' });
    expect(out.store.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid code and never reflects upstream secrets in its error', async () => {
    const out = await authorize('bot', { deniedExchange: true });
    expect(out.result).toMatchObject({ code: 'exchange_failed' });
    expect(JSON.stringify(out.result)).not.toContain('fixture-secret-value');
    expect(out.store.save).not.toHaveBeenCalled();
  });

  it('refuses to replace a grant changed during the consent page', async () => {
    const out = await authorize('bot', { changeWhileWaiting: true });
    expect(out.result).toMatchObject({ code: 'store_conflict' });
    expect(out.store.save).toHaveBeenCalledTimes(1);
    expect((await out.store.load())?.accessToken).toBe('other-access');
  });

  it('sanitizes unrecognized errors', () => {
    expect(
      JSON.stringify(
        authorizationErrorEvent(new Error('Bearer fixture-secret-value')),
      ),
    ).not.toContain('fixture-secret-value');
  });

  it('refuses identical normalized token paths before any listener, exchange or write', async () => {
    const base = config();
    const store = memoryStore();
    const fetcher = vi.fn();
    const waitForCode = vi.fn();
    await expect(
      runTwitchAuthorization({
        role: 'broadcaster',
        config: {
          ...base,
          TWITCH_TOKEN_FILE: 'fixture/same.json',
          TWITCH_BROADCASTER_TOKEN_FILE: './fixture/../fixture/same.json',
        },
        store,
        fetch: fetcher as typeof fetch,
        waitForCode,
        emit: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'token_path_conflict' });
    expect(waitForCode).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });
});

function fakeListeners(options: { busy?: boolean; callback?: string } = {}) {
  const close = vi.fn();
  const handlers: RequestListener[] = [];
  const factory = vi.fn((handler: RequestListener) => {
    handlers.push(handler);
    const server = new EventEmitter() as EventEmitter & {
      listen: (...args: unknown[]) => void;
      close: typeof close;
      closeAllConnections: typeof close;
    };
    server.close = close;
    server.closeAllConnections = close;
    server.listen = (...args) =>
      queueMicrotask(() => {
        if (options.busy)
          server.emit(
            'error',
            Object.assign(new Error('fixture-secret'), { code: 'EADDRINUSE' }),
          );
        else (args.at(-1) as () => void)();
      });
    return server;
  }) as unknown as typeof createServer;
  const callback = () => {
    const response = { writeHead: vi.fn().mockReturnThis(), end: vi.fn() };
    handlers[0]!(
      {
        url: options.callback ?? '/callback?state=expected&code=fixture-code',
      } as IncomingMessage,
      response as unknown as ServerResponse,
    );
    return response;
  };
  return { factory, callback, close };
}

describe('loopback callback without a real listener', () => {
  it.each([
    ['state_mismatch', '/callback?state=wrong&code=fixture-code'],
    ['missing_code', '/callback?state=expected'],
    ['authorization_denied', '/callback?state=expected&error=denied'],
  ])('rejects %s and closes its fake listeners', async (code, callback) => {
    const listeners = fakeListeners({ callback });
    await expect(
      waitForAuthorizationCode({
        redirectUri: 'http://localhost:3789/callback',
        state: 'expected',
        timeoutMs: 1000,
        serverFactory: listeners.factory,
        onListening: listeners.callback,
      }),
    ).rejects.toMatchObject({ code });
    expect(listeners.close).toHaveBeenCalled();
  });

  it('rejects a busy port before emitting an authorization link', async () => {
    const listeners = fakeListeners({ busy: true });
    const onListening = vi.fn();
    await expect(
      waitForAuthorizationCode({
        redirectUri: 'http://localhost:3789/callback',
        state: 'expected',
        timeoutMs: 1000,
        serverFactory: listeners.factory,
        onListening,
      }),
    ).rejects.toMatchObject({ code: 'port_busy' });
    expect(onListening).not.toHaveBeenCalled();
    expect(listeners.close).toHaveBeenCalled();
  });

  it('returns a code only after a valid state and callback', async () => {
    const listeners = fakeListeners();
    await expect(
      waitForAuthorizationCode({
        redirectUri: 'http://localhost:3789/callback',
        state: 'expected',
        timeoutMs: 1000,
        serverFactory: listeners.factory,
        onListening: listeners.callback,
      }),
    ).resolves.toBe('fixture-code');
  });

  it('times out and closes a fake listener when consent never returns', async () => {
    const listeners = fakeListeners();
    await expect(
      waitForAuthorizationCode({
        redirectUri: 'http://localhost:3789/callback',
        state: 'expected',
        timeoutMs: 1,
        serverFactory: listeners.factory,
        onListening: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(listeners.close).toHaveBeenCalled();
  });
});
