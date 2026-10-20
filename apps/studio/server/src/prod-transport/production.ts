import { timingSafeEqual } from 'node:crypto';
import { rename, stat } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { basename } from 'node:path';
import { BonkRuntime } from '../bonk-lab/runtime.js';
import type { CoreCall } from '../bonk-lab/worker.js';
import type { LabCoreCall, LabCoreEvents } from '../lab-moderation/proxy.js';
import { buildInfo } from '../build-info.js';
import { SoundRuntime } from '../sound-lab/runtime.js';
import { TtsRuntime } from '../tts-lab/runtime.js';
import {
  type ProdCoreCall,
  prodCoreClient,
  StudioTransportError,
} from './core-client.js';
import { loadInstallation } from './installation.js';
import {
  productionConfig,
  productionIdentity,
  profileFiles,
  writeProfileChoice,
  type BootPlan,
  type Profile,
} from './profile.js';

// ASTRA-P1-019 lot 2: the Production profile of Studio — Bonk, Soundboard and TTS runtimes over the
// future-prod transport (same workers, journals in their own `production/` folder, same players
// with their own tokens), a link state for the Studio page, and the profile API.

export type ProductionState =
  | 'inactive' // Lab profile
  | 'not_configured'
  | 'not_paired'
  | 'connecting'
  | 'connected'
  | 'core_unreachable'
  | 'revoked'
  | 'update_required'
  | 'tls_invalid'
  | 'identity_mismatch'
  | 'start_failed';

/** Transport error code → state shown in Studio (never a generic « network error » for a typed cause). */
export function stateFromCode(
  code: string | null | undefined,
): ProductionState {
  switch (code) {
    case null:
    case undefined:
      return 'connected';
    case 'studio_unauthorized':
      return 'not_paired';
    case 'studio_revoked':
      return 'revoked';
    case 'protocol_incompatible':
      return 'update_required';
    case 'tls_rejected':
      return 'tls_invalid';
    case 'identity_mismatch':
      return 'identity_mismatch';
    default:
      return 'core_unreachable';
  }
}

/** Periodic handshake (`/v1/studio/session`) giving the Production link state. */
export class ProductionLink {
  state: ProductionState = 'connecting';
  detail: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly core: CoreCall) {}
  async check() {
    try {
      await this.core('/v1/studio/session');
      this.state = 'connected';
      this.detail = null;
    } catch (e) {
      this.state = stateFromCode(
        e instanceof StudioTransportError ? e.code : 'core_unreachable',
      );
      this.detail = (e as Error).message;
    }
    return this.state;
  }
  start(intervalMs = 5000) {
    void this.check();
    this.timer = setInterval(() => void this.check(), intervalMs);
  }
  stop() {
    clearInterval(this.timer);
  }
}

export interface ProductionRuntimes {
  link: ProductionLink;
  bonk: BonkRuntime;
  sound: SoundRuntime;
  tts: TtsRuntime;
  /**
   * The streamer's cockpit (Moderation V2, Tombola, test wallet, TTS rules) on the same Core, over
   * the installation credential: the Lab routes the cockpit speaks, relayed by Core under
   * /v1/studio/cockpit. Never the Lab chat; Commands V2 and the mini-games switch since lot 8 (the main Core hosts the chat games).
   */
  cockpit: LabCoreCall;
  /** Twitch alerts V1 (§ 22): the installation client for /v1/studio/alerts (same alerts runtime as the Lab). */
  alertsCore: LabCoreCall;
  /** Lot 9: the Jeu des mots wins stream of the cockpit (the same Studio runtime and OBS sound source as the Lab). */
  cockpitEvents: LabCoreEvents;
}

