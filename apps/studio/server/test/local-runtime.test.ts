import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalRuntime,
  labDatabaseUrl,
  type RuntimeDeps,
} from '../src/runtime/local-runtime.js';
import { LogBuffer } from '../src/test-lab/log-buffer.js';
import type { ManagedProcess } from '../src/test-lab/managed-process.js';

class FakeLabCore {
  running = false;
  pid: number | null = null;
  lastExit: { code: number | null; at: string } | null = null;
  starts: Record<string, string>[] = [];
  stops = 0;
  orphan: number | null = null;
  async adoptPrevious() {
    if (this.orphan === null) return false;
    this.running = true;
    this.pid = this.orphan;
    return true;
  }
  start(env: Record<string, string> = {}) {
    this.starts.push(env);
    this.running = true;
    this.pid = 1000 + this.starts.length;
  }
  async stop() {
    this.stops++;
    this.running = false;
  }
  crash(code = 1) {
    this.running = false;
    this.lastExit = { code, at: new Date().toISOString() };
  }
}

function setup(over: Partial<RuntimeDeps> = {}) {
  const core = new FakeLabCore();
  let healthy = true;
  const deps: RuntimeDeps = {
    docker: {
      containerState: async () => ({ state: 'running', detail: 'running' }),
      startContainer: async () => {},
      stopContainer: async () => {},
      postgresReady: async () => true,
    },
    fetch: (async () =>
      healthy && core.running
        ? new Response(JSON.stringify({ service: 'bonk-lab-core' }), {
            status: 200,
          })
        : Promise.reject(new Error('down'))) as unknown as typeof fetch,
    sleep: async () => {},
    now: () => Date.now(),
    portFree: async () => true,
    prepareDatabase: async () => ['20261003120000_sound_lab_custom_label.sql'],
    labCore: core as unknown as ManagedProcess,
    readCoreEnv: () => ({
      DATABASE_URL: 'postgres://u:secretpw@127.0.0.1:5432/raptoru',
    }),
    readBotEnv: () => ({
      TWITCH_CLIENT_ID: 'cid',
      TWITCH_CLIENT_SECRET: 'csecret',
      TWITCH_BROADCASTER_ID: '83603689',
    }),
    logs: new LogBuffer((t) => t),
    redact: (t) => t.split('secretpw').join('***'),
    ...over,
  };
  const rt = new LocalRuntime(deps);
  const state = (id: string) => rt.status().services.find((s) => s.id === id)!;
  return { rt, core, deps, state, setHealthy: (v: boolean) => (healthy = v) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LocalRuntime', () => {
  it('starts Postgres → Lab database → Lab Core with the session secret and the Lab database', async () => {
    const { rt, core, state } = setup();
    await rt.start();
    expect(state('postgres').state).toBe('ready');
    expect(state('database').state).toBe('ready');
    expect(state('labcore').state).toBe('ready');
    expect(state('providers').state).toBe('ready');
    expect(core.starts).toHaveLength(1);
    const env = core.starts[0]!;
    expect(env.BONK_LAB_SECRET).toBe(rt.secret);
    expect(rt.secret).toHaveLength(64);
    expect(new URL(env.BONK_LAB_DATABASE_URL!).pathname).toBe(
      '/raptoru_bonk_lab',
    );
    expect(env.BONK_LAB_CHANNEL_TWITCH_ID).toBe('83603689');
    await rt.stop();
    expect(core.running).toBe(false);
  });

  it('refuses a database that is not local and never shows secrets', async () => {
    expect(() =>
      labDatabaseUrl('postgres://u:p@db.example.com:5432/raptoru'),
    ).toThrow(/locale/);
    const { rt, state } = setup({
      prepareDatabase: async () => {
        throw new Error('password authentication failed for secretpw');
      },
    });
    await rt.start();
    expect(state('database').state).toBe('error');
    expect(state('database').detail).not.toContain('secretpw');
    expect(state('labcore').state).toBe('stopped');
  });

  it('marks Docker unavailable without crashing and retries later', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { rt, state } = setup({
      docker: {
        containerState: async () =>
          ++calls === 1
            ? { state: 'error', detail: 'pipe not found' }
            : { state: 'running', detail: 'running' },
        startContainer: async () => {},
        stopContainer: async () => {},
        postgresReady: async () => true,
      },
    });
    await rt.start();
    expect(state('postgres').state).toBe('error');
    expect(state('postgres').detail).toMatch(/Docker/);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(state('labcore').state).toBe('ready'));
    await rt.stop();
  });

  it('refuses an occupied Lab Core port instead of starting a second Core', async () => {
    const { rt, core, state } = setup({
      portFree: async () => false,
      fetch: (async () =>
        new Response(JSON.stringify({ service: 'bonk-lab-core' }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    await rt.start();
    expect(core.starts).toHaveLength(0);
    expect(state('labcore').state).toBe('error');
    expect(state('labcore').detail).toMatch(/bonk:lab/);
  });

  it('replaces a Lab Core orphaned by a killed Studio (stored PID, unknown secret)', async () => {
    const { rt, core } = setup();
    core.orphan = 42;
    await rt.start();
    expect(core.stops).toBe(1);
    expect(core.starts).toHaveLength(1);
    await rt.stop();
  });

  it('restarts a crashed Lab Core at most 3 times in 5 minutes, then waits for a manual retry', async () => {
    vi.useFakeTimers();
    const { rt, core, state } = setup();
    await rt.start();
    for (const delay of [2000, 5000, 10000]) {
      core.crash();
      await vi.advanceTimersByTimeAsync(3000); // health watch sees the dead process
      expect(state('labcore').state).toBe('starting');
      await vi.advanceTimersByTimeAsync(delay);
      await vi.waitFor(() => expect(state('labcore').state).toBe('ready'));
    }
    expect(core.starts).toHaveLength(4);
    core.crash();
    await vi.advanceTimersByTimeAsync(3000);
    expect(state('labcore').state).toBe('error');
    expect(state('labcore').detail).toMatch(/relance manuelle/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(core.starts).toHaveLength(4);
    await rt.restart();
    expect(state('labcore').state).toBe('ready');
    expect(core.starts).toHaveLength(5);
    await rt.stop();
  });

  it('shows a Lab migration error and does not start the Lab Core', async () => {
    const { rt, core, state } = setup({
      prepareDatabase: async () => {
        throw new Error('migration Lab refusée : syntax error');
      },
    });
    await rt.start();
    expect(state('database').detail).toMatch(/migration/);
    expect(core.starts).toHaveLength(0);
  });

  it('reports partial providers when the Twitch app is missing (Twemoji still works)', async () => {
    const { rt, state } = setup({ readBotEnv: () => ({}) });
    await rt.start();
    expect(state('labcore').state).toBe('ready');
    expect(state('providers').state).toBe('degraded');
    expect(state('providers').detail).toMatch(/Twemoji/);
    await rt.stop();
  });
});
