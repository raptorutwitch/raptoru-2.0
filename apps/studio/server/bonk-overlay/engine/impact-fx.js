// Bonk VNext lot 6 — impact FX: the historical Bonk FX, taken from the legacy overlay
// (Alerte_system.html, `spawnBonkImpact` + `.bonk-wave/.bonk-streak/.bonk-particle` and their
// keyframes, identical in every version saved June → August 2026). Same streak geometry, colours,
// gradients, durations, easings and settings (spread 0.68, epais 1.9, lent 1.6); the CSS is in
// overlay.css. Two variants: « exact » (with the wave, 30 %) and « no wave » (70 %). Only change
// (Antoni, lot 6): the 3 smallest particles are left out (11 → 8) so that salves stay readable.
// Centred on the projectile's centre at the impact and scaled by its size, like the legacy overlay.

/** Streaks: [angle °, length, thickness, start radius] for a ~130 px object (legacy BONK_STREAKS). */
export const STREAKS = Object.freeze([
  [2.2, 92, 6.4, 29],
  [34.3, 100, 4.1, 24],
  [68.0, 88, 6.7, 19],
  [89.4, 69, 5.6, 25],
  [111.2, 68, 4.8, 29],
  [154.8, 65, 6.4, 20],
  [182.1, 64, 4.0, 28],
  [204.8, 68, 6.9, 28],
  [236.2, 102, 5.6, 26],
  [264.7, 101, 6.1, 30],
  [307.1, 72, 5.1, 20],
  [323.6, 61, 4.9, 25],
]);
/**
 * Particles: [angle °, distance, size] (legacy BONK_PARTS minus its 3 smallest: [67.3, 161, 7.0],
 * [115.8, 187, 7.2], [186.2, 139, 6.6]).
 */
export const PARTICLES = Object.freeze([
  [9.6, 139, 7.7],
  [43.0, 124, 9.3],
  [102.4, 153, 12.0],
  [173.7, 153, 11.8],
  [238.0, 155, 7.4],
  [252.0, 121, 7.4],
  [296.5, 148, 10.9],
  [313.7, 178, 12.9],
]);

export const IMPACT_FX = Object.freeze({
  spread: 0.68,
  epais: 1.9,
  lent: 1.6,
  /** Share of impacts drawn with the wave (« Legacy exact »); the others: « Legacy sans cercle ». */
  waveShare: 0.3,
});

/** Same removal delay as the legacy overlay: 420 × lent + 140 ms. */
export const IMPACT_FX_MS = Math.round(420 * IMPACT_FX.lent) + 140;

/** `random`: the shot's seeded stream for its FX. */
export const pickImpactFx = (random) =>
  random() < IMPACT_FX.waveShare ? 'exact' : 'nowave';

/**
 * Draws one impact FX into `stage` and removes it after IMPACT_FX_MS (`timer`).
 * @param {object} o
 * @param {{x:number,y:number}} o.at projectile centre at the impact
 * @param {number} o.size projectile size (px)
 * @param {'exact'|'nowave'} o.variant
 * @returns the FX container
 */
export function spawnImpactFx({ document, stage, timer, at, size, variant }) {
  const { spread, epais, lent } = IMPACT_FX;
  const k = (size || 150) / 130;
  const fx = document.createElement('div');
  fx.className = 'bonk-fx';
  fx.style.setProperty('--bonk-x', `${at.x.toFixed(1)}px`);
  fx.style.setProperty('--bonk-y', `${at.y.toFixed(1)}px`);

  if (variant === 'exact') {
    const wave = document.createElement('div');
    wave.className = 'bonk-wave';
    wave.style.setProperty('--w0', Math.round(40 * k) + 'px');
    wave.style.setProperty('--w1', Math.round(300 * spread * k) + 'px');
    wave.style.setProperty('--bw0', Math.max(5, Math.round(13 * k)) + 'px');
    wave.style.animation = `bonkWave ${Math.round(380 * lent)}ms cubic-bezier(.12,.7,.25,1) forwards`;
    fx.append(wave);
  }
  for (const [a, len, th, inner] of STREAKS) {
    const s = document.createElement('div');
    s.className = 'bonk-streak';
    const L = len * spread * k;
    const TH = Math.max(3, th * 0.5 * epais * k);
    s.style.width = L.toFixed(0) + 'px';
    s.style.height = TH.toFixed(1) + 'px';
    s.style.marginTop = (-TH / 2).toFixed(1) + 'px';
    s.style.setProperty('--a', a + 'deg');
    s.style.setProperty('--inner', (inner * k).toFixed(0) + 'px');
    s.style.setProperty('--travel', (L * 1.1).toFixed(0) + 'px');
    s.style.animation = `bonkStreak ${Math.round(360 * lent)}ms cubic-bezier(.1,.75,.22,1) forwards`;
    fx.append(s);
  }
  for (const [a, d, sz] of PARTICLES) {
    const p = document.createElement('div');
    p.className = 'bonk-particle';
    const SZ = Math.max(4, sz * 0.95 * k);
    p.style.width = p.style.height = SZ.toFixed(1) + 'px';
    p.style.setProperty('--a', a + 'deg');
    p.style.setProperty('--d', (d * spread * k).toFixed(0) + 'px');
    p.style.animation = `bonkParticle ${Math.round(400 * lent)}ms cubic-bezier(.1,.7,.3,1) forwards`;
    fx.append(p);
  }
  stage.append(fx);
  timer(() => fx.remove(), IMPACT_FX_MS);
  return fx;
}
