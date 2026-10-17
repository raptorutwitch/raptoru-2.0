import type { CpInteractionId } from '@raptoru/schemas';
import {
  ObsActionError,
  type ObsActions,
} from '../channel-points/obs-actions.js';
import type { EffectEnd, EffectsPlayer } from '../effects/player.js';

// Native interactions (P0.2, docs/EFFECTS_PLAYER.md § 9) — written in code with their legacy parameters; the streamer
// only picks one for a reward. Creepy = the SAMMI « Creepy » button (deck « Points de chaine », ID28), same timeline
// (SAMMI command delays are absolute from the trigger). OBS does the look: the « Creepy Effect » scene animates itself
// when it becomes active (Move filters, overlay page) and its transitions (Cut in and out) are OBS's own settings —
// nothing of it is redone here. Studio only triggers:
//   t0      restart the media « Prowler Effect » and show it in « Alerte complète » until t+4 s (temporary source);
//   t+0.5 s the sound « Prowler Effect.ogg » at 29 % (effects player);
//   t+0.8 s the scene « Creepy Effect » until t+5 s (temporary scene: back to the starting scene, only if the program
//           is still on « Creepy Effect »).
// Both « until » go through Studio's one revert mechanism (obs-reverts.json): a Studio restart or an OBS outage never
// replays the effect, it only restores what is due, where nothing changed meanwhile. Start condition: the program
// scene is one of CREEPY.from (otherwise nothing happens, as in SAMMI). Several Creepy close together run one after the
// other (SAMMI's button is queueable, 6 s long); a few may wait, more are refused.

export const CREEPY = {
  from: ['Scène Fullscreen', 'Just Chatting', 'Scène PS5', 'Scène Dessin'],
  scene: 'Creepy Effect',
  media: { scene: 'Alerte complète', source: 'Prowler Effect' },
  sound: { id: 'prowler-effect', volume: 29 },
  soundAt: 500,
  sceneAt: 800,
  mediaUntil: 4000,
  backAt: 5000,
  /** SAMMI button duration: the next Creepy starts after this. */
  runMs: 6000,
  /** Creepy waiting behind the one running (beyond: refused). */
  maxWaiting: 4,
} as const;

/** A readable refusal (French, for the history). */
export class InteractionError extends Error {}

export interface InteractionsDeps {
  obs: ObsActions;
  effects: EffectsPlayer | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Lateness allowed after a due instant before forcing the revert check (the periodic check covers the rest). */
const DUE_MARGIN_MS = 30;

export class Interactions {
  private queue: Promise<unknown> = Promise.resolve();
  /** Creepy accepted and not ended (the one running + those waiting). */
  private inFlight = 0;

  constructor(private readonly d: InteractionsDeps) {}

  private now() {
    return (this.d.now ?? Date.now)();
  }
  private sleep(ms: number) {
    return (this.d.sleep ?? ((t) => new Promise((ok) => setTimeout(ok, t))))(
      ms,
    );
  }

  /** Accepts an interaction now; resolves with the promise of its end (it may first wait for the one running). */
  start(id: CpInteractionId): { end: Promise<EffectEnd> } {
    if (id !== 'creepy') throw new InteractionError('interaction inconnue');
    if (this.inFlight >= 1 + CREEPY.maxWaiting)
      throw new InteractionError('Creepy déjà en attente (trop de demandes)');
    this.inFlight += 1;
    const end = this.queue
      .then(() => this.creepy())
      .finally(() => {
        this.inFlight -= 1;
      });
    this.queue = end.catch(() => undefined);
    return { end };
  }

  private async creepy(): Promise<EffectEnd> {
    const { obs, effects } = this.d;
    const t0 = this.now();
    const until = (ms: number) => this.sleep(Math.max(0, t0 + ms - this.now()));
    const left = (ms: number) => Math.max(500, t0 + ms - this.now());
    try {
      const from = await obs.currentScene();
      if (!(CREEPY.from as readonly string[]).includes(from))
        return {
          event: 'failed',
          error: `Creepy ignoré : scène « ${from} » non prévue`.slice(0, 200),
        };
      await obs.restartMedia(CREEPY.media.source);
      await obs.run({
        type: 'obs_source',
        scene: CREEPY.media.scene,
        source: CREEPY.media.source,
        visible: true,
        duration_ms: left(CREEPY.mediaUntil),
      });
      await until(CREEPY.soundAt);
      let noSound = false;
      try {
        if (!effects) throw new Error('effects_player_unavailable');
        await effects.play({
          kind: 'sound',
          id: CREEPY.sound.id,
          volume: CREEPY.sound.volume,
        });
      } catch {
        noSound = true; // the visual still runs, as SAMMI's buttons do; reported below
      }
      await until(CREEPY.sceneAt);
      await obs.run({
        type: 'obs_scene',
        scene: CREEPY.scene,
        duration_ms: left(CREEPY.backAt),
      });
      // The two ends are due now: checked at once (the periodic check would add up to 250 ms).
      await until(CREEPY.mediaUntil + DUE_MARGIN_MS);
      await obs.tick();
      await until(CREEPY.backAt + DUE_MARGIN_MS);
      await obs.tick();
      await until(CREEPY.runMs);
      return noSound
        ? { event: 'failed', error: 'creepy_no_sound' }
        : { event: 'completed' };
    } catch (e) {
      return {
        event: 'failed',
        error: (e instanceof ObsActionError
          ? e.message
          : 'erreur inattendue'
        ).slice(0, 200),
      };
    }
  }
}
