/* global document, location, fetch, crypto, Audio, AudioContext, setTimeout, clearTimeout, setInterval, AbortSignal, requestAnimationFrame, cancelAnimationFrame, performance, Event */

// Raptoru effects player (docs/EFFECTS_PLAYER.md) — ONE OBS browser source (1920×1080). Every effect handed by Studio
// plays at once (effects overlap; Studio caps how many) and reports started → completed / failed / unknown. Nothing is
// ever replayed: an effect handed to this page is played once or reported failed; one whose end never comes is released
// and reported unknown.
// - sound (P0.1): its own audio element, at the volume Studio gives;
// - video (P0.2): full frame (object-fit contain), its own sound, presented as its legacy overlay did
//   (Alerte_system.html « jouerAlerteSuperposee »): random horizontal mirror, rise from +550 px with a 220 ms fade in,
//   500 ms fade out before the end, ducking of the plays of the same video (only the oldest `audible` heard);
// - wbrb (P0.2, BRB): the legacy « jouerWbrb » layer — the screen capture (dimmed, brown veil), the camera capture
//   dropping in after 1 s, the « We'll be right back » video on top (shown 80 ms after the start); at the video's end:
//   fade out after 500 ms (200 ms), removed at 700 ms — the effect ends then.
//
// In OBS the page may play sound without a click. In a normal browser it shows « Activer le son » and takes no effect
// until sound is allowed (Studio then reports the player as muted instead of handing effects to a silent page).
const player = crypto.randomUUID();
const token = location.hash.slice(1);
const panel = document.getElementById('panel');
const status = document.getElementById('status');
const enable = document.getElementById('enable');
const stage = document.getElementById('stage');
const seen = new Set();
let playing = 0;
let audioEnabled = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Started, end never signalled: released after its duration plus this margin (Studio waits longer). */
const END_MARGIN_MS = 15_000;
const START_TIMEOUT_MS = 5000;
/** Legacy overlay: fade out 500 ms before the end of a video. */
const FADE_OUT_MS = 500;
/** Legacy overlay: volume ramps of the ducking (cubic ease out). */
const RAMP_MS = 450;

async function call(path, data) {
  const response = await fetch('/effects/player/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-effects-token': token },
    body: JSON.stringify({ player, ...data }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('player_request_failed');
  return response.json();
}
const heartbeat = () => call('heartbeat', { audio: audioEnabled });
async function report(effect, event, error) {
  // Retry only the report, never the effect.
  for (let n = 0; n < 10; n++) {
    try {
      await call('report', {
        delivery_id: effect.delivery_id,
        event,
        ...(error ? { error } : {}),
      });
      return;
    } catch {
      await sleep(300);
    }
  }
}

function show(text) {
  panel.hidden = audioEnabled && !text;
  enable.hidden = audioEnabled;
  status.textContent =
    text ?? (audioEnabled ? '' : 'Son bloqué : clique pour autoriser.');
}

/**
 * Is sound allowed? At load: only read (a resume without a click may never settle in a normal browser). On the click:
 * resume, bounded.
 */
async function unlock(fromClick) {
  try {
    const context = new AudioContext();
    if (context.state !== 'running' && fromClick)
      await Promise.race([context.resume(), sleep(1000)]);
    audioEnabled = context.state === 'running';
    void context.close().catch(() => {});
  } catch {
    audioEnabled = false;
  }
  show();
  void heartbeat().catch(() => {});
}
// OBS: allowed at once. A normal browser: needs the click.
enable.addEventListener('click', () => void unlock(true));

const MEDIA_URL = /^media\/[a-z0-9][a-z0-9-]{0,47}$/;
const CAPTURE_URL = /^capture\/[0-9a-f-]{36}$/;
const clamp = (v) => Math.min(1, Math.max(0, Number(v) || 0));

// --- ducking (legacy « reglerVolumesSuperposes ») ---------------------------------------------------------------------

/** effect_id → plays of that video, oldest first. */
const groups = new Map();

function ramp(el, target) {
  cancelAnimationFrame(Number(el.dataset.volumeFrame || 0));
  const from = el.volume;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / RAMP_MS);
    el.volume = clamp(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1 && el.isConnected)
      el.dataset.volumeFrame = String(requestAnimationFrame(tick));
  };
  el.dataset.volumeFrame = String(requestAnimationFrame(tick));
}

function duck(effectId) {
  const plays = groups.get(effectId) ?? [];
  if (!plays.length) return;
  const { base, ducking } = plays[0];
  const n = plays.length;
  const audible = Math.min(n, ducking.audible);
  const level = Math.max(
    base * ducking.min,
    base - (n - 1) * base * ducking.step,
  );
  plays.forEach((p, i) => {
    p.el.muted = i >= audible;
    ramp(p.el, i < audible ? level : 0);
  });
  stage.dataset[`plays_${effectId.replace(/-/g, '_')}`] = String(n);
}

// --- one effect -----------------------------------------------------------------------------------------------------

