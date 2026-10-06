import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  loadOrCreateInstallation,
  type StudioInstallation,
} from './installation.js';
import { BUILT_IN_PRODUCTION, ENV_CORE_DEFAULT_CHANNEL } from './built-in.js';

// ASTRA-P1-019 lot 2 (D6): one Studio app, two profiles — Lab (default) and Production.
// - The choice is persisted (`profile.json`) and read at startup only: changing it is an explicit
//   action followed by a supervised restart of the Studio server, never a hot switch.
// - The Production Core is NOT configurable from the Studio page: its URL is a build constant
//   (built-in.ts, the staging Core until the cutover); the process environment overrides it only for
//   a local test Core (and its trusted CA). A page can therefore never send the installation
//   credential to another host (lot 2 security review).
// - At startup, Production is restored only if its configuration passes the static checks (https,
//   sane URL, readable PEM, healthy identity bound to that Core); otherwise Lab, with the reason
//   shown. Runtime failures (Core unreachable, revoked…) keep Production and show the state.

export type Profile = 'lab' | 'production';

export const PRODUCTION_ENV = {
  url: 'RAPTORU_PRODUCTION_CORE_URL',
  ca: 'RAPTORU_PRODUCTION_CA_FILE',
  channel: 'RAPTORU_PRODUCTION_CHANNEL_ID',
} as const;

export interface ProductionConfig {
  url: string;
  origin: string;
  /** Trust anchor replacing the default roots (local test Core, private CA); undefined = system roots. */
  ca: Buffer | undefined;
  caSha256: string | null;
  /** Twitch channel served by this Core (workers, cockpit). */
  channelId: string;
  /** Shown in Studio: « Staging » (build constant) or « Test (environnement) ». */
  label: string;
}

export type ConfigCheck =
  | { ok: true; config: ProductionConfig }
  | { ok: false; code: string; message: string };

const MAX_CA_BYTES = 64 * 1024;

/**
 * Static checks only (no network): https, sane URL, readable PEM certificate. Without an environment
 * URL, the build constant (staging Core); an explicitly empty one disables Production.
 */
export async function productionConfig(
  env: Record<string, string | undefined>,
): Promise<ConfigCheck> {
  const fromEnv = env[PRODUCTION_ENV.url] !== undefined;
  const raw = fromEnv ? env[PRODUCTION_ENV.url] : BUILT_IN_PRODUCTION.url;
  const channelId =
    env[PRODUCTION_ENV.channel] ??
    (fromEnv ? ENV_CORE_DEFAULT_CHANNEL : BUILT_IN_PRODUCTION.channelId);
  if (!/^\d{1,32}$/.test(channelId))
    return {
      ok: false,
      code: 'invalid_channel',
      message: `Chaîne du Core invalide (${PRODUCTION_ENV.channel})`,
    };
  if (!raw)
    return {
      ok: false,
      code: 'not_configured',
      message: `Core de production non configuré (${PRODUCTION_ENV.url})`,
    };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid_url', message: 'URL du Core invalide' };
  }
  if (url.protocol !== 'https:')
    return {
      ok: false,
      code: 'https_required',
      message: 'URL du Core refusée : HTTPS obligatoire',
    };
  if (
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return {
      ok: false,
      code: 'invalid_url',
      message:
        'URL du Core invalide : origine seule attendue (https://hôte[:port])',
    };
  let ca: Buffer | undefined;
  const caFile = env[PRODUCTION_ENV.ca];
  if (caFile) {
    // Never a network path (Windows UNC would open an SMB connection).
    if (/^(\\\\|\/\/)/.test(caFile))
      return {
        ok: false,
        code: 'invalid_ca',
        message: 'Certificat refusé : chemin réseau interdit',
      };
    try {
      ca = await readFile(caFile);
    } catch {
      return {
        ok: false,
        code: 'invalid_ca',
        message: 'Certificat de confiance illisible',
      };
    }
    if (
      ca.length > MAX_CA_BYTES ||
      !ca.toString('latin1').includes('-----BEGIN CERTIFICATE-----')
    )
      return {
        ok: false,
        code: 'invalid_ca',
        message: 'Certificat de confiance invalide (PEM attendu)',
      };
  }
  return {
    ok: true,
    config: {
      url: url.origin + '/',
      origin: url.origin,
      ca,
      caSha256: ca ? createHash('sha256').update(ca).digest('hex') : null,
      channelId,
      label: fromEnv ? 'Test (environnement)' : BUILT_IN_PRODUCTION.label,
    },
  };
}

