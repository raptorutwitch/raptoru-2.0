import {
  ObsActionError,
  type ObsActions,
} from '../channel-points/obs-actions.js';
import {
  type EffectEnd,
  EffectError,
  type EffectsPlayer,
} from '../effects/player.js';
import { InteractionError } from './creepy.js';

// Native interaction BRB (P0.2, docs/EFFECTS_PLAYER.md § 10) — the SAMMI « We'll Be Right back » button (deck « Points
// de chaine », ID48), same timeline (SAMMI: Wait commands between the steps):
//   t0      instant capture of the source « Écran » (screen);
//   t+0.6 s instant capture of « overlay cam shushu » (camera);
//   t+1.2 s the legacy BRB layer on the effects player (both captures + « We'll be right back » video), and « Micro » and
//           « Musique Isolée » muted;
//   t+7.2 s « Musique Isolée » and « Micro » unmuted.
// The captures stay in memory (never a file) and leave with the effect. The mutes go through Studio's one revert
// mechanism (obs-reverts.json): unmuted at their end, after an error, or after a Studio restart — only if still muted (a
// manual change is kept; an input muted before BRB stays muted). Start condition: the program scene is one of BRB.from;
// otherwise nothing happens (SAMMI refunded the reward and wrote « Pas la bonne scène pour ça ! » in the chat — Raptoru
// cannot refund a reward SAMMI created: the history says so). Effects player absent: nothing is done (no mute without
// the animation). One BRB at a time (SAMMI's button is neither queueable nor overlappable): a BRB asked while one runs is
// refused.

export const BRB = {
  from: ['Scène Dessin', 'Scène Fullscreen', 'Scène PS5'],
  screen: 'Écran',
  cam: 'overlay cam shushu',
  camAt: 600,
  showAt: 1200,
  mute: ['Micro', 'Musique Isolée'],
  unmuteAt: 7200,
} as const;

export interface BrbDeps {
  obs: ObsActions;
  effects: EffectsPlayer | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Lateness allowed after a due instant before forcing the revert check (the periodic check covers the rest). */
const DUE_MARGIN_MS = 30;

export class Brb {
  private running = false;

  constructor(private readonly d: BrbDeps) {}

  private now() {
    return (this.d.now ?? Date.now)();
  }
  private sleep(ms: number) {
    return (this.d.sleep ?? ((t) => new Promise((ok) => setTimeout(ok, t))))(
      ms,
    );
  }

  /** Accepts a BRB now (refused while one runs); resolves with the promise of its end. */
  start(): { end: Promise<EffectEnd> } {
    if (this.running) throw new InteractionError('BRB déjà en cours');
    this.running = true;
    const end = this.run().finally(() => {
      this.running = false;
    });
    return { end };
  }

  private async run(): Promise<EffectEnd> {
    const { obs, effects } = this.d;
    const t0 = this.now();
    const until = (ms: number) => this.sleep(Math.max(0, t0 + ms - this.now()));
    const failed = (error: string): EffectEnd => ({
      event: 'failed',
      error: error.slice(0, 200),
    });
    try {
      const from = await obs.currentScene();
      if (!(BRB.from as readonly string[]).includes(from))
        return failed(
          `BRB refusé : scène « ${from} » non prévue (aucun remboursement possible : récompense créée par SAMMI)`,
        );
      const page = effects?.status();
      if (!effects || !page?.connected || !page.audio)
        return failed(
          'BRB annulé : lecteur d’effets non ouvert (aucune capture, aucune coupure)',
        );
      const screen = await obs.screenshot(BRB.screen);
      await until(BRB.camAt);
      const cam = await obs.screenshot(BRB.cam);
      await until(BRB.showAt);
      // The animation and the mutes at the same instant (as SAMMI); the mutes are undone at once if it cannot start.
      const [shown, ...muted] = await Promise.allSettled([
        effects.play({ kind: 'wbrb', screen, cam }),
        ...BRB.mute.map((input) =>
          obs.temporaryMute(
            input,
            Math.max(500, t0 + BRB.unmuteAt - this.now()),
          ),
        ),
      ]);
      if (shown.status === 'rejected') {
        for (const input of BRB.mute) await obs.endMute(input).catch(() => {});
        const e = shown.reason as Error;
        return failed(
          e instanceof EffectError ? e.message : 'erreur inattendue',
        );
      }
      await until(BRB.unmuteAt + DUE_MARGIN_MS);
      await obs.tick();
      const played = await shown.value.end;
      const notMuted = BRB.mute.filter(
        (_, i) => muted[i]!.status === 'rejected',
      );
      if (played.event !== 'completed')
        return { event: played.event, error: played.error };
      // As SAMMI (its mute of a missing input just fails): the effect ran, the history names the input not muted.
      if (notMuted.length)
        return failed(`BRB joué, coupure impossible : ${notMuted.join(', ')}`);
      return { event: 'completed' };
    } catch (e) {
      return failed(
        e instanceof ObsActionError ? e.message : 'erreur inattendue',
      );
    }
  }
}
