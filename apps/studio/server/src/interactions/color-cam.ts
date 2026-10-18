import {
  COLOR_CAM,
  type ColorCamId,
  ColorCamId as ColorCamIdSchema,
  colorCamSettings,
} from '@raptoru/schemas';
import {
  ObsActionError,
  type ObsActions,
} from '../channel-points/obs-actions.js';
import type { EffectEnd } from '../effects/player.js';
import { InteractionError } from './creepy.js';

// Native interaction Couleur Cam (P0.2, docs/EFFECTS_PLAYER.md § 12) — the SAMMI « Couleur Cam » reward (Deck Principal,
// ID45 « Couleur Shushu »). Core resolved the viewer's text to a preset; here: the dedicated colour correction filter of
// the Shushu frame goes from its CURRENT values (a manual change is the start) to the preset in COLOR_CAM.transitionMs,
// smooth In/Out, then stays (as SAMMI: no reset). SAMMI ran four « Motion: Filter Settings » (one request per setting
// at each of its frames); here one request carries the five values, about 30 times a second, each step waiting for
// OBS's answer (never a backlog). The latest request wins: a colour asked during a transition takes over from the
// values reached, the older one stops before its next step (it can never write over the newer one). Nothing is
// persisted: after a Studio restart or an OBS outage the filter keeps the colour it reached.

export interface ColorCamDeps {
  obs: ObsActions;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const STEP_MS = 33;
const KEYS = [
  'gamma',
  'contrast',
  'brightness',
  'saturation',
  'hue_shift',
] as const;
/** The native filter's value when a key is absent from its settings (OBS stores only non-default values). */
const DEFAULTS: Record<(typeof KEYS)[number], number> = {
  gamma: 0,
  contrast: 0,
  brightness: 0,
  saturation: 0,
  hue_shift: 0,
};
/** SAMMI « Smooth: In/Out » (slow start, faster, slow end). */
export const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

export class ColorCam {
  /** The latest accepted transition: an older one stops at its next step. */
  private generation = 0;

  constructor(private readonly d: ColorCamDeps) {}

  private now() {
    return (this.d.now ?? Date.now)();
  }
  private sleep(ms: number) {
    return (this.d.sleep ?? ((t) => new Promise((ok) => setTimeout(ok, t))))(
      ms,
    );
  }

  /** Accepts a colour now; resolves with the promise of its end. */
  start(color: ColorCamId | undefined): { end: Promise<EffectEnd> } {
    if (!color || !ColorCamIdSchema.safeParse(color).success)
      throw new InteractionError('Couleur Cam : couleur inconnue');
    return { end: this.run(color) };
  }

  private async run(color: ColorCamId): Promise<EffectEnd> {
    const { obs } = this.d;
    const failed = (error: string): EffectEnd => ({
      event: 'failed',
      error: error.slice(0, 200),
    });
    let started = false;
    try {
      const from = await obs.currentScene();
      if (!(COLOR_CAM.from as readonly string[]).includes(from))
        return failed(
          `Couleur Cam refusée : pas de caméra sur la scène « ${from} » (aucun remboursement possible : récompense créée par SAMMI)`,
        );
      const mine = ++this.generation;
      const filter = await obs.filter(COLOR_CAM.source, COLOR_CAM.filter);
      if (!filter.enabled)
        return failed(
          `Couleur Cam : filtre « ${COLOR_CAM.filter} » désactivé dans OBS`,
        );
      const start = Object.fromEntries(
        KEYS.map((k) => {
          const v = Number(filter.settings[k] ?? DEFAULTS[k]);
          return [k, Number.isFinite(v) ? v : DEFAULTS[k]];
        }),
      ) as Record<(typeof KEYS)[number], number>;
      const target = colorCamSettings(color);
      const t0 = this.now();
      started = true;
      for (;;) {
        if (this.generation !== mine) return { event: 'completed' };
        const t = Math.min(1, (this.now() - t0) / COLOR_CAM.transitionMs);
        const k = easeInOut(t);
        await obs.setFilterSettings(
          COLOR_CAM.source,
          COLOR_CAM.filter,
          Object.fromEntries(
            KEYS.map((key) => [
              key,
              t === 1
                ? target[key]
                : start[key] + (target[key] - start[key]) * k,
            ]),
          ),
        );
        if (t === 1) return { event: 'completed' };
        await this.sleep(STEP_MS);
      }
    } catch (e) {
      const reason =
        e instanceof ObsActionError ? e.message : 'erreur inattendue';
      return failed(
        started
          ? `Couleur « ${color} » interrompue : ${reason} (couleur atteinte conservée)`
          : reason,
      );
    }
  }
}
