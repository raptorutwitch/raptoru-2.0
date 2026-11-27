import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  CHAOS_PROTOCOL,
  type ChaosCommand,
  type ChaosEvent,
  type ChaosResponse,
} from '@raptoru/schemas';

// Pilote local du moteur Chaos (apps/chaos-engine, docs/chaos/CONTRATS_MOTEUR.md) : un processus séparé, piloté en JSON
// ligne par ligne. Studio est son parent : le moteur s'arrête seul si Studio meurt (parent surveillé), s'il ne reçoit
// plus de battement, ou si son stdin se ferme. Ici : lancement, corrélation des réponses, battements, relance après
// une panne (délais croissants), arrêt propre. Aucune logique d'effet : le moteur décide.

export class ChaosError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ChaosEngineOptions {
  exe: string;
  stateDir: string;
  pingMs?: number;
  heartbeatMs?: number;
  callTimeoutMs?: number;
  restartDelaysMs?: number[];
  args?: string[];
  /** Tests : un faux moteur (node script) au lieu de l'exécutable. */
  spawnImpl?: (args: string[]) => ChildProcess;
  log?: (line: string) => void;
}

export type ChaosEngineStatus =
  'absent' | 'stopped' | 'starting' | 'ready' | 'restarting';

export interface ChaosEngineState {
  status: ChaosEngineStatus;
  pid: number | null;
  hello: Record<string, unknown> | null;
  restarts: number;
  lastExit: { reason: string | null; code: number | null; at: string } | null;
  lastError: string | null;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class ChaosEngineClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private seq = 0;
  private readonly pending = new Map<string, Pending>();
  private pingTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private wantRunning = false;
  private exitReason: string | null = null;
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] =
    [];
  readonly state: ChaosEngineState = {
    status: 'stopped',
    pid: null,
    hello: null,
    restarts: 0,
    lastExit: null,
    lastError: null,
  };

  constructor(private readonly o: ChaosEngineOptions) {
    super();
    if (!this.available()) this.state.status = 'absent';
  }

  available() {
    return !!this.o.spawnImpl || existsSync(this.o.exe);
  }

  start() {
    if (this.child || this.restartTimer) return;
    if (!this.available()) {
      this.state.status = 'absent';
      return;
    }
    this.wantRunning = true;
    this.state.status = 'starting';
    this.exitReason = null;
    const args = [
      '--serve',
      '--parent',
      String(process.pid),
      '--state-dir',
      this.o.stateDir,
      '--heartbeat-ms',
      String(this.o.heartbeatMs ?? 3000),
      ...(this.o.args ?? []),
    ];
    let child: ChildProcess;
    try {
      child = this.o.spawnImpl
        ? this.o.spawnImpl(args)
        : spawn(this.o.exe, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          });
    } catch (e) {
      this.state.lastError = (e as Error).message;
      this.onExit(null);
      return;
    }
    this.child = child;
    this.state.pid = child.pid ?? null;
    createInterface({ input: child.stdout! }).on('line', (l) => this.onLine(l));
    child.stderr?.on('data', (d: Buffer) =>
      this.o.log?.(`[chaos-engine] ${d.toString().trim()}`),
    );
    child.on('error', (e) => {
      this.state.lastError = e.message;
    });
    child.on('exit', (code) => this.onExit(code));
    child.stdin?.on('error', () => {
      /* moteur déjà terminé : la sortie est traitée par 'exit' */
    });
    this.pingTimer = setInterval(
      () => this.write({ cmd: 'ping', id: `p${++this.seq}` }),
      this.o.pingMs ?? 1000,
    );
  }

  /** Attend que le moteur soit prêt (le démarre au besoin). */
  ready(timeoutMs = 10_000): Promise<void> {
    if (this.state.status === 'ready') return Promise.resolve();
    if (this.state.status === 'absent')
      return Promise.reject(
        new ChaosError('engine_absent', `moteur introuvable : ${this.o.exe}`),
      );
    this.start();
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      this.readyWaiters.push(w);
      setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((x) => x !== w);
        reject(new ChaosError('engine_not_ready', 'le moteur ne répond pas'));
      }, timeoutMs).unref();
    });
  }

  async call<T = Record<string, unknown>>(
    cmd: ChaosCommand,
    body: Record<string, unknown> = {},
    timeoutMs = this.o.callTimeoutMs ?? 4000,
  ): Promise<T> {
    await this.ready();
    const id = `s${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ChaosError('engine_timeout', `pas de réponse du moteur (${cmd})`),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      if (!this.write({ ...body, cmd, id })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new ChaosError('engine_unavailable', 'moteur arrêté'));
      }
    });
  }

  private write(msg: Record<string, unknown>) {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return false;
    stdin.write(`${JSON.stringify({ v: CHAOS_PROTOCOL, ...msg })}\n`);
    return true;
  }

  private onLine(line: string) {
    let m: ChaosResponse | ChaosEvent;
    try {
      m = JSON.parse(line) as ChaosResponse | ChaosEvent;
    } catch {
      this.o.log?.(`[chaos-engine] ligne illisible : ${line.slice(0, 200)}`);
      return;
    }
    if (m.type === 'response') {
      const p = m.id ? this.pending.get(m.id) : undefined;
      if (!p) return; // battement, ou réponse arrivée après l'expiration
      this.pending.delete(m.id!);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else
        p.reject(
          new ChaosError(
            m.error?.code ?? 'engine_error',
            m.error?.message ?? 'erreur du moteur',
          ),
        );
      return;
    }
    if (m.event === 'engine.ready') {
      this.state.status = 'ready';
      this.state.hello = m as Record<string, unknown>;
      this.state.lastError = null;
      for (const w of this.readyWaiters.splice(0)) w.resolve();
    } else if (m.event === 'engine.exit') {
      this.exitReason = String(m.reason ?? '');
    } else if (m.event === 'engine.error') {
      this.state.lastError = `${String(m.code)} : ${String(m.message)}`;
    }
    this.emit('event', m);
  }

  private onExit(code: number | null) {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.child = null;
    this.state.pid = null;
    this.state.hello = null;
    this.state.lastExit = {
      reason: this.exitReason,
      code,
      at: new Date().toISOString(),
    };
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new ChaosError('engine_exited', 'le moteur s’est arrêté'));
    }
    this.pending.clear();
    this.emit('exit', this.state.lastExit);
    if (!this.wantRunning) {
      this.state.status = 'stopped';
      for (const w of this.readyWaiters.splice(0))
        w.reject(new ChaosError('engine_stopped', 'moteur arrêté'));
      return;
    }
    // Panne : relance avec des délais croissants (la fenêtre d'effet a déjà disparu avec le processus).
    const delays = this.o.restartDelaysMs ?? [500, 2000, 5000, 10_000];
    const wait = delays[Math.min(this.state.restarts, delays.length - 1)]!;
    this.state.status = 'restarting';
    this.state.restarts++;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.wantRunning) this.start();
    }, wait);
    this.restartTimer.unref();
  }

  /** Arrêt propre (STOP ALL puis sortie) ; tue le processus s'il ne répond pas. */
  async stop(timeoutMs = 1500): Promise<void> {
    this.wantRunning = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    if (!child) {
      if (this.state.status !== 'absent') this.state.status = 'stopped';
      return;
    }
    const gone = new Promise<void>((r) => child.once('exit', () => r()));
    this.write({ cmd: 'shutdown', id: `x${++this.seq}` });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    await gone;
    clearTimeout(timer);
  }
}
