import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import pg from 'pg';
import { dockerOps, type DockerOps } from '../test-lab/docker.js';
import {
  paths,
  readEnvFile,
  REPO_ROOT,
  type EnvFile,
} from '../test-lab/local-env.js';
import type { LogBuffer } from '../test-lab/log-buffer.js';
import { ManagedProcess, PidStore } from '../test-lab/managed-process.js';

// Local Runtime Manager: what Studio must run by itself so that Hub + Bonk + Soundboard work with
// their real local pipeline, with no terminal and no `npm run bonk:lab`.
//
//   Docker Postgres (raptoru2-pg) → Lab database + Lab migrations → Lab Core (127.0.0.1:4301)
//
// The Lab Core is the existing isolated test entrypoint (apps/core-api/dist/bonk-lab/local-server.js):
// test_mode, simulated payment, dedicated database, no Wallet / Loyalty / bot. Studio's Bonk and
// Soundboard workers talk to it with a per-session secret that never leaves this machine.
// Nothing here connects to the production channel, SAMMI or StreamElements.

export const LAB_CORE_PORT = 4301;
export const LAB_DATABASE = 'raptoru_bonk_lab';
/**
 * Only the Lab migrations, in order: never the Wallet / Loyalty / Daily schema. Must equal
 * LAB_MIGRATIONS of apps/core-api/src/db/migration-scopes.ts (checked by the core-api tests).
 */
export const LAB_MIGRATIONS = [
  '20260929120000_bonk_lab.sql',
  '20260930120000_bonk_lab_twitch.sql',
  '20261001120000_bonk_lab_third_party.sql',
  '20261002120000_sound_lab.sql',
  '20261003120000_sound_lab_custom_label.sql',
  '20261004120000_tts_lab.sql',
  '20261005120000_lab_moderation.sql',
  '20261006120000_tts_lab_cooldown_clear.sql',
  '20261007120000_moderation_d4.sql',
  '20261008120000_raffle_v2.sql',
  '20261009120000_raffle_scheduler.sql',
  '20261010120000_raffle_round_labels.sql',
  '20261011120000_commands_v2.sql',
  '20261012120000_commands_v2_invocations.sql',
  '20261013120000_commands_v2_steps.sql',
  '20261014120000_commands_v2_categories.sql',
  '20261015120000_lab_moderation_idempotency.sql',
  '20261016130000_lab_stream_session_twitch_id.sql',
  '20261017120000_bonk_lab_viewer_oauth.sql',
  '20261018120000_bonk_lab_volleys.sql',
  '20261019120000_cmd_steps_word_game.sql',
  '20261019130000_word_game_lab.sql',
  '20261020120000_mini_games_lab.sql',
  '20261021120000_mini_game_duels_lab.sql',
  '20261022120000_alerts_lab.sql',
  '20261023120000_alerts_lab_families.sql',
  '20261025120000_channel_points_lab.sql',
  '20261026120000_random_ban_lab.sql',
  '20261027120000_sub_wheel_lab.sql',
  '20261030120000_lab_ledger_channel_points.sql',
  '20261031140000_cmd_steps_win_announcements_lab.sql',
  '20261104120000_cp_redemptions_chat_source_lab.sql',
  '20261105120000_caution_lab.sql',
  '20261106120000_votekick_lab.sql',
  '20261107120000_votekick_settings_lab.sql',
  '20261108120000_spotify_lab.sql',
  '20261108140000_cmd_steps_music_lab.sql',
];

export type ServiceState =
  'stopped' | 'starting' | 'ready' | 'degraded' | 'error';
export interface ServiceStatus {
  id: 'postgres' | 'database' | 'labcore' | 'providers';
  label: string;
  state: ServiceState;
  detail: string;
  since: string;
}

export interface RuntimeDeps {
  docker: DockerOps;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  portFree: (port: number) => Promise<boolean>;
  /** Creates the Lab database if needed and applies the Lab migrations. Returns what was applied. */
  prepareDatabase: (adminUrl: string) => Promise<string[]>;
  labCore: ManagedProcess;
  readCoreEnv: () => EnvFile;
  readBotEnv: () => EnvFile;
  logs: LogBuffer;
  /** Removes known secrets from any detail shown in the UI. */
  redact: (text: string) => string;
}

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
/** Crash policy: at most 3 automatic restarts in 5 minutes, then manual retry only (no crash loop). */
const RESTART_DELAYS = [2000, 5000, 10000];
const RESTART_WINDOW_MS = 5 * 60_000;
/** A live process whose /health stays silent this long is frozen: stopped, then the crash policy. */
const FROZEN_MS = 20_000;

