// Bonk VNext lot 1 — trajectory families (audit §7): weighted, parameterised entries of the physics
// simulator. Anti-repetition: never the same family three times in a row, never the same entry twice
// in a row.

import { CANVAS, pickWeighted } from './target.js';

export const OFFSCREEN = 220;

/** Entry points (where the projectile comes from), relative to the impact point; `facing`: target
 * edges seen from there. */
export const ENTRIES = Object.freeze({
  'top-l': { facing: ['top'] },
  'top-c': { facing: ['top'] },
  'top-r': { facing: ['top'] },
  topleft: { facing: ['top', 'left'] },
  topright: { facing: ['top', 'right'] },
  left: { facing: ['left'] },
  right: { facing: ['right'] },
  'left-low': { facing: ['left'] },
  'right-low': { facing: ['right'] },
  'bottom-l': { facing: ['bottom'] },
  'bottom-c': { facing: ['bottom'] },
  'bottom-r': { facing: ['bottom'] },
  bottomleft: { facing: ['bottom', 'left'] },
  bottomright: { facing: ['bottom', 'right'] },
});

const TOP = ['top-l', 'top-c', 'top-r'];
const BOTTOM = ['bottom-l', 'bottom-c', 'bottom-r'];

/**
 * flight: time to the impact (s); gravity: × of the base gravity during the approach; drift: lateral
 * acceleration (px/s², random sign); spinScale: × rotation speed; squash: impact squash ×.
 */
export const FAMILIES = Object.freeze([
  {
    id: 'chute',
    weight: 20,
    entries: TOP,
    flight: [0.5, 0.8],
    gravity: [0.9, 1.1],
  },
  {
    id: 'diagonale',
    weight: 18,
    entries: ['topleft', 'topright'],
    flight: [0.38, 0.58],
    gravity: [0.9, 1.1],
  },
  {
    id: 'arc',
    weight: 18,
    entries: ['left-low', 'right-low'],
    flight: [0.75, 1],
    gravity: [1, 1.2],
  },
  {
    id: 'tendu',
    weight: 12,
    entries: ['left', 'right'],
    flight: [0.28, 0.42],
    gravity: [0.35, 0.45],
  },
  {
    id: 'remontee',
    weight: 10,
    entries: [...BOTTOM, 'bottomleft', 'bottomright'],
    flight: [0.6, 0.85],
    gravity: [0.9, 1.1],
  },
  {
    id: 'lourd',
    weight: 9,
    entries: [...TOP, 'topleft', 'topright'],
    flight: [0.75, 1],
    gravity: [1.25, 1.35],
    spinScale: 0.4,
    squash: 1.6,
  },
  {
    id: 'courbe',
    weight: 9,
    entries: ['left', 'right', 'topleft', 'topright'],
    flight: [0.6, 0.85],
    gravity: [0.8, 1],
    drift: [900, 1500],
  },
  {
    id: 'abstrait',
    weight: 4,
    entries: Object.keys(ENTRIES),
    flight: [0.45, 0.75],
    gravity: [0.6, 1.2],
    spinScale: 1.6,
    reverseAtImpact: true,
  },
]);

const between = (random, [min, max]) => min + random() * (max - min);

/** `history`: previous family ids, most recent last. */
export function pickFamily(random, history = []) {
  const repeated =
    history.length >= 2 && history.at(-1) === history.at(-2)
      ? history.at(-1)
      : null;
  const pool = FAMILIES.filter((f) => f.id !== repeated);
  return pickWeighted(
    random,
    pool.map((f) => [f, f.weight]),
  );
}

/** `lastEntry`: entry of the previous projectile (avoided when the family offers another one). */
export function pickEntry(random, family, lastEntry = null) {
  const options =
    family.entries.length > 1
      ? family.entries.filter((e) => e !== lastEntry)
      : family.entries;
  return options[Math.floor(random() * options.length)];
}

/** Start point of the entry for an impact at (x, y). */
export function entryPoint(random, entry, impact) {
  const { width: W, height: H } = CANVAS;
  const r = (range) => between(random, range);
  switch (entry) {
    case 'top-l':
      return { x: impact.x - r([150, 380]), y: -OFFSCREEN };
    case 'top-c':
      return { x: impact.x + r([-150, 150]), y: -OFFSCREEN };
    case 'top-r':
      return { x: impact.x + r([150, 380]), y: -OFFSCREEN };
    case 'topleft':
      return { x: -OFFSCREEN, y: r([-OFFSCREEN, 0.3 * H]) };
    case 'topright':
      return { x: W + OFFSCREEN, y: r([-OFFSCREEN, 0.3 * H]) };
    case 'left':
      return { x: -OFFSCREEN, y: impact.y - r([120, 440]) };
    case 'right':
      return { x: W + OFFSCREEN, y: impact.y - r([120, 440]) };
    case 'left-low':
      return { x: -OFFSCREEN, y: impact.y + r([-80, 240]) };
    case 'right-low':
      return { x: W + OFFSCREEN, y: impact.y + r([-80, 240]) };
    case 'bottom-l':
      return { x: impact.x - r([150, 300]), y: H + OFFSCREEN };
    case 'bottom-c':
      return { x: impact.x + r([-150, 150]), y: H + OFFSCREEN };
    case 'bottom-r':
      return { x: impact.x + r([150, 300]), y: H + OFFSCREEN };
    case 'bottomleft':
      return { x: -OFFSCREEN, y: r([0.75 * H, H + OFFSCREEN]) };
    default:
      return { x: W + OFFSCREEN, y: r([0.75 * H, H + OFFSCREEN]) };
  }
}
