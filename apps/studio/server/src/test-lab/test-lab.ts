import { join } from 'node:path';
import { dockerOps, type DockerOps } from './docker.js';
import {
  collectSecrets,
  paths,
  readEnvFile,
  readTokenSummary,
  redact,
  type EnvFile,
} from './local-env.js';
import { LogBuffer, type LogSource } from './log-buffer.js';
import { ManagedProcess, PidStore, runNodeScript } from './managed-process.js';

// Temporary "Test Lab" backend: drives the local shadow-presence test without a terminal.
// Secrets stay in this process; the UI only ever receives the non-secret fields below.

export interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

export interface TestLabDeps {
  docker: DockerOps;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  runScript: typeof runNodeScript;
  core: ManagedProcess;
  bot: ManagedProcess;
  readCoreEnv: () => EnvFile;
  readBotEnv: () => EnvFile;
  readToken: typeof readTokenSummary;
  /** Removes every known secret from a text before it is stored or sent to the UI. */
  redact: (text: string) => string;
  logs: LogBuffer;
}

export function createTestLab(): TestLab {
  const redactor = (text: string) => redact(text, collectSecrets());
  const logs = new LogBuffer(redactor);
  const pids = new PidStore(paths.runtimeDir);
  let lab: TestLab | null = null;
  const core = new ManagedProcess({
    name: 'core',
    cwd: paths.coreDir,
    args: ['--env-file-if-exists=.env', 'dist/index.js'],
    pids,
    onLine: (line, stream) =>
      logs.add('core', line, stream === 'stderr' ? 'error' : 'info'),
  });
  const bot = new ManagedProcess({
    name: 'bot',
    cwd: paths.botDir,
    args: ['--env-file-if-exists=.env', 'dist/index.js'],
    pids,
    onLine: (line, stream) => lab?.onBotLine(line, stream),
  });
  const deps: TestLabDeps = {
    docker: dockerOps,
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    runScript: runNodeScript,
    core,
    bot,
    readCoreEnv: () => readEnvFile(paths.coreEnv),
    readBotEnv: () => readEnvFile(paths.botEnv),
    readToken: readTokenSummary,
    redact: redactor,
    logs,
  };
  lab = new TestLab(deps);
  return lab;
}

/** Test Lab never starts a Core able to write Jetons from loyalty rewards. */
export function coreGuard(env: EnvFile): string | null {
  for (const flag of ['LOYALTY_PASSIVE_CREDITS', 'LOYALTY_EVENT_CREDITS']) {
    if ((env[flag] ?? 'false') !== 'false')
      return `refused: ${flag} must be false in apps/core-api/.env`;
  }
  return null;
}

/** Shadow test preconditions: the bot may only run with chat commands off and presence on. */
export function botGuard(env: EnvFile): string | null {
  if ((env.DAILY_CHAT_COMMANDS ?? 'false') !== 'false') {
    return 'refused: DAILY_CHAT_COMMANDS must be false in apps/twitch-bot/.env';
  }
  if ((env.LOYALTY_CHAT_COMMANDS ?? 'false') !== 'false') {
    return 'refused: LOYALTY_CHAT_COMMANDS must be false in apps/twitch-bot/.env';
  }
  if (env.PRESENCE_SHADOW !== 'true')
    return 'refused: PRESENCE_SHADOW must be true in apps/twitch-bot/.env';
  return null;
}

export class TestLab {
  private busy: string | null = null;
  private sequence: {
    running: boolean;
    action: string | null;
    steps: StepResult[];
  } = {
    running: false,
    action: null,
    steps: [],
  };
  private health: {
    ok: boolean;
    checkedAt: string | null;
    error: string | null;
  } = {
    ok: false,
    checkedAt: null,
    error: null,
  };
  private preflight: { ok: boolean; at: string; lines: string[] } | null = null;
  private botInfo = {
    twitch: 'not connected' as 'not connected' | 'authenticated' | 'eventsub',
    lastError: null as string | null,
    presenceStream: null as string | null,
    lastChatters: null as number | null,
    lastSnapshotAt: null as string | null,
    lastPresenceError: null as string | null,
    loyaltyEvents: 'unknown' as string,
    lastSubSnapshot: null as string | null,
  };

