import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ChaosEvent } from '@raptoru/schemas';
import type { LabCoreCall } from '../lab-moderation/proxy.js';
import { WorkerLoop } from '../worker-loop.js';
import { ChaosError, type ChaosEngineClient } from './engine-client.js';
import { resolveScreens, submitViewerEffect } from './viewer-effect.js';

// Chaos V2 lot 2 (docs/chaos/CONTRAT_LOT2.md § 3) : Studio joue ce que le Core a vendu aux viewers. Le Core décide de
// tout (prix, file, remboursements) ; cette boucle dit au Core l'état du moteur (battement toutes les 3 s), prend UNE
// demande à la fois quand le moteur peut la démarrer tout de suite, la passe au moteur (submitViewerEffect : source
// core, écran de la fiche, politique reject) et rend compte (started / ended / failed). Règles (worker son, Halloween) :
// - une demande est inscrite au journal AVANT d'être envoyée au moteur : jamais envoyée deux fois, même après un
//   redémarrage de Studio (le moteur meurt avec Studio : ce qui n'a pas fini est rendu comme tel au redémarrage) ;
// - les comptes rendus non transmis restent au journal et sont renvoyés (le Core les accepte plusieurs fois) ;
// - tout ce qui n'a pas démarré est rendu `failed` (le Core rembourse) ; STOP ALL de Studio, arrêt d'urgence ou sortie
//   du moteur → `stop-all` au Core (ses demandes en attente sont annulées et remboursées).

export const CHAOS_CORE = {
  heartbeatMs: 3000,
  /** Core injoignable : le battement s'espace (×2) jusqu'à ce délai. */
  maxBackoffMs: 30_000,
  /** Envoyée, jamais démarrée (le moteur abandonne à 20 s) : annulée dans le moteur, rendue `failed`. */
  startMs: 25_000,
  /** Démarrée, sans fin après sa durée + cette marge : `ended` / `unknown_end`. */
  endMarginMs: 30_000,
  /** Identifiants déjà livrés gardés au journal (jamais livrés deux fois). */
  doneIds: 500,
} as const;

type Ack = {
  event: 'started' | 'ended' | 'failed';
  code?: string;
  reason?: string;
  played_ms?: number;
};
interface Entry {
  id: string;
  attempt_id: string;
  effect: string;
  duration_ms: number;
  /** Inscrite avant l'envoi au moteur ; false = refusée ici sans jamais l'atteindre. */
  delivered: boolean;
  delivered_at: number;
  started_at: number | null;
  acks: Ack[];
  /** Comptes rendus déjà acceptés par le Core (dans l'ordre de `acks`). */
  reported: number;
}
interface Journal {
  studio: string;
  entries: Entry[];
  done: string[];
}
interface Registry {
  engine_limits?: { max_active_effects?: number };
  slots?: Record<string, { max_active?: number }>;
  effects?: { id: string; slot: string; internal?: boolean }[];
}
interface EngineConfig {
  safety?: {
    max_duration_ms?: number;
    max_active_effects?: number;
    safe_mode?: boolean;
  };
  effects?: Record<string, { enabled?: boolean; screen?: string }>;
}
interface Claimed {
  id: string;
  attempt_id: string;
  engine_request?: Record<string, unknown>;
  duration_ms: number;
  lease_expires_at: string;
}

export interface ChaosCoreDeps {
  /** Le moteur de Studio (et la route STOP ALL de la page). */
  runtime: { client: ChaosEngineClient; onStopAll: (() => void) | null };
  /** Le Core du profil : Lab (secret Studio / cockpit du Core principal) ou Production (identité d'installation). */
  core: LabCoreCall;
  environment: 'lab' | 'production';
  channelId: string;
  studioId: string;
  /** Fichier du journal (dossier de données du profil). */
  journal: string;
  log?: (line: string) => void;
  now?: () => number;
  heartbeatMs?: number;
}

