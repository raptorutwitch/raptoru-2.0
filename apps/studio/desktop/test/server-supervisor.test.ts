import { describe, expect, it } from 'vitest';
import {
  EXIT_PORT_IN_USE,
  ServerSupervisor,
  type ChildHandle,
  type Probe,
} from '../src/server-supervisor.js';

/** Fake local world: one port, spawned servers that come up after a few probes, fake time. */
function world(options: { occupiedBy?: Probe; startProbes?: number } = {}) {
  let t = 0;
  let pid = 1000;
  let listening: FakeChild | null = null;
  let foreign: Probe = options.occupiedBy ?? 'down';
  const spawned: FakeChild[] = [];
  const killed: number[] = [];
  let shutdowns = 0;

  class FakeChild implements ChildHandle {
    pid = ++pid;
    alive = true;
    healthy = true;
    probesBeforeUp = options.startProbes ?? 1;
    private exits: ((code: number | null) => void)[] = [];
    onExit(l: (code: number | null) => void) {
      this.exits.push(l);
    }
    onOutput() {}
    exit(code: number | null) {
      if (!this.alive) return;
      this.alive = false;
      if (listening === this) listening = null;
      for (const l of this.exits.splice(0)) l(code);
    }
  }

  const deps = {
    spawn: () => {
      const c = new FakeChild();
      spawned.push(c);
      if (listening || foreign !== 'down')
        queueMicrotask(() => c.exit(EXIT_PORT_IN_USE));
      else listening = c;
      return c;
    },
    probe: async (): Promise<Probe> => {
      if (foreign !== 'down') return foreign;
      if (!listening) return 'down';
      if (listening.probesBeforeUp > 0) {
        listening.probesBeforeUp -= 1;
        return 'down';
      }
      return listening.healthy ? 'studio' : 'down';
    },
    portFree: async () => !listening && foreign === 'down',
    requestShutdown: async () => {
      shutdowns += 1;
      if (foreign === 'studio') foreign = 'down';
      const c = listening;
      if (c) queueMicrotask(() => c.exit(0));
    },
    killTree: async (p: number) => {
      killed.push(p);
      spawned.find((c) => c.pid === p)?.exit(1);
    },
    now: () => t,
    sleep: (ms: number) =>
      // "Forever" (idle health loop): never resolves; otherwise fake time moves and control is yielded.
      ms >= 1e8
        ? new Promise<void>(() => {})
        : new Promise<void>((resolve) => {
            t += ms;
            setImmediate(resolve);
          }),
    log: () => {},
  };
  return {
    deps,
    spawned,
    killed,
    get shutdowns() {
      return shutdowns;
    },
    get t() {
      return t;
    },
    advance: (ms: number) => {
      t += ms;
    },
    setForeign: (p: Probe) => {
      foreign = p;
    },
  };
}
const flush = async (n = 50) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
/** Waits (bounded) until the supervisor reaches one of the states. */
async function until(sup: ServerSupervisor, states: string[]) {
  for (let i = 0; i < 2000 && !states.includes(sup.status.state); i++)
    await flush(5);
  return sup.status.state;
}

