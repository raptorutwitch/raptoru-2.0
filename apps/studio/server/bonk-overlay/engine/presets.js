// Bonk VNext lot 1 — impact presets, common tier only (rare FX: lot 4). A preset is data: the
// physics reads it. squash: × impact squash; restitution: × bounce energy; floorBounces: bounces on
// the floor before resting; friction: × ground friction; holdScale: × time on the ground;
// spinAfter: rotation speed after the impact (°/s range, random sign) or null (keeps its spin).

import { pickWeighted } from './target.js';

export const COMMON_PRESETS = Object.freeze([
  {
    id: 'impact',
    weight: 30,
    squash: 1,
    restitution: 1,
    floorBounces: 0,
    friction: 1,
    holdScale: 1,
    spinAfter: null,
  },
  {
    id: 'squash',
    weight: 18,
    squash: 1.6,
    restitution: 0.9,
    floorBounces: 0,
    friction: 1,
    holdScale: 1,
    spinAfter: null,
  },
  {
    id: 'rebond',
    weight: 20,
    squash: 1,
    restitution: 1.25,
    floorBounces: 1,
    friction: 1,
    holdScale: 0.9,
    spinAfter: null,
  },
  {
    id: 'glisse',
    weight: 12,
    squash: 0.8,
    restitution: 0.8,
    floorBounces: 0,
    friction: 0.45,
    holdScale: 1.15,
    spinAfter: null,
  },
  {
    id: 'chute',
    weight: 10,
    squash: 1.2,
    restitution: 0.35,
    floorBounces: 0,
    friction: 1.2,
    holdScale: 1,
    spinAfter: null,
  },
  {
    id: 'vrille',
    weight: 10,
    squash: 1,
    restitution: 1,
    floorBounces: 0,
    friction: 1,
    holdScale: 1,
    spinAfter: [420, 720],
  },
]);

export function pickPreset(random) {
  return pickWeighted(
    random,
    COMMON_PRESETS.map((p) => [p, p.weight]),
  );
}