  constructor(readonly deps: TestLabDeps) {}

  get logs(): LogBuffer {
    return this.deps.logs;
  }

  private log(
    source: LogSource,
    text: string,
    level: 'info' | 'error' = 'info',
  ) {
    this.deps.logs.add(source, text, level);
  }

  /** Bot stdout is also parsed for the dashboard (auth, EventSub, presence cycles). */
  onBotLine(line: string, stream: 'stdout' | 'stderr'): void {
    const presence = line.includes('[presence]');
    this.log(
      presence ? 'presence' : 'bot',
      line,
      stream === 'stderr' ? 'error' : 'info',
    );
    const clean = this.deps.redact(line);
    if (line.includes('token ok for')) this.botInfo.twitch = 'authenticated';
    if (line.includes('EventSub subscriptions created'))
      this.botInfo.twitch = 'eventsub';
    if (line.includes('loyalty Twitch events on'))
      this.botInfo.loyaltyEvents = 'on';
    const off = /loyalty Twitch events OFF: (.*)/.exec(line);
    if (off) this.botInfo.loyaltyEvents = `OFF: ${this.deps.redact(off[1]!)}`;
    if (line.includes('broadcaster EventSub subscriptions created'))
      this.botInfo.loyaltyEvents = 'on (EventSub ready)';
    const snap = /subscription snapshot: (\d+) subscribers/.exec(line);
    if (snap)
      this.botInfo.lastSubSnapshot = `${snap[1]} subscribers at ${new Date().toISOString()}`;
    if (line.includes('subscription snapshot failed'))
      this.botInfo.lastSubSnapshot = `failed: ${clean}`;
    const started = /shadow worker started for stream (\S+)/.exec(line);
    if (started) this.botInfo.presenceStream = started[1]!;
    if (/shadow worker stopped/.test(line)) this.botInfo.presenceStream = null;
    const chatters = /\[presence\] (\d+) chatters/.exec(line);
    if (chatters) {
      this.botInfo.lastChatters = Number(chatters[1]);
      this.botInfo.lastSnapshotAt = new Date().toISOString();
    }
    if (/snapshot failed|worker stopped\. Check|REJECTED/.test(line))
      this.botInfo.lastPresenceError = clean;
    if (stream === 'stderr' || /fail|error|unusable|lacks/i.test(line))
      this.botInfo.lastError = clean;
  }

