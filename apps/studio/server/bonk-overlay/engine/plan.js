// Bonk VNext lot 1 — everything a projectile will do, decided before it is shown. Every draw comes
// from one stream seeded by the interaction id (legacy seeded RNG): same id + same scene context →
// same projectile. The context (recent impacts, previous family / entry, dense scene) is explicit.

import { createSeededRandom, seedFromReference } from '../bonk-v3-core.js';
import { ENTRIES, entryPoint, pickEntry, pickFamily } from './families.js';
import { buildTrajectory } from './physics.js';
import { pickPreset } from './presets.js';
import { sampleSize } from './size.js';
import { DEFAULT_TARGET, pickImpact } from './target.js';

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

/**
 * @param {string} id interaction id (the seed)
 * @param {{rect?:object, recent?:{x:number,y:number}[], history?:string[], lastEntry?:string|null,
 *   reduced?:boolean, sizeMean?:number}} [context]
 */
export function planShot(id, context = {}) {
  const random = createSeededRandom(seedFromReference(id));
  const size = sampleSize(random, { mean: context.sizeMean });
  const family = pickFamily(random, context.history);
  const entry = pickEntry(random, family, context.lastEntry ?? null);
  const preset = pickPreset(random);
  const spin = pickSpin(random, family, preset);
  const exit = random() < 0.5 ? 'fall' : 'shrink';
  const impact = pickImpact(random, {
    rect: context.rect ?? DEFAULT_TARGET,
    facing: ENTRIES[entry].facing,
    size,
    recent: context.recent ?? [],
  });
  const start = entryPoint(random, entry, impact);
  const drift = family.drift
    ? (random() < 0.5 ? -1 : 1) * between(random, family.drift)
    : 0;
  const trajectory = buildTrajectory({
    random,
    impact,
    start,
    flight: between(random, family.flight),
    gravity: between(random, family.gravity),
    drift,
    size,
    spin,
    squash: (family.squash ?? 1) * preset.squash,
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
    trajectory,
  };
}
