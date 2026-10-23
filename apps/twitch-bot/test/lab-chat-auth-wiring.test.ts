import { afterEach, describe, expect, it, vi } from 'vitest';
import { TWITCH_OAUTH_PROFILES } from '@raptoru/schemas';
import { TOKEN_VALIDATION_INTERVAL_MS } from '../src/twitch/auth-supervision.js';
import type { TwitchAuthOptions, AuthStatus } from '../src/twitch/auth.js';
import type { EventSubHandlers } from '../src/twitch/eventsub.js';

const mockedModules = [
  '../src/config.js',
  '../src/twitch/auth.js',
  '../src/twitch/helix.js',
  '../src/twitch/eventsub.js',
  '../src/lab-chat-ingest.js',
  '../src/lab-chat-output.js',
  '../src/random-ban-executor.js',
  '../src/caution-executor.js',
  '../src/votekick-executor.js',
  '../src/runtime.js',
];

afterEach(() => {
  for (const path of mockedModules) vi.doUnmock(path);
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function boot(
  broadcasterScopes: string[],
  botScopes = ['user:read:chat'],
  options: {
    invalidBroadcaster?: boolean;
    main?: boolean;
    randomBan?: 'true' | 'false';
    points?: 'true' | 'false';
  } = {},
) {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubEnv('LAB_CHAT_CORE_URL', 'http://127.0.0.1:4301');
  vi.stubEnv('LAB_CHAT_SECRET', 'local-mocked-secret-for-tests-only-00000000');
  vi.stubEnv('TWITCH_ENABLED', 'true');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'on').mockImplementation(() => process);
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process stopped');
  });
  // The main bot first asks the Core for the single-instance lease (granted here), then everything else.
  const requests = vi.fn(async (url: string | URL) =>
    String(url).endsWith('/v1/bot/instance/lease')
      ? Response.json({
          granted: true,
          holder: {
            instanceId: 'pc-test',
            host: 'pc',
            since: '2026-10-21T10:00:00.000Z',
            expiresAt: '2026-10-21T10:00:45.000Z',
          },
          ttlSeconds: 45,
          renewSeconds: 15,
        })
      : Response.json({ outcome: 'ignored' }),
  );
  vi.stubGlobal('fetch', requests);

  const config = {
    TWITCH_CLIENT_ID: 'mock-client',
    TWITCH_CLIENT_SECRET: 'mock-secret',
    TWITCH_TOKEN_FILE: 'mock-bot',
    TWITCH_BROADCASTER_TOKEN_FILE: 'mock-broadcaster',
    TWITCH_BROADCASTER_ID: TWITCH_OAUTH_PROFILES.broadcaster.expectedUserId,
    LAB_CHAT_JOURNAL_FILE: 'mock-output',
    LAB_RANDOM_BAN_JOURNAL_FILE: 'mock-rb',
  };
  vi.doMock('../src/config.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/config.js')>()),
    loadTwitchAppConfig: () => config,
    loadConfig: () => ({
      ...config,
      DAILY_CHAT_COMMANDS: 'true',
      LOYALTY_CHAT_COMMANDS: 'false',
      PRESENCE_SHADOW: 'false',
      LAB_CHAT_INGEST: 'true',
      LAB_CHAT_OUTPUT: 'true',
      LAB_ALERTS_FOLLOW: 'true',
      RANDOM_BAN: options.randomBan ?? 'true',
      RANDOM_BAN_JOURNAL_FILE: 'mock-main-rb',
      LOYALTY_TWITCH_EVENTS: 'false',
      CHANNEL_POINTS_EVENTS: options.points ?? 'true',
      CORE_API_URL: 'http://127.0.0.1:4301',
      BOT_SECRET: 'mock-bot-secret',
      STREAM_SYNC_INTERVAL_MS: 60_000,
      BOT_HOST: 'pc',
    }),
  }));

  const accounts: {
    options: TwitchAuthOptions;
    validate: ReturnType<typeof vi.fn<() => Promise<void>>>;
    status: AuthStatus;
  }[] = [];
  vi.doMock('../src/twitch/auth.js', () => ({
    fileTokenStore: () => ({
      load: async () => ({ scopes: broadcasterScopes }),
    }),
    TwitchAuth: class {
      account: (typeof accounts)[number];
      constructor(options: TwitchAuthOptions) {
        const profile =
          options.expectedUserId === TWITCH_OAUTH_PROFILES.bot.expectedUserId
            ? 'bot'
            : 'broadcaster';
        this.account = {
          options,
          validate: vi.fn(async () => {}),
          status: {
            state: 'ready',
            userId: options.expectedUserId,
            login: TWITCH_OAUTH_PROFILES[profile].login,
            scopes: profile === 'bot' ? botScopes : broadcasterScopes,
            expiresAt: '2026-11-01T00:00:00Z',
            hasRefreshToken: true,
            lastRefreshAt: null,
            lastValidatedAt: null,
            error: null,
          },
        };
        accounts.push(this.account);
      }
      async init() {
        if (
          options.invalidBroadcaster &&
          this.account.status.userId ===
            TWITCH_OAUTH_PROFILES.broadcaster.expectedUserId
        ) {
          this.account.options.onFailure?.('refresh_rejected');
          throw new Error('mock broadcaster refresh rejected');
        }
        return this.account.status;
      }
      status() {
        return this.account.status;
      }
      validate() {
        return this.account.validate();
      }
      getAccessToken() {
        throw new Error('unmocked token read');
      }
      handleUnauthorized() {
        throw new Error('unmocked refresh');
      }
    },
  }));
  const helix = {
    subscribe: vi.fn(async () => {}),
    getStream: vi.fn(async () => null),
    getCustomRewards: vi.fn(async () => []),
  };
  vi.doMock('../src/twitch/helix.js', () => ({ createHelix: () => helix }));
  const sockets: {
    handlers: EventSubHandlers;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.doMock('../src/twitch/eventsub.js', () => ({
    runEventSub: (handlers: EventSubHandlers) => {
      const client = { handlers, stop: vi.fn(), connected: () => true };
      sockets.push(client);
      return client;
    },
  }));
  const ingest = {
    handlers: {
      subscribe: vi.fn(async () => {}),
      notification: vi.fn(async () => {}),
    },
    syncStream: vi.fn(async () => {}),
    reconcileStream: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const runtime = {
    eventSub: ingest.handlers,
    streams: { sync: vi.fn(async () => {}) },
    presence: { stop: vi.fn() },
  };
  vi.doMock('../src/runtime.js', () => ({ createBotRuntime: () => runtime }));
  vi.doMock('../src/lab-chat-ingest.js', () => ({
    createLabChatIngest: () => ingest,
    transient: () => false,
  }));
  const output = { run: vi.fn(async () => {}), stop: vi.fn() };
  vi.doMock('../src/lab-chat-output.js', () => ({
    createLabChatOutput: () => output,
    createRateLimiter: vi.fn(),
    fileJournal: vi.fn(),
  }));
  const randomBan = {
    ready: { canSearch: true, canTimeout: false, missing: [] },
    run: vi.fn(async () => {}),
    stop: vi.fn(),
  };
  const createRandomBanExecutor = vi.fn((deps: unknown) => {
    void deps;
    return randomBan;
  });
  vi.doMock('../src/random-ban-executor.js', () => ({
    createRandomBanExecutor,
    fileRbJournal: vi.fn(),
    helixRbTwitch: vi.fn(() => ({})),
    RB_SCOPES: {
      broadcaster: ['moderation:read', 'channel:read:subscriptions'],
    },
  }));
  // Caution's executor polls Core like Random Ban's (to report its rights): isolated the same way.
  const caution = {
    ready: { canRead: false, canRelease: false, missing: [] },
    run: vi.fn(async () => {}),
    stop: vi.fn(),
  };
  const createCautionExecutor = vi.fn((deps: unknown) => {
    void deps;
    return caution;
  });
  vi.doMock('../src/caution-executor.js', () => ({
    createCautionExecutor,
    fileCautionJournal: vi.fn(),
    helixCautionTwitch: vi.fn(() => ({})),
  }));
  // Votekick's executor polls Core the same way: isolated too.
  const createVotekickExecutor = vi.fn((deps: unknown) => {
    void deps;
    return {
      ready: { canRead: false, canTimeout: false, missing: [] },
      run: vi.fn(async () => {}),
      stop: vi.fn(),
    };
  });
  vi.doMock('../src/votekick-executor.js', () => ({
    createVotekickExecutor,
    helixVotekickTwitch: vi.fn(() => ({})),
  }));
  if (options.main) await import('../src/index.js');
  else await import('../src/lab-chat-main.js');
  return {
    accounts,
    sockets,
    helix,
    requests,
    createRandomBanExecutor,
    createCautionExecutor,
    ingest,
    output,
    randomBan,
    runtime,
  };
}

describe('Bot account and capability wiring (no real Twitch or token files)', () => {
  it('pins each identity, accepts manage-only points, and validates both accounts hourly', async () => {
    const s = await boot(['channel:manage:redemptions']);
    expect(s.accounts.map((a) => a.options.expectedUserId)).toEqual([
      TWITCH_OAUTH_PROFILES.bot.expectedUserId,
      TWITCH_OAUTH_PROFILES.broadcaster.expectedUserId,
    ]);
    expect(s.accounts[0]!.options.requiredScopes).toEqual(['user:read:chat']);
    expect(s.accounts[1]!.options.requiredScopes).toEqual([
      'channel:read:redemptions',
    ]);
    expect(s.sockets).toHaveLength(2);
    await s.sockets[1]!.handlers.subscribe('broadcaster-session');
    expect(s.helix.subscribe).toHaveBeenCalledWith(
      'channel.channel_points_custom_reward_redemption.add',
      { broadcaster_user_id: TWITCH_OAUTH_PROFILES.broadcaster.expectedUserId },
      'broadcaster-session',
      '1',
    );
    await vi.advanceTimersByTimeAsync(TOKEN_VALIDATION_INTERVAL_MS);
    expect(s.accounts.every((a) => a.validate.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it('provides broadcaster reads to Random Ban without requiring any Points de chaîne permission or socket', async () => {
    const s = await boot(['moderation:read', 'channel:read:subscriptions']);
    expect(s.sockets).toHaveLength(1);
    expect(s.accounts[1]!.options.requiredScopes).toEqual([
      'moderation:read',
      'channel:read:subscriptions',
    ]);
    expect(s.createRandomBanExecutor.mock.calls[0]![0]).toMatchObject({
      broadcasterScopes: ['moderation:read', 'channel:read:subscriptions'],
    });
    await vi.advanceTimersByTimeAsync(TOKEN_VALIDATION_INTERVAL_MS);
    expect(s.accounts[1]!.validate).toHaveBeenCalledTimes(1);
  });

  it('keeps chat ingestion available when no broadcaster module has usable scopes', async () => {
    const s = await boot([]);
    expect(s.accounts).toHaveLength(1);
    expect(s.sockets).toHaveLength(1);
    expect(s.createRandomBanExecutor.mock.calls[0]![0]).toMatchObject({
      broadcasterScopes: null,
    });
    // The Lab adapter always runs Caution's executor; without the broadcaster token it says it cannot read.
    expect(s.createCautionExecutor.mock.calls[0]![0]).toMatchObject({
      broadcasterScopes: null,
    });
    expect(s.requests).not.toHaveBeenCalled();
  });

  it('an invalid broadcaster at Lab startup leaves chat running and Random Ban unavailable', async () => {
    const s = await boot(
      [
        'channel:manage:redemptions',
        'moderation:read',
        'channel:read:subscriptions',
      ],
      undefined,
      { invalidBroadcaster: true },
    );
    expect(s.sockets).toHaveLength(1);
    expect(s.sockets[0]!.stop).not.toHaveBeenCalled();
    expect(s.ingest.close).not.toHaveBeenCalled();
    expect(s.createRandomBanExecutor.mock.calls[0]![0]).toMatchObject({
      broadcasterScopes: null,
    });
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('the main bot only requires its running modules and also supervises manage-only broadcaster access', async () => {
    const s = await boot(
      ['channel:manage:redemptions'],
      ['user:read:chat', 'user:write:chat'],
      { main: true },
    );
    expect(s.accounts[0]!.options.requiredScopes).toEqual([
      'user:read:chat',
      'user:write:chat',
    ]);
    expect(s.accounts[1]!.options.requiredScopes).toEqual([
      'channel:read:redemptions',
    ]);
    expect(s.sockets).toHaveLength(2);
    // RANDOM_BAN=true: the Lab executor, on the main Core's bot routes, with the broadcaster's reads.
    expect(s.createRandomBanExecutor).toHaveBeenCalledTimes(1);
    expect(s.createRandomBanExecutor.mock.calls[0]![0]).toMatchObject({
      base: '/v1/bot/random-ban',
      channelId: TWITCH_OAUTH_PROFILES.broadcaster.expectedUserId,
      executorId: `bot-${TWITCH_OAUTH_PROFILES.bot.expectedUserId}`,
      broadcasterScopes: ['channel:manage:redemptions'],
    });
    expect(s.randomBan.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TOKEN_VALIDATION_INTERVAL_MS);
    expect(s.accounts.every((a) => a.validate.mock.calls.length === 1)).toBe(
      true,
    );
    // The main bot frees its single-instance lease before exiting: consumers stop at once, exit 78 after the release.
    vi.mocked(process.exit).mockImplementation(() => undefined as never);
    s.accounts[1]!.options.onFailure!('wrong_account');
    expect(
      s.sockets.every((socket) => socket.stop.mock.calls.length === 1),
    ).toBe(true);
    expect(s.runtime.presence.stop).toHaveBeenCalledTimes(1);
    expect(s.randomBan.stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(
      s.requests.mock.calls.some((c) =>
        String(c[0]).endsWith('/v1/bot/instance/release'),
      ),
    ).toBe(true);
    expect(process.exit).toHaveBeenCalledWith(78);
  });

  it('the main bot names its instance on every Core call and stays up while its lease is renewed', async () => {
    const s = await boot(
      ['channel:manage:redemptions'],
      ['user:read:chat', 'user:write:chat'],
      { main: true },
    );
    await vi.advanceTimersByTimeAsync(5 * 60_000); // 20 renewals, every one granted
    expect(process.exit).not.toHaveBeenCalled();
    const calls = s.requests.mock.calls as unknown as [
      string | URL,
      RequestInit,
    ][];
    const core = calls.filter(([url]) =>
      String(url).startsWith('http://127.0.0.1:4301/v1/bot/'),
    );
    expect(
      core.filter(([url]) => String(url).endsWith('/v1/bot/instance/lease'))
        .length,
    ).toBeGreaterThan(15);
    expect(core.length).toBeGreaterThan(0);
    for (const [, init] of core)
      expect(
        (init.headers as Record<string, string>)['x-raptoru-bot-instance'],
      ).toMatch(/^pc-/);
  });

  it('Core unreachable for longer than the fence: the main bot stops everything itself (exit 75) before its lease can be given away', async () => {
    const s = await boot(
      ['channel:manage:redemptions'],
      ['user:read:chat', 'user:write:chat'],
      { main: true },
    );
    vi.mocked(process.exit).mockImplementation(() => undefined as never);
    s.requests.mockImplementation(async () => {
      throw new Error('network down');
    });
    await vi.advanceTimersByTimeAsync(34_000);
    expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000); // 36 s after the last granted request, < 45 s
    expect(process.exit).toHaveBeenCalledWith(75);
    expect(
      s.sockets.every((socket) => socket.stop.mock.calls.length === 1),
    ).toBe(true);
    expect(s.runtime.presence.stop).toHaveBeenCalledTimes(1);
    expect(s.randomBan.stop).toHaveBeenCalledTimes(1);
    // Fenced, not released: the lease is not provably its own any more.
    expect(
      s.requests.mock.calls.some((c) =>
        String(c[0]).endsWith('/v1/bot/instance/release'),
      ),
    ).toBe(false);
  });

  it('an invalid broadcaster at main bot startup leaves chat and presence running', async () => {
    const s = await boot(
      ['channel:manage:redemptions'],
      ['user:read:chat', 'user:write:chat'],
      { invalidBroadcaster: true, main: true },
    );
    expect(s.sockets).toHaveLength(1);
    expect(s.sockets[0]!.stop).not.toHaveBeenCalled();
    expect(s.runtime.presence.stop).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
    // Random Ban stays available to Core, which refuses its searches (no broadcaster reads).
    expect(s.createRandomBanExecutor.mock.calls[0]![0]).toMatchObject({
      broadcasterScopes: null,
    });
  });

  it('the main bot with RANDOM_BAN=false runs no executor and opens no broadcaster connection for it', async () => {
    const s = await boot([], ['user:read:chat'], {
      main: true,
      randomBan: 'false',
    });
    expect(s.createRandomBanExecutor).not.toHaveBeenCalled();
    // CAUTION unset (OFF by default: SAMMI still answers !caution): no Caution executor either.
    expect(s.createCautionExecutor).not.toHaveBeenCalled();
  });

  it('the main bot with Random Ban alone: broadcaster reads, no broadcaster EventSub socket', async () => {
    const s = await boot(
      ['moderation:read', 'channel:read:subscriptions'],
      ['user:read:chat'],
      { main: true, points: 'false' },
    );
    expect(s.sockets).toHaveLength(1);
    expect(s.createRandomBanExecutor.mock.calls[0]![0]).toMatchObject({
      base: '/v1/bot/random-ban',
      broadcasterScopes: ['moderation:read', 'channel:read:subscriptions'],
    });
  });

  it('a durable broadcaster failure closes both consumers and optional executors', async () => {
    const s = await boot(
      ['channel:manage:redemptions'],
      ['user:read:chat', 'user:write:chat'],
    );
    expect(() => s.accounts[1]!.options.onFailure!('missing_scopes')).toThrow(
      'process stopped',
    );
    expect(
      s.sockets.every((socket) => socket.stop.mock.calls.length === 1),
    ).toBe(true);
    expect(s.ingest.close).toHaveBeenCalledTimes(1);
    expect(s.output.stop).toHaveBeenCalledTimes(1);
    expect(s.randomBan.stop).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(78);
  });
});
