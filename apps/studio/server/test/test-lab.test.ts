import { mkdtemp, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createStudioServer } from '../src/index.js';
import { redact } from '../src/test-lab/local-env.js';
import { LogBuffer } from '../src/test-lab/log-buffer.js';
import { ManagedProcess, PidStore } from '../src/test-lab/managed-process.js';
import {
  botGuard,
  coreGuard,
  TestLab,
  type TestLabDeps,
} from '../src/test-lab/test-lab.js';

const SECRET = 'super-secret-bot-value-123';

function fakeProcess() {
  const p = {
    running: false,
    adopted: false,
    pid: null as number | null,
    lastExit: null as { code: number | null; at: string } | null,
    start: vi.fn((env: Record<string, string> = {}) => {
      void env;
      p.running = true;
      p.pid = 4242;
    }),
    stop: vi.fn(async () => {
      p.running = false;
      p.pid = null;
    }),
  };
  return p;
}

function fakeLab(
  overrides: Partial<{
    botEnv: Record<string, string>;
    preflightCode: number;
    pg: string;
    migrateCode: number;
  }> = {},
) {
  const calls: string[] = [];
  const core = fakeProcess();
  const bot = fakeProcess();
  // Health follows the fake Core process.
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith('/health')) {
      if (!core.running) throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify({ status: 'ok' }));
    }
    return new Response('{}', { status: 404 });
  });
  let pgState = overrides.pg ?? 'running';
  const deps: TestLabDeps = {
    docker: {
      containerState: vi.fn(async () => ({
        state: pgState as 'running',
        detail: pgState,
      })),
      startContainer: vi.fn(async () => {
        calls.push('docker start');
        pgState = 'running';
      }),
      stopContainer: vi.fn(async () => {
        calls.push('docker stop');
        pgState = 'stopped';
      }),
      postgresReady: vi.fn(async () => pgState === 'running'),
    },
    fetch: fetchImpl as typeof fetch,
    sleep: async () => {},
    runScript: vi.fn(async (_cwd: string, args: string[]) => {
      const script = args.at(-1)!;
      calls.push(
        script.includes('migrate')
          ? 'migrate'
          : script.includes('stream-reconcile')
            ? 'reconcile'
            : 'preflight',
      );
      if (script.includes('stream-reconcile')) {
        return {
          code: 0,
          lines: ['offline on Twitch: session closed (live=false)'],
        };
      }
      if (script.includes('migrate'))
        return { code: overrides.migrateCode ?? 0, lines: ['applied'] };
      return overrides.preflightCode
        ? {
            code: overrides.preflightCode,
            lines: ['FAIL: missing scope moderator:read:chatters'],
          }
        : {
            code: 0,
            lines: [
              `token owner: lecroupier_ (${SECRET})`,
              'OK: Get Chatters works (total reported: 6)',
            ],
          };
    }) as TestLabDeps['runScript'],
    core: core as unknown as TestLabDeps['core'],
    bot: bot as unknown as TestLabDeps['bot'],
    readCoreEnv: () => ({ PORT: '3000', STUDIO_SECRET: SECRET }),
    readBotEnv: () =>
      overrides.botEnv ?? {
        DAILY_CHAT_COMMANDS: 'false',
        PRESENCE_SHADOW: 'true',
        TWITCH_ENABLED: 'false',
      },
    readToken: () => ({
      present: true,
      login: 'lecroupier_',
      userId: '1',
      scopes: ['moderator:read:chatters'],
      expiresAt: null,
      hasRefreshToken: true,
    }),
    redact: (t) => redact(t, [SECRET]),
    logs: new LogBuffer((t) => redact(t, [SECRET])),
  };
  const lab = new TestLab(deps);
  core.start.mockImplementation(() => {
    calls.push('core start');
    core.running = true;
    core.pid = 1111;
  });
  bot.start.mockImplementation(() => {
    calls.push('bot start');
    bot.running = true;
    bot.pid = 2222;
    lab.onBotLine(
      '[twitch-bot] token ok for lecroupier_ (1239040922), expires … · presence shadow true',
      'stdout',
    );
  });
  core.stop.mockImplementation(async () => {
    calls.push('core stop');
    core.running = false;
  });
  bot.stop.mockImplementation(async () => {
    calls.push('bot stop');
    bot.running = false;
  });
  return { lab, deps, core, bot, calls };
}

