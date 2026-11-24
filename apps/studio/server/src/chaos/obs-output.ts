import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ObsLike } from '../channel-points/obs-actions.js';

// Chaos › Diffusion OBS — mode C (docs/chaos/MODE_C.md) : une activation, deux sorties. Le moteur reste l'autorité de la
// session (file, graine, durée, transitions, arrêt) : il calcule la partition de la sortie OBS (même réplique que le
// calque) et publie effect.obs ; ce module, sur la SEULE connexion OBS de Studio, règle puis active les filtres
// « Raptoru Chaos V2 · … » de la source gameplay choisie, les coupe à la fin, à l'arrêt, à STOP ALL et au moindre doute.
// Il ne touche jamais un autre filtre (V1 compris), une scène, une source ou un réglage d'OBS. Les filtres ne sont créés
// que par « Préparer les filtres OBS » (geste explicite, avec la liste exacte et une sauvegarde des filtres existants).

export type ChaosObsMode = 'screen' | 'obs' | 'both';
export interface ChaosObsConfig {
  mode: ChaosObsMode;
  /** Source gameplay d'OBS (nom), ex. « Écran ». */
  source: string | null;
  /** Écran physique que cette source capture (\\.\DISPLAYn) : la sortie OBS ne suit que les effets de cet écran. */
  device: string | null;
  prepared: { version: string; at: string } | null;
}
export interface PlanFilter {
  key: string;
  name: string;
  shader: string;
  kind: 'filter' | 'overlay';
  effect_file: string;
  order: number;
}
export interface ChaosObsPlan {
  version: string;
  dir: string;
  effects: Record<
    string,
    {
      label: string;
      available: boolean;
      reason: string | null;
      warnings: string[];
      filters: PlanFilter[];
    }
  >;
}
interface SessionFilter {
  key: string;
  settings: Record<string, unknown>;
}
interface Session {
  requestId: string;
  effect: string;
  names: string[];
  state: 'prepared' | 'live' | 'ending' | 'ended' | 'failed';
  error: string | null;
  enabledAt: number | null;
  at: number;
}
type Engine = (cmd: string, args?: object) => Promise<unknown>;

export const V2_PREFIX = 'Raptoru Chaos V2 · ';
const V1_PREFIX = 'Raptoru Chaos · ';
const CAPTURE_KINDS = ['monitor_capture', 'window_capture', 'game_capture'];
const ENDED = new Set([
  'effect.ended',
  'effect.failed',
  'effect.canceled',
  'effect.expired',
  'effect.rejected',
]);

export class ChaosObsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Erreur OBS lisible (sans identifiant). */
function obsReason(e: unknown) {
  const m = (e as Error)?.message ?? '';
  if (m === 'obs_offline') return 'OBS non connecté';
  if (m === 'obs_request_timeout') return 'OBS ne répond pas';
  return m || 'refus d’OBS';
}

export class ChaosObsOutput {
  // Capture directe par défaut (docs/chaos/CAPTURE_DIRECTE.md) : la source « Écran » d'OBS voit le calque, sans
  // filtre. Écran + OBS (filtres, mode C) reste l'alternative, choisie dans le panneau Diffusion OBS.
  config: ChaosObsConfig = {
    mode: 'screen',
    source: null,
    device: null,
    prepared: null,
  };
  plan: ChaosObsPlan | null = null;
  private readonly sessions = new Map<string, Session>();
  /**
   * Toutes les requêtes OBS des sessions, l'une après l'autre, dans l'ordre des événements du moteur (réglages →
   * activation → recalage → coupure) ; et le propriétaire de chaque filtre : la fin d'une activation ne coupe jamais un
   * filtre qu'une activation suivante du même effet a déjà repris.
   */
  private chain: Promise<void> = Promise.resolve();
  private readonly owner = new Map<string, string>();
  private wasConnected = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cache: { at: number; value: Record<string, unknown> } | null = null;
  /** Dernier incident visible dans la page (exclusion refusée, OBS perdu pendant un effet…). */
  lastIncident: { at: string; message: string } | null = null;

