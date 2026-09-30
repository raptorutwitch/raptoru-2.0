// Supervision of the local Studio server by the Electron main process. Electron is the top of the
// local runtime: it starts the server, waits for /health, watches the process and its health,
// restarts it with a backoff after a crash (bounded), and reports a clear state to the window —
// through IPC, so recovery never depends on the server's own HTTP API.
//
// Pure logic: processes, HTTP, ports and time are injected (tested with fakes).

export type ServerState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'crashed'
  | 'restarting'
  | 'fatal';

export interface ServerStatus {
  state: ServerState;
  /** Human-readable French detail for the status page. */
  detail: string;
  pid: number | null;
  /** Automatic restarts inside the current window. */
  restarts: number;
  maxRestarts: number;
  lastExit: { code: number | null; at: string } | null;
  since: string;
  logTail: string[];
}

export interface ChildHandle {
  pid: number | undefined;
  onExit(listener: (code: number | null) => void): void;
  onOutput(listener: (line: string) => void): void;
}

export type Probe = 'studio' | 'other' | 'down';

export interface SupervisorDeps {
  spawn(): ChildHandle;
  /** GET /health: 'studio' = a Studio server answers, 'other' = something else, 'down' = nothing. */
  probe(): Promise<Probe>;
  portFree(): Promise<boolean>;
  /** POST /api/shutdown (graceful: the server stops its Core first). */
  requestShutdown(): Promise<void>;
  /** Kills a process and its children (Windows: taskkill /T /F). */
  killTree(pid: number): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
}

export interface SupervisorOptions {
  /** Automatic restarts allowed inside `windowMs`, then fatal (user action required). */
  maxRestarts?: number;
  windowMs?: number;
  backoffMs?: number[];
  startTimeoutMs?: number;
  healthIntervalMs?: number;
  /** Consecutive failed health checks before `degraded`. */
  degradedAfter?: number;
  /** Consecutive failed health checks before the process is killed and restarted. */
  killAfter?: number;
  stopTimeoutMs?: number;
}

/** Exit code used by the Studio server when its port is already taken (no restart loop). */
export const EXIT_PORT_IN_USE = 3;

export class ServerSupervisor {
  private readonly o: Required<SupervisorOptions>;
  private child: ChildHandle | null = null;
  private crashes: number[] = [];
  private stopping = false;
  private generation = 0;
  private healthFailures = 0;
  private monitor: Promise<void> | null = null;
  private listeners = new Set<(s: ServerStatus) => void>();
  private tail: string[] = [];
  private s: ServerStatus;

  constructor(
    private readonly deps: SupervisorDeps,
    options: SupervisorOptions = {},
  ) {
    this.o = {
      maxRestarts: 3,
      windowMs: 3 * 60_000,
      backoffMs: [1_000, 3_000, 6_000],
      startTimeoutMs: 30_000,
      healthIntervalMs: 2_000,
      degradedAfter: 3,
      killAfter: 8,
      stopTimeoutMs: 10_000,
      ...options,
    };
    this.s = {
      state: 'stopped',
      detail: 'Serveur Studio arrêté',
      pid: null,
      restarts: 0,
      maxRestarts: this.o.maxRestarts,
      lastExit: null,
      since: new Date(deps.now()).toISOString(),
      logTail: [],
    };
  }

  get status(): ServerStatus {
    return { ...this.s, logTail: [...this.tail] };
  }

