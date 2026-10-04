import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Node children started by the Studio (Core, bot). No shell, no visible window, one child per
// service. Each child's identity is persisted (PID, entry script, launch time) so a Studio that
// crashed can find (and stop) what it started, and nothing else: a stored PID is adopted only if the
// process behind it has that entry on its command line and was created at that time — a reused PID
// or another program is refused (ASTRA-P2-026).

export type ServiceName = 'core' | 'bot' | 'labcore' | 'labchat';

/** Persisted identity of a child (a bare number: record of an older Studio, before identities). */
export type PidRecord =
  number | { pid: number; entry: string; started_at: number };
const recordPid = (r: PidRecord) => (typeof r === 'number' ? r : r.pid);
/** Creation time of the adopted process vs. the recorded launch: same process within this margin. */
const START_MARGIN_MS = 10_000;

/** What the OS says about a live process (null: gone or unreadable). */
export interface ProcessInfo {
  commandLine: string;
  startedAt: number;
}

export class PidStore {
  constructor(private readonly dir: string) {}

  private get file() {
    return join(this.dir, 'processes.json');
  }

  read(): Partial<Record<ServiceName, PidRecord>> {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Partial<
        Record<ServiceName, PidRecord>
      >;
    } catch {
      return {};
    }
  }

  set(name: ServiceName, record: PidRecord | null): void {
    const all = this.read();
    if (record === null) delete all[name];
    else all[name] = record;
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

/** Command line and creation time of a live process (Windows: CIM; elsewhere: ps). */
export async function processInfo(pid: number): Promise<ProcessInfo | null> {
  if (!pidAlive(pid)) return null;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { @{ c = $p.CommandLine; t = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }`,
        ],
        { windowsHide: true, timeout: 15_000 },
      );
      if (!stdout.trim()) return null;
      const out = JSON.parse(stdout) as { c: string | null; t: number };
      return { commandLine: out.c ?? '', startedAt: Number(out.t) };
    }
    const { stdout } = await execFileAsync('ps', [
      '-p',
      String(pid),
      '-o',
      'etimes=',
      '-o',
      'args=',
    ]);
    const m = /^\s*(\d+)\s+(.*)$/s.exec(stdout);
    if (!m) return null;
    return {
      commandLine: m[2]!.trim(),
      startedAt: Date.now() - Number(m[1]) * 1000,
    };
  } catch {
    return null;
  }
}

export interface ManagedProcessOptions {
  name: ServiceName;
  cwd: string;
  args: string[];
  pids: PidStore;
  onLine: (line: string, stream: 'stdout' | 'stderr') => void;
  nodePath?: string;
  /** OS view of a process (injectable for tests). */
  probe?: (pid: number) => Promise<ProcessInfo | null>;
}

export class ManagedProcess {
  private child: ChildProcess | null = null;
  private adoptedPid: number | null = null;
  private adoptedRecord: PidRecord | null = null;
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

  /** True only if `record` still designates the very process this Studio started. */
  private async owns(record: PidRecord): Promise<boolean> {
    // Record of an older Studio (bare PID): its rule, so an update never orphans its children.
    if (typeof record === 'number') return isNodeProcess(record);
    const info = await (this.options.probe ?? processInfo)(record.pid);
    return (
      !!info &&
      info.commandLine.includes(record.entry) &&
      Math.abs(info.startedAt - record.started_at) <= START_MARGIN_MS
    );
  }

  /** At Studio startup: take back a child left by a previous Studio session, if it is still it. */
  async adoptPrevious(): Promise<boolean> {
    const record = this.options.pids.read()[this.options.name];
    if (record && (await this.owns(record))) {
      this.adoptedPid = recordPid(record);
      this.adoptedRecord = record;
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
    if (child.pid)
      this.options.pids.set(this.options.name, {
        pid: child.pid,
        entry: this.options.args.at(-1) ?? '',
        started_at: Date.now(),
      });
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
      // Re-checked right before the kill: never terminate a process that is no longer ours.
      if (this.adoptedRecord && (await this.owns(this.adoptedRecord)))
        process.kill(pid);
      for (let i = 0; i < 50 && pidAlive(pid); i++)
        await new Promise((r) => setTimeout(r, 100));
      this.adoptedPid = null;
      this.adoptedRecord = null;
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
