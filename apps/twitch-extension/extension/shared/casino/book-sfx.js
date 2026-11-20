// Casino V1 — the emote machine's own sounds (ported unchanged from prototypes/casino-emotes/src/sfx.js).
// Machine n°2 — les sons NOUVEAUX, tous synthétisés (aucun fichier, aucun droit), dans la même chaîne douce que la
// machine à fruits (vendor/audio.js : passe-bas 5,5 kHz + compresseur). Ils suivent son interrupteur Son et son
// volume (ArcadeAudio.enabled / .volume) : un seul réglage pour toute la machine.
import { ArcadeAudio } from './audio.js';

let ctx = null;
let out = null;
function ready() {
  if (!ArcadeAudio.enabled) return false;
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
    comp.ratio.value = 4;
    out.connect(soft).connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  out.gain.value = ArcadeAudio.volume * 0.6;
  return true;
}
function tone(freq, dur, { gain = 0.05, at = 0, type = 'sine', slide = null, attack = 0.006 } = {}) {
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
  o.stop(t + dur + 0.03);
}
function hiss(dur, { freq = 1200, q = 1, gain = 0.03, at = 0, sweep = null } = {}) {
  const t = ctx.currentTime + at;
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource();
  s.buffer = b;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
}
/** Une cloche : partiels inharmoniques (1 · 2,76 · 5,40) qui s'éteignent vite, le fondamental plus longtemps. */
function bell(f, at = 0, gain = 0.05, dur = 1.3) {
  tone(f, dur, { gain, at, attack: 0.004 });
  tone(f * 2.76, dur * 0.45, { gain: gain * 0.35, at, attack: 0.003 });
  tone(f * 5.4, dur * 0.22, { gain: gain * 0.18, at, attack: 0.002 });
}

// Gamme de do majeur pentatonique : les BONUS montent dessus, toujours consonants entre eux.
const NOTES = [196.0, 261.63, 329.63, 392.0, 523.25, 659.25]; // sol2 · do3 · mi3 · sol3 · do4 · mi4

const SFX = {
  /**
   * Le k-ième BONUS révélé dans ce tour (1, 2, 3…), au moment exact où son rouleau s'arrête : « tom… tom… TOM ! ».
   * Un tom accordé (sinus dont la hauteur retombe un peu) + un petit claquement ; le 3e est plus fort et sonne.
   */
  bonusNote(k) {
    if (!ready()) return;
    const f = NOTES[Math.min(k, NOTES.length - 1)];
    const strong = k >= 3;
    tone(f * 1.5, 0.05, { gain: 0.03, slide: f, attack: 0.002 });
    tone(f, strong ? 0.55 : 0.34, { gain: strong ? 0.11 : 0.08, slide: f * 0.94, attack: 0.004 });
    tone(f * 2, strong ? 0.4 : 0.2, { gain: strong ? 0.035 : 0.02, attack: 0.004 });
    hiss(0.05, { freq: 2600, q: 2, gain: 0.025 });
    if (strong) bell(f * 2, 0.04, 0.035, 0.9);
  },
  /** 3 BONUS ou plus : un carillon de réussite (do · mi · sol · do), clair et court. */
  bonusSuccess() {
    if (!ready()) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, 0.12 + i * 0.11, 0.045, 1.4));
    tone(261.63, 1.6, { gain: 0.03, at: 0.1, attack: 0.08 });
  },
  /** Le carrousel : un tic de bois à chaque symbole qui passe sous le repère (au plus ~25 par seconde). */
  carouselTick(speed = 1) {
    if (!ready()) return;
    hiss(0.02, { freq: 3200 - 900 * (1 - speed), q: 3, gain: 0.03 });
    tone(880, 0.03, { gain: 0.012, attack: 0.002 });
  },
  /** Le carrousel s'arrête sur le symbole : un accord qui s'ouvre. */
  carouselLand() {
    if (!ready()) return;
    [392, 493.88, 587.33, 783.99].forEach((f, i) => tone(f, 0.9, { gain: 0.035, at: i * 0.045, attack: 0.01 }));
    bell(1174.66, 0.18, 0.03, 1);
  },
  /** Les tours gratuits commencent. */
  freeStart() {
    if (!ready()) return;
    hiss(0.5, { freq: 300, sweep: 2600, q: 0.8, gain: 0.03 });
    [523.25, 783.99].forEach((f, i) => bell(f, 0.3 + i * 0.12, 0.04, 1.1));
  },
  /** Un rouleau se remplit du symbole extensible : un souffle qui monte, un demi-ton plus haut à chaque rouleau. */
  expandFill(i = 0) {
    if (!ready()) return;
    const f = 329.63 * 2 ** (i * 3 / 12);
    hiss(0.28, { freq: 500 + i * 150, sweep: 2400 + i * 300, q: 1.1, gain: 0.03 });
    tone(f, 0.42, { gain: 0.05, at: 0.12, attack: 0.02 });
    tone(f * 1.5, 0.3, { gain: 0.025, at: 0.16, attack: 0.02 });
  },
  /** Le gain de l'extension compté. */
  expandWin(level = 1) {
    if (!ready()) return;
    const base = level >= 3 ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [659.25, 783.99, 1046.5];
    base.forEach((f, i) => bell(f, i * 0.08, 0.04, 0.9));
  },
  /** +10 tours gratuits. */
  retrigger() {
    if (!ready()) return;
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, i * 0.09, 0.045, 1.2));
    hiss(0.6, { freq: 800, sweep: 3200, q: 1, gain: 0.025, at: 0.1 });
  },
  /** Fin du bonus : une cadence douce (plus riche si le bonus est gros). */
  bonusEnd(big = false) {
    if (!ready()) return;
    const seq = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98] : [659.25, 523.25, 783.99, 1046.5];
    seq.forEach((f, i) => bell(f, i * 0.1, 0.045, 1.4));
    tone(130.81, 1.8, { gain: 0.035, at: 0.1, attack: 0.1 });
  },
};

/** Chaque son demandé (même coupé) est noté si la page le demande (contrôles automatiques : globalThis.__sfxLog). */
export const Sfx = Object.fromEntries(
  Object.entries(SFX).map(([name, fn]) => [name, (...a) => (globalThis.__sfxLog?.push({ name, arg: a[0], t: performance.now() }), fn(...a))]),
);