  onChange(listener: (s: ServerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(state: ServerState, detail: string) {
    const changed = state !== this.s.state || detail !== this.s.detail;
    this.s = {
      ...this.s,
      state,
      detail,
      pid: this.child?.pid ?? null,
      restarts: this.recentCrashes(),
      since: changed ? new Date(this.deps.now()).toISOString() : this.s.since,
    };
    if (changed) this.deps.log(`[supervisor] ${state} — ${detail}`);
    const snapshot = this.status;
    for (const l of this.listeners) l(snapshot);
  }

  private output(line: string) {
    this.tail.push(line);
    if (this.tail.length > 200) this.tail.splice(0, this.tail.length - 200);
    this.deps.log(line);
  }

  private recentCrashes() {
    const from = this.deps.now() - this.o.windowMs;
    this.crashes = this.crashes.filter((t) => t >= from);
    return this.crashes.length;
  }

  /** Starts the server (idempotent while starting / ready). Resolves once ready, fatal or crashed. */
  async start(): Promise<void> {
    if (this.child || ['starting', 'ready', 'degraded'].includes(this.s.state))
      return;
    this.stopping = false;
    const gen = ++this.generation;
    this.set('starting', 'Démarrage du serveur Studio…');
    // The port must be ours to take. A Studio server still answering here is an orphan (Electron is
    // single instance): stopped gracefully so it stops its own Core. Anything else: never fight it.
    const probe = await this.deps.probe();
    if (probe === 'studio') {
      this.output(
        '[supervisor] serveur Studio orphelin sur le port : arrêt demandé',
      );
      await this.deps.requestShutdown().catch(() => {});
      if (!(await this.waitPortFree(15_000))) {
        this.set(
          'fatal',
          'Le port 4100 reste occupé par un ancien serveur Studio qui ne s’arrête pas.',
        );
        return;
      }
    } else if (probe === 'other' || !(await this.deps.portFree())) {
      this.set(
        'fatal',
        'Le port 4100 est occupé par une autre application : libère-le, puis « Relancer le serveur Studio ».',
      );
      return;
    }
    if (gen !== this.generation) return;

    const child = this.deps.spawn();
    this.child = child;
    child.onOutput((line) => this.output(line));
    child.onExit((code) => void this.exited(child, code));
    this.s.pid = child.pid ?? null;

    const deadline = this.deps.now() + this.o.startTimeoutMs;
    while (this.deps.now() < deadline) {
      if (this.child !== child || gen !== this.generation) return; // exited or superseded
      if ((await this.deps.probe()) === 'studio') {
        this.healthFailures = 0;
        this.set('ready', 'Serveur Studio prêt');
        this.watchHealth(child, gen);
        return;
      }
      await this.deps.sleep(250);
    }
    if (this.child !== child) return;
    this.output(
      '[supervisor] le serveur ne répond pas à /health : arrêt forcé',
    );
    await this.kill(child);
  }

  private watchHealth(child: ChildHandle, gen: number) {
    this.monitor = (async () => {
      while (
        this.child === child &&
        gen === this.generation &&
        !this.stopping
      ) {
        await this.deps.sleep(this.o.healthIntervalMs);
        if (this.child !== child || gen !== this.generation || this.stopping)
          return;
        const ok = (await this.deps.probe()) === 'studio';
        if (ok) {
          this.healthFailures = 0;
          if (this.s.state === 'degraded')
            this.set('ready', 'Serveur Studio prêt');
          continue;
        }
        this.healthFailures += 1;
        if (this.healthFailures >= this.o.killAfter) {
          this.output(
            '[supervisor] serveur Studio muet trop longtemps : arrêt forcé puis relance',
          );
          await this.kill(child);
          return;
        }
        if (this.healthFailures >= this.o.degradedAfter)
          this.set(
            'degraded',
            'Le serveur Studio ne répond plus (vérification en cours)…',
          );
      }
    })();
  }

  private async kill(child: ChildHandle) {
    if (child.pid) await this.deps.killTree(child.pid).catch(() => {});
  }

  private async exited(child: ChildHandle, code: number | null) {
    if (this.child !== child) return;
    this.child = null;
    this.s.lastExit = { code, at: new Date(this.deps.now()).toISOString() };
    this.output(
      `[supervisor] serveur Studio arrêté (code ${code ?? 'signal'})`,
    );
    if (this.stopping) {
      this.set('stopped', 'Serveur Studio arrêté');
      return;
    }
    if (code === EXIT_PORT_IN_USE) {
      this.set(
        'fatal',
        'Le port 4100 est déjà utilisé : aucun redémarrage automatique. Libère-le, puis « Relancer le serveur Studio ».',
      );
      return;
    }
    this.crashes.push(this.deps.now());
    const n = this.recentCrashes();
    if (n > this.o.maxRestarts) {
      this.set(
        'fatal',
        `Le serveur Studio s’est arrêté ${n} fois en peu de temps : relance automatique suspendue.`,
      );
      return;
    }
    this.set('crashed', 'Serveur Studio perdu');
    const gen = ++this.generation;
    const delay =
      this.o.backoffMs[Math.min(n - 1, this.o.backoffMs.length - 1)] ?? 1_000;
    this.set(
      'restarting',
      `Relance automatique ${n}/${this.o.maxRestarts} dans ${Math.round(delay / 1000)} s…`,
    );
    await this.deps.sleep(delay);
    if (gen !== this.generation || this.stopping) return;
    // The old process is gone; its port may still be closing.
    if (!(await this.waitPortFree(10_000))) {
      if ((await this.deps.probe()) === 'studio') {
        await this.deps.requestShutdown().catch(() => {});
        await this.waitPortFree(10_000);
      }
    }
    if (gen !== this.generation || this.stopping) return;
    this.s.state = 'crashed'; // allows start()
    await this.start();
  }

  private async waitPortFree(ms: number) {
    const deadline = this.deps.now() + ms;
    while (this.deps.now() < deadline) {
      if (await this.deps.portFree()) return true;
      await this.deps.sleep(250);
    }
    return this.deps.portFree();
  }

  /** User action (IPC): stop whatever is left and start again, with a fresh restart budget. */
  async restart(): Promise<void> {
    this.crashes = [];
    this.generation += 1;
    const child = this.child;
    if (child) {
      this.stopping = true;
      await this.stopChild(child);
      this.stopping = false;
    }
    this.child = null;
    this.s.state = 'stopped';
    await this.start();
  }

  /** Graceful stop (app closing): the server stops its Core; forced kill after the timeout. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.generation += 1;
    const child = this.child;
    if (child) await this.stopChild(child);
    this.child = null;
    this.set('stopped', 'Serveur Studio arrêté');
  }

  private async stopChild(child: ChildHandle) {
    const exited = new Promise<void>((resolve) =>
      child.onExit(() => resolve()),
    );
    await this.deps.requestShutdown().catch(() => {});
    const timeout = this.deps
      .sleep(this.o.stopTimeoutMs)
      .then(() => 'timeout' as const);
    if ((await Promise.race([exited, timeout])) === 'timeout') {
      this.output('[supervisor] arrêt gracieux trop long : arrêt forcé');
      await this.kill(child);
      await Promise.race([exited, this.deps.sleep(3_000)]);
    }
  }
}