export function labDatabaseUrl(coreDatabaseUrl: string | undefined): URL {
  if (!coreDatabaseUrl)
    throw new Error('DATABASE_URL absent de apps/core-api/.env');
  const url = new URL(coreDatabaseUrl);
  if (!LOCAL_HOSTS.includes(url.hostname))
    throw new Error('base locale requise (DATABASE_URL doit viser 127.0.0.1)');
  url.pathname = `/${LAB_DATABASE}`;
  return url;
}

export class LocalRuntime {
  private services = new Map<ServiceStatus['id'], ServiceStatus>();
  private stopping = false;
  private running: Promise<void> | null = null;
  private restarts: number[] = [];
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Since when the live Lab Core's /health has been silent (null: it answers). */
  private silentSince: number | null = null;
  readonly secret = randomBytes(32).toString('hex');
  readonly coreUrl = `http://127.0.0.1:${LAB_CORE_PORT}`;

  constructor(readonly deps: RuntimeDeps) {
    for (const [id, label] of [
      ['postgres', 'Postgres (Docker)'],
      ['database', 'Base locale Lab'],
      ['labcore', 'Core local (Bonk · Soundboard)'],
      ['providers', 'Providers emotes'],
    ] as const)
      this.set(id, 'stopped', '—', label);
  }

  private set(
    id: ServiceStatus['id'],
    state: ServiceState,
    detail: string,
    label?: string,
  ) {
    const prev = this.services.get(id);
    if (prev && prev.state === state && prev.detail === detail) return;
    this.services.set(id, {
      id,
      label: label ?? prev?.label ?? id,
      state,
      detail: this.deps.redact(detail),
      since: new Date(this.deps.now()).toISOString(),
    });
    if (prev && prev.state !== state)
      this.deps.logs.add(
        'runtime',
        `${prev.label} : ${state} — ${detail}`,
        state === 'error' ? 'error' : 'info',
      );
  }

  status() {
    return {
      services: [...this.services.values()],
      // The Studio port actually used (PORT, as the server reads it), not an assumed 4100.
      ports: {
        studio: Number(process.env.PORT ?? 4100),
        labCore: LAB_CORE_PORT,
        oauthCallback: 3789,
      },
      restartsInWindow: this.recentRestarts().length,
    };
  }

  get ready(): boolean {
    return this.services.get('labcore')?.state === 'ready';
  }

  /** Starts (or retries) the whole local stack. Never throws: every failure becomes a visible state. */
  start(): Promise<void> {
    if (this.running) return this.running;
    this.stopping = false;
    this.running = this.bringUp().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private adoptionChecked = false;

  private async bringUp(): Promise<void> {
    // A Lab Core left running by a Studio that was killed is recognised by its stored PID (and only
    // if it is still a node process): it is replaced below, never mistaken for a foreign one.
    if (!this.adoptionChecked) {
      this.adoptionChecked = true;
      if (await this.deps.labCore.adoptPrevious())
        this.deps.logs.add(
          'runtime',
          `Core local orphelin retrouvé (pid ${this.deps.labCore.pid})`,
        );
    }
    if (!(await this.ensurePostgres())) return this.retryLater(10_000);
    if (!(await this.ensureDatabase())) return;
    await this.ensureLabCore();
  }

  private retryLater(ms: number) {
    if (this.stopping) return;
    clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => void this.start(), ms);
  }

  private async ensurePostgres(): Promise<boolean> {
    const { state, detail } = await this.deps.docker.containerState();
    if (state === 'error') {
      this.set(
        'postgres',
        'error',
        `Docker ne répond pas (Docker Desktop lancé ?) — nouvel essai auto : ${detail}`,
      );
      return false;
    }
    if (state === 'missing') {
      this.set('postgres', 'error', 'conteneur raptoru2-pg introuvable');
      return false;
    }
    if (state !== 'running') {
      this.set('postgres', 'starting', 'démarrage du conteneur raptoru2-pg');
      try {
        await this.deps.docker.startContainer();
      } catch (e) {
        this.set('postgres', 'error', (e as Error).message);
        return false;
      }
    }
    for (let i = 0; i < 30 && !this.stopping; i++) {
      if (await this.deps.docker.postgresReady()) {
        this.set('postgres', 'ready', 'accepte les connexions');
        return true;
      }
      this.set('postgres', 'starting', 'en attente de Postgres');
      await this.deps.sleep(1000);
    }
    this.set('postgres', 'error', 'Postgres non prêt après 30 s');
    return false;
  }

  private labUrl: URL | null = null;

