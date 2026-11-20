// Ported unchanged from the validated casino prototype (prototypes/casino-v8 · audio.js); docs/CASINO.md.
// Display only: every result comes from the Core.
// Bruitages discrets, synthétisés (aucun fichier, aucun droit) — ou tes fichiers si assets/manifest.js en déclare.
// Coupés par défaut. Sortie adoucie (passe-bas 5,5 kHz + compresseur), au plus 6 sons à la fois, aucun bruit de
// comptage : des clics mécaniques courts, des carillons sinusoïdaux doux ; un effet plus riche pour les gros gains.
import { SKIN } from './skin.js';

let ctx = null;
let out = null;
let enabled = false;
let volume = 0.5;
let noiseBuf = null;
let voices = 0;
let lastTick = 0;
const files = {};

function ensure() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    out = ctx.createGain();
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 5500;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    out.connect(soft).connect(comp).connect(ctx.destination);
    out.gain.value = volume * 0.6;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}
const ready = () => enabled && ensure();
/** Une voix de plus, sauf si 6 jouent déjà (on ne superpose pas un brouhaha). */
function voice(dur, important = false) {
  if (voices >= 6 && !important) return false;
  voices++;
  setTimeout(() => voices--, dur * 1000 + 30);
  return true;
}

function tone(freq, dur, { gain = 0.05, at = 0, type = 'sine', slide = null, attack = 0.008 } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function noise(dur, { freq = 1800, q = 2, gain = 0.06, at = 0, type = 'bandpass', sweep = null, attack = 0.002 } = {}) {
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.02);
}
const chime = (freqs, step, gain, dur = 0.32) => freqs.forEach((f, i) => tone(f, dur, { gain, at: i * step, attack: 0.012 }));

/** Ton fichier (assets/manifest.js › sounds) s'il existe : rien de synthétisé alors. */
function file(name) {
  const src = SKIN.sounds && SKIN.sounds[name];
  if (!src) return false;
  if (!enabled) return true;
  const a = (files[name] ||= new Audio(src)).cloneNode();
  a.volume = Math.min(1, volume * 0.9);
  a.play().catch(() => {});
  return true;
}

