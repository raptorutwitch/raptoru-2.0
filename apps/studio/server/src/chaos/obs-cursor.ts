import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ObsLike } from '../channel-points/obs-actions.js';

// Chaos › curseur d'OBS (docs/chaos/CURSEUR_OBS.md). Pendant un effet qui transforme l'image (miroir, retournement,
// tremblement, zoom, ivre, tunnel), le moteur masque le vrai curseur à l'écran et dessine le curseur transformé dans
// le calque, que la source « Écran » d'OBS capture (capture directe). OBS dessine en plus le vrai curseur, qu'il lit de
// Windows : deux curseurs dans le stream. Pendant ces effets, Studio coupe « Capturer le curseur » de cette source, sur
// la SEULE connexion OBS de Studio, et rétablit exactement la valeur d'avant à la fin, à STOP ALL, à l'arrêt du moteur,
// à la reconnexion d'OBS ou au redémarrage de Studio (valeur d'avant gardée sur disque tant qu'elle n'est pas rétablie).
// Rien d'autre n'est touché : ni une autre source, ni un filtre, ni une scène ; la source n'est pas recréée.
// Coût mesuré (chaos-obs-check --cursor-toggle) : OBS redémarre sa capture DXGI à chaque changement de ce réglage,
// 0 à 2 images vides le plus souvent : un changement au début, un à la fin, regroupés pour les effets enchaînés.

/** Réglage « curseur » selon le type de source d'OBS. */
const CURSOR_KEY: Record<string, string> = {
  monitor_capture: 'capture_cursor',
  game_capture: 'capture_cursor',
  window_capture: 'cursor',
};
const ENDED = new Set([
  'effect.ended',
  'effect.failed',
  'effect.canceled',
  'effect.expired',
  'effect.rejected',
]);

interface Saved {
  source: string;
  key: string;
  previous: boolean;
  at: string;
}
interface State {
  enabled: boolean;
  saved: Saved | null;
}
/** Vue d'activation du moteur (événements effect.*) : ce qui décide d'un curseur logiciel. */
export interface CursorView {
  effect?: string;
  target?: { device?: string | null; input?: string | null } | null;
  outputs?: { obs?: boolean } | null;
}

export class ChaosObsCursor {
  state: State = { enabled: false, saved: null };
  /** Activations (acceptées, en file ou en cours) qui dessinent un curseur sur l'écran de la source. */
  private readonly holders = new Set<string>();
  /** Activations vues : en cours d'évaluation, retenues (curseur logiciel sur l'écran de la source), sans curseur, finies. */
  private readonly seen = new Map<
    string,
    'pending' | 'held' | 'no' | 'ended'
  >();
  private chain: Promise<void> = Promise.resolve();
  private lingerUntil = 0;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Curseur déjà coupé dans OBS avant l'effet : laissé tel quel, rien à rétablir. */
  private leftAlone = false;
  /** Valeur coupée revérifiée depuis la dernière (re)connexion. */
  private verified = false;
  private wasConnected = false;
  lastIncident: { at: string; message: string } | null = null;

  constructor(
    private readonly file: string,
    private readonly obs: () => ObsLike | null,
    private readonly target: () => {
      source: string | null;
      device: string | null;
    },
    /** L'effet dessine-t-il un curseur logiciel (registre "cursor": "follow", réglage de la fiche, suivi actif) ? */
    private readonly drawsCursor: (effect: string) => Promise<boolean>,
    private readonly log: (line: string) => void = () => {},
    private readonly now: () => number = Date.now,
    /** Délai avant de rétablir : un effet enchaîné juste après ne provoque pas deux coupures de la capture. */
    private readonly lingerMs = 600,
  ) {}