  private async ensureDatabase(): Promise<boolean> {
    try {
      this.labUrl = labDatabaseUrl(this.deps.readCoreEnv().DATABASE_URL);
      const admin = new URL(this.labUrl.href);
      admin.pathname = '/postgres';
      this.set('database', 'starting', 'migrations Lab');
      const applied = await this.deps.prepareDatabase(admin.href);
      this.set(
        'database',
        'ready',
        applied.length
          ? `${LAB_DATABASE} · ${applied.length} migration(s) appliquée(s)`
          : `${LAB_DATABASE} · à jour`,
      );
      return true;
    } catch (e) {
      // Migration errors are shown, never retried blindly (no loop on a broken migration).
      this.set('database', 'error', (e as Error).message);
      return false;
    }
  }

  private async labCoreHealth(): Promise<{ ok: boolean; service?: string }> {
    try {
      const res = await this.deps.fetch(`${this.coreUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      const body = (await res.json()) as { service?: string };
      return { ok: res.ok, service: body.service };
    } catch {
      return { ok: false };
    }
  }

  /** Readiness (/ready): the Lab Core answers AND its database does. */
  private async labCoreReady(): Promise<boolean> {
    try {
      const res = await this.deps.fetch(`${this.coreUrl}/ready`, {
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async ensureLabCore(): Promise<void> {
    const core = this.deps.labCore;
    // A Lab Core left by a crashed Studio session cannot know this session's secret: replace it.
    if (core.running) {
      this.deps.logs.add(
        'runtime',
        `Core local d'une session précédente (pid ${core.pid}) : arrêt`,
      );
      await core.stop();
    }
    if (!(await this.deps.portFree(LAB_CORE_PORT))) {
      const other = await this.labCoreHealth();
      this.set(
        'labcore',
        'error',
        other.service === 'bonk-lab-core'
          ? `port ${LAB_CORE_PORT} déjà utilisé par un Core Lab lancé hors Studio (npm run bonk:lab ?) — ferme-le puis « Réessayer »`
          : `port ${LAB_CORE_PORT} occupé par une autre application — libère-le puis « Réessayer »`,
      );
      return;
    }
    const bot = this.deps.readBotEnv();
    const clientId = bot.TWITCH_CLIENT_ID ?? '';
    const clientSecret = bot.TWITCH_CLIENT_SECRET ?? '';
    const channel = bot.TWITCH_BROADCASTER_ID ?? '';
    this.set('labcore', 'starting', `lancement sur 127.0.0.1:${LAB_CORE_PORT}`);
    core.start({
      BONK_LAB_DATABASE_URL: this.labUrl!.href,
      BONK_LAB_SECRET: this.secret,
      // Twitch app of Raptoru 2.0 (local .env), for the Lab Core only; never sent to the UI.
      BONK_LAB_TWITCH_CLIENT_ID: clientId,
      BONK_LAB_TWITCH_CLIENT_SECRET: clientSecret,
      BONK_LAB_CHANNEL_TWITCH_ID: channel,
    });
    const providers: string[] = [];
    providers.push(
      clientId && clientSecret
        ? 'Twitch (connexion viewer)'
        : 'Twitch : app absente du .env',
    );
    providers.push(
      /^\d+$/.test(channel)
        ? '7TV · BTTV · FFZ'
        : '7TV/BTTV/FFZ : TWITCH_BROADCASTER_ID absent',
    );
    providers.push('Twemoji');
    for (let i = 0; i < 40 && !this.stopping; i++) {
      if ((await this.labCoreHealth()).ok) {
        this.set(
          'labcore',
          'ready',
          `127.0.0.1:${LAB_CORE_PORT} (pid ${core.pid})`,
        );
        this.set(
          'providers',
          clientId && clientSecret && /^\d+$/.test(channel)
            ? 'ready'
            : 'degraded',
          providers.join(' · '),
        );
        this.watch();
        return;
      }
      if (!core.running) break;
      await this.deps.sleep(500);
    }
    this.set(
      'labcore',
      'error',
      core.running
        ? '/health sans réponse après 20 s'
        : `arrêt immédiat (code ${core.lastExit?.code ?? '?'}) — voir les logs`,
    );
    if (core.running) await core.stop();
    this.onCrash();
  }

  private recentRestarts() {
    const now = this.deps.now();
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    return this.restarts;
  }

  /** Unexpected stop: bounded automatic restart, then manual retry only. */
  private onCrash() {
    if (this.stopping) return;
    const recent = this.recentRestarts();
    if (recent.length >= RESTART_DELAYS.length) {
      this.set(
        'labcore',
        'error',
        `arrêts répétés (${recent.length} relances en 5 min) — relance manuelle « Réessayer »`,
      );
      return;
    }
    const delay = RESTART_DELAYS[recent.length]!;
    this.restarts.push(this.deps.now());
    this.set(
      'labcore',
      'starting',
      `arrêt inattendu — relance automatique dans ${delay / 1000} s`,
    );
    this.retryLater(delay);
  }

