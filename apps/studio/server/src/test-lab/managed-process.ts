import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Node children started by the Studio (Core, bot). No shell, no visible window, one child per
// service. PIDs are persisted so a Studio that crashed can find (and stop) what it started, and
// nothing else: a PID is only adopted if it is still a node process.

export type ServiceName = 'core' | 'bot' | 'labcore';

export class PidStore {
  constructor(private readonly dir: string) {}

  private get file() {
    return join(this.dir, 'processes.json');
  }

  read(): Partial<Record<ServiceName, number>> {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Partial<
        Record<ServiceName, number>
      >;
    } catch {
      return {};
    }
  }

  set(name: ServiceName, pid: number | null): void {
    const all = this.read();
    if (pid === null) delete all[name];
    else all[name] = pid;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(all));
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True only if `pid` is a running node process (never adopt a reused PID of another program). */
export async function isNodeProcess(pid: number): Promise<boolean> {
  if (!pidAlive(pid)) return false;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        {
          windowsHide: true,
        },
      );
      // node.exe, or the Studio's own executable when packaged (children run as ELECTRON_RUN_AS_NODE).
      const image = stdout
        .trim()
        .split('","')[0]!
        .replace(/^"/, '')
        .toLowerCase();
      return (
        image === 'node.exe' ||
        image === basename(process.execPath).toLowerCase()
      );
    }
    const { stdout } = await execFileAsync('ps', [
      '-p',
      String(pid),
      '-o',
      'comm=',
    ]);
    return /node/.test(stdout);
  } catch {
    return false;
  }
}

export interface ManagedProcessOptions {
  name: ServiceName;
  cwd: string;
  args: string[];
  pids: PidStore;
  onLine: (line: string, stream: 'stdout' | 'stderr') => void;
  nodePath?: string;
}

export class ManagedProcess {
  private child: ChildProcess | null = null;
  private adoptedPid: number | null = null;
  lastExit: { code: number | null; at: string } | null = null;

  constructor(private readonly options: ManagedProcessOptions) {}

  get name(): ServiceName {
    return this.options.name;
  }

  get pid(): number | null {
    return this.child?.pid ?? this.adoptedPid;
  }

  get running(): boolean {
    if (this.child) return true;
    if (this.adoptedPid !== null && !pidAlive(this.adoptedPid)) {
      this.adoptedPid = null;
      this.options.pids.set(this.options.name, null);
    }
    return this.adoptedPid !== null;
  }

  get adopted(): boolean {
    return this.child === null && this.adoptedPid !== null;
  }

  /** At Studio startup: take back a child left by a previous Studio session, if still alive. */
  async adoptPrevious(): Promise<boolean> {
    const pid = this.options.pids.read()[this.options.name];
    if (pid && (await isNodeProcess(pid))) {
      this.adoptedPid = pid;
      return true;
    }
    this.options.pids.set(this.options.name, null);
    return false;
  }

  start(env: Record<string, string> = {}): void {
    if (this.running)
      throw new Error(
        `${this.options.name} is already running (pid ${this.pid})`,
      );
    const child = spawn(
      this.options.nodePath ?? process.execPath,
      this.options.args,
      {
        cwd: this.options.cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    this.child = child;
    for (const stream of ['stdout', 'stderr'] as const) {
      createInterface({ input: child[stream]! }).on('line', (line) =>
        this.options.onLine(line, stream),
      );
    }
    child.on('error', (error) =>
      this.options.onLine(`spawn failed: ${error.message}`, 'stderr'),
    );
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      this.lastExit = { code, at: new Date().toISOString() };
      this.options.pids.set(this.options.name, null);
    });
    if (child.pid) this.options.pids.set(this.options.name, child.pid);
  }

  /** Stops the child (or the adopted PID). Waits for the exit, forces after `timeoutMs`. */
  async stop(timeoutMs = 5000): Promise<void> {
    const child = this.child;
    if (child) {
      const exited = new Promise<void>((resolve) =>
        child.once('exit', () => resolve()),
      );
      child.kill();
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      await exited;
      clearTimeout(timer);
      return;
    }
    const pid = this.adoptedPid;
    if (pid !== null) {
      if (await isNodeProcess(pid)) process.kill(pid);
      for (let i = 0; i < 50 && pidAlive(pid); i++)
        await new Promise((r) => setTimeout(r, 100));
      this.adoptedPid = null;
      this.options.pids.set(this.options.name, null);
    }
  }
}

/** Runs a node script to completion (migrations, preflight), without window. */
export function runNodeScript(
  cwd: string,
  args: string[],
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
  timeoutMs = 60_000,
  nodePath = process.execPath,
): Promise<{ code: number | null; lines: string[] }> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const child = spawn(nodePath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    for (const stream of ['stdout', 'stderr'] as const) {
      createInterface({ input: child[stream]! }).on('line', (line) => {
        lines.push(line);
        onLine(line, stream);
      });
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (error) => {
      lines.push(`spawn failed: ${error.message}`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, lines });
    });
  });
}