describe('bot guard (shadow test preconditions)', () => {
  it('refuses DAILY_CHAT_COMMANDS=true and PRESENCE_SHADOW=false', () => {
    expect(
      botGuard({ DAILY_CHAT_COMMANDS: 'true', PRESENCE_SHADOW: 'true' }),
    ).toMatch(/DAILY_CHAT_COMMANDS/);
    expect(
      botGuard({ DAILY_CHAT_COMMANDS: 'false', PRESENCE_SHADOW: 'false' }),
    ).toMatch(/PRESENCE_SHADOW/);
    expect(
      botGuard({ LOYALTY_CHAT_COMMANDS: 'true', PRESENCE_SHADOW: 'true' }),
    ).toMatch(/LOYALTY_CHAT_COMMANDS/);
    expect(botGuard({ PRESENCE_SHADOW: 'true' })).toBeNull();
  });

  it('never starts the bot when the guard refuses', async () => {
    const { lab, bot } = fakeLab({
      botEnv: { DAILY_CHAT_COMMANDS: 'true', PRESENCE_SHADOW: 'true' },
    });
    await lab.startCore();
    expect(await lab.startBot()).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/DAILY_CHAT_COMMANDS/),
    });
    expect(bot.start).not.toHaveBeenCalled();
  });

  it('starts the bot with Twitch enabled for that child only, chat forced off', async () => {
    const { lab, bot } = fakeLab();
    await lab.startCore();
    expect(await lab.startBot()).toMatchObject({ ok: true });
    expect(bot.start).toHaveBeenCalledWith({
      TWITCH_ENABLED: 'true',
      DAILY_CHAT_COMMANDS: 'false',
      LOYALTY_CHAT_COMMANDS: 'false',
      PRESENCE_SHADOW: 'true',
    });
  });
});

describe('Start All / Stop All', () => {
  it('runs Postgres → migrations → Core → preflight → bot in order', async () => {
    const { lab, calls } = fakeLab({ pg: 'stopped' });
    const steps = await lab.startAll();
    expect(calls).toEqual([
      'docker start',
      'migrate',
      'core start',
      'preflight',
      'bot start',
    ]);
    expect(steps.map((s) => [s.step, s.ok])).toEqual([
      ['Postgres', true],
      ['Migrations', true],
      ['Core', true],
      ['Twitch Auth', true],
      ['Presence Shadow', true],
      ['Chat Commands OFF', true],
    ]);
  });

  it('stops at the failing step and never launches the next ones', async () => {
    const { lab, calls, bot } = fakeLab({ preflightCode: 1 });
    const steps = await lab.startAll();
    expect(steps.at(-1)).toMatchObject({
      step: 'Twitch Auth',
      ok: false,
      detail: expect.stringMatching(/FAIL/),
    });
    expect(bot.start).not.toHaveBeenCalled();
    expect(calls).not.toContain('bot start');

    const failedMigration = fakeLab({ migrateCode: 1 });
    await failedMigration.lab.startAll();
    expect(failedMigration.calls).toEqual(['migrate']);
  });

  it('reuses a Core already running outside the Studio instead of starting a second one', async () => {
    const { lab, core, deps } = fakeLab();
    core.running = false;
    (deps.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response(JSON.stringify({ status: 'ok' })),
    );
    expect(await lab.startCore()).toMatchObject({
      ok: true,
      detail: expect.stringMatching(/outside the Studio/),
    });
    expect(core.start).not.toHaveBeenCalled();
    expect(await lab.stopCore()).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/outside the Studio/),
    });
  });

  it('Stop All stops the bot then Core and leaves Postgres running', async () => {
    const { lab, calls } = fakeLab();
    await lab.startAll();
    calls.length = 0;
    await lab.stopAll();
    // The live state is reconciled with Twitch between the bot stop and the Core stop.
    expect(calls).toEqual(['bot stop', 'reconcile', 'core stop']);
    expect((await lab.status()).postgres.state).toBe('running');
  });

  it('one action at a time: a concurrent click is rejected, nothing starts twice', async () => {
    const { lab, core } = fakeLab();
    const [first, second] = await Promise.allSettled([
      lab.startAll(),
      lab.startCore(),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringMatching(/busy/),
      }),
    });
    expect(core.start).toHaveBeenCalledTimes(1);
  });

  it('refuses to stop Postgres while Core or the bot run', async () => {
    const { lab } = fakeLab();
    await lab.startCore();
    await expect(lab.stopPostgres()).rejects.toThrow(/first/);
  });
});

