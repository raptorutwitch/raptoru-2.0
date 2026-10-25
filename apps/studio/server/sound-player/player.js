/* global document, location, fetch, crypto, Audio, AudioContext, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, localStorage */
import { readChoice, restoreAudio, writeChoice } from './audio-choice.js';

// Local Soundboard player (Lab). Each sound handed by Studio plays at once in its own audio
// element (Core decides what may overlap: stack / queue / ignore_if_running) and reports
// started / completed / failed. Nothing is ever replayed: a sound handed to this page is either
// proven (ACK) or left to Studio/Core as execution_unknown.
//
// Volume protection: a light, progressive attenuation of the Soundboard mix only (these audio
// elements), never the system, OBS or anything else.
const player = crypto.randomUUID();
const token = location.hash.slice(1);
const status = document.getElementById('status');
const enable = document.getElementById('enable');
const disable = document.getElementById('disable');
const seen = new Set();
const active = new Set(); // { audio, base } currently playing
const stoppers = new Map(); // interaction_id → stop() of a sound handed to this page
let audioEnabled = false;
/** Cut on purpose by the streamer (« Couper le son »): reported to Studio, kept across a reload. */
let audioOff = false;
let protection = 'light';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1 sound → 100 %, then ~5 % (light) / ~10 % (medium) less per extra sound, with a floor.
const CURVES = { off: [1, 1], light: [0.95, 0.68], medium: [0.9, 0.55] };
function mixGain(level, playing) {
  const [step, floor] = CURVES[level] ?? CURVES.light;
  return Math.max(floor, step ** Math.max(0, playing - 1));
}
let ramp = null;
function applyMix() {
  const gain = mixGain(protection, active.size);
  clearInterval(ramp);
  // Short ramp (≈150 ms) so a new sound never makes the others jump in volume.
  let steps = 5;
  ramp = setInterval(() => {
    steps -= 1;
    for (const a of active) {
      const target = a.base * gain;
      const next =
        steps <= 0
          ? target
          : a.audio.volume + (target - a.audio.volume) / (steps + 1);
      a.audio.volume = Math.min(1, Math.max(0, next));
    }
    if (steps <= 0) clearInterval(ramp);
  }, 30);
  document.body.dataset.playing = String(active.size);
  document.body.dataset.gain = gain.toFixed(3);
}