  /**
   * Health watch: a crashed Lab Core restarts (bounded); a live one whose /health stays silent for
   * FROZEN_MS is frozen: stopped, then the same bounded policy (ASTRA-P1-011). A live Core whose
   * database does not answer (/ready) is shown degraded with that reason and never restarted: an
   * outside outage, it recovers by itself (ASTRA-P1-005).
   */
  private watch() {
    clearTimeout(this.watchTimer);
    this.silentSince = null;
    const loop = async () => {
      if (this.stopping) return;
      const alive = this.deps.labCore.running;
      const health = alive ? await this.labCoreHealth() : { ok: false };
      if (this.stopping) return;
      if (!alive) {
        this.set(
          'labcore',
          'error',
          `processus arrêté (code ${this.deps.labCore.lastExit?.code ?? '?'})`,
        );
        this.set('providers', 'stopped', 'Core local arrêté');
        return this.onCrash();
      }
      if (!health.ok) {
        const now = this.deps.now();
        this.silentSince ??= now;
        if (now - this.silentSince >= FROZEN_MS) {
          this.set(
            'labcore',
            'error',
            `/health muet depuis ${FROZEN_MS / 1000} s alors que le processus vit (figé) — arrêt`,
          );
          await this.deps.labCore.stop();
          if (this.stopping) return;
          this.set('providers', 'stopped', 'Core local arrêté');
          return this.onCrash();
        }
        this.set('labcore', 'degraded', '/health ne répond pas');
      } else {
        this.silentSince = null;
        const ready = await this.labCoreReady();
        if (this.stopping) return;
        if (!ready)
          this.set(
            'labcore',
            'degraded',
            'Core local vivant, base de données injoignable — reprise automatique dès son retour',
          );
        else if (this.services.get('labcore')?.state !== 'ready')
          this.set(
            'labcore',
            'ready',
            `127.0.0.1:${LAB_CORE_PORT} (pid ${this.deps.labCore.pid})`,
          );
      }
      this.watchTimer = setTimeout(() => void loop(), 3000);
    };
    this.watchTimer = setTimeout(() => void loop(), 3000);
  }

  /** Manual « Réessayer » / « Redémarrer » from the UI: resets the crash budget. */
  async restart(): Promise<void> {
    this.restarts = [];
    clearTimeout(this.watchTimer);
    await this.running;
    if (this.deps.labCore.running) {
      this.set('labcore', 'starting', 'redémarrage demandé');
      this.stopping = true;
      await this.deps.labCore.stop();
      this.stopping = false;
    }
    await this.start();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.watchTimer);
    await this.deps.labCore.stop();
    this.set('labcore', 'stopped', 'arrêté avec Studio');
  }
}

/** Real dependencies (Docker, Postgres, the Lab Core child). */
export function createLocalRuntime(
  logs: LogBuffer,
  redactor: (text: string) => string,
  labCore?: ManagedProcess,
): LocalRuntime {
  const pids = new PidStore(paths.runtimeDir);
  return new LocalRuntime({
    docker: dockerOps,
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    portFree,
    prepareDatabase,
    labCore:
      labCore ??
      new ManagedProcess({
        name: 'labcore',
        cwd: REPO_ROOT,
        args: [join('apps', 'core-api', 'dist', 'bonk-lab', 'local-server.js')],
        pids,
        onLine: (line, stream) =>
          logs.add('labcore', line, stream === 'stderr' ? 'error' : 'info'),
      }),
    readCoreEnv: () => readEnvFile(paths.coreEnv),
    readBotEnv: () => readEnvFile(paths.botEnv),
    logs,
    redact: redactor,
  });
}

export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

/** Same steps as scripts/bonk-lab.mjs: dedicated database, Lab migrations only, in one transaction. */
export async function prepareDatabase(adminUrl: string): Promise<string[]> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const exists = await admin.query(
      'select 1 from pg_database where datname = $1',
      [LAB_DATABASE],
    );
    if (!exists.rowCount) await admin.query(`create database ${LAB_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${LAB_DATABASE}`;
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const applied: string[] = [];
  try {
    await db.query('begin');
    await db.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    for (const migration of LAB_MIGRATIONS) {
      const done = await db.query(
        'select 1 from schema_migrations where name = $1',
        [migration],
      );
      if (done.rowCount) continue;
      await db.query(
        await readFile(
          join(REPO_ROOT, 'supabase', 'migrations', migration),
          'utf8',
        ),
      );
      await db.query('insert into schema_migrations(name) values($1)', [
        migration,
      ]);
      applied.push(migration);
    }
    await db.query('commit');
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw new Error(`migration Lab refusée : ${(e as Error).message}`, {
      cause: e,
    });
  } finally {
    await db.end();
  }
  return applied;
}
