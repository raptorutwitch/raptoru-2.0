/* global AudioContext, fetch, Audio */
// Bonk VNext lot 1 — adaptive impact sound (audit §10). One governor decides, per impact, whether a
// sound plays and how loud: every impact when isolated, 1 in 2 / 3 / 5 as the impact rate grows
// (counter, not chance), at most 5 sounds/s and 90 ms apart; the volume sinks during a long burst
// (down to 45 %) and comes back after a calm.

export const AUDIO = Object.freeze({
  volume: 0.4,
  /** Time constant of the impact-rate estimate (s). */
  tau: 1.5,
  minGapMs: 90,
  perSecond: 5,
  calmMs: 1500,
  recoverMs: 2000,
  fatigueMs: 8000,
  floor: 0.45,
});

/** Existing extension sounds (assets/sounds/<name>.mp3). */
export const SOUND_POOL = Object.freeze([
  'punch-2',
  'punch-3',
  'punch-4',
  'punch-5',
  'punch-6',
  'roblox-oof',
]);

/** 1 sound every `k` impacts for an impact rate (impacts/s). */
export function everyNth(rate) {
  if (rate < 1.2) return 1;
  if (rate < 3) return 2;
  if (rate < 6) return 3;
  return 5;
}

export function createAudioGovernor(options = AUDIO) {
  let rate = 0;
  let last = null;
  let fatigue = 0;
  let counter = 0;
  let tier = 1;
  let lastPlay = -Infinity;
  let tokens = options.perSecond;
  let lastFile = null;
  return {
    /**
     * @param {number} t impact time (ms)
     * @param {() => number} random the projectile's seeded stream
     * @param {{heavy?: boolean}} [kind]
     * @returns {{play: boolean, gain: number, file: string, rate: number}}
     */
    onImpact(t, random, { heavy = false } = {}) {
      const gap = last === null ? Infinity : t - last;
      if (gap > options.calmMs)
        fatigue *= Math.max(0, 1 - (gap - options.calmMs) / options.recoverMs);
      else if (rate >= 1.2)
        fatigue = Math.min(1, fatigue + gap / options.fatigueMs);
      rate =
        (last === null ? 0 : rate * Math.exp(-gap / 1000 / options.tau)) +
        1 / options.tau;
      tokens = Math.min(
        options.perSecond,
        tokens + (last === null ? 0 : (gap / 1000) * options.perSecond),
      );
      last = t;

      const k = everyNth(rate);
      if (k !== tier) {
        tier = k;
        counter = 0;
      }
      let play = counter % k === 0;
      counter += 1;
      if (play && (t - lastPlay < options.minGapMs || tokens < 1)) play = false;
      const choices = SOUND_POOL.filter((f) => f !== lastFile);
      const file = choices[Math.floor(random() * choices.length)];
      const playbackRate = heavy ? 0.85 : 0.94 + random() * 0.12;
      if (play) {
        tokens -= 1;
        lastPlay = t;
        lastFile = file;
      }
      return {
        play,
        gain: options.volume * (1 - (1 - options.floor) * fatigue),
        file,
        rate: playbackRate,
      };
    },
  };
}

/** Plays the decided sounds: Web Audio (decoded once), HTML audio while it is not available. */
export function createAudioPlayer(base = '/ext/assets/sounds/') {
  let ctx = null;
  const buffers = new Map();
  try {
    ctx = new AudioContext();
    for (const name of SOUND_POOL)
      fetch(`${base}${name}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => buffers.set(name, buffer))
        .catch(() => {});
  } catch {
    ctx = null;
  }
  return {
    play({ file, gain, rate }) {
      const buffer = buffers.get(file);
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
      if (ctx && buffer && ctx.state === 'running') {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        const volume = ctx.createGain();
        volume.gain.value = gain;
        source.connect(volume).connect(ctx.destination);
        source.start();
        return;
      }
      const audio = new Audio(`${base}${file}.mp3`);
      audio.volume = gain;
      audio.preservesPitch = false;
      audio.playbackRate = rate;
      void audio.play().catch(() => {});
    },
  };
}