describe('Studio server supervisor (Electron main)', () => {
  it('starts the server and becomes ready only once /health answers', async () => {
    const w = world({ startProbes: 3 });
    const sup = new ServerSupervisor(w.deps, { healthIntervalMs: 1e9 });
    await sup.start();
    expect(sup.status.state).toBe('ready');
    expect(w.spawned).toHaveLength(1);
  });

  it('a crash is detected and the server restarted with a backoff; 3 restarts max, then fatal', async () => {
    const w = world();
    const sup = new ServerSupervisor(w.deps, {
      healthIntervalMs: 1e9,
      backoffMs: [1000, 3000, 6000],
    });
    await sup.start();
    const states: string[] = [];
    sup.onChange((s) => states.push(s.state));
    for (let n = 1; n <= 3; n++) {
      w.spawned.at(-1)!.exit(1);
      expect(await until(sup, ['ready', 'fatal'])).toBe('ready');
      expect(sup.status.restarts).toBe(n);
    }
    expect(states).toContain('crashed');
    expect(states).toContain('restarting');
    w.spawned.at(-1)!.exit(1);
    expect(await until(sup, ['fatal'])).toBe('fatal');
    expect(w.spawned).toHaveLength(4); // no spawn loop after the budget
    await flush(200);
    expect(w.spawned).toHaveLength(4);
  });

  it('the restart budget is per window: crashes far apart never become fatal', async () => {
    const w = world();
    const sup = new ServerSupervisor(w.deps, {
      healthIntervalMs: 1e9,
      windowMs: 60_000,
    });
    await sup.start();
    for (let n = 0; n < 6; n++) {
      w.advance(120_000);
      w.spawned.at(-1)!.exit(1);
      expect(await until(sup, ['ready', 'fatal'])).toBe('ready');
    }
  });

  it('manual restart (IPC) works from fatal, with a fresh budget', async () => {
    const w = world();
    const sup = new ServerSupervisor(w.deps, {
      healthIntervalMs: 1e9,
      maxRestarts: 1,
    });
    await sup.start();
    w.spawned.at(-1)!.exit(1);
    await until(sup, ['ready']);
    w.spawned.at(-1)!.exit(1);
    expect(await until(sup, ['fatal'])).toBe('fatal');
    await sup.restart();
    expect(sup.status.state).toBe('ready');
    expect(sup.status.restarts).toBe(0);
  });

  it('manual restart of a live server: graceful stop first, then a new process', async () => {
    const w = world();
    const sup = new ServerSupervisor(w.deps, { healthIntervalMs: 1e9 });
    await sup.start();
    const first = w.spawned[0]!;
    await sup.restart();
    expect(first.alive).toBe(false);
    expect(w.shutdowns).toBe(1);
    expect(w.spawned).toHaveLength(2);
    expect(sup.status.state).toBe('ready');
  });

  it('port taken by another application: explicit fatal, nothing spawned', async () => {
    const w = world({ occupiedBy: 'other' });
    const sup = new ServerSupervisor(w.deps);
    await sup.start();
    expect(sup.status.state).toBe('fatal');
    expect(sup.status.detail).toMatch(/4100/);
    expect(w.spawned).toHaveLength(0);
  });

  it('an orphan Studio server on the port is stopped gracefully, then ours starts', async () => {
    const w = world({ occupiedBy: 'studio' });
    const sup = new ServerSupervisor(w.deps, { healthIntervalMs: 1e9 });
    await sup.start();
    expect(w.shutdowns).toBe(1);
    expect(sup.status.state).toBe('ready');
    expect(w.spawned).toHaveLength(1);
  });

  it('server exiting with the port-in-use code: fatal, no restart loop', async () => {
    const w = world();
    const sup = new ServerSupervisor(w.deps, { healthIntervalMs: 1e9 });
    await sup.start();
    w.spawned[0]!.exit(EXIT_PORT_IN_USE);
    expect(await until(sup, ['fatal'])).toBe('fatal');
    await flush(200);
    expect(w.spawned).toHaveLength(1);
  });

  it('health lost while the process lives: degraded, then killed and restarted', async () => {
    const w = world();
    const sup = new ServerSupervisor(w.deps, {
      healthIntervalMs: 2000,
      degradedAfter: 3,
      killAfter: 5,
    });
    await sup.start();
    const states: string[] = [];
    sup.onChange((s) => states.push(s.state));
    w.spawned[0]!.healthy = false;
    expect(await until(sup, ['restarting', 'fatal'])).toBe('restarting');
    expect(states).toContain('degraded');
    expect(w.killed).toContain(w.spawned[0]!.pid);
    expect(await until(sup, ['ready'])).toBe('ready');
    expect(w.spawned).toHaveLength(2);
  });

  it('stop (app closing): graceful shutdown, no restart afterwards', async () => {
    const w = world();
    const sup = new ServerSupervisor(w.deps, { healthIntervalMs: 1e9 });
    await sup.start();
    await sup.stop();
    await flush(200);
    expect(sup.status.state).toBe('stopped');
    expect(w.spawned).toHaveLength(1);
    expect(w.spawned[0]!.alive).toBe(false);
  });
});