/** `/v1/lab/<rest>` of the Studio cockpit → `/v1/studio/cockpit/<rest>` on the Production Core. */
export function cockpitClient(core: CoreCall): LabCoreCall {
  return <T>(
    path: string,
    body?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> => {
    if (!path.startsWith('/v1/lab/'))
      return Promise.reject(new Error('lab_route_required'));
    return core<T>(
      `/v1/studio/cockpit/${path.slice('/v1/lab/'.length)}`,
      body,
      options,
    );
  };
}

/** `/v1/lab/word-game/<channel>/events` → the same stream under /v1/studio/cockpit on the Production Core. */
export function cockpitEvents(core: ProdCoreCall): LabCoreEvents {
  return (path, signal) =>
    /^\/v1\/lab\/word-game\/\d{1,32}\/events$/.test(path)
      ? core.events(
          `/v1/studio/cockpit/${path.slice('/v1/lab/'.length)}`,
          signal,
        )
      : Promise.reject(new Error('lab_route_required'));
}

/** Production runtimes (never the Lab Core, never the Lab journals or the Lab environment). */
export async function createProductionRuntimes(
  origin: string,
  runtimeDir: string,
  production: NonNullable<BootPlan['production']>,
): Promise<ProductionRuntimes> {
  const files = profileFiles(runtimeDir);
  const core = prodCoreClient({
    url: production.config.url,
    installation: production.installation,
    ca: production.config.ca,
  });
  const wiring = (module: 'bonk' | 'sound' | 'tts') => ({
    core,
    journal: files.journal(module),
    transport: {
      base: `/v1/studio/${module}`,
      studioId: production.installation.installationId,
      channel: production.config.channelId,
      configBase: `/v1/studio/cockpit/${module}`,
    },
  });
  return {
    link: new ProductionLink(core),
    bonk: await BonkRuntime.create(origin, wiring('bonk')),
    sound: await SoundRuntime.create(origin, wiring('sound')),
    tts: await TtsRuntime.create(origin, wiring('tts')),
    cockpit: cockpitClient(core),
    alertsCore: core,
    cockpitEvents: cockpitEvents(core),
  };
}

export interface ProfileApiDeps {
  plan: BootPlan;
  runtimeDir: string;
  env: Record<string, string | undefined>;
  /** Production link (Production profile only). */
  link: ProductionLink | null;
  /** Production selected and valid, but its runtimes could not start (e.g. a journal of another profile). */
  startError?: string | null;
  /** Local work in a worker (claimed, executing or not yet acknowledged): no switch now. */
  busy: () => boolean;
  /** Stops the worker loops once a switch is accepted: nothing is claimed before the restart. */
  stopWorkers?: () => void;
  now?: () => number;
}

const MAIN_HEADER = 'x-raptoru-main';

/** Only the Electron main process (which shows a native confirmation) may change the profile. */
export function fromMain(req: IncomingMessage, env: ProfileApiDeps['env']) {
  const expected = env.RAPTORU_MAIN_TOKEN ?? '';
  const actual = String(req.headers[MAIN_HEADER] ?? '');
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

/** What the Studio page may see: never the secret (the pairing code cannot authenticate). */
export async function profileStatus(d: ProfileApiDeps) {
  const files = profileFiles(d.runtimeDir);
  const check = await productionConfig(d.env);
  const identity = await loadInstallation(files.identity).catch(
    () => 'corrupt' as const,
  );
  const production = d.plan.effective === 'production';
  const build = buildInfo();
  return {
    selected: d.plan.selected,
    effective: d.plan.effective,
    notice: d.plan.notice,
    build: {
      version: build.version,
      sha: build.sha,
      packaged: build.packaged,
      built_at: build.builtAt,
    },
    production: {
      configured: check.ok,
      config_error: check.ok ? null : check.message,
      core_origin: check.ok ? check.config.origin : null,
      label: check.ok ? check.config.label : null,
      channel_id: check.ok ? check.config.channelId : null,
      custom_ca: check.ok ? check.config.ca !== undefined : false,
      identity:
        identity === 'corrupt' ? 'corrupt' : identity ? 'present' : 'none',
      installation_id:
        identity && identity !== 'corrupt' ? identity.installationId : null,
      pairing_code:
        identity && identity !== 'corrupt' ? identity.pairingCode : null,
      state: production
        ? d.startError
          ? 'start_failed'
          : (d.link?.state ?? 'connecting')
        : check.ok
          ? 'inactive'
          : 'not_configured',
      detail: production ? (d.startError ?? d.link?.detail ?? null) : null,
    },
  };
}

type Reply = (status: number, body: unknown) => void;

/** `/api/profile` (status) and the main-process-only mutations. Returns false when not handled. */
export async function handleProfileApi(
  req: IncomingMessage,
  url: URL,
  body: () => Promise<Record<string, unknown>>,
  reply: Reply,
  d: ProfileApiDeps,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/profile')) return false;
  if (req.method === 'GET' && url.pathname === '/api/profile') {
    reply(200, await profileStatus(d));
    return true;
  }
  if (req.method !== 'POST') {
    reply(404, { error: 'not_found' });
    return true;
  }
  if (!fromMain(req, d.env)) {
    reply(403, { error: 'main_process_required' });
    return true;
  }
  // A restart while something is claimed or playing would end it as execution_unknown: refuse.
  if (d.busy()) {
    reply(409, {
      error: 'execution_in_progress',
      message:
        'Une interaction est en cours : réessaie quand elle est terminée',
    });
    return true;
  }
  const files = profileFiles(d.runtimeDir);
  if (url.pathname === '/api/profile/select') {
    const profile = (await body()).profile as Profile;
    if (profile !== 'lab' && profile !== 'production') {
      reply(400, { error: 'invalid_profile' });
      return true;
    }
    if (profile === 'production') {
      const check = await productionConfig(d.env);
      if (!check.ok) {
        reply(409, { error: check.code, message: check.message });
        return true;
      }
      const identity = await productionIdentity(files.identity, check.config);
      if (!identity.ok) {
        reply(409, { error: identity.code, message: identity.message });
        return true;
      }
    }
    await writeProfileChoice(files.profile, profile);
    if (profile !== d.plan.effective) d.stopWorkers?.();
    reply(200, {
      ok: true,
      profile,
      restart_required: profile !== d.plan.effective,
    });
    return true;
  }
  if (url.pathname === '/api/profile/regenerate') {
    if (d.plan.effective !== 'lab') {
      reply(409, {
        error: 'lab_profile_required',
        message: 'Passe d’abord sur le profil Lab',
      });
      return true;
    }
    // Never deleted: the old identity and its journals are archived (the Core pairing stays to revoke).
    let archived: string | null = null;
    if (await stat(files.productionDir).catch(() => null)) {
      const target = `${files.productionDir}.replaced-${(d.now ?? Date.now)()}`;
      await rename(files.productionDir, target);
      archived = basename(target);
    }
    await writeProfileChoice(files.profile, 'lab');
    reply(200, { ok: true, archived });
    return true;
  }
  reply(404, { error: 'not_found' });
  return true;
}