async function call(path, data) {
  const response = await fetch('/sound-lab/player/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sound-token': token },
    body: JSON.stringify({ player, ...data }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('player_request_failed');
  return response.json();
}
async function heartbeat() {
  const reply = await call('heartbeat', { audio: audioEnabled, off: audioOff });
  const level = reply?.settings?.volume_protection;
  if (CURVES[level] && level !== protection) {
    protection = level;
    applyMix();
  }
}
async function ack(i, event, error) {
  // Retry only the acknowledgement, never the sound. Bounded by the Core lease.
  for (let n = 0; n < 20; n++) {
    try {
      await call('ack', {
        interaction_id: i.interaction_id,
        attempt_id: i.delivery.attempt_id,
        event,
        ...(error ? { error } : {}),
      });
      return;
    } catch {
      await sleep(500);
    }
  }
}
const LEVEL_LABEL = {
  off: 'sans protection',
  light: 'protection légère',
  medium: 'protection moyenne',
};
function idle() {
  status.textContent = active.size
    ? `Lecture : ${active.size} son${active.size > 1 ? 's' : ''} · ${LEVEL_LABEL[protection]}`
    : 'Prêt · les sons du Soundboard Lab sont joués ici.';
}

/** True when this page may play audio now (a browser may keep resume() pending without a gesture: bounded). */
async function unlockAudio() {
  const context = new AudioContext();
  try {
    await Promise.race([context.resume(), sleep(1000)]);
    return context.state === 'running';
  } finally {
    await context.close().catch(() => {});
  }
}
function showAudio(text) {
  enable.hidden = audioEnabled;
  disable.hidden = !audioEnabled;
  if (audioEnabled) idle();
  else status.textContent = text;
}

// Browsers only allow audio after a user gesture on the page: this click unlocks it (and is remembered).
enable.addEventListener('click', async () => {
  try {
    audioEnabled = await unlockAudio();
  } catch {
    audioEnabled = false;
  }
  if (audioEnabled) {
    audioOff = false;
    writeChoice(localStorage, 'on');
  }
  showAudio('Lecture audio refusée par le navigateur.');
  void heartbeat().catch(() => {});
});
// A deliberate cut: no new sound is handed to this page, and a reload does not turn it back on.
disable.addEventListener('click', () => {
  audioEnabled = false;
  audioOff = true;
  writeChoice(localStorage, 'off');
  showAudio(
    'Son coupé volontairement : clique sur « Activer le son » pour le rétablir.',
  );
  void heartbeat().catch(() => {});
});

// Reload (Ctrl+R in Studio) or restart: back to the streamer's last choice.
const restored = await restoreAudio(readChoice(localStorage), unlockAudio);
audioEnabled = restored === 'enabled';
audioOff = restored === 'off';
showAudio(
  restored === 'off'
    ? 'Son coupé volontairement : clique sur « Activer le son » pour le rétablir.'
    : restored === 'needs_click'
      ? 'Son activé avant le rechargement, mais le navigateur exige un clic : clique sur « Activer le son ».'
      : 'Son désactivé : clique pour autoriser la lecture.',
);

/**
 * End guard (ASTRA-P2-028): a sound that started but never reports its end is released after its
 * duration plus Core's margin (SOUND_LAB_RULES.executingMarginMs) — without any ACK: it may have been
 * heard, so Core's lease turns it into execution_unknown (never replayed, no certain refund).
 */
const END_MARGIN_MS = 15_000;

// Only the file path shape resolved by Core (a local extension asset).
const LOCAL_SOUND = /^assets\/sounds\/[a-z0-9][a-z0-9._-]*\.mp3$/;

async function play(i) {
  if (seen.has(i.interaction_id)) return;
  seen.add(i.interaction_id);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  if (
    !LOCAL_SOUND.test(i.sound_url) ||
    i.test_mode !== true ||
    i.payment_mode !== 'simulated'
  ) {
    await ack(i, 'failed', {
      code: 'invalid_sound',
      message: 'unexpected sound url',
    });
    return;
  }
  const audio = new Audio('/ext/' + i.sound_url);
  const entry = {
    audio,
    base: Math.min(1, Math.max(0, Number(i.volume ?? 100) / 100)),
  };
  audio.volume = entry.base * mixGain(protection, active.size + 1);
  let started = false;
  let startedAck = null;
  let endGuard = null;
  const outcome = new Promise((resolve) => {
    audio.addEventListener('playing', () => {
      if (started) return;
      started = true;
      active.add(entry);
      applyMix();
      idle();
      startedAck = ack(i, 'started');
      endGuard = setTimeout(
        () => resolve({ event: 'unknown' }),
        Math.max(0, Number(i.duration_ms) || 0) + END_MARGIN_MS,
      );
    });
    audio.addEventListener('ended', () => resolve({ event: 'completed' }));
    audio.addEventListener('error', () =>
      resolve({
        event: 'failed',
        // 404 or undecodable file before any sound; a decode error after the start is a playback error.
        error: started
          ? { code: 'playback_error', message: 'audio error while playing' }
          : {
              code: 'file_missing',
              message: 'audio file missing or unreadable',
            },
      }),
    );
    // Moderation stop (Core already cancelled it): silence now, prove it with a `stopped` ACK.
    stoppers.set(i.interaction_id, () => resolve({ event: 'stopped' }));
    // Never started (blocked, stalled): nothing was heard, so this is a clean failure.
    setTimeout(() => {
      if (!started)
        resolve({
          event: 'failed',
          error: { code: 'start_timeout', message: 'playback did not start' },
        });
    }, 5000);
  });
  audio.play().catch((e) => {
    if (e && e.name === 'NotAllowedError') {
      // Blocked by the browser, not a choice: the remembered 'on' stays, the button asks for a click.
      audioEnabled = false;
      showAudio(
        'Son bloqué par le navigateur : clique sur « Activer le son ».',
      );
    }
  });
  const result = await outcome;
  clearTimeout(endGuard);
  stoppers.delete(i.interaction_id);
  // Release the element: no audio player kept alive after a spam burst.
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  active.delete(entry);
  applyMix();
  idle();
  if (result.event === 'unknown') {
    // Started, no end ever reported: the element is released, the outcome stays Core's (lease).
    status.textContent = `Fin non signalée : ${i.sound_label} (résultat inconnu)`;
  } else if (result.event === 'stopped') {
    if (startedAck) await startedAck;
    await ack(i, 'stopped');
    status.textContent = `Arrêté par la modération : ${i.sound_label}`;
  } else if (result.event === 'completed') {
    // `ended` implies the sound started; keep the started → completed order for Core.
    await (startedAck ?? ack(i, 'started'));
    await ack(i, 'completed');
  } else {
    if (startedAck) await startedAck;
    await ack(i, 'failed', result.error);
    status.textContent = `Échec : ${i.sound_label} (${result.error.code})`;
  }
}

setInterval(() => void heartbeat().catch(() => {}), 1500);
await heartbeat().catch(() => {});
while (true) {
  try {
    const { interaction, stop } = await call('next', {});
    for (const s of stop ?? []) {
      const halt = stoppers.get(s.interaction_id);
      // Already over on this page: still prove that nothing of it is playing any more.
      if (halt) halt();
      else
        void ack(
          {
            interaction_id: s.interaction_id,
            delivery: { attempt_id: s.attempt_id },
          },
          'stopped',
        );
    }
    // Not awaited: sounds overlap when Core allows it; the next one is fetched right away.
    if (interaction) void play(interaction);
  } catch {
    /* Studio unavailable: never invent a result. */
  }
  await sleep(120);
}
