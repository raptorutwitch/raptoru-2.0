/* global document, location, fetch, crypto, Audio, AudioContext, setTimeout, clearTimeout, setInterval, AbortSignal, requestAnimationFrame, cancelAnimationFrame, performance, Event, sessionStorage */

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
//   fade out after 500 ms (200 ms), removed at 700 ms — the effect ends then;
// - ban (Random Ban V2): the legacy ban layer (Alerte_system.html « jouerAlerte » ban_*): the video (its own sound, mirror
//   variants), the phrase with both names shown at show_at / hidden at hide_at (slide 0.3 s); ends at the video's end or
//   duration + 800 ms (the legacy watchdog), whichever first;
// - flop (Random Ban V2): the trumpet and « X a flop cheh ! » (the legacy OBS text source: fade in, 2 s, fade out).
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

/**
 * Stale page (BRB fix, 18/10/2026): Studio answers with the version of the files it serves and hands this page nothing
 * while it differs. The page then waits until its effects are over and reloads (same URL, token kept; files served
 * no-store). One reload per new version: if it still comes back old (a cache), it keeps its code (stale_ok) instead of
 * reloading in a loop.
 */
const VERSION =
  document.querySelector('meta[name="effects-player-version"]')?.content ?? '';
const RELOAD_KEY = 'effects-player-reloaded-to';
let staleOk = false;
let reloading = false;
const triedReload = (version) => {
  try {
    return sessionStorage.getItem(RELOAD_KEY) === version;
  } catch {
    return true; // no storage: no guard against a loop, so no automatic reload
  }
};
async function reloadWhenIdle(version) {
  reloading = true;
  while (playing > 0 || reports > 0) await sleep(250);
  try {
    sessionStorage.setItem(RELOAD_KEY, version);
  } catch {
    staleOk = true;
    reloading = false;
    return;
  }
  location.reload();
}
/** A version answer from Studio: reload once if it differs. */
function checkVersion(version) {
  if (!version || version === VERSION || staleOk || reloading) return;
  if (triedReload(version)) staleOk = true;
  else void reloadWhenIdle(version);
}
let reports = 0;

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
const heartbeat = async () => {
  const reply = await call('heartbeat', {
    audio: audioEnabled,
    version: VERSION,
    stale_ok: staleOk,
  });
  checkVersion(reply?.version);
};
async function report(effect, event, error) {
  reports += 1;
  try {
    await sendReport(effect, event, error);
  } finally {
    reports -= 1;
  }
}
async function sendReport(effect, event, error) {
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

/** Legacy ban layer: video + phrase; « effect-done » at the video's end or the watchdog (duration + 800 ms). */
function banElement(effect) {
  const b = effect.ban;
  const layer = document.createElement('div');
  layer.className = 'rb';
  const el = document.createElement('video');
  el.playsInline = true;
  el.preload = 'auto';
  el.volume = clamp(effect.volume);
  if (b.mirror) el.classList.add('mirror');
  el.style.visibility = 'hidden';
  el.src = effect.url;
  const text = document.createElement('div');
  // Legacy: one phrase of the pool at random, names in their colours (text only: never HTML from a name).
  const phrase = b.phrases[Math.floor(Math.random() * b.phrases.length)];
  for (const part of phrase.split(/(\{trigger\}|\{banned\})/)) {
    if (!part) continue;
    if (part === '{trigger}' || part === '{banned}') {
      const span = document.createElement('span');
      span.className = part === '{trigger}' ? 'trigger' : 'banned';
      span.textContent = part === '{trigger}' ? b.trigger : b.banned;
      text.append(span);
    } else text.append(part);
  }
  layer.append(el, text);
  stage.append(layer);
  el.addEventListener('canplay', () => (el.style.visibility = 'visible'), {
    once: true,
  });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.style.visibility = 'hidden';
    el.dispatchEvent(new Event('effect-done'));
  };
  const timers = [
    setTimeout(() => (text.className = 'pseudo-ban show'), Number(b.show_at)),
    setTimeout(() => (text.className = 'pseudo-ban hide'), Number(b.hide_at)),
    setTimeout(finish, Number(b.duration) + 800),
  ];
  el.addEventListener('ended', finish, { once: true });
  return {
    el,
    doneEvent: 'effect-done',
    release() {
      timers.forEach(clearTimeout);
      layer.remove();
    },
  };
}

/** Legacy flop: the trumpet and the text (fade in, visible, fade out); done when both are over. */
function flopElement(effect) {
  const f = effect.ban;
  const el = new Audio(effect.url);
  el.volume = clamp(effect.volume);
  const text = document.createElement('div');
  text.className = 'rb-flop';
  text.textContent = f.text;
  text.style.left = Number(f.left) + 'px';
  text.style.top = Number(f.top) + 'px';
  text.style.transform = `scale(${Number(f.scale_x)}, ${Number(f.scale_y)})`;
  text.style.transitionDuration = Number(f.fade_ms) + 'ms';
  stage.append(text);
  let soundOver = false;
  let textOver = false;
  const check = () => {
    if (soundOver && textOver) el.dispatchEvent(new Event('effect-done'));
  };
  const timers = [];
  el.addEventListener(
    'playing',
    () => {
      requestAnimationFrame(() => text.classList.add('on'));
      timers.push(
        setTimeout(() => text.classList.remove('on'), Number(f.visible_ms)),
        setTimeout(
          () => {
            textOver = true;
            check();
          },
          Number(f.visible_ms) + Number(f.fade_ms),
        ),
      );
    },
    { once: true },
  );
  el.addEventListener(
    'ended',
    () => {
      soundOver = true;
      check();
    },
    { once: true },
  );
  return {
    el,
    doneEvent: 'effect-done',
    release() {
      timers.forEach(clearTimeout);
      text.remove();
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
  const ban =
    effect.kind === 'ban' &&
    Array.isArray(effect.ban?.phrases) &&
    effect.ban.phrases.length > 0;
  const flop = effect.kind === 'flop' && typeof effect.ban?.text === 'string';
  if (
    (effect.kind !== 'sound' && !video && !wbrb && !ban && !flop) ||
    !MEDIA_URL.test(effect.url)
  ) {
    await report(effect, 'failed', 'invalid_effect');
    return;
  }
  const media = wbrb
    ? wbrbElement(effect)
    : ban
      ? banElement(effect)
      : flop
        ? flopElement(effect)
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
      const { effects, version } = await call('next', {
        version: VERSION,
        stale_ok: staleOk,
      });
      checkVersion(version);
      // Not awaited: effects overlap; the next ones are fetched right away.
      for (const effect of effects ?? []) void play(effect);
    }
  } catch {
    /* Studio unavailable: never invent a result. */
  }
  await sleep(100);
}
