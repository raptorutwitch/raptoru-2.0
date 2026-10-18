import { FX_CAM, type FxCamEffectId } from '@raptoru/schemas';
import {
  ObsActionError,
  type ObsActions,
} from '../channel-points/obs-actions.js';
import type { EffectEnd } from '../effects/player.js';
import { InteractionError } from './creepy.js';

// Native interaction FX Cam (P0.2, docs/EFFECTS_PLAYER.md § 11) — the SAMMI « FX cam » reward (deck « Points de chaine »,
// ID12 + its timer ID26 « FX JANITOR »). Core resolved the viewer's text to an allowed effect; here: enable the
// effect's filter on FX_CAM.source for FX_CAM.durationMs, through the rules' temporary obs_filter (Studio's one revert
// mechanism, obs-reverts.json: disabled at its end only if still enabled, after a Studio restart or an OBS outage too).
// The shader animates itself from its activation (elapsed_time_enable) and is back to the plain camera before the end.
// As SAMMI: only from FX_CAM.from (otherwise nothing; SAMMI refunded — impossible for a reward SAMMI created); the same
// effect while it runs is refused (SAMMI: « Cet effet est déjà actif », refunded); different effects stack (one filter
// each, OBS composes them).

export interface FxCamDeps {
  obs: ObsActions;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Lateness allowed after the end before forcing the revert check (the periodic check covers the rest). */
const DUE_MARGIN_MS = 30;

export class FxCam {
  private readonly running = new Set<FxCamEffectId>();

  constructor(private readonly d: FxCamDeps) {}

  private now() {
    return (this.d.now ?? Date.now)();
  }
  private sleep(ms: number) {
    return (this.d.sleep ?? ((t) => new Promise((ok) => setTimeout(ok, t))))(
      ms,
    );
  }

  /** Accepts an effect now (refused while the same one runs); resolves with the promise of its end. */
  start(effect: FxCamEffectId | undefined): { end: Promise<EffectEnd> } {
    if (!effect || !FX_CAM.effects.includes(effect))
      throw new InteractionError('FX Cam : effet inconnu');
    if (this.running.has(effect))
      throw new InteractionError(`FX « ${effect} » déjà actif`);
    this.running.add(effect);
    const end = this.run(effect).finally(() => this.running.delete(effect));
    return { end };
  }

  private async run(effect: FxCamEffectId): Promise<EffectEnd> {
    const { obs } = this.d;
    const failed = (error: string): EffectEnd => ({
      event: 'failed',
      error: error.slice(0, 200),
    });
    try {
      const from = await obs.currentScene();
      if (!(FX_CAM.from as readonly string[]).includes(from))
        return failed(
          `FX Cam refusé : pas de caméra sur la scène « ${from} » (aucun remboursement possible : récompense créée par SAMMI)`,
        );
      // Already on in OBS (enabled by hand, or still on from before a Studio restart): not restarted.
      if (await obs.filterEnabled(FX_CAM.source, effect))
        return failed(`FX « ${effect} » déjà actif dans OBS`);
      const t0 = this.now();
      await obs.run({
        type: 'obs_filter',
        source: FX_CAM.source,
        filter: effect,
        enabled: true,
        duration_ms: FX_CAM.durationMs,
      });
      await this.sleep(
        Math.max(0, t0 + FX_CAM.durationMs + DUE_MARGIN_MS - this.now()),
      );
      await obs.tick();
      // OBS gone meanwhile: the filter is disabled when OBS answers again (pending revert).
      await obs.filterEnabled(FX_CAM.source, effect).catch(() => {
        throw new ObsActionError(
          `FX « ${effect} » joué ; OBS déconnecté avant la fin (filtre désactivé au retour d’OBS)`,
        );
      });
      return { event: 'completed' };
    } catch (e) {
      return failed(
        e instanceof ObsActionError ? e.message : 'erreur inattendue',
      );
    }
  }
}