export function profileFiles(runtimeDir: string) {
  const productionDir = join(runtimeDir, 'production');
  return {
    profile: join(runtimeDir, 'profile.json'),
    productionDir,
    identity: join(productionDir, 'studio-installation.json'),
    journal: (module: 'bonk' | 'sound' | 'tts') =>
      join(productionDir, module, 'journal.json'),
  };
}

/** The persisted choice; anything unreadable is Lab (with the reason). */
export async function readProfileChoice(
  file: string,
): Promise<{ choice: Profile; notice: string | null }> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return { choice: 'lab', notice: null };
    return { choice: 'lab', notice: 'Choix de profil illisible : profil Lab' };
  }
  try {
    const data = JSON.parse(text) as { profile?: unknown };
    if (data.profile === 'lab' || data.profile === 'production')
      return { choice: data.profile, notice: null };
  } catch {
    /* below */
  }
  return { choice: 'lab', notice: 'Choix de profil invalide : profil Lab' };
}

export async function writeProfileChoice(file: string, choice: Profile) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    `${file}.tmp`,
    JSON.stringify({ version: 1, profile: choice }),
  );
  await rename(`${file}.tmp`, file);
}

/** Identity bound to `config`'s Core: a different binding is a static error (no credential sent). */
export async function productionIdentity(
  identityFile: string,
  config: ProductionConfig,
): Promise<
  | { ok: true; installation: StudioInstallation }
  | { ok: false; code: string; message: string }
> {
  let installation: StudioInstallation;
  try {
    installation = await loadOrCreateInstallation(identityFile, {
      coreOrigin: config.origin,
      caSha256: config.caSha256,
    });
  } catch {
    return {
      ok: false,
      code: 'identity_corrupt',
      message:
        'Identité Studio illisible : rien n’est régénéré automatiquement (régénération explicite requise)',
    };
  }
  if (
    installation.binding.coreOrigin !== config.origin ||
    installation.binding.caSha256 !== config.caSha256
  )
    return {
      ok: false,
      code: 'identity_mismatch',
      message:
        'Identité Studio liée à un autre Core : régénération explicite requise',
    };
  return { ok: true, installation };
}

export interface BootPlan {
  selected: Profile;
  effective: Profile;
  notice: string | null;
  /** The local Lab runtime (Postgres + Lab Core) — Lab only, never in Production. */
  startLabCore: boolean;
  production: {
    config: ProductionConfig;
    installation: StudioInstallation;
  } | null;
}

/** What this Studio server starts as. Never throws: a Production that cannot start falls back to Lab. */
export async function bootPlan(
  runtimeDir: string,
  env: Record<string, string | undefined>,
): Promise<BootPlan> {
  const files = profileFiles(runtimeDir);
  const { choice, notice } = await readProfileChoice(files.profile);
  const lab = (why: string | null): BootPlan => ({
    selected: choice,
    effective: 'lab',
    notice: why,
    startLabCore: true,
    production: null,
  });
  if (choice === 'lab') return lab(notice);
  const check = await productionConfig(env);
  if (!check.ok)
    return lab(`Profil Production non restauré : ${check.message}`);
  const identity = await productionIdentity(files.identity, check.config);
  if (!identity.ok)
    return lab(`Profil Production non restauré : ${identity.message}`);
  return {
    selected: choice,
    effective: 'production',
    notice: null,
    startLabCore: false,
    production: { config: check.config, installation: identity.installation },
  };
}
