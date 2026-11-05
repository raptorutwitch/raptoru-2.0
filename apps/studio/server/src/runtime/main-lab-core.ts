import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  loadOrCreateInstallation,
  type StudioInstallation,
} from '../prod-transport/installation.js';

// The local Lab on the MAIN Core (decision of 05/11/2026; opt-in STUDIO_LAB_CORE=main while the historical Lab Core
// stays the default): Studio's runtime prepares and starts apps/core-api/dist/index.js with CORE_ENVIRONMENT=lab — the
// Production entry point, assembly and schema — then talks to it exactly as the installed Studio talks to the VPS
// (installation credential, /v1/studio, /v1/ext), over plain HTTP on loopback only.
// - Its environment is built HERE, from nothing (a clean environment: no variable of Studio's process reaches it), with
//   secrets generated once for this PC (never a Production one) and the local database of apps/core-api/.env.
// - The Core's own guards still decide (loopback database, fictional channel 900100, no real Twitch app).
// - Optional and read-only: the PUBLIC 7TV / BTTV / FFZ catalogs of a real channel (STUDIO_LAB_EMOTE_CATALOG_CHANNEL_ID,
//   off by default) — no token, no account.

export const MAIN_LAB_CORE_PORT = 4302;
export const MAIN_LAB_DATABASE = 'raptoru_core_lab';
export const MAIN_LAB_CHANNEL = { id: '900100', login: 'raptoru_lab' };

interface Secrets {
  bot: string;
  studio: string;
  extension: string;
}

async function loadOrCreateSecrets(file: string): Promise<Secrets> {
  try {
    const s = JSON.parse(await readFile(file, 'utf8')) as Partial<Secrets>;
    if (s.bot && s.studio && s.extension) return s as Secrets;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const s: Secrets = {
    bot: randomBytes(24).toString('hex'),
    studio: randomBytes(24).toString('hex'),
    extension: randomBytes(32).toString('base64'),
  };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(s), { mode: 0o600 });
  return s;
}

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

export class MainLabCore {
  readonly url = `http://127.0.0.1:${MAIN_LAB_CORE_PORT}`;
  private constructor(
    readonly coreDir: string,
    readonly installation: StudioInstallation,
    private readonly secrets: Secrets,
    private readonly options: { emoteCatalogChannelId: string | null },
  ) {}

  static async open(o: {
    runtimeDir: string;
    coreDir: string;
    emoteCatalogChannelId?: string | null;
  }): Promise<MainLabCore> {
    const dir = join(o.runtimeDir, 'lab-main');
    const url = `http://127.0.0.1:${MAIN_LAB_CORE_PORT}`;
    const emote = o.emoteCatalogChannelId?.trim() || null;
    if (emote && !/^\d{1,32}$/.test(emote))
      throw new Error(
        'STUDIO_LAB_EMOTE_CATALOG_CHANNEL_ID : identifiant Twitch numérique attendu',
      );
    return new MainLabCore(
      o.coreDir,
      await loadOrCreateInstallation(join(dir, 'studio-installation.json'), {
        coreOrigin: url,
        caSha256: null,
      }),
      await loadOrCreateSecrets(join(dir, 'core-secrets.json')),
      { emoteCatalogChannelId: emote },
    );
  }

  /** The Lab Core's extension secret: Studio signs the Extension Lab's JWT with it (core-frontier.ts). */
  get extensionSecret(): Buffer {
    return Buffer.from(this.secrets.extension, 'base64');
  }

  get emoteCatalog(): string | null {
    return this.options.emoteCatalogChannelId;
  }

  /** The Core's whole environment (nothing else is passed): its local database, fictional channel, own secrets. */
  env(coreDatabaseUrl: string | undefined): Record<string, string> {
    if (!coreDatabaseUrl)
      throw new Error('DATABASE_URL absent de apps/core-api/.env');
    const db = new URL(coreDatabaseUrl);
    if (!LOCAL_HOSTS.includes(db.hostname))
      throw new Error(
        'base locale requise (DATABASE_URL doit viser 127.0.0.1)',
      );
    db.pathname = `/${MAIN_LAB_DATABASE}`;
    return {
      CORE_ENVIRONMENT: 'lab',
      PORT: String(MAIN_LAB_CORE_PORT),
      DATABASE_URL: db.href,
      TWITCH_CHANNEL_ID: MAIN_LAB_CHANNEL.id,
      TWITCH_CHANNEL_LOGIN: MAIN_LAB_CHANNEL.login,
      BOT_SECRET: this.secrets.bot,
      STUDIO_SECRET: this.secrets.studio,
      TWITCH_EXTENSION_SECRET: this.secrets.extension,
      ...(this.options.emoteCatalogChannelId
        ? { EMOTE_CATALOG_CHANNEL_ID: this.options.emoteCatalogChannelId }
        : {}),
    };
  }

  /** Database created if missing, pending migrations (production migrator), first fixtures, Studio paired. */
  prepare(env: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      const child = spawn(
        process.execPath,
        [
          join('dist', 'scripts', 'lab-prepare.js'),
          this.installation.pairingCode,
        ],
        {
          cwd: this.coreDir,
          env: { ...cleanEnv(), ...env },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (d: Buffer) =>
          lines.push(...d.toString('utf8').split(/\r?\n/).filter(Boolean)),
        );
      child.on('error', (e) => reject(e));
      child.on('exit', (code) =>
        code === 0
          ? resolve(
              (lines.at(-1) ?? 'préparé').replace(/^\[lab-prepare\]\s*/, ''),
            )
          : reject(
              new Error(
                `préparation du Core Lab refusée : ${lines.slice(-3).join(' · ') || `code ${code}`}`,
              ),
            ),
      );
    });
  }
}

/**
 * What a child process needs from the OS and nothing else (no variable of Studio's process: tokens, secrets, Twitch
 * apps…). Windows keys are case-insensitive: each is copied as present.
 */
export function cleanEnv(): Record<string, string> {
  const keep = new Set([
    'PATH',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'COMSPEC',
    'PATHEXT',
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] =>
        keep.has(e[0].toUpperCase()) && typeof e[1] === 'string',
    ),
  );
}
