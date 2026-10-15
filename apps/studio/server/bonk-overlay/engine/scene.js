/* global performance, requestAnimationFrame, setTimeout */
// Bonk VNext lot 1 — the scene: one requestAnimationFrame loop moves every projectile along its
// precomputed trajectory, triggers its impact (historical FX, lot 6 + governed sound) and applies the
// density rules. Lot 6: also plays the combo finisher (one giant projectile, same engine).
// Time-driven (elapsed since the start), so a slow frame never changes a trajectory.

import { createSeededRandom, seedFromReference } from '../bonk-v3-core.js';
import { createAudioGovernor } from './audio.js';
import { finisherSize } from './combo.js';
import { DENSITY, densityDecision } from './density.js';
import { pickImpactFx, spawnImpactFx } from './impact-fx.js';
import { sampleAt } from './physics.js';
import { planShot } from './plan.js';
import { CANVAS, DEFAULT_TARGET, MIN_SIDE } from './target.js';

const RECENT_IMPACTS = 6;
/** End guaranteed even without frames. */
const END_FALLBACK_MS = 500;

/**
 * @param {object} o
 * @param {{append(el: unknown): void}} o.stage
 * @param {{play(sound: object): void}} o.audio
 * @param {Document} o.document
 */
export function createScene({
  stage,
  audio,
  document,
  now = () => performance.now(),
  frame = (cb) => requestAnimationFrame(cb),
  timer = (cb, ms) => setTimeout(cb, ms),
  limits = DENSITY,
}) {
  const sprites = [];
  const recent = [];
  const history = [];
  let lastEntry = null;
  /** Saved target (Studio settings, lot 2); new projectiles only, the ones in flight keep theirs. */
  let target = { mode: 'manual', rect: DEFAULT_TARGET };
  let looping = false;
  const governor = createAudioGovernor();

  const finish = (s) => {
    if (s.done) return;
    s.done = true;
    s.el.remove();
    sprites.splice(sprites.indexOf(s), 1);
    s.resolveStarted();
    s.resolveFinished();
  };

  const impact = (s, t) => {
    // Dense scene: no FX (as the former puff); the finisher always has its FX, always with the wave.
    if (!s.reduced || s.plan.finisher)
      spawnImpactFx({
        document,
        stage,
        timer,
        at: s.plan.impact,
        size: s.plan.size,
        variant: s.plan.finisher ? 'exact' : s.fx,
      });
    const sound = governor.onImpact(t, s.audioRandom, { heavy: s.plan.heavy });
    if (sound.play) audio.play(sound);
  };

  const render = (s, t) => {
    if (s.done) return;
    s.resolveStarted();
    const elapsed = t - s.begin;
    const trajectory = s.plan.trajectory;
    if (!s.impacted && elapsed >= trajectory.impactMs) {
      s.impacted = true;
      impact(s, t);
    }
    const k =
      s.fastExitAt === null ? 1 : 1 - (t - s.fastExitAt) / limits.fastExitMs;
    if (elapsed >= trajectory.durationMs || k <= 0) return finish(s);
    const state = sampleAt(trajectory, elapsed);
    const half = s.plan.size / 2;
    s.el.style.transform = `translate(${(state.x - half).toFixed(1)}px, ${(state.y - half).toFixed(1)}px) rotate(${state.rot.toFixed(1)}deg) scale(${(state.sx * k).toFixed(3)}, ${(state.sy * k).toFixed(3)})`;
  };

  const loop = () => {
    const t = now();
    for (const s of [...sprites]) render(s, t);
    if (sprites.length) frame(loop);
    else looping = false;
  };

  /** The oldest projectiles still on their normal course leave in `fastExitMs`. */
  const accelerate = (count) => {
    const t = now();
    for (const s of sprites) {
      if (count <= 0) break;
      if (s.fastExitAt !== null) continue;
      s.fastExitAt = t;
      count -= 1;
    }
  };

  return {
    /** Projectiles on screen. */
    /** Applies a saved target; anything malformed is ignored (the current one stays). */
    setTarget(next) {
      if (next?.mode === 'fullscreen') {
        target = { mode: 'fullscreen', rect: null };
        return;
      }
      const r = next?.rect;
      const ok =
        next?.mode === 'manual' &&
        r &&
        [r.x, r.y, r.w, r.h].every(Number.isFinite) &&
        r.w >= MIN_SIDE &&
        r.h >= MIN_SIDE &&
        r.x >= 0 &&
        r.y >= 0 &&
        r.x + r.w <= CANVAS.width + 0.5 &&
        r.y + r.h <= CANVAS.height + 0.5;
      if (ok)
        target = { mode: 'manual', rect: { x: r.x, y: r.y, w: r.w, h: r.h } };
    },

    get target() {
      return target;
    },

    get alive() {
      return sprites.length;
    },

    /**
     * Shows one projectile (`image`: decoded <img>). `started`: it is on screen; `finished`: it has
     * left. Never dropped: under density it is shorter, or waits (bounded) for a free slot.
     * `finisherViewers` (lot 6): the combo finisher, sized by its distinct viewers; it stays out of the
     * anti-repetition context of the normal shots and is never reduced.
     */
    async play({ id, image, finisherViewers = null }) {
      const giant =
        finisherViewers === null ? null : finisherSize(finisherViewers);
      if (finisherViewers !== null && giant === null)
        throw new Error('finisher_needs_viewers');
      const waitStart = now();
      let decision = densityDecision(sprites.length, 0, limits);
      while (decision.wait) {
        accelerate(1);
        await new Promise((r) => timer(r, 50));
        decision = densityDecision(sprites.length, now() - waitStart, limits);
      }
      if (decision.accelerate) accelerate(decision.accelerate);
      const plan = planShot(id, {
        recent,
        history,
        lastEntry,
        reduced: giant ? false : decision.reduced,
        mode: target.mode,
        rect: target.rect,
        ...(giant ? { finisherSize: giant } : {}),
      });
      if (!giant) {
        recent.push({ x: plan.impact.x, y: plan.impact.y });
        if (recent.length > RECENT_IMPACTS) recent.shift();
        history.push(plan.family);
        if (history.length > 2) history.shift();
        lastEntry = plan.entry;
      }

      const s = {
        el: image,
        plan,
        reduced: giant ? false : decision.reduced,
        fx: pickImpactFx(createSeededRandom(seedFromReference(`${id}:fx`))),
        audioRandom: createSeededRandom(seedFromReference(`${id}:audio`)),
        begin: now(),
        impacted: false,
        fastExitAt: null,
        done: false,
      };
      s.started = new Promise((r) => (s.resolveStarted = r));
      s.finished = new Promise((r) => (s.resolveFinished = r));
      image.className = 'projectile';
      image.style.width = image.style.height = `${plan.size}px`;
      stage.append(image);
      sprites.push(s);
      render(s, s.begin); // on screen now: started
      timer(() => finish(s), plan.trajectory.durationMs + END_FALLBACK_MS);
      if (!looping) {
        looping = true;
        frame(loop);
      }
      return { started: s.started, finished: s.finished, plan };
    },
  };
}
