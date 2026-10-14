// Bonk VNext lot 1 — trajectory simulator, ported from the legacy `buildBonkTrajectory`
// (bonk-v3-core.js, kept unchanged): same gravity, 16 ms step, wall bounces, ground hold and roll,
// « fall » / « shrink » exits. Generalised: any entry point, flight time, gravity scale, lateral drift,
// impact behaviour by category (rim bounce, traverse, graze, offset, centre) and preset.
// Output: points sampled every 16 ms ({t ms, x, y, rot °, sx, sy}), played by the scene.

import { CANVAS } from './target.js';

export const GRAVITY = 3800;
const STEP = 0.016;
const FLOOR_MARGIN = 18;
const MIN_TOTAL = 2.6;
const MIN_TOTAL_REDUCED = 1.6;
const SHRINK_GROW = 0.12;
const SHRINK_EXIT = 0.42;
/** Longest life after the impact (s): past it the projectile shrinks out wherever it is. */
const MAX_AFTER_IMPACT = 3.4;
const OFFSCREEN = 260;

const between = (random, min, max) => min + random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * @param {object} p
 * @param {() => number} p.random seeded stream (continues the shot's draws)
 * @param {{x:number,y:number,nx:number,ny:number,category:string}} p.impact
 * @param {{x:number,y:number}} p.start
 * @param {number} p.flight time to the impact (s)
 * @param {number} p.gravity × GRAVITY during the approach
 * @param {number} [p.drift] lateral acceleration during the approach (px/s²)
 * @param {number} p.size projectile size (px)
 * @param {{before:number, after:number}} p.spin rotation speeds (°/s)
 * @param {number} p.squash impact squash strength (× 0.16)
 * @param {object} p.preset common preset (restitution, floorBounces, friction, holdScale)
 * @param {'fall'|'shrink'} p.exit
 * @param {boolean} [p.reduced] dense scene: shorter ground hold, shrink exit
 */
export function buildTrajectory(p) {
  const { random, impact, start, size, preset } = p;
  const { width: W, height: H } = CANVAS;
  const radius = clamp(size * 0.46, 34, 320);
  const floorY = H - FLOOR_MARGIN - radius;
  const T = p.flight;
  const g = GRAVITY * p.gravity;
  const ax = p.drift ?? 0;
  const vx0 = (impact.x - start.x - 0.5 * ax * T * T) / T;
  const vy0 = (impact.y - start.y - 0.5 * g * T * T) / T;
  const points = [];
  let rot = 0;
  const push = (t, x, y, phase, scale = 1) =>
    points.push({ t: t * 1000, x, y, rot, phase, scale });

  for (let t = 0; t < T - 1e-6; t += STEP) {
    rot = p.spin.before * t;
    push(
      t,
      start.x + vx0 * t + 0.5 * ax * t * t,
      start.y + vy0 * t + 0.5 * g * t * t,
      'approach',
    );
  }
  rot = p.spin.before * T;
  push(T, impact.x, impact.y, 'impact');

  // --- impact: the velocity after the hit depends on where it hit -------------------------------
  let vx = vx0 + ax * T;
  let vy = vy0 + g * T;
  const restitution = preset.restitution;
  // Fullscreen (lot 2): « glass » knocks back like a centre hit, « pass » flies through like a
  // traverse; no edge reflection without a camera frame.
  if (impact.category === 'center' || impact.category === 'glass') {
    vx *= between(random, 0.7, 1);
    vy =
      -between(random, 0.42, 0.82) *
      Math.max(Math.abs(vy), 600) *
      Math.min(1.3, restitution);
  } else if (impact.category === 'traverse' || impact.category === 'pass') {
    const k = between(random, 0.55, 0.75);
    vx *= k;
    vy *= k;
  } else if (impact.category === 'offset') {
    const k = between(random, 0.75, 0.9);
    vx *= k;
    vy *= k;
  } else {
    // rim / graze: reflection on the edge (outward normal), graze only deflects slightly.
    const e =
      impact.category === 'graze'
        ? between(random, 0.15, 0.3)
        : Math.min(0.95, between(random, 0.45, 0.7) * restitution);
    const dot = vx * impact.nx + vy * impact.ny;
    if (dot < 0) {
      vx -= (1 + e) * dot * impact.nx;
      vy -= (1 + e) * dot * impact.ny;
      vx *= 0.85;
    } else {
      vx *= 0.8;
      vy *= 0.8;
    }
  }
  const spinAfter = p.spin.after;

  // --- after the impact: free flight, walls, floor, ground hold, exit --------------------------
  const G = GRAVITY * Math.max(1, p.gravity);
  let x = impact.x;
  let y = impact.y;
  let t = T;
  let bounces = preset.floorBounces;
  let groundedUntil = null;
  const minTotal = p.reduced ? MIN_TOTAL_REDUCED : MIN_TOTAL;
  const exit = p.reduced ? 'shrink' : p.exit;
  const outside = () =>
    x < -OFFSCREEN || x > W + OFFSCREEN || y > H + OFFSCREEN;

  while (groundedUntil === null && t < T + MAX_AFTER_IMPACT && !outside()) {
    t += STEP;
    const previousY = y;
    vy += G * STEP;
    x += vx * STEP;
    y += vy * STEP;
    rot += spinAfter * STEP;
    if (x <= radius && vx < 0) {
      x = radius;
      vx = Math.abs(vx) * between(random, 0.58, 0.76);
    } else if (x >= W - radius && vx > 0) {
      x = W - radius;
      vx = -Math.abs(vx) * between(random, 0.58, 0.76);
    }
    if (y >= floorY && previousY < floorY && vy > 0) {
      y = floorY;
      if (bounces > 0 && vy > 500) {
        bounces -= 1;
        vy = -vy * between(random, 0.3, 0.42);
      } else {
        vy = 0;
        const hold =
          between(random, 0.72, 0.98) *
          preset.holdScale *
          (p.reduced ? 0.5 : 1);
        groundedUntil = t + Math.max(hold, minTotal - t - 0.32, 0.3);
        vx *= between(random, 0.66, 0.82);
      }
    }
    push(t, x, y, groundedUntil === null ? 'air' : 'ground');
  }

  if (groundedUntil !== null) {
    const friction = 1.6 * preset.friction;
    while (t < groundedUntil) {
      t += STEP;
      const dx = vx * STEP;
      x += dx;
      if (x <= radius || x >= W - radius) {
        x = clamp(x, radius, W - radius);
        vx = -vx * 0.5;
      }
      vx *= Math.exp(-friction * STEP);
      rot += (dx / radius) * (180 / Math.PI);
      push(t, x, y, 'ground');
    }
  }

  // --- exit ----------------------------------------------------------------------------------
  const direction = Math.sign(vx || spinAfter || 1);
  const exitVx = direction * Math.max(520, Math.abs(vx));
  const exitStart = t;
  if (exit === 'shrink' || groundedUntil === null) {
    // Shrinks out where it is (also the bound for a projectile never back on the ground).
    const end = exitStart + SHRINK_GROW + SHRINK_EXIT;
    while (t < end && !outside()) {
      t += STEP;
      const dx = groundedUntil === null ? vx * STEP : exitVx * STEP;
      x += dx;
      if (groundedUntil === null) {
        vy += G * STEP;
        y += vy * STEP;
      }
      rot +=
        groundedUntil === null
          ? spinAfter * STEP
          : (dx / radius) * (180 / Math.PI);
      const e = t - exitStart;
      const scale =
        e < SHRINK_GROW
          ? 1 + 0.08 * (e / SHRINK_GROW)
          : Math.max(
              0,
              1.08 - 1.08 * clamp((e - SHRINK_GROW) / SHRINK_EXIT, 0, 1),
            );
      push(t, x, y, 'exit', scale);
    }
  } else {
    // The ground disappears: falls off the bottom with normal gravity.
    let fallVy = 0;
    while (!outside() && t < exitStart + 1.5) {
      t += STEP;
      fallVy += G * STEP;
      const dx = exitVx * STEP;
      x += dx;
      y += fallVy * STEP;
      rot += (dx / radius) * (180 / Math.PI);
      push(t, x, y, 'exit');
    }
  }

  // Squash around the impact (legacy shape: ±45 ms, 0.16 × strength).
  const strength = 0.16 * p.squash;
  for (const point of points) {
    const d = Math.abs(point.t / 1000 - T);
    const k = d < 0.045 ? (1 - d / 0.045) * strength : 0;
    point.sx = (1 + k) * point.scale;
    point.sy = (1 - k) * point.scale;
  }

  return {
    points,
    impactMs: T * 1000,
    durationMs: points.at(-1).t,
    exit: exit === 'shrink' || groundedUntil === null ? 'shrink' : 'fall',
  };
}

/** State at `tMs` (linear interpolation between the two surrounding points). */
export function sampleAt(trajectory, tMs) {
  const pts = trajectory.points;
  if (tMs <= pts[0].t) return pts[0];
  if (tMs >= pts.at(-1).t) return pts.at(-1);
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= tMs) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const k = (tMs - a.t) / (b.t - a.t || 1);
  const mix = (u, v) => u + (v - u) * k;
  return {
    t: tMs,
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    rot: mix(a.rot, b.rot),
    sx: mix(a.sx, b.sx),
    sy: mix(a.sy, b.sy),
  };
}