const final = (e: Entry) => e.acks.some((a) => a.event !== 'started');
const engineId = (id: string) => `core-${id}`;
const FAILED = ['failed', 'rejected', 'expired', 'canceled', 'duplicate'];
const CODE = /^[a-z][a-z0-9_]{0,39}$/;

export class ChaosCoreLoop {
  private readonly loop: WorkerLoop;
  private coreOk = false;
  private fails = 0;
  private lastBeat = 0;
  private downLogged = false;
  private stopAllPending: string | null = null;
  private registry: Registry | null = null;
  private config: EngineConfig | null = null;
  private chain: Promise<void> = Promise.resolve();
  private saved = '';
  /** Dernière erreur de la boucle (lisible ; null quand tout va bien). */
  error: string | null = null;

  private constructor(
    private readonly d: ChaosCoreDeps,
    private state: Journal,
  ) {
    this.loop = new WorkerLoop(
      () => this.tick(),
      () => this.state.entries.some((e) => e.reported < e.acks.length),
      () => !this.coreOk,
    );
    const c = d.runtime.client;
    c.on('event', (e: ChaosEvent) => this.onEngineEvent(e));
    c.on('exit', () => this.onEngineExit());
  }

  static async open(d: ChaosCoreDeps) {
    let state: Journal = { studio: d.studioId, entries: [], done: [] };
    try {
      state = JSON.parse(await readFile(d.journal, 'utf8')) as Journal;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const loop = new ChaosCoreLoop(d, state);
    if (state.studio !== d.studioId) {
      // Travail d'une autre identité Studio : ses comptes rendus seraient refusés ; les identifiants livrés restent.
      if (state.entries.length)
        loop.log(
          `journal d'une autre installation : ${state.entries.length} compte(s) rendu(s) abandonné(s)`,
        );
      state.studio = d.studioId;
      state.entries = [];
    }
    // Le moteur s'arrête avec Studio : ce qui était en cours ne peut plus finir ici.
    for (const e of state.entries)
      if (e.delivered && !final(e))
        e.acks.push(
          e.started_at
            ? { event: 'ended', code: 'unknown_end' }
            : { event: 'failed', code: 'studio_restart' },
        );
    await loop.save();
    return loop;
  }

  start() {
    this.d.runtime.onStopAll = () => this.requestStopAll('studio_stop_all');
    this.loop.start();
  }

  stop() {
    this.loop.stop();
    if (this.d.runtime.onStopAll) this.d.runtime.onStopAll = null;
  }

  private now() {
    return this.d.now ? this.d.now() : Date.now();
  }

  private log(text: string) {
    this.d.log?.(`[chaos-core] ${text}`);
  }

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/chaos'
      : `/v1/lab/chaos/${this.d.channelId}`;
  }

  private engineReady() {
    return this.d.runtime.client.state.status === 'ready';
  }

