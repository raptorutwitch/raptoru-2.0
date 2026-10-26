// Bonk VNext lot 1 — everything a projectile will do, decided before it is shown. Every draw comes
// from one stream seeded by the interaction id (legacy seeded RNG): same id + same scene context →
// same projectile. The context (recent impacts, previous family / entry, dense scene) is explicit.

import { createSeededRandom, seedFromReference } from '../bonk-v3-core.js';
import {
  ENTRIES,
  FAMILIES,
  entryPoint,
  pickEntry,
  pickFamily,
} from './families.js';
import { buildTrajectory } from './physics.js';
import { pickPreset } from './presets.js';
import { SIZE_MEAN, sampleSize } from './size.js';
import { DEFAULT_TARGET, pickFullscreenImpact, pickImpact } from './target.js';

const between = (random, [min, max]) => min + random() * (max - min);

/** Rotation profile: slow spin 50 %, fast spin 30 %, no spin then a twist at the impact 20 %. */
function pickSpin(random, family, preset) {
  const direction = random() < 0.5 ? -1 : 1;
  const scale = family.spinScale ?? 1;
  const profile = random();
  let before;
  let after;
  if (profile < 0.5) before = after = between(random, [35, 145]);
  else if (profile < 0.8) before = after = between(random, [250, 620]);
  else {
    before = 0;
    after = between(random, [450, 800]);
  }
  before *= direction * scale;
  after *= direction * scale * (family.reverseAtImpact ? -1 : 1);
  if (preset.spinAfter)
    after = Math.sign(after || direction) * between(random, preset.spinAfter);
  return {
    before,
    after,
    profile: profile < 0.5 ? 'slow' : profile < 0.8 ? 'fast' : 'twist',
  };
}

const HEAVY = FAMILIES.find((f) => f.id === 'lourd');

/**
 * « Punch » (26/10): about one shot in PUNCH.share arrives faster (its flight time × PUNCH.flight, i.e. 12–22 % faster).
 * Drawn from its own stream (`${id}:speed`): every other draw of the shot (size, family, entry, impact, sounds) stays
 * exactly as validated. Never the « tendu » family (already the fastest) nor a combo finisher (its mass slows it).
 */
export const PUNCH = { share: 1 / 6, flight: [0.82, 0.9] };

export function punchFactor(id, familyId, giant) {
  if (giant || familyId === 'tendu') return 1;
  const r = createSeededRandom(seedFromReference(`${id}:speed`));
  if (r() >= PUNCH.share) return 1;
  return between(r, PUNCH.flight);
}

/**
 * Lot 6 — mass of a combo finisher, from its size only: 0 at a normal size, +1 each time the size
 * doubles. The same simulator gets a slower entry, less spin (inertia), a softer bounce, a stronger
 * squash and a longer time on the ground — no separate physics.
 */
export function finisherMass(size) {
  const w = Math.max(0, Math.log2(size / SIZE_MEAN));
  return {
    weight: w,
    flight: 1 + 0.3 * w,
    spin: 1 / (1 + 0.8 * w),
    restitution: 1 / (1 + 0.35 * w),
    squash: 1 + 0.15 * w,
    hold: 1 + 0.4 * w,
  };
}

/**
 * @param {string} id interaction id (the seed)
 * @param {{mode?:'manual'|'fullscreen', rect?:object, recent?:{x:number,y:number}[], history?:string[], lastEntry?:string|null,
 *   reduced?:boolean, sizeMean?:number, finisherSize?:number}} [context] `finisherSize`: lot 6 combo
 *   finisher (fixed size, heavy family, mass profile); every other shot is drawn exactly as before.
 */
export function planShot(id, context = {}) {
  const random = createSeededRandom(seedFromReference(id));
  const drawn = sampleSize(random, { mean: context.sizeMean });
  const giant = Number.isFinite(context.finisherSize);
  const size = giant ? context.finisherSize : drawn;
  const mass = giant ? finisherMass(size) : null;
  const family = giant ? HEAVY : pickFamily(random, context.history);
  const entry = pickEntry(random, family, context.lastEntry ?? null);
  const drawnPreset = pickPreset(random);
  const preset = mass
    ? {
        ...drawnPreset,
        restitution: drawnPreset.restitution * mass.restitution,
        holdScale: drawnPreset.holdScale * mass.hold,
      }
    : drawnPreset;
  const drawnSpin = pickSpin(random, family, preset);
  const spin = mass
    ? {
        ...drawnSpin,
        before: drawnSpin.before * mass.spin,
        after: drawnSpin.after * mass.spin,
      }
    : drawnSpin;
  const drawnExit = random() < 0.5 ? 'fall' : 'shrink';
  // A giant falling off the bottom would still be on screen when its course ends: it shrinks out.
  const exit = giant && size > 400 ? 'shrink' : drawnExit;
  const impact =
    context.mode === 'fullscreen'
      ? pickFullscreenImpact(random, { size, recent: context.recent ?? [] })
      : pickImpact(random, {
          rect: context.rect ?? DEFAULT_TARGET,
          facing: ENTRIES[entry].facing,
          size,
          recent: context.recent ?? [],
        });
  const entered = entryPoint(random, entry, impact);
  // A giant starts fully off screen: its entry point is pushed back by its extra half-size.
  const back = giant ? Math.max(0, size / 2 - 120) : 0;
  const dx = entered.x - impact.x;
  const dy = entered.y - impact.y;
  const d = Math.hypot(dx, dy) || 1;
  const start = {
    x: entered.x + (dx / d) * back,
    y: entered.y + (dy / d) * back,
  };
  const drift = family.drift
    ? (random() < 0.5 ? -1 : 1) * between(random, family.drift)
    : 0;
  const punch = punchFactor(id, family.id, giant);
  const trajectory = buildTrajectory({
    random,
    impact,
    start,
    flight: between(random, family.flight) * (mass?.flight ?? 1) * punch,
    gravity: between(random, family.gravity),
    drift,
    size,
    spin,
    squash: (family.squash ?? 1) * preset.squash * (mass?.squash ?? 1),
    preset,
    exit,
    reduced: Boolean(context.reduced),
  });
  return {
    id,
    size,
    family: family.id,
    entry,
    preset: preset.id,
    spin: spin.profile,
    impact,
    heavy: family.id === 'lourd',
    finisher: giant,
    punch: punch < 1,
    trajectory,
  };
}
