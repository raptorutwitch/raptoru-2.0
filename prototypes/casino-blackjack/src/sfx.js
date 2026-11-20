// Blackjack (prototype) — les petits sons, synthétisés (aucun fichier) ; coupés par défaut comme au Casino.
let ctx = null;
let on = false;
let vol = 0.5;
const ac = () => (ctx ??= new (globalThis.AudioContext || globalThis.webkitAudioContext)());

function noise(ms, { f = 2400, q = 1.4, gain = 0.18, at = 0 } = {}) {
  const c = ac();
  const n = Math.floor((c.sampleRate * ms) / 1000);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain * vol;
  src.connect(bp).connect(g).connect(c.destination);
  src.start(c.currentTime + at);
}
function tone(freq, ms, { type = 'sine', gain = 0.12, at = 0, slide = 0 } = {}) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + ms / 1000);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain * vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + ms / 1000 + 0.02);
}
const play = (fn) => {
  if (!on) return;
  try {
    fn();
  } catch {
    /* pas d'audio */
  }
};

export const Sfx = {
  setEnabled: (v) => ((on = !!v), on && ac().resume?.()),
  enabled: () => on,
  setVolume: (v) => (vol = Math.max(0, Math.min(1, v))),
  card: (at = 0) => play(() => noise(70, { f: 3200, q: 0.9, gain: 0.22, at })),
  flip: () => play(() => (noise(55, { f: 2600, gain: 0.2 }), noise(40, { f: 4200, gain: 0.12, at: 0.06 }))),
  chip: () => play(() => (tone(2100, 60, { type: 'triangle', gain: 0.09 }), tone(2900, 50, { type: 'triangle', gain: 0.06, at: 0.035 }))),
  tick: () => play(() => tone(1250, 45, { type: 'square', gain: 0.035 })),
  shuffle: () => play(() => { for (let i = 0; i < 9; i++) noise(40, { f: 2800 + i * 90, gain: 0.12, at: i * 0.07 }); }),
  win: () => play(() => [660, 880, 1100].forEach((f, i) => tone(f, 160, { type: 'triangle', gain: 0.1, at: i * 0.08 }))),
  blackjack: () => play(() => [660, 880, 1100, 1320, 1760].forEach((f, i) => tone(f, 220, { type: 'triangle', gain: 0.11, at: i * 0.07 }))),
  push: () => play(() => tone(520, 160, { gain: 0.08 })),
  lose: () => play(() => tone(240, 260, { type: 'sine', gain: 0.1, slide: 0.7 })),
  turn: () => play(() => (tone(880, 90, { gain: 0.07 }), tone(1320, 120, { gain: 0.06, at: 0.08 }))),
};