  private corePort(): number {
    return Number(this.deps.readCoreEnv().PORT || 3000);
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await this.deps.fetch(
        `http://127.0.0.1:${this.corePort()}/health`,
        {
          signal: AbortSignal.timeout(2000),
        },
      );
      const body = (await res.json()) as { status?: string };
      this.health = {
        ok: res.ok && body.status === 'ok',
        checkedAt: new Date().toISOString(),
        error: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (error) {
      this.health = {
        ok: false,
        checkedAt: new Date().toISOString(),
        error: (error as Error).message,
      };
    }
    return this.health.ok;
  }

  /** Logins excluded from passive gains (read from Core, display only). */
  private async passiveExclusions(): Promise<string[] | null> {
    const secret = this.deps.readCoreEnv().STUDIO_SECRET;
    if (!this.health.ok || !secret) return null;
    try {
      const res = await this.deps.fetch(
        `http://127.0.0.1:${this.corePort()}/v1/admin/loyalty/exclusions`,
        {
          headers: { authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(3000),
        },
      );
      if (!res.ok) return null;
      return ((await res.json()) as { login: string }[]).map((e) => e.login);
    } catch {
      return null;
    }
  }

  private async presenceSummary() {
    const secret = this.deps.readCoreEnv().STUDIO_SECRET;
    if (!this.health.ok || !secret) return null;
    try {
      const res = await this.deps.fetch(
        `http://127.0.0.1:${this.corePort()}/v1/admin/presence/streams/latest`,
        {
          headers: { authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(3000),
        },
      );
      if (res.status === 404) return { available: false as const };
      if (!res.ok)
        return { available: false as const, error: `HTTP ${res.status}` };
      const r = (await res.json()) as {
        streamId: string;
        endedAt: string | null;
        durationSeconds: number;
        uniqueViewers: number;
        cycles: {
          total: number;
          ok: number;
          failed: number;
          coveragePercent: number;
          lastOkAt: string | null;
        };
        errors: {
          observedAt: string;
          errorKind: string;
          httpStatus: number | null;
        }[];
      };
      return {
        available: true as const,
        streamId: r.streamId,
        live: r.endedAt === null,
        durationMinutes: Math.round(r.durationSeconds / 60),
        uniqueViewers: r.uniqueViewers,
        cycles: r.cycles,
        lastError: r.errors.at(-1) ?? null,
      };
    } catch (error) {
      return { available: false as const, error: (error as Error).message };
    }
  }

  async status() {
    await this.checkHealth();
    const botEnv = this.deps.readBotEnv();
    const token = this.deps.readToken();
    const coreEnv = this.deps.readCoreEnv();
    const broadcaster = this.deps.readToken(paths.broadcasterTokenFile);
    const { core, bot } = this.deps;
    return {
      busy: this.busy,
      sequence: this.sequence,
      postgres: await this.deps.docker.containerState(),
      core: {
        process: core.running
          ? core.adopted
            ? 'running (previous Studio session)'
            : 'running'
          : this.health.ok
            ? 'external'
            : 'stopped',
        pid: core.pid,
        lastExit: core.lastExit,
        health: this.health,
      },
      auth: {
        tokenFile: token.present,
        login: token.login,
        scopes: token.scopes,
        expiresAt: token.expiresAt,
        accessTokenFresh: token.expiresAt
          ? Date.parse(token.expiresAt) > Date.now()
          : false,
        hasRefreshToken: token.hasRefreshToken,
        lastPreflight: this.preflight,
      },
      bot: {
        state: bot.running
          ? bot.adopted
            ? 'running (previous Studio session)'
            : 'running'
          : bot.lastExit &&
              bot.lastExit.code !== 0 &&
              bot.lastExit.code !== null
            ? 'error'
            : 'stopped',
        pid: bot.pid,
        lastExit: bot.lastExit,
        flags: {
          DAILY_CHAT_COMMANDS: botEnv.DAILY_CHAT_COMMANDS ?? 'false',
          LOYALTY_CHAT_COMMANDS: botEnv.LOYALTY_CHAT_COMMANDS ?? 'false',
          PRESENCE_SHADOW: botEnv.PRESENCE_SHADOW ?? 'false',
          TWITCH_ENABLED_IN_FILE: botEnv.TWITCH_ENABLED ?? 'false',
        },
        guard: botGuard(botEnv),
        twitch: bot.running ? this.botInfo.twitch : 'not connected',
        lastError: this.botInfo.lastError,
      },
      loyalty: {
        flags: {
          LOYALTY_PREVIEW: coreEnv.LOYALTY_PREVIEW ?? 'false',
          LOYALTY_TWITCH_EVENTS: botEnv.LOYALTY_TWITCH_EVENTS ?? 'false',
          LOYALTY_PASSIVE_CREDITS: coreEnv.LOYALTY_PASSIVE_CREDITS ?? 'false',
          LOYALTY_EVENT_CREDITS: coreEnv.LOYALTY_EVENT_CREDITS ?? 'false',
        },
        creditsGuard: coreGuard(coreEnv),
        broadcasterToken: {
          login: broadcaster.login,
          scopes: broadcaster.scopes,
          hasRefreshToken: broadcaster.hasRefreshToken,
        },
        events: bot.running ? this.botInfo.loyaltyEvents : 'bot stopped',
        lastSubSnapshot: this.botInfo.lastSubSnapshot,
        passiveExclusions: await this.passiveExclusions(),
      },
      presence: {
        worker:
          bot.running && this.botInfo.presenceStream
            ? `tracking ${this.botInfo.presenceStream}`
            : bot.running
              ? 'waiting for live'
              : 'stopped',
        lastChatters: this.botInfo.lastChatters,
        lastSnapshotAt: this.botInfo.lastSnapshotAt,
        lastError: this.botInfo.lastPresenceError,
        report: await this.presenceSummary(),
      },
    };
  }

  /** One action at a time: double clicks never start two Cores or two bots. */
  private async exclusive<T>(action: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error(`busy: ${this.busy} in progress`);
    this.busy = action;
    try {
      return await fn();
    } finally {
      this.busy = null;
    }
  }

  // --- Postgres -------------------------------------------------------------------------------

  private async ensurePostgres(): Promise<StepResult> {
    let { state, detail } = await this.deps.docker.containerState();
    if (state === 'missing' || state === 'error')
      return { step: 'Postgres', ok: false, detail };
    if (state !== 'running') {
      this.log('postgres', 'starting container raptoru2-pg');
      await this.deps.docker.startContainer();
    }
    for (let i = 0; i < 30; i++) {
      if (await this.deps.docker.postgresReady())
        return { step: 'Postgres', ok: true, detail: 'accepting connections' };
      await this.deps.sleep(1000);
    }
    ({ state, detail } = await this.deps.docker.containerState());
    return {
      step: 'Postgres',
      ok: false,
      detail: `not ready (${state}: ${detail})`,
    };
  }

  startPostgres() {
    return this.exclusive('start postgres', () => this.ensurePostgres());
  }

  stopPostgres() {
    return this.exclusive('stop postgres', async () => {
      if (this.deps.core.running || this.deps.bot.running)
        throw new Error('stop the bot and Core first');
      this.log('postgres', 'stopping container raptoru2-pg (volume kept)');
      await this.deps.docker.stopContainer();
      return { step: 'Postgres', ok: true, detail: 'stopped (data kept)' };
    });
  }

  // --- Core -----------------------------------------------------------------------------------

  private async migrate(): Promise<StepResult> {
    const { code, lines } = await this.deps.runScript(
      paths.coreDir,
      ['--env-file-if-exists=.env', join('dist', 'scripts', 'migrate.js')],
      (line, stream) =>
        this.log(
          'core',
          `[migrate] ${line}`,
          stream === 'stderr' ? 'error' : 'info',
        ),
    );
    return {
      step: 'Migrations',
      ok: code === 0,
      detail:
        code === 0
          ? (lines.at(-1) ?? 'ok')
          : lines.slice(-3).join(' | ') || `exit ${code}`,
    };
  }

  private async ensureCore(): Promise<StepResult> {
    if (!this.deps.core.running && (await this.checkHealth())) {
      return {
        step: 'Core',
        ok: true,
        detail: 'already running outside the Studio (not managed)',
      };
    }
    if (!this.deps.core.running) {
      const refused = coreGuard(this.deps.readCoreEnv());
      if (refused) return { step: 'Core', ok: false, detail: refused };
      this.log('studio', 'starting Core (loyalty credits forced off)');
      // Parent env wins over --env-file: credits stay off even if the file changes later.
      this.deps.core.start({
        LOYALTY_PASSIVE_CREDITS: 'false',
        LOYALTY_EVENT_CREDITS: 'false',
      });
    }
    for (let i = 0; i < 40; i++) {
      if (await this.checkHealth())
        return {
          step: 'Core',
          ok: true,
          detail: `/health ok (pid ${this.deps.core.pid})`,
        };
      if (!this.deps.core.running) break;
      await this.deps.sleep(500);
    }
    return {
      step: 'Core',
      ok: false,
      detail: this.deps.core.running
        ? '/health not ok after 20s'
        : `Core exited (code ${this.deps.core.lastExit?.code})`,
    };
  }

  startCore() {
    return this.exclusive('start core', () => this.ensureCore());
  }

  stopCore() {
    return this.exclusive('stop core', () => this.doStopCore());
  }

  private async doStopCore(): Promise<StepResult> {
    if (this.deps.bot.running)
      return { step: 'Core', ok: false, detail: 'stop the bot first' };
    if (!this.deps.core.running) {
      return {
        step: 'Core',
        ok: !(await this.checkHealth()),
        detail: this.health.ok
          ? 'running outside the Studio: stop it where it was started'
          : 'not running',
      };
    }
    this.log('studio', 'stopping Core');
    await this.deps.core.stop();
    return { step: 'Core', ok: true, detail: 'stopped' };
  }

  restartCore() {
    return this.exclusive('restart core', async () => {
      const stopped = await this.doStopCore();
      if (!stopped.ok) return stopped;
      return this.ensureCore();
    });
  }

  // --- Twitch preflight -----------------------------------------------------------------------

  private async doPreflight(): Promise<StepResult> {
    const { code, lines } = await this.deps.runScript(
      paths.botDir,
      [
        '--env-file-if-exists=.env',
        join('dist', 'scripts', 'presence-preflight.js'),
      ],
      (line, stream) =>
        this.log('preflight', line, stream === 'stderr' ? 'error' : 'info'),
    );
    const clean = lines.map((l) => this.deps.redact(l));
    this.preflight = {
      ok: code === 0,
      at: new Date().toISOString(),
      lines: clean.filter((l) => !/^\s*at /.test(l)).slice(-8),
    };
    return {
      step: 'Twitch Auth',
      ok: code === 0,
      detail:
        code === 0
          ? (clean.find((l) => l.startsWith('OK:')) ?? 'preflight ok')
          : (clean.find((l) => l.startsWith('FAIL')) ??
            clean.at(-1) ??
            `exit ${code}`),
    };
  }

  runPreflight() {
    return this.exclusive('preflight', () => this.doPreflight());
  }

  // --- Bot ------------------------------------------------------------------------------------

  private async doStartBot(): Promise<StepResult> {
    const refused = botGuard(this.deps.readBotEnv());
    if (refused) {
      this.log('studio', `bot start ${refused}`, 'error');
      return { step: 'Presence Shadow', ok: false, detail: refused };
    }
    if (this.deps.bot.running)
      return {
        step: 'Presence Shadow',
        ok: true,
        detail: `bot already running (pid ${this.deps.bot.pid})`,
      };
    if (!(await this.checkHealth()))
      return {
        step: 'Presence Shadow',
        ok: false,
        detail: 'Core is not healthy',
      };

    this.botInfo = {
      ...this.botInfo,
      twitch: 'not connected',
      lastError: null,
      presenceStream: null,
    };
    this.log(
      'studio',
      'starting twitch-bot (presence shadow, chat commands off)',
    );
    // Enables Twitch for this child only; the .env file keeps TWITCH_ENABLED=false.
    this.deps.bot.start({
      TWITCH_ENABLED: 'true',
      DAILY_CHAT_COMMANDS: 'false',
      LOYALTY_CHAT_COMMANDS: 'false',
      PRESENCE_SHADOW: 'true',
    });
    for (let i = 0; i < 40; i++) {
      if (this.botInfo.twitch !== 'not connected') {
        return {
          step: 'Presence Shadow',
          ok: true,
          detail: `bot running (pid ${this.deps.bot.pid}), Twitch auth ok`,
        };
      }
      if (!this.deps.bot.running) break;
      await this.deps.sleep(500);
    }
    const detail = this.deps.bot.running
      ? 'bot started but Twitch auth not confirmed after 20s'
      : `bot exited: ${this.botInfo.lastError ?? `code ${this.deps.bot.lastExit?.code}`}`;
    return { step: 'Presence Shadow', ok: false, detail };
  }

  startBot() {
    return this.exclusive('start bot', () => this.doStartBot());
  }

  private async doStopBot(): Promise<StepResult> {
    if (!this.deps.bot.running)
      return { step: 'Bot', ok: true, detail: 'not running' };
    this.log('studio', 'stopping twitch-bot');
    await this.deps.bot.stop();
    this.botInfo.presenceStream = null;
    return { step: 'Bot', ok: true, detail: 'stopped' };
  }

  stopBot() {
    return this.exclusive('stop bot', () => this.doStopBot());
  }

  restartBot() {
    return this.exclusive('restart bot', async () => {
      await this.doStopBot();
      return this.doStartBot();
    });
  }

  // --- Sequences ------------------------------------------------------------------------------

  /** Postgres → migrations → Core → health → preflight → bot. Stops at the first failure. */
  startAll() {
    return this.exclusive('start all', async () => {
      this.sequence = { running: true, action: 'Start All', steps: [] };
      const steps: (() => Promise<StepResult>)[] = [
        () => this.ensurePostgres(),
        () => this.migrate(),
        () => this.ensureCore(),
        () => this.doPreflight(),
        () => this.doStartBot(),
      ];
      try {
        for (const step of steps) {
          const result = await step();
          this.sequence.steps.push(result);
          this.log(
            'studio',
            `${result.ok ? '✅' : '❌'} ${result.step}: ${result.detail}`,
            result.ok ? 'info' : 'error',
          );
          if (!result.ok) return this.sequence.steps;
        }
        this.sequence.steps.push({
          step: 'Chat Commands OFF',
          ok: this.deps.readBotEnv().DAILY_CHAT_COMMANDS !== 'true',
          detail: 'DAILY_CHAT_COMMANDS=false',
        });
        return this.sequence.steps;
      } finally {
        this.sequence.running = false;
      }
    });
  }

  /** Bot then Core. Postgres keeps running. */
  stopAll() {
    return this.exclusive('stop all', async () => {
      this.sequence = { running: true, action: 'Stop All', steps: [] };
      try {
        this.sequence.steps.push(await this.doStopBot());
        this.sequence.steps.push(await this.reconcileStream());
        this.sequence.steps.push(await this.doStopCore());
        return this.sequence.steps;
      } finally {
        this.sequence.running = false;
      }
    });
  }

  /** Studio closing: stop what the Studio started, never Postgres. */
  async shutdown(): Promise<void> {
    await this.deps.bot.stop().catch(() => {});
    await this.reconcileStream().catch(() => {});
    await this.deps.core.stop().catch(() => {});
  }

  /**
   * With the bot stopped, nothing would receive stream.offline anymore: ask Twitch once (Helix,
   * read-only) and report the live state to Core before Core stops. If Twitch still says live,
   * the session stays open and the next bot start closes it at the last live confirmation.
   */
  private async reconcileStream(): Promise<StepResult> {
    if (!this.deps.core.running || !(await this.checkHealth())) {
      return {
        step: 'Stream state',
        ok: true,
        detail: 'Core not running: nothing to reconcile',
      };
    }
    const { code, lines } = await this.deps.runScript(
      paths.botDir,
      [
        '--env-file-if-exists=.env',
        join('dist', 'scripts', 'stream-reconcile.js'),
      ],
      (line, stream) =>
        this.log(
          'bot',
          `[reconcile] ${line}`,
          stream === 'stderr' ? 'error' : 'info',
        ),
      20_000,
    );
    return {
      step: 'Stream state',
      ok: code === 0,
      detail: this.deps.redact(lines.at(-1) ?? `exit ${code}`),
    };
  }
}