const SFX = {
  click: () => ready() && voice(0.03) && noise(0.025, { freq: 2600, q: 3, gain: 0.025 }),
  spinStart: () => ready() && voice(0.3) && noise(0.28, { freq: 260, sweep: 1100, q: 0.9, gain: 0.045, attack: 0.05 }),
  reelStop: (i = 0) => {
    if (file('reelStop') || !ready() || !voice(0.08)) return;
    noise(0.03, { freq: 1700 - i * 60, q: 4, gain: 0.07 });
    tone(118 - i * 4, 0.07, { gain: 0.06, slide: 72, attack: 0.003 });
  },
  scatter: (n = 1) => ready() && voice(0.4, true) && (tone(880 * (1 + (n - 1) * 0.125), 0.38, { gain: 0.05, attack: 0.01 }), tone(1770 * (1 + (n - 1) * 0.125), 0.25, { gain: 0.015 })),
  anticipation: () => ready() && voice(1) && noise(0.95, { type: 'lowpass', freq: 500, sweep: 1400, q: 0.7, gain: 0.025, attack: 0.4 }),
  win: (level = 1) => {
    if (level >= 3 ? file('bigWin') : file('win')) return;
    if (!ready() || !voice(level >= 3 ? 1.2 : 0.5, true)) return;
    if (level === 1) chime([784, 1047], 0.085, 0.05);
    else if (level === 2) chime([659, 784, 1047], 0.09, 0.055);
    else {
      chime([523, 659, 784, 1047, 1319], 0.08, 0.06, 0.4);
      [523, 784, 1047].forEach((f) => tone(f, 1.1, { gain: 0.03, at: 0.42, attack: 0.04 }));
      noise(0.7, { type: 'highpass', freq: 6000, gain: 0.012, at: 0.4, attack: 0.1 });
    }
  },
  wild: () => file('wild') || (ready() && voice(0.4, true) && (tone(1175, 0.22, { gain: 0.04 }), tone(1568, 0.3, { gain: 0.035, at: 0.07 }))),
  bonus: () => file('bonus') || (ready() && voice(1.4, true) && (chime([392, 523, 659, 784, 1047], 0.1, 0.05, 0.35), [523, 659, 784].forEach((f) => tone(f, 1, { gain: 0.03, at: 0.55, attack: 0.05 })))),
  wheelTick: () => {
    if (file('wheelTick') || !ready()) return;
    const now = ctx.currentTime;
    if (now - lastTick < 0.045) return; // au plus ~22 clics par seconde, jamais un bourdonnement
    lastTick = now;
    if (voice(0.02)) noise(0.012, { freq: 3000, q: 2.5, gain: 0.03 });
  },
  /** La bille : un losange (clac), une barrette (tic), un rebond, la pose. Au plus ~28 par seconde. */
  ballHit: (kind, v = 0.5) => {
    if (file('ballHit') || !ready()) return;
    const now = ctx.currentTime;
    if (now - lastTick < 0.035 || !voice(0.06)) return;
    lastTick = now;
    if (kind === 'diamond') {
      noise(0.03, { freq: 2100, q: 3, gain: 0.03 + 0.05 * v });
      tone(420, 0.05, { gain: 0.02 + 0.03 * v, slide: 260, attack: 0.002 });
    }
    else noise(0.018, { freq: kind === 'floor' ? 2400 : 3200, q: 2.5, gain: 0.012 + 0.04 * v });
  },
  /** Le jeton ALL-IN choisi : un souffle qui monte et un accord bref. */
  allIn: () => file('allIn') || (ready() && voice(0.9, true) && (noise(0.35, { freq: 300, sweep: 2400, q: 0.9, gain: 0.04, attack: 0.05 }), chime([392, 587, 784], 0.07, 0.05, 0.5), tone(196, 0.6, { gain: 0.035, at: 0.18, attack: 0.02 }))),
  /** Une combinaison gagnante présentée : un petit carillon qui monte d'un demi-ton à chaque étape. */
  lineStep: (i = 0) => file('lineStep') || (ready() && voice(0.25, true) && chime([659, 988].map((f) => f * 2 ** (Math.min(i, 9) / 12)), 0.05, 0.045, 0.22)),
  // --- Le Coffre (V8) ---
  /** Les cases vides du Coffre tournent : un souffle bref. */
  coffreSpin: () => file('coffreSpin') || (ready() && voice(0.3) && noise(0.26, { freq: 520, sweep: 1500, q: 0.8, gain: 0.03, attack: 0.03 })),
  /** Une pièce tombe dans le Coffre : un tintement, plus brillant pour les grosses pièces. */
  coffreCoin: (tier = 1) => file('coffreCoin') || (ready() && voice(0.25, true) && (tone(988 * 2 ** (tier / 6), 0.18, { gain: 0.045, attack: 0.004 }), tone(1976 * 2 ** (tier / 6), 0.12, { gain: 0.015, at: 0.02 }))),
  /** Les relances reviennent à 3. */
  coffreReset: () => file('coffreReset') || (ready() && voice(0.3, true) && chime([784, 988, 1175], 0.05, 0.04, 0.2)),
  /** Une relance perdue. */
  coffreDrop: () => file('coffreDrop') || (ready() && voice(0.2) && tone(330, 0.16, { gain: 0.035, slide: 220 })),
  /** Colonne complète ou doubleur : un accord qui monte. */
  coffreDouble: () => file('coffreDouble') || (ready() && voice(0.7, true) && (chime([523, 659, 784, 1047], 0.06, 0.05, 0.3), noise(0.4, { freq: 900, sweep: 3200, q: 1, gain: 0.025, attack: 0.05 }))),
  /** Un jackpot (MINI, MAJEUR, MÉGA, GRAND) : la fanfare, plus longue selon le rang. */
  coffreJackpot: (rank = 0) => file('coffreJackpot') || (ready() && voice(1 + rank * 0.3, true) && (chime([523, 659, 784, 1047, 1319, 1568].slice(0, 3 + rank), 0.08, 0.06, 0.4), [523, 784, 1047].forEach((f) => tone(f, 0.9 + rank * 0.3, { gain: 0.028, at: 0.3 + rank * 0.08, attack: 0.04 })))),
  wheelStart: () => ready() && voice(0.5) && noise(0.45, { freq: 240, sweep: 900, q: 0.8, gain: 0.04, attack: 0.08 }),
  wheelStop: (won) => {
    if (file('wheelStop') || !ready() || !voice(0.7, true)) return;
    tone(1047, 0.6, { gain: 0.045, attack: 0.01 });
    if (won) tone(1568, 0.5, { gain: 0.03, at: 0.08 });
  },
};

export const ArcadeAudio = {
  ...SFX,
  setEnabled(v) {
    enabled = !!v;
    if (enabled) ensure();
  },
  get enabled() {
    return enabled;
  },
  setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (out) out.gain.value = volume * 0.6;
  },
  get volume() {
    return volume;
  },
};