  private save() {
    const run = async () => {
      const text = JSON.stringify(this.state);
      if (text === this.saved) return;
      await mkdir(dirname(this.d.journal), { recursive: true });
      await writeFile(`${this.d.journal}.tmp`, text, { mode: 0o600 });
      await rename(`${this.d.journal}.tmp`, this.d.journal);
      this.saved = text;
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  private settle(e: Entry, ack: Ack) {
    if (final(e)) return;
    // Forme attendue par le Core (ChaosAckRequest) : un code lisible par une machine, une durée entière ≥ 0.
    if (ack.code && !CODE.test(ack.code))
      ack = {
        ...ack,
        code: 'engine_error',
        reason: (ack.reason ?? ack.code).slice(0, 200),
      };
    if (ack.played_ms !== undefined)
      ack.played_ms = Math.max(0, Math.round(ack.played_ms));
    e.acks.push(ack);
    void this.save().catch((err: Error) =>
      this.log(`journal non écrit : ${err.message}`),
    );
    this.loop.wake();
  }

  /** STOP ALL (page, arrêt d'urgence, sortie du moteur) : dit au Core dès qu'il répond ; aucune prise d'ici là. */
  requestStopAll(reason: string) {
    this.stopAllPending = reason;
    this.loop.wake();
  }

  // --- événements du moteur ----------------------------------------------------------------------------------------

  private onEngineEvent(e: ChaosEvent) {
    if (e.event === 'engine.emergency_stop')
      return this.requestStopAll('emergency_stop');
    const rid = typeof e.request_id === 'string' ? e.request_id : '';
    if (!rid.startsWith('core-') || !e.event.startsWith('effect.')) return;
    const en = this.state.entries.find(
      (x) => x.delivered && engineId(x.id) === rid && !final(x),
    );
    if (!en) return;
    const kind = e.event.slice('effect.'.length);
    const code = typeof e.reason === 'string' ? e.reason : kind;
    const running = typeof e.running_ms === 'number' ? e.running_ms : null;
    if (kind === 'started') {
      if (en.started_at) return;
      en.started_at = this.now();
      return this.settle(en, { event: 'started' });
    }
    if (kind !== 'ended' && !FAILED.includes(kind)) return;
    // Déjà connue du moteur : jamais envoyée deux fois d'ici ; si elle joue, ses propres événements en rendent compte.
    if (kind === 'duplicate') {
      if (!en.started_at) this.settle(en, { event: 'failed', code });
      return;
    }
    if (!en.started_at && e.started === true) {
      // Démarrage manqué : dit avant la fin (le Core ne passe pas de « pris en charge » à « fini »).
      en.started_at = this.now() - (running ?? 0);
      en.acks.push({ event: 'started' });
    }
    if (en.started_at)
      // Démarrée puis interrompue ou finie : la raison du moteur (duration, target_lost, studio_stop_all…) et la durée jouée.
      return this.settle(en, {
        event: 'ended',
        code,
        played_ms: Math.round(running ?? this.now() - en.started_at),
      });
    this.settle(en, {
      event: 'failed',
      code,
      ...(typeof e.detail === 'string'
        ? { reason: e.detail.slice(0, 200) }
        : {}),
    });
  }

  private onEngineExit() {
    this.registry = null;
    const now = this.now();
    for (const en of this.state.entries)
      if (en.delivered && !final(en))
        this.settle(
          en,
          en.started_at
            ? {
                event: 'ended',
                code: 'engine_exit',
                played_ms: Math.min(en.duration_ms, now - en.started_at),
              }
            : { event: 'failed', code: 'engine_exit' },
        );
    this.requestStopAll('engine_exit');
  }

  // --- boucle -------------------------------------------------------------------------------------------------------

  private async tick() {
    try {
      this.expireLocal();
      const hb = this.d.heartbeatMs ?? CHAOS_CORE.heartbeatMs;
      const every = this.coreOk
        ? hb
        : Math.min(CHAOS_CORE.maxBackoffMs, hb * 2 ** this.fails);
      if (this.now() - this.lastBeat >= every) await this.heartbeat();
      if (!this.coreOk) return;
      if (this.stopAllPending) await this.sendStopAll();
      await this.flushAcks();
      await this.claim();
      this.error = null;
    } catch (e) {
      // Core en panne ou injoignable (pas un refus définitif, pas le moteur) : la boucle s'espace jusqu'au battement.
      if (!(e instanceof ChaosError) && !ChaosCoreLoop.settledByCore(e))
        this.coreOk = false;
      this.error = (e as Error).message;
    }
  }

  private expireLocal() {
    const now = this.now();
    for (const en of this.state.entries) {
      if (!en.delivered || final(en)) continue;
      if (!en.started_at && now - en.delivered_at > CHAOS_CORE.startMs) {
        // Jamais démarrée (réponse perdue ?) : retirée du moteur s'il la connaît, avant d'être rendue (remboursée).
        if (this.engineReady())
          void this.d.runtime.client
            .call('effect.cancel', {
              request_id: engineId(en.id),
              immediate: true,
              reason: 'no_start',
            })
            .catch(() => {});
        this.settle(en, { event: 'failed', code: 'no_start' });
      } else if (
        en.started_at &&
        now - en.started_at > en.duration_ms + CHAOS_CORE.endMarginMs
      )
        this.settle(en, { event: 'ended', code: 'unknown_end' });
    }
  }

  private effectsView() {
    const out: Record<string, { enabled: boolean }> = {};
    for (const e of this.registry?.effects ?? [])
      if (!e.internal)
        out[e.id] = {
          enabled: this.config?.effects?.[e.id]?.enabled !== false,
        };
    return out;
  }

  private async heartbeat() {
    const c = this.d.runtime.client;
    if (this.engineReady()) {
      try {
        const [cfg, reg] = await Promise.all([
          c.call<EngineConfig>('config.get'),
          this.registry
            ? null
            : c
                .call<{ registry: Registry }>('describe')
                .then((r) => r.registry),
        ]);
        this.config = cfg;
        if (reg) this.registry = reg;
      } catch {
        /* moteur occupé ou parti : l'état connu reste, `engine_ready` suit son statut */
      }
    }
    this.lastBeat = this.now();
    try {
      const r = await this.d.core<{ stop?: { id: string; reason?: string }[] }>(
        `${this.base}/heartbeat`,
        {
          studio_instance_id: this.d.studioId,
          engine_ready: this.engineReady() && !!this.registry && !!this.config,
          safety_max_ms: this.config?.safety?.max_duration_ms ?? 30_000,
          safe_mode: this.config?.safety?.safe_mode === true,
          effects: this.effectsView(),
          inflight: this.state.entries
            .filter((e) => e.delivered && !final(e))
            .map((e) => e.id),
        },
      );
      if (!this.coreOk) this.log('Core joint');
      this.coreOk = true;
      this.fails = 0;
      this.downLogged = false;
      for (const s of r?.stop ?? []) await this.stopRequest(s.id);
    } catch (e) {
      this.coreOk = false;
      this.fails++;
      this.error = (e as Error).message;
      if (!this.downLogged)
        this.log(`Core injoignable : ${(e as Error).message}`);
      this.downLogged = true;
    }
  }

  /** Arrêt demandé par la modération (heartbeat) : retiré du moteur ; ses événements donnent le compte rendu. */
  private async stopRequest(id: string) {
    const en = this.state.entries.find(
      (x) => x.id === id && x.delivered && !final(x),
    );
    if (!en || !this.engineReady()) return; // moteur parti : sa sortie a déjà rendu compte
    try {
      await this.d.runtime.client.call('effect.cancel', {
        request_id: engineId(id),
        reason: 'moderation',
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'unknown_request')
        this.settle(
          en,
          en.started_at
            ? { event: 'ended', code: 'unknown_end' }
            : { event: 'failed', code: 'unknown_request' },
        );
    }
  }

  /** Erreur définitive du Core (déjà réglé, mauvais essai, requête invalide) : ne sert à rien de renvoyer. */
  private static settledByCore(e: unknown) {
    const s = (e as { status?: number }).status;
    return s === 400 || s === 404 || s === 409;
  }

  private async sendStopAll() {
    try {
      await this.d.core(`${this.base}/stop-all`, {
        studio_instance_id: this.d.studioId,
      });
      this.log(`STOP ALL transmis au Core (${this.stopAllPending})`);
    } catch (e) {
      if (!ChaosCoreLoop.settledByCore(e)) throw e;
      this.log(`STOP ALL refusé par le Core : ${(e as Error).message}`);
    }
    this.stopAllPending = null;
  }

  private async flushAcks() {
    for (const en of this.state.entries)
      while (en.reported < en.acks.length) {
        const ack = en.acks[en.reported]!;
        try {
          await this.d.core(`${this.base}/requests/${en.id}/ack`, {
            studio_instance_id: this.d.studioId,
            attempt_id: en.attempt_id,
            ...ack,
            ...(ack.reason ? { reason: ack.reason.slice(0, 200) } : {}),
          });
        } catch (e) {
          // Réseau, Core en panne : renvoyé plus tard (tick), sans marteler.
          if (!ChaosCoreLoop.settledByCore(e)) throw e;
          this.log(
            `compte rendu ${ack.event} de ${en.id} refusé : ${(e as Error).message}`,
          );
        }
        en.reported++;
        await this.save();
      }
    const before = this.state.entries.length;
    this.state.entries = this.state.entries.filter(
      (e) => !(final(e) && e.reported === e.acks.length),
    );
    if (this.state.entries.length !== before) await this.save();
  }

  /** Les effets qui peuvent démarrer tout de suite : emplacement libre, pas déjà actif sur leur écran, sous le plafond. */
  private async startable(): Promise<string[]> {
    const reg = this.registry;
    const cfg = this.config;
    if (!reg || !cfg) return [];
    const c = this.d.runtime.client;
    const [status, targets] = await Promise.all([
      c.call<{
        active?: { effect: string; target?: { device?: string } }[];
      }>('status'),
      c.call<{ monitors?: { device: string; primary?: boolean }[] }>(
        'targets.list',
        { windows: false },
      ),
    ]);
    const active = status.active ?? [];
    const cap = Math.min(
      reg.engine_limits?.max_active_effects ?? Infinity,
      cfg.safety?.max_active_effects ?? Infinity,
    );
    if (active.length >= cap) return [];
    const slotOf = new Map((reg.effects ?? []).map((e) => [e.id, e.slot]));
    return (reg.effects ?? [])
      .filter((e) => {
        if (e.internal || cfg.effects?.[e.id]?.enabled === false) return false;
        let device: string;
        try {
          device = resolveScreens(
            cfg.effects?.[e.id]?.screen ?? 'primary',
            targets.monitors ?? [],
          )[0]!;
        } catch {
          return false;
        }
        const here = active.filter((a) => a.target?.device === device);
        if (here.some((a) => a.effect === e.id)) return false;
        return (
          here.filter((a) => slotOf.get(a.effect) === e.slot).length <
          (reg.slots?.[e.slot]?.max_active ?? 1)
        );
      })
      .map((e) => e.id);
  }

  private async claim() {
    if (!this.engineReady() || this.stopAllPending) return;
    const startable = await this.startable();
    if (!startable.length) return;
    const { item } = await this.d.core<{ item: Claimed | null }>(
      `${this.base}/claim`,
      { studio_instance_id: this.d.studioId, startable },
    );
    if (!item) return;
    const known =
      this.state.done.includes(item.id) ||
      this.state.entries.some((e) => e.id === item.id);
    const en: Entry = {
      id: item.id,
      attempt_id: item.attempt_id,
      effect: String(item.engine_request?.effect ?? '?'),
      duration_ms: Number(item.duration_ms) || 0,
      delivered: !known,
      delivered_at: this.now(),
      started_at: null,
      acks: known ? [{ event: 'failed', code: 'already_delivered' }] : [],
      reported: 0,
    };
    this.state.entries.push(en);
    if (!known) {
      this.state.done.push(item.id);
      this.state.done.splice(0, this.state.done.length - CHAOS_CORE.doneIds);
    }
    await this.save(); // AVANT le moteur : jamais envoyée deux fois
    if (known) return this.loop.wake();
    if (!this.engineReady())
      return this.settle(en, { event: 'failed', code: 'engine_not_ready' });
    const r = await submitViewerEffect(
      this.d.runtime,
      item.engine_request ?? {},
      { source: 'core', ref: item.id, requestId: engineId(item.id) },
    );
    if (r.ok && r.note) this.log(`${en.effect} : ${r.note}`);
    // Sans réponse, le moteur a pu la recevoir : ses événements (ou l'abandon à 25 s) en rendront compte.
    if (!r.ok && r.code !== 'engine_timeout')
      this.settle(en, { event: 'failed', code: r.code, reason: r.message });
  }
}