  constructor(
    private readonly file: string,
    private readonly obs: () => ObsLike | null,
    private readonly engine: Engine,
    private readonly log: (line: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  async load() {
    try {
      const saved = JSON.parse(
        await readFile(this.file, 'utf8'),
      ) as Partial<ChaosObsConfig>;
      this.config = {
        mode:
          saved.mode === 'both' || saved.mode === 'obs' ? saved.mode : 'screen',
        source: typeof saved.source === 'string' ? saved.source : null,
        device: typeof saved.device === 'string' ? saved.device : null,
        prepared: saved.prepared ?? null,
      };
    } catch {
      /* réglages par défaut : capture directe (écran seul), source à choisir */
    }
  }
  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.config, null, 2));
    await rename(`${this.file}.tmp`, this.file);
  }

  /** Surveille la connexion OBS : à chaque (re)connexion, réconciliation (aucun filtre V2 actif sans session vivante). */
  start() {
    this.timer ??= setInterval(() => void this.watch(), 1000);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private async watch() {
    const c = this.obs()?.connected === true;
    if (c !== this.wasConnected) this.cache = null;
    if (c && !this.wasConnected) {
      this.wasConnected = true;
      await this.reconcile('reconnexion à OBS');
    } else if (!c && this.wasConnected) {
      this.wasConnected = false;
      // OBS perdu : les sessions vivantes perdent leur sortie OBS ; le moteur cesse d'exclure le calque (la capture
      // d'écran d'OBS, si elle revient, le voit : une seule application). Leurs filtres s'éteignent seuls (fin de
      // partition, fenêtre de validité) et sont coupés à la reconnexion.
      for (const s of this.sessions.values())
        if (s.state === 'prepared' || s.state === 'live') {
          s.state = 'failed';
          s.error = 'OBS perdu pendant l’effet';
          await this.engine('effect.obs_lost', {
            request_id: s.requestId,
            reason: 'obs_lost',
          }).catch(() => {});
        }
      this.incident('OBS s’est déconnecté : sortie OBS coupée');
    }
  }

  private incident(message: string) {
    this.lastIncident = { at: new Date(this.now()).toISOString(), message };
    this.log(`[chaos/obs] ${message}`);
  }

  async setConfig(v: Partial<ChaosObsConfig>) {
    if (v.mode !== undefined) {
      if (!['screen', 'obs', 'both'].includes(v.mode))
        throw new ChaosObsError(
          'invalid_request',
          'mode : screen, obs ou both',
        );
      this.config.mode = v.mode;
    }
    if (v.source !== undefined) {
      if (v.source !== null && (typeof v.source !== 'string' || !v.source))
        throw new ChaosObsError('invalid_request', 'source OBS invalide');
      if (v.source !== this.config.source) {
        // Autre source : ses filtres ne sont pas préparés ; ceux de l'ancienne sont coupés (jamais retirés).
        await this.disableAll('changement de source').catch(() => {});
        this.config.prepared = null;
      }
      this.config.source = v.source;
    }
    if (v.device !== undefined) {
      if (v.device !== null && !/^\\\\\.\\DISPLAY\d{1,2}$/i.test(v.device))
        throw new ChaosObsError('invalid_request', 'écran invalide');
      this.config.device = v.device;
    }
    this.cache = null;
    await this.save();
    return this.config;
  }

  private connected() {
    const o = this.obs();
    if (!o?.connected)
      throw new ChaosObsError('obs_offline', 'OBS non connecté');
    return o;
  }

  async loadPlan(force = false) {
    if (!this.plan || force)
      this.plan = (await this.engine('obs.plan')) as ChaosObsPlan;
    return this.plan;
  }

  /** Les filtres V2 attendus (ordre de la chaîne), d'après le plan du moteur. */
  private planFilters() {
    return Object.values(this.plan?.effects ?? {})
      .flatMap((e) => e.filters)
      .sort((a, b) => a.order - b.order);
  }

  private async filterList(source: string) {
    const r = await this.connected().request('GetSourceFilterList', {
      sourceName: source,
    });
    return (r.filters ?? []) as {
      filterName: string;
      filterKind: string;
      filterEnabled: boolean;
      filterIndex: number;
      filterSettings: Record<string, unknown>;
    }[];
  }

  /** Taille de la source (élément de scène : sourceWidth × sourceHeight), sinon null. */
  private async sourceSize(source: string) {
    const o = this.connected();
    const scenes = ((await o.request('GetSceneList', {})).scenes ?? []) as {
      sceneName: string;
    }[];
    for (const sc of scenes) {
      const items = ((
        await o.request('GetSceneItemList', { sceneName: sc.sceneName })
      ).sceneItems ?? []) as { sourceName: string; sceneItemId: number }[];
      const it = items.find((i) => i.sourceName === source);
      if (!it) continue;
      const t = (
        await o.request('GetSceneItemTransform', {
          sceneName: sc.sceneName,
          sceneItemId: it.sceneItemId,
        })
      ).sceneItemTransform as { sourceWidth?: number; sourceHeight?: number };
      if ((t.sourceWidth ?? 0) > 0 && (t.sourceHeight ?? 0) > 0)
        return {
          width: Math.round(t.sourceWidth!),
          height: Math.round(t.sourceHeight!),
          scene: sc.sceneName,
        };
    }
    return null;
  }

  /**
   * L'état de la diffusion OBS pour la page (relevé au plus toutes les 2 s) : connexion, version, plugin, source et sa
   * taille, filtres V2 présents ou manquants, filtres V1 (laissés tels quels), raisons d'un mode C incomplet.
   */
  async status(force = false): Promise<Record<string, unknown>> {
    if (!force && this.cache && this.now() - this.cache.at < 2000)
      return { ...this.cache.value, sessions: this.sessionsView() };
    const reasons: string[] = [];
    const o = this.obs();
    const value: Record<string, unknown> = {
      config: this.config,
      obs: { connected: o?.connected === true },
      incident: this.lastIncident,
    };
    if (this.config.mode !== 'screen') {
      // Le plan vient du moteur (pas d'OBS) : les effets disponibles se lisent même OBS fermé.
      await this.loadPlan().catch(() => null);
      if (!o?.connected) reasons.push('OBS non connecté (réglages du Bonk)');
      else {
        try {
          const v = await o.request('GetVersion', {});
          value.obs = {
            connected: true,
            version: v.obsVersion,
            websocket: v.obsWebSocketVersion,
          };
          const kinds = ((await o.request('GetSourceFilterKindList', {}))
            .sourceFilterKinds ?? []) as string[];
          value.shaderfilter = kinds.includes('shader_filter');
          if (!value.shaderfilter)
            reasons.push('plugin obs-shaderfilter absent d’OBS');
          const inputs = ((await o.request('GetInputList', {})).inputs ??
            []) as { inputName: string; inputKind: string }[];
          value.sources = inputs
            .filter((i) => CAPTURE_KINDS.includes(i.inputKind))
            .map((i) => ({ name: i.inputName, kind: i.inputKind }));
          const src = this.config.source;
          if (!src) reasons.push('source gameplay non choisie');
          else if (!inputs.some((i) => i.inputName === src))
            reasons.push(`source « ${src} » introuvable dans OBS`);
          else {
            const size = await this.sourceSize(src).catch(() => null);
            value.source = {
              name: src,
              kind: inputs.find((i) => i.inputName === src)?.inputKind,
              ...(size ?? {}),
            };
            if (!size)
              reasons.push(`taille de « ${src} » inconnue (dans aucune scène)`);
            await this.loadPlan().catch(() => null);
            const list = await this.filterList(src);
            const want = this.planFilters();
            const missing = want.filter(
              (f) =>
                !list.some(
                  (x) =>
                    x.filterName === f.name &&
                    x.filterSettings.shader_file_name === f.effect_file,
                ),
            );
            value.filters = {
              expected: want.length,
              missing: missing.map((f) => f.name),
              enabled: list
                .filter(
                  (x) => x.filterName.startsWith(V2_PREFIX) && x.filterEnabled,
                )
                .map((x) => x.filterName),
              v1: list
                .filter((x) => x.filterName.startsWith(V1_PREFIX))
                .map((x) => ({ name: x.filterName, enabled: x.filterEnabled })),
              others: list.filter(
                (x) =>
                  !x.filterName.startsWith(V2_PREFIX) &&
                  !x.filterName.startsWith(V1_PREFIX),
              ).length,
            };
            if (!this.plan)
              reasons.push('plan des filtres indisponible (moteur)');
            else if (missing.length)
              reasons.push(
                `${missing.length} filtre${missing.length > 1 ? 's' : ''} Chaos V2 à préparer`,
              );
          }
        } catch (e) {
          reasons.push(obsReason(e));
        }
      }
      if (!this.config.device)
        reasons.push('écran physique de la source non choisi');
    } else if (o?.connected) {
      // Capture directe : seulement la liste des sources (curseur d'OBS, obs-cursor.ts) ; aucun filtre lu ni touché.
      try {
        const v = await o.request('GetVersion', {});
        value.obs = { connected: true, version: v.obsVersion };
        const inputs = ((await o.request('GetInputList', {})).inputs ?? []) as {
          inputName: string;
          inputKind: string;
        }[];
        value.sources = inputs
          .filter((i) => CAPTURE_KINDS.includes(i.inputKind))
          .map((i) => ({ name: i.inputName, kind: i.inputKind }));
      } catch {
        /* OBS occupé : la liste revient au relevé suivant */
      }
    }
    value.effects = Object.fromEntries(
      Object.entries(this.plan?.effects ?? {}).map(([k, e]) => [
        k,
        { available: e.available, reason: e.reason },
      ]),
    );
    value.ready = this.config.mode === 'screen' || reasons.length === 0;
    value.reasons = reasons;
    this.cache = { at: this.now(), value };
    return { ...value, sessions: this.sessionsView() };
  }

  private sessionsView() {
    return [...this.sessions.values()]
      .filter((s) => this.now() - s.at < 60_000 || s.state === 'live')
      .map((s) => ({
        request_id: s.requestId,
        effect: s.effect,
        state: s.state,
        error: s.error,
      }));
  }

  /**
   * Les sorties d'une activation selon le mode : « écran », « OBS », ou les deux. Sortie OBS impossible (OBS absent,
   * filtres non préparés, effet impossible dans un filtre) : en mode « Écran + OBS », l'effet part sur l'écran seul et
   * la page le dit (la capture d'écran d'OBS voit alors le calque, comme avant : une seule application) ; en mode
   * « OBS uniquement », l'activation est refusée.
   */
  async outputsFor(effect: string): Promise<{
    outputs: ('screen' | 'obs')[];
    obs?: { device: string; width: number; height: number };
    note?: string;
  }> {
    const mode = this.config.mode;
    if (mode === 'screen') return { outputs: ['screen'] };
    // Connexion vérifiée en direct (l'état complet est relevé au plus toutes les 2 s) : jamais de sortie OBS demandée
    // à un OBS qui vient de partir.
    const st = await this.status(this.obs()?.connected !== true);
    let why: string | null = null;
    const plan = this.plan?.effects[effect];
    const src = st.source as { width?: number; height?: number } | undefined;
    if (!st.ready) why = (st.reasons as string[])[0] ?? 'OBS indisponible';
    else if (!plan) why = 'effet inconnu du plan OBS';
    else if (!plan.available)
      why = `pas de version OBS de cet effet (${plan.reason ?? '?'})`;
    else if (!src?.width || !src.height || !this.config.device)
      why = 'source OBS incomplète';
    if (why) {
      if (mode === 'obs')
        throw new ChaosObsError(
          'obs_unavailable',
          `Sortie OBS impossible : ${why}`,
        );
      return {
        outputs: ['screen'],
        note: `Écran seulement : ${why}. La capture d’écran d’OBS voit le calque, comme avant.`,
      };
    }
    return {
      outputs: mode === 'obs' ? ['obs'] : ['screen', 'obs'],
      obs: {
        device: this.config.device!,
        width: src!.width!,
        height: src!.height!,
      },
    };
  }

  // ---------- Événements du moteur ----------
  onEngineEvent(e: Record<string, unknown>) {
    const ev = String(e.event ?? '');
    const rid = typeof e.request_id === 'string' ? e.request_id : null;
    if (ev === 'engine.emergency_stop') {
      void this.disableAll('arrêt d’urgence');
      return;
    }
    if (!rid) return;
    if (ev === 'effect.obs') {
      const phase = String(e.phase ?? '');
      if (phase === 'prepare') this.prepareSession(rid, e);
      else if (phase === 'retime') this.retime(rid, e);
      else if (phase === 'blocked') {
        const s = this.sessions.get(rid);
        const reason = String(e.reason ?? 'sortie OBS retirée');
        if (s) {
          s.state = 'failed';
          s.error = reason;
          this.queue(s, () => this.setEnabled(this.mine(s), false));
        }
        if (reason === 'exclusion_failed')
          this.incident(
            'Protection anti-double impossible (Windows refuse d’exclure le calque des captures) : sortie OBS coupée, le calque reste visible par la capture d’écran',
          );
      }
      return;
    }
    const s = this.sessions.get(rid);
    if (!s) return;
    const outputs = e.outputs as { obs?: boolean } | undefined;
    if (
      ev === 'effect.started' &&
      s.state === 'prepared' &&
      outputs?.obs !== false
    ) {
      s.state = 'live';
      this.queue(s, async () => {
        await this.setEnabled(s.names, true);
        s.enabledAt = this.now();
      });
    } else if (ENDED.has(ev)) {
      s.state = s.state === 'failed' ? 'failed' : 'ended';
      this.queue(s, () => this.setEnabled(this.mine(s), false));
    }
  }

  /** Le moteur s'est arrêté (fin, panne) : tous les filtres V2 sont coupés. */
  onEngineExit() {
    void this.disableAll('moteur arrêté');
  }

  /** Les filtres de la session qu'aucune activation plus récente n'a repris. */
  private mine(s: Session) {
    return s.names.filter((n) => this.owner.get(n) === s.requestId);
  }

  private queue(s: Session, step: () => Promise<void>) {
    this.chain = this.chain.then(step).catch((err) => {
      s.state = 'failed';
      s.error = obsReason(err);
      this.incident(`Sortie OBS de ${s.effect} : ${s.error}`);
      // Plus de sortie OBS pour cette activation : le moteur cesse d'exclure le calque (une seule application).
      void this.engine('effect.obs_lost', {
        request_id: s.requestId,
        reason: s.error,
      }).catch(() => {});
      void this.setEnabled(this.mine(s), false).catch(() => {});
    });
  }

  private namesFor(filters: SessionFilter[]) {
    const byKey = new Map(this.planFilters().map((f) => [f.key, f.name]));
    const names = filters.map((f) => byKey.get(f.key));
    return names.every(Boolean) ? (names as string[]) : null;
  }

  private prepareSession(rid: string, e: Record<string, unknown>) {
    const filters = (e.filters ?? []) as SessionFilter[];
    const names = this.namesFor(filters);
    const s: Session = {
      requestId: rid,
      effect: String(e.effect ?? ''),
      names: names ?? [],
      state: 'prepared',
      error: null,
      enabledAt: null,
      at: this.now(),
    };
    this.sessions.set(rid, s);
    for (const n of names ?? []) this.owner.set(n, rid);
    for (const [k, old] of this.sessions)
      if (this.now() - old.at > 10 * 60_000 && old.state !== 'live')
        this.sessions.delete(k);
    if (!names) {
      this.queue(s, () => {
        throw new Error('filtres Chaos V2 à préparer (plan du moteur changé)');
      });
      return;
    }
    this.queue(s, () => this.applySettings(names, filters));
  }

  private retime(rid: string, e: Record<string, unknown>) {
    const s = this.sessions.get(rid);
    if (!s || s.state === 'failed' || s.state === 'ended') return;
    const filters = (e.filters ?? []) as SessionFilter[];
    const names = this.namesFor(filters);
    if (!names) return;
    if (e.why === 'stop') s.state = 'ending';
    // Une passe absente de la nouvelle partition (sortie sans elle) : son filtre est coupé.
    const gone = s.names.filter((n) => !names.includes(n));
    this.queue(s, async () => {
      await this.applySettings(names, filters);
      if (gone.length) await this.setEnabled(gone, false);
    });
  }

  private async applySettings(names: string[], filters: SessionFilter[]) {
    const o = this.connected();
    const src = this.config.source!;
    for (let i = 0; i < names.length; i++)
      await o.request('SetSourceFilterSettings', {
        sourceName: src,
        filterName: names[i],
        filterSettings: filters[i]!.settings,
        overlay: true,
      });
  }

  private async setEnabled(names: string[], on: boolean) {
    if (!names.length) return;
    const o = this.connected();
    for (const n of names)
      await o.request('SetSourceFilterEnabled', {
        sourceName: this.config.source!,
        filterName: n,
        filterEnabled: on,
      });
  }

  /**
   * STOP ALL, arrêt d'urgence, moteur arrêté, Studio qui se ferme, (re)connexion : coupe tous les filtres « Raptoru
   * Chaos V2 · » de la source, sans animation. Aucun autre filtre n'est lu pour être modifié.
   */
  async disableAll(why: string) {
    for (const s of this.sessions.values())
      if (s.state === 'prepared' || s.state === 'live' || s.state === 'ending')
        s.state = 'ended';
    this.owner.clear();
    const src = this.config.source;
    const o = this.obs();
    if (!src || !o?.connected) return { disabled: 0 };
    const list = await this.filterList(src).catch(() => []);
    let n = 0;
    for (const f of list)
      if (f.filterName.startsWith(V2_PREFIX) && f.filterEnabled) {
        await o
          .request('SetSourceFilterEnabled', {
            sourceName: src,
            filterName: f.filterName,
            filterEnabled: false,
          })
          .then(() => n++)
          .catch(() => {});
      }
    if (n) this.log(`[chaos/obs] ${n} filtre(s) Chaos V2 coupé(s) : ${why}`);
    this.cache = null;
    return { disabled: n };
  }

  /** Réconciliation : aucun filtre V2 actif sans session vivante (OBS relancé, Studio relancé après un plantage). */
  async reconcile(why: string) {
    const live = [...this.sessions.values()].filter((s) => s.state === 'live');
    // Une session vivante au moment d'une reconnexion a perdu sa continuité (OBS a pu redémarrer) : coupée aussi.
    for (const s of live) {
      s.state = 'failed';
      s.error = 'OBS reconnecté pendant l’effet';
      await this.engine('effect.obs_lost', {
        request_id: s.requestId,
        reason: 'obs_reconnected',
      }).catch(() => {});
    }
    return this.disableAll(why);
  }

  // ---------- Préparation (geste explicite) ----------
  /** Ce que « Préparer » ferait, sans rien changer : filtres à créer, à mettre à jour, filtres existants laissés. */
  async preview() {
    const src = this.config.source;
    if (!src)
      throw new ChaosObsError(
        'invalid_request',
        'choisis d’abord la source gameplay',
      );
    await this.loadPlan(true);
    const list = await this.filterList(src);
    const create: string[] = [];
    const update: string[] = [];
    for (const f of this.planFilters()) {
      const have = list.find((x) => x.filterName === f.name);
      if (!have) create.push(f.name);
      else if (have.filterSettings.shader_file_name !== f.effect_file)
        update.push(f.name);
    }
    return {
      source: src,
      version: this.plan!.version,
      create,
      update,
      untouched: list
        .filter((x) => !x.filterName.startsWith(V2_PREFIX))
        .map((x) => x.filterName),
      unavailable: Object.entries(this.plan!.effects)
        .filter(([, e]) => !e.available)
        .map(([k, e]) => ({ effect: k, reason: e.reason })),
    };
  }

  /**
   * Crée les filtres V2 manquants (désactivés), met à jour le fichier de shader de ceux qui existent, après une
   * sauvegarde des filtres de la source. Les autres filtres (V1, étrangers) ne sont ni déplacés, ni modifiés.
   */
  async prepare(backupDir: string) {
    const src = this.config.source;
    if (!src)
      throw new ChaosObsError(
        'invalid_request',
        'choisis d’abord la source gameplay',
      );
    const o = this.connected();
    await this.loadPlan(true);
    const before = await this.filterList(src);
    const backup = join(
      backupDir,
      `filtres-${src.replace(/[^\w.-]+/g, '_')}-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}.json`,
    );
    await mkdir(backupDir, { recursive: true });
    await writeFile(
      backup,
      JSON.stringify(
        {
          source: src,
          at: new Date(this.now()).toISOString(),
          filters: before,
        },
        null,
        2,
      ),
    );
    const created: string[] = [];
    const updated: string[] = [];
    for (const f of this.planFilters()) {
      const have = before.find((x) => x.filterName === f.name);
      const settings = {
        from_file: true,
        shader_file_name: f.effect_file,
        override_entire_effect: true,
      };
      if (!have) {
        await o.request('CreateSourceFilter', {
          sourceName: src,
          filterName: f.name,
          filterKind: 'shader_filter',
          filterSettings: settings,
        });
        // Créé actif par OBS : coupé tout de suite (il ne joue que pendant un effet).
        await o.request('SetSourceFilterEnabled', {
          sourceName: src,
          filterName: f.name,
          filterEnabled: false,
        });
        // Une passe sur l'image se place avant les calques V2 déjà là (le moteur pose ses calques après ses passes).
        if (f.kind === 'filter') {
          const now = await this.filterList(src);
          const firstOverlay = now.find(
            (x) =>
              x.filterName.startsWith(V2_PREFIX) &&
              this.planFilters().find((p) => p.name === x.filterName)?.kind ===
                'overlay',
          );
          const me = now.find((x) => x.filterName === f.name);
          if (firstOverlay && me && me.filterIndex > firstOverlay.filterIndex)
            await o.request('SetSourceFilterIndex', {
              sourceName: src,
              filterName: f.name,
              filterIndex: firstOverlay.filterIndex,
            });
        }
        created.push(f.name);
      } else if (have.filterSettings.shader_file_name !== f.effect_file) {
        await o.request('SetSourceFilterSettings', {
          sourceName: src,
          filterName: f.name,
          filterSettings: settings,
          overlay: true,
        });
        if (have.filterEnabled)
          await o.request('SetSourceFilterEnabled', {
            sourceName: src,
            filterName: f.name,
            filterEnabled: false,
          });
        updated.push(f.name);
      }
    }
    this.config.prepared = {
      version: this.plan!.version,
      at: new Date(this.now()).toISOString(),
    };
    await this.save();
    this.cache = null;
    this.log(
      `[chaos/obs] filtres préparés sur « ${src} » : ${created.length} créé(s), ${updated.length} mis à jour (sauvegarde ${backup})`,
    );
    return { source: src, created, updated, backup };
  }

  /** Retire les filtres V2 de la source (retour arrière explicite). Jamais un autre filtre. */
  async remove() {
    const src = this.config.source;
    if (!src) throw new ChaosObsError('invalid_request', 'aucune source');
    const o = this.connected();
    const removed: string[] = [];
    for (const f of await this.filterList(src))
      if (f.filterName.startsWith(V2_PREFIX)) {
        await o.request('RemoveSourceFilter', {
          sourceName: src,
          filterName: f.filterName,
        });
        removed.push(f.filterName);
      }
    this.config.prepared = null;
    await this.save();
    this.cache = null;
    return { source: src, removed };
  }
}
