/* global performance, requestAnimationFrame, setTimeout */
// Bonk VNext lot 1 — the scene: one requestAnimationFrame loop moves every projectile along its
// precomputed trajectory, triggers its impact (puff + governed sound) and applies the density rules.
// Time-driven (elapsed since the start), so a slow frame never changes a trajectory.

import { createSeededRandom, seedFromReference } from '../bonk-v3-core.js';
import { createAudioGovernor } from './audio.js';
import { DENSITY, densityDecision } from './density.js';
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

  const puff = (s) => {
    const el = document.createElement('div');
    el.className = 'puff';
    const d = Math.round(s.plan.size * 0.9);
    el.style.width = el.style.height = `${d}px`;
    const at = `translate(${(s.plan.impact.x - d / 2).toFixed(1)}px, ${(s.plan.impact.y - d / 2).toFixed(1)}px)`;
    el.style.transform = `${at} scale(0)`;
    stage.append(el);
    // Full transform keyframes (no individual `scale` property: older OBS browsers lack it).
    const animation = el.animate?.(
      [
        { opacity: 0.55, transform: `${at} scale(0.4)` },
        { opacity: 0, transform: `${at} scale(1.3)` },
      ],
      { duration: 180, easing: 'ease-out' },
    );
    if (animation) animation.finished.finally(() => el.remove());
    else el.remove();
  };

  const impact = (s, t) => {
    if (!s.reduced) puff(s);
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
     */
    async play({ id, image }) {
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
        reduced: decision.reduced,
        mode: target.mode,
        rect: target.rect,
      });
      recent.push({ x: plan.impact.x, y: plan.impact.y });
      if (recent.length > RECENT_IMPACTS) recent.shift();
      history.push(plan.family);
      if (history.length > 2) history.shift();
      lastEntry = plan.entry;

      const s = {
        el: image,
        plan,
        reduced: decision.reduced,
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
