import type { ObsLike } from '../channel-points/obs-actions.js';
import { ChaosObsError } from './obs-output.js';

// Chaos › relais anti-coupure du curseur d'OBS (docs/chaos/CURSEUR_OBS.md § 5).
// Changer « Capturer le curseur » d'une capture d'écran fait relâcher par la source sa duplication DXGI ; seule capture
// de cet écran, elle la détruit puis la recrée : images vides (le flash noir). OBS partage UNE duplication par écran
// entre toutes ses captures de cet écran (compteur de références, libobs-d3d11) : une seconde capture du même écran,
// toujours affichée, la garde en vie et la bascule devient instantanée. Le relais est cette seconde capture : sans
// curseur, minuscule et hors du cadre (invisible dans le stream), verrouillée, tout en bas de chaque scène qui contient
// la source. Créé et retiré seulement sur un geste d'Antoni (aperçu exact, confirmation) ; rien d'autre n'est touché.

export const RELAY_PREFIX = 'Raptoru Chaos V2 · relais curseur · ';
/** Hors du cadre et minuscule : jamais visible, mais « affichée » pour OBS (la duplication reste partagée). */
const PLACE = {
  positionX: -4000,
  positionY: -4000,
  scaleX: 0.002,
  scaleY: 0.002,
};

interface SceneItem {
  sourceName: string;
  sceneItemId: number;
  sceneItemIndex?: number;
  sceneItemEnabled?: boolean;
}

export class ChaosObsRelay {
  constructor(
    private readonly obs: () => ObsLike | null,
    private readonly source: () => string | null,
    private readonly log: (line: string) => void = () => {},
  ) {}

  static nameFor(source: string) {
    return RELAY_PREFIX + source;
  }

  private conn() {
    const o = this.obs();
    if (!o?.connected)
      throw new ChaosObsError(
        'obs_offline',
        'OBS non connecté (réglages du Bonk)',
      );
    return o;
  }

  /** Où en est le relais : présent, sur le bon écran, dans quelles scènes de la source il manque. */
  async status() {
    const src = this.source();
    const o = this.obs();
    if (!src || !o?.connected)
      return {
        source: src,
        ready: false,
        reason: !src ? 'source gameplay non choisie' : 'OBS non connecté',
      };
    try {
      const plan = await this.plan();
      return {
        source: src,
        relay: plan.relay,
        exists: plan.exists,
        same_screen: plan.sameScreen,
        scenes: plan.scenes,
        missing: plan.missing,
        program_covered: plan.programCovered,
        ready: plan.exists && plan.sameScreen && plan.missing.length === 0,
      };
    } catch (e) {
      return {
        source: src,
        ready: false,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** Ce que « Préparer » ferait, exactement (rien n'est modifié). */
  async plan() {
    const o = this.conn();
    const src = this.source();
    if (!src)
      throw new ChaosObsError('obs_relay', 'source gameplay non choisie');
    const relay = ChaosObsRelay.nameFor(src);
    const s = await o.request('GetInputSettings', { inputName: src });
    if (s.inputKind !== 'monitor_capture')
      throw new ChaosObsError(
        'obs_relay',
        `« ${src} » n'est pas une capture d'écran (${String(s.inputKind)}) : relais inutile`,
      );
    const srcSettings = (s.inputSettings ?? {}) as Record<string, unknown>;
    let relaySettings: Record<string, unknown> | null = null;
    try {
      relaySettings = (
        await o.request('GetInputSettings', { inputName: relay })
      ).inputSettings as Record<string, unknown>;
    } catch {
      /* pas encore de relais */
    }
    const list = await o.request('GetSceneList', {});
    const scenes = ((list.scenes ?? []) as { sceneName: string }[]).map(
      (x) => x.sceneName,
    );
    const program = String(
      list.currentProgramSceneName ?? list.currentProgramScene ?? '',
    );
    const withSource: string[] = [];
    const missing: string[] = [];
    for (const sc of scenes) {
      const items = ((await o.request('GetSceneItemList', { sceneName: sc }))
        .sceneItems ?? []) as SceneItem[];
      if (!items.some((i) => i.sourceName === src)) continue;
      withSource.push(sc);
      if (!items.some((i) => i.sourceName === relay)) missing.push(sc);
    }
    return {
      relay,
      exists: relaySettings !== null,
      sameScreen:
        relaySettings === null ||
        (relaySettings.monitor_id === srcSettings.monitor_id &&
          (relaySettings.method ?? 0) === (srcSettings.method ?? 0)),
      settings: {
        monitor_id: srcSettings.monitor_id,
        method: srcSettings.method ?? 0,
        capture_cursor: false,
      },
      scenes: withSource,
      missing,
      programCovered:
        !withSource.includes(program) || !missing.includes(program),
    };
  }

  /**
   * Crée le relais (une capture sans curseur du même écran) et l'ajoute, caché le temps d'être placé, à chaque scène
   * qui contient la source : hors du cadre, minuscule, tout en bas, verrouillé. Idempotent (complète ce qui manque).
   */
  async prepare() {
    const o = this.conn();
    const p = await this.plan();
    const done: string[] = [];
    for (const sc of p.missing) {
      let id: number;
      if (!p.exists && done.length === 0) {
        id = Number(
          (
            await o.request('CreateInput', {
              sceneName: sc,
              inputName: p.relay,
              inputKind: 'monitor_capture',
              inputSettings: p.settings,
              sceneItemEnabled: false,
            })
          ).sceneItemId,
        );
      } else {
        id = Number(
          (
            await o.request('CreateSceneItem', {
              sceneName: sc,
              sourceName: p.relay,
              sceneItemEnabled: false,
            })
          ).sceneItemId,
        );
      }
      await o.request('SetSceneItemTransform', {
        sceneName: sc,
        sceneItemId: id,
        sceneItemTransform: PLACE,
      });
      await o.request('SetSceneItemIndex', {
        sceneName: sc,
        sceneItemId: id,
        sceneItemIndex: 0,
      });
      await o.request('SetSceneItemLocked', {
        sceneName: sc,
        sceneItemId: id,
        sceneItemLocked: true,
      });
      await o.request('SetSceneItemEnabled', {
        sceneName: sc,
        sceneItemId: id,
        sceneItemEnabled: true,
      });
      done.push(sc);
    }
    if (p.exists && !p.sameScreen)
      await o.request('SetInputSettings', {
        inputName: p.relay,
        inputSettings: p.settings,
        overlay: true,
      });
    this.log(
      `[chaos/relais] relais « ${p.relay} » ${done.length ? `ajouté à ${done.join(', ')}` : 'déjà en place'}`,
    );
    return { relay: p.relay, added: done, status: await this.status() };
  }

  /** Retour arrière : le relais disparaît de toutes les scènes (aucune autre source touchée). */
  async remove() {
    const o = this.conn();
    const src = this.source();
    if (!src)
      throw new ChaosObsError('obs_relay', 'source gameplay non choisie');
    const relay = ChaosObsRelay.nameFor(src);
    try {
      await o.request('RemoveInput', { inputName: relay });
    } catch {
      return { removed: false };
    }
    this.log(`[chaos/relais] relais « ${relay} » retiré`);
    return { removed: true };
  }
}