  async load() {
    try {
      const s = JSON.parse(await readFile(this.file, 'utf8')) as Partial<State>;
      this.state = {
        enabled: s.enabled === true,
        saved:
          s.saved &&
          typeof s.saved.source === 'string' &&
          typeof s.saved.key === 'string' &&
          typeof s.saved.previous === 'boolean'
            ? s.saved
            : null,
      };
    } catch {
      /* rien d'enregistré : désactivé, rien à rétablir */
    }
    if (this.state.saved)
      this.log(
        `[chaos/curseur] « Capturer le curseur » de « ${this.state.saved.source} » à rétablir (Studio arrêté pendant un effet)`,
      );
  }
  private async persist() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.state, null, 2));
    await rename(`${this.file}.tmp`, this.file);
  }

  /** Relevé régulier : reconnexion d'OBS, valeur à rétablir après un redémarrage de Studio ou d'OBS. */
  start() {
    this.timer ??= setInterval(() => {
      const c = this.obs()?.connected === true;
      if (!c) this.verified = false;
      if (c !== this.wasConnected) this.wasConnected = c;
      if (c && (this.state.saved || this.holders.size)) this.kick();
    }, 1000);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.timer = this.lingerTimer = null;
  }

  async setEnabled(on: boolean) {
    this.state.enabled = on;
    await this.persist();
    this.kick();
    await this.chain;
  }

  status() {
    return {
      enabled: this.state.enabled,
      active: this.holders.size,
      hidden: this.state.saved !== null,
      left_alone: this.leftAlone,
      pending_restore:
        this.state.saved !== null && this.holders.size === 0
          ? this.state.saved.source
          : null,
      incident: this.lastIncident,
    };
  }

  // ---------- Événements du moteur ----------
  onEngineEvent(e: Record<string, unknown>) {
    const ev = String(e.event ?? '');
    if (ev === 'engine.emergency_stop') return void this.releaseAll();
    const rid = typeof e.request_id === 'string' ? e.request_id : null;
    if (!rid || !ev.startsWith('effect.')) return;
    if (ENDED.has(ev)) {
      this.seen.set(rid, 'ended');
      if (this.holders.delete(rid) && this.holders.size === 0) this.linger();
      setTimeout(() => this.seen.delete(rid), 60_000).unref?.();
      return;
    }
    if (this.seen.has(rid)) return;
    this.seen.set(rid, 'pending');
    void this.evaluate(e as CursorView)
      .then((draws) => {
        // Fin arrivée pendant l'évaluation : rien à retenir.
        if (this.seen.get(rid) !== 'pending') return;
        this.seen.set(rid, draws ? 'held' : 'no');
        if (!draws) return;
        this.holders.add(rid);
        this.lingerUntil = 0;
        this.kick();
      })
      .catch(() => this.seen.set(rid, 'no'));
  }

  /** Curseur logiciel sur l'écran que capture la source, sans la sortie OBS (filtres : le calque y est exclu). */
  private async evaluate(v: CursorView) {
    const t = this.target();
    if (!this.state.enabled || !t.source || !t.device || !v.effect)
      return false;
    if (v.outputs?.obs === true || v.target?.input) return false;
    if ((v.target?.device ?? '').toLowerCase() !== t.device.toLowerCase())
      return false;
    return this.drawsCursor(v.effect);
  }

  /** STOP ALL, arrêt d'urgence, moteur arrêté : rétabli tout de suite. */
  releaseAll() {
    this.holders.clear();
    this.lingerUntil = 0;
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.kick();
    return this.chain;
  }

  private linger() {
    this.lingerUntil = this.now() + this.lingerMs;
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = setTimeout(() => {
      this.lingerTimer = null;
      // The delay is over when its timer fires: a timer can fire a little before the wall clock reaches
      // `lingerUntil`, and the cursor would then stay off until the next effect (CI, PR #130).
      this.lingerUntil = 0;
      this.kick();
    }, this.lingerMs);
    this.lingerTimer.unref?.();
  }

  private kick() {
    this.chain = this.chain
      .then(() => this.apply())
      .catch((err: unknown) => {
        this.incident(err instanceof Error ? err.message : String(err));
      });
  }

  /** Amène OBS à l'état voulu ; ne fait aucune requête quand il y est déjà. */
  private async apply() {
    const o = this.obs();
    if (!o?.connected) return;
    const src = this.target().source;
    const want =
      this.state.enabled &&
      !!src &&
      (this.holders.size > 0 || this.now() < this.lingerUntil);
    const saved = this.state.saved;
    if (want && !saved && !this.leftAlone && src) {
      const r = await o.request('GetInputSettings', { inputName: src });
      const kind = String(r.inputKind ?? '');
      const key = CURSOR_KEY[kind];
      if (!key) {
        this.leftAlone = true;
        this.incident(
          `« ${src} » (${kind || 'type inconnu'}) n'a pas de réglage de curseur connu : laissée telle quelle`,
        );
        return;
      }
      let cur = (r.inputSettings as Record<string, unknown> | undefined)?.[key];
      if (typeof cur !== 'boolean') {
        const d = await o.request('GetInputDefaultSettings', {
          inputKind: kind,
        });
        cur = (d.defaultInputSettings as Record<string, unknown> | undefined)?.[
          key
        ];
      }
      if (cur === false) {
        this.leftAlone = true; // déjà coupé par Antoni : on n'y touche pas, rien à rétablir
        return;
      }
      this.state.saved = {
        source: src,
        key,
        previous: true,
        at: new Date(this.now()).toISOString(),
      };
      await this.persist();
      try {
        await o.request('SetInputSettings', {
          inputName: src,
          inputSettings: { [key]: false },
          overlay: true,
        });
        this.verified = true;
        this.log(`[chaos/curseur] curseur d'OBS coupé sur « ${src} »`);
      } catch (err) {
        this.state.saved = null; // rien n'a changé dans OBS
        await this.persist();
        throw err;
      }
    } else if (want && saved && !this.verified) {
      // Reconnexion pendant un effet : OBS a pu redémarrer avec le curseur rétabli.
      const r = await o.request('GetInputSettings', {
        inputName: saved.source,
      });
      if (
        (r.inputSettings as Record<string, unknown> | undefined)?.[
          saved.key
        ] !== false
      )
        await o.request('SetInputSettings', {
          inputName: saved.source,
          inputSettings: { [saved.key]: false },
          overlay: true,
        });
      this.verified = true;
    } else if (!want && saved) {
      await o.request('SetInputSettings', {
        inputName: saved.source,
        inputSettings: { [saved.key]: saved.previous },
        overlay: true,
      });
      this.state.saved = null;
      await this.persist();
      this.log(`[chaos/curseur] curseur d'OBS rétabli sur « ${saved.source} »`);
    }
    if (!want) this.leftAlone = false;
  }

  private incident(message: string) {
    this.lastIncident = { at: new Date(this.now()).toISOString(), message };
    this.log(`[chaos/curseur] ${message}`);
  }
}
