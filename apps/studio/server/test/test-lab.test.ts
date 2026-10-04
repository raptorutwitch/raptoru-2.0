import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { crashLine, createStudioServer, stopAll } from '../src/index.js';
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

  it('refuses to stop Postgres under the Studio runtime Lab Core; allowed once nothing uses it', async () => {
    const { lab, deps, calls } = fakeLab();
    let labCore = true;
    deps.postgresUsers = () =>
      labCore ? ['the Lab Core (Studio runtime)'] : [];
    await expect(lab.stopPostgres()).rejects.toThrow(/Lab Core/);
    expect(calls).not.toContain('docker stop');
    labCore = false;
    await expect(lab.stopPostgres()).resolves.toMatchObject({ ok: true });
    expect(calls).toContain('docker stop');
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
    ).toMatchObject({
      pid: proc.pid,
      entry: "console.log('ready'); setInterval(() => {}, 1000)",
      started_at: expect.any(Number),
    });

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

describe('process adoption by identity (ASTRA-P2-026)', () => {
  it('a real node process that is not ours (other entry) is refused and never killed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-pm-'));
    const pids = new PidStore(dir);
    // Another node program alive under the stored PID (a reused PID).
    const foreign = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    try {
      pids.set('labcore', {
        pid: foreign.pid!,
        entry: 'dist/bonk-lab/local-server.js',
        started_at: Date.now(),
      });
      const next = new ManagedProcess({
        name: 'labcore',
        cwd: dir,
        args: [],
        pids,
        onLine: () => {},
      });
      expect(await next.adoptPrevious()).toBe(false);
      expect(pids.read().labcore).toBeUndefined();
      expect(foreign.exitCode).toBeNull(); // still alive: not ours, untouched
    } finally {
      foreign.kill();
    }
  });

  it('same entry but created at another time (PID reused) is refused; the right one is adopted; old records keep their rule', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-pm-'));
    const pids = new PidStore(dir);
    const t = Date.now() - 60_000;
    let created = t;
    const make = () =>
      new ManagedProcess({
        name: 'core',
        cwd: dir,
        args: [],
        pids,
        onLine: () => {},
        probe: async () => ({
          commandLine: 'node.exe --env-file-if-exists=x dist/index.js',
          startedAt: created,
        }),
      });
    pids.set('core', {
      pid: process.pid,
      entry: 'dist/index.js',
      started_at: t,
    });
    created = t + 3_600_000; // the PID now belongs to a process born an hour later
    expect(await make().adoptPrevious()).toBe(false);
    pids.set('core', {
      pid: process.pid,
      entry: 'dist/index.js',
      started_at: t,
    });
    created = t + 800; // the very process this Studio started
    const owned = make();
    expect(await owned.adoptPrevious()).toBe(true);
    expect(owned.pid).toBe(process.pid);
    // Record written by an older Studio (bare PID): previous rule (a live node process).
    pids.set('core', process.pid);
    expect(await make().adoptPrevious()).toBe(true);
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
    expect(coreGuard({ DAILY_WALLET_CREDITS: 'true' })).toMatch(
      /DAILY_WALLET_CREDITS/,
    ); // ASTRA-P2-002: Daily credits are a Core Wallet write too
    expect(coreGuard({ LOYALTY_PREVIEW: 'true' })).toBeNull();

    const { lab, core } = fakeLab();
    await lab.startCore();
    expect(core.start).toHaveBeenCalledWith({
      LOYALTY_PASSIVE_CREDITS: 'false',
      LOYALTY_EVENT_CREDITS: 'false',
      DAILY_WALLET_CREDITS: 'false',
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

describe('shutdown barrier', () => {
  it('waits for every stop (Lab chat ingress included) and reports a failure without blocking the others', async () => {
    let release!: () => void;
    const labchat = new Promise<void>((r) => (release = r));
    const failed: string[] = [];
    let done = false;
    const all = stopAll(
      {
        labchat: () => labchat,
        testlab: async () => {
          throw new Error('boom');
        },
        runtime: undefined,
      },
      (name) => failed.push(name),
    ).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false); // the ingress has not stopped yet: no exit
    expect(failed).toEqual(['testlab']);
    release();
    await all;
    expect(done).toBe(true);
  });
});

describe('crash traces (ASTRA-P2-014)', () => {
  it('a crash line keeps the stack for diagnosis and never a secret', () => {
    const error = new Error(
      `connect failed postgres://raptoru:${SECRET}@127.0.0.1/x (Bearer abcdefghijklmnop)`,
    );
    const line = crashLine('uncaught exception', error, (t) =>
      redact(t, [SECRET]),
    );
    expect(line).toMatch(
      /^\[studio-server\] uncaught exception: Error: connect failed/,
    );
    expect(line).toContain('at '); // stack frames kept
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('abcdefghijklmnop');
    expect(
      crashLine('unhandled rejection', `token ${SECRET}`, (t) =>
        redact(t, [SECRET]),
      ),
    ).toBe('[studio-server] unhandled rejection: token ***');
  });
});