describe('secrets never reach logs or the UI', () => {
  it('redacts known secrets and bearer values', () => {
    const logs = new LogBuffer((t) => redact(t, [SECRET]), 3);
    logs.add(
      'bot',
      `using ${SECRET} and Authorization: Bearer abcdefghijklmnop123`,
    );
    for (let i = 0; i < 5; i++) logs.add('core', `line ${i}`);
    expect(logs.since().map((l) => l.text)).toEqual([
      'line 2',
      'line 3',
      'line 4',
    ]); // bounded
    const one = new LogBuffer((t) => redact(t, [SECRET]));
    one.add(
      'bot',
      `using ${SECRET} and Authorization: Bearer abcdefghijklmnop123`,
    );
    expect(one.since()[0]!.text).toBe(
      'using *** and Authorization: Bearer ***',
    );
  });

  it('status and preflight output contain no secret', async () => {
    const { lab } = fakeLab();
    await lab.startAll();
    const everything =
      JSON.stringify(await lab.status()) + JSON.stringify(lab.logs.since());
    expect(everything).not.toContain(SECRET);
    expect(everything).toContain('OK: Get Chatters works');
  });
});

describe('Studio HTTP API', () => {
  it('requires the Studio header and a loopback Host', async () => {
    const { lab } = fakeLab();
    const server = createStudioServer(lab, () => {});
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/api/test-lab/core/start`;
    // Port differs from 4100 here, so even a correct header is refused by the Host check.
    expect((await fetch(url, { method: 'POST' })).status).toBe(403);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { 'x-raptoru-studio': '1' },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    await new Promise((r) => server.close(r));
  });
});

describe('managed child processes (real node children)', () => {
  it('runs one child, refuses a duplicate, stops it and forgets its PID', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-pm-'));
    const pids = new PidStore(dir);
    const lines: string[] = [];
    const proc = new ManagedProcess({
      name: 'core',
      cwd: dir,
      args: ['-e', "console.log('ready'); setInterval(() => {}, 1000)"],
      pids,
      onLine: (l) => lines.push(l),
    });
    proc.start();
    expect(proc.running).toBe(true);
    expect(() => proc.start()).toThrow(/already running/);
    expect(
      JSON.parse(await readFile(join(dir, 'processes.json'), 'utf8')).core,
    ).toBe(proc.pid);

    await proc.stop();
    expect(proc.running).toBe(false);
    expect(pids.read().core).toBeUndefined();
  });

  it('adopts a child left by a crashed Studio and can stop it; ignores dead PIDs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-pm-'));
    const pids = new PidStore(dir);
    const first = new ManagedProcess({
      name: 'bot',
      cwd: dir,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      pids,
      onLine: () => {},
    });
    first.start();
    const orphanPid = first.pid!;

    // New Studio session, same PID file.
    const next = new ManagedProcess({
      name: 'bot',
      cwd: dir,
      args: [],
      pids,
      onLine: () => {},
    });
    expect(await next.adoptPrevious()).toBe(true);
    expect(next.pid).toBe(orphanPid);
    await next.stop();
    expect(next.running).toBe(false);

    pids.set('bot', 999_999);
    expect(await next.adoptPrevious()).toBe(false);
    expect(pids.read().bot).toBeUndefined();
  });
});

describe('loyalty credits guard', () => {
  it('refuses a Core configured with loyalty credits, and forces them off at start', async () => {
    expect(coreGuard({ LOYALTY_PASSIVE_CREDITS: 'true' })).toMatch(
      /LOYALTY_PASSIVE_CREDITS/,
    );
    expect(coreGuard({ LOYALTY_EVENT_CREDITS: 'true' })).toMatch(
      /LOYALTY_EVENT_CREDITS/,
    );
    expect(coreGuard({ LOYALTY_PREVIEW: 'true' })).toBeNull();

    const { lab, core } = fakeLab();
    await lab.startCore();
    expect(core.start).toHaveBeenCalledWith({
      LOYALTY_PASSIVE_CREDITS: 'false',
      LOYALTY_EVENT_CREDITS: 'false',
    });
    const status = await lab.status();
    expect(status.loyalty.flags).toEqual({
      LOYALTY_PREVIEW: 'false',
      LOYALTY_TWITCH_EVENTS: 'false',
      LOYALTY_PASSIVE_CREDITS: 'false',
      LOYALTY_EVENT_CREDITS: 'false',
    });
  });
});