function videoElement(effect) {
  const p = effect.presentation;
  const el = document.createElement('video');
  el.playsInline = true;
  el.preload = 'auto';
  el.volume = clamp(effect.volume);
  el.dataset.effect = effect.effect_id;
  if (p && Math.random() < Number(p.mirror)) el.classList.add('mirror');
  el.src = effect.url;
  stage.append(el);
  const entry = { el, base: clamp(effect.volume), ducking: p.ducking };
  const plays = groups.get(effect.effect_id) ?? [];
  plays.push(entry);
  groups.set(effect.effect_id, plays);
  duck(effect.effect_id);
  let fadeTimer = null;
  el.addEventListener(
    'canplay',
    () => {
      // Two frames so the starting position is painted before the rise.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => el.classList.add(p.rise ? 'in' : 'still')),
      );
    },
    { once: true },
  );
  el.addEventListener(
    'loadedmetadata',
    () => {
      if (Number.isFinite(el.duration))
        fadeTimer = setTimeout(
          () => el.classList.add('out'),
          Math.max(0, el.duration * 1000 - FADE_OUT_MS),
        );
    },
    { once: true },
  );
  return {
    el,
    release() {
      clearTimeout(fadeTimer);
      cancelAnimationFrame(Number(el.dataset.volumeFrame || 0));
      el.remove();
      const rest = (groups.get(effect.effect_id) ?? []).filter(
        (x) => x !== entry,
      );
      if (rest.length) groups.set(effect.effect_id, rest);
      else groups.delete(effect.effect_id);
      duck(effect.effect_id);
    },
  };
}

/** Legacy « jouerWbrb » / « arreterWbrb ». The element whose events drive the effect is the video; done after the tail. */
function wbrbElement(effect) {
  const layer = document.createElement('div');
  layer.className = 'wbrb';
  const bg = document.createElement('img');
  bg.className = 'wbrb-bg';
  bg.alt = '';
  bg.src = effect.images.screen;
  const shade = document.createElement('div');
  shade.className = 'wbrb-bg-shade';
  const cam = document.createElement('img');
  cam.className = 'wbrb-cam';
  cam.alt = '';
  cam.src = effect.images.cam;
  const el = document.createElement('video');
  el.playsInline = true;
  el.preload = 'auto';
  el.volume = clamp(effect.volume);
  el.src = effect.url;
  layer.append(bg, shade, cam, el);
  stage.append(layer);
  const timers = [setTimeout(() => layer.classList.add('video-ready'), 80)];
  el.addEventListener(
    'ended',
    () => {
      timers.push(
        setTimeout(() => layer.classList.add('fade-out'), 500),
        setTimeout(() => el.dispatchEvent(new Event('effect-done')), 700),
      );
    },
    { once: true },
  );
  return {
    el,
    doneEvent: 'effect-done',
    release() {
      timers.forEach(clearTimeout);
      layer.remove();
    },
  };
}

function audioElement(effect) {
  const el = new Audio(effect.url);
  el.volume = clamp(effect.volume);
  return { el, release() {} };
}

async function play(effect) {
  if (seen.has(effect.delivery_id)) return;
  seen.add(effect.delivery_id);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  const video =
    effect.kind === 'video' &&
    effect.presentation &&
    typeof effect.effect_id === 'string';
  const wbrb =
    effect.kind === 'wbrb' &&
    CAPTURE_URL.test(effect.images?.screen ?? '') &&
    CAPTURE_URL.test(effect.images?.cam ?? '');
  if (
    (effect.kind !== 'sound' && !video && !wbrb) ||
    !MEDIA_URL.test(effect.url)
  ) {
    await report(effect, 'failed', 'invalid_effect');
    return;
  }
  const media = wbrb
    ? wbrbElement(effect)
    : video
      ? videoElement(effect)
      : audioElement(effect);
  const el = media.el;
  let started = false;
  let endGuard = null;
  const outcome = new Promise((resolve) => {
    el.addEventListener('playing', () => {
      if (started) return;
      started = true;
      playing += 1;
      document.body.dataset.playing = String(playing);
      void report(effect, 'started');
      const ms = Number.isFinite(el.duration) ? el.duration * 1000 : 0;
      endGuard = setTimeout(
        () => resolve({ event: 'unknown' }),
        ms + END_MARGIN_MS,
      );
    });
    el.addEventListener(media.doneEvent ?? 'ended', () =>
      resolve({ event: 'completed' }),
    );
    el.addEventListener('error', () =>
      resolve({
        event: 'failed',
        error: started ? 'playback_error' : 'file_missing',
      }),
    );
    setTimeout(() => {
      if (!started) resolve({ event: 'failed', error: 'start_timeout' });
    }, START_TIMEOUT_MS);
  });
  el.play().catch((e) => {
    if (e && e.name === 'NotAllowedError') {
      audioEnabled = false;
      show();
    }
  });
  const result = await outcome;
  clearTimeout(endGuard);
  // Release the element: nothing kept alive after a burst.
  el.pause();
  media.release();
  el.removeAttribute('src');
  el.load();
  if (started) {
    playing -= 1;
    document.body.dataset.playing = String(playing);
  }
  await report(
    effect,
    result.event,
    result.event === 'failed'
      ? audioEnabled
        ? result.error
        : 'effects_player_muted'
      : undefined,
  );
}

await unlock(false);
setInterval(() => void heartbeat().catch(() => {}), 1500);
while (true) {
  try {
    // A silent page takes nothing: Studio sees it muted and refuses the effect with a readable reason.
    if (audioEnabled) {
      const { effects } = await call('next', {});
      // Not awaited: effects overlap; the next ones are fetched right away.
      for (const effect of effects ?? []) void play(effect);
    }
  } catch {
    /* Studio unavailable: never invent a result. */
  }
  await sleep(100);
}
