/* global document, location, crypto, fetch, setTimeout, clearTimeout, sessionStorage, window */
// Twitch alerts V1 (A2) — the OBS browser source (1920×1080, transparent). The ONLY consumer of Core's alert queue:
// it asks Studio for the next alert (Studio claims it from Core with this page's consumer id), plays it with the
// shared engine and reports « started » when the video really starts, then « completed » or « failed » with the
// reason. A closed / crashed source simply stops reporting: Core's leases requeue an alert never started, and never
// replay one already seen.
// Families (17/10/2026): Core hands out at most one alert per family (follow, subscription, bits, donation, raid), so
// several families play here at once. Each alert gets its OWN engine instance in its own layer (video, sound, texts,
// timers, name colour, saved placement), stacked by family (follow at the bottom, raid on top), destroyed when it
// ends; an alert never touches another one. Nothing is kept between alerts (no local queue beyond one per family).
import { createAlertEngine } from './engine.js';
import { familyLayer, familyOf, pickNameColor } from './timeline.js';

const token = location.hash.slice(1);
const consumerId = 'obs-' + crypto.randomUUID().slice(0, 8);
const POLL_MS = 1000;
const OK = new Set(['video-ended', 'audio-ended', 'duration']);
const stage = document.getElementById('stage');
const mediaUrl = (name) => `media/${encodeURIComponent(name)}`;

const post = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, token, consumer_id: consumerId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(json.error || `HTTP ${res.status}`), {
      status: res.status,
    });
  return json;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A report is retried a few times (Studio restarting); a refusal (409: alert already ended) is final. */
async function ack(alert, event, error) {
  for (let i = 0; i < 5; i++) {
    try {
      return await post('ack', {
        alert_id: alert.alert_id,
        attempt_id: alert.attempt_id,
        family: alert.family,
        event,
        error,
      });
    } catch (e) {
      if (e.status && e.status < 500) return null;
      await wait(1000 * (i + 1));
    }
  }
  return null;
}

/** Name colours of the alerts on screen (a new alert avoids them and the previous one). */
const colors = new Set();
let lastColor = null;

/** One alert in its own layer and engine instance; resolves once reported and cleaned up. */
async function playOne(alert) {
  const family = alert.family || familyOf(alert.variant?.type);
  const layer = document.createElement('div');
  layer.className = 'alert-layer';
  layer.dataset.family = family;
  layer.style.zIndex = String(familyLayer(family));
  stage.append(layer);
  const engine = createAlertEngine({ stage: layer, mediaUrl });
  const nameColor = pickNameColor([lastColor, ...colors]);
  lastColor = nameColor;
  colors.add(nameColor);
  try {
    let started = null;
    const { reason } = await engine.play(alert.variant, alert.data, {
      placement: alert.placement, // saved calibration, read by Studio when the alert was claimed
      nameColor,
      onStarted: () => {
        started = ack(alert, 'started');
      },
    });
    await started;
    if (OK.has(reason)) await ack(alert, 'completed');
    else await ack(alert, 'failed', reason);
  } finally {
    colors.delete(nameColor);
    engine.destroy();
    layer.remove();
  }
}

/**
 * Per family, the alert playing (Core never hands out two of one family; should it happen anyway — a lease lost
 * while still playing — the second one waits for the first instead of overlapping it).
 */
const running = new Map();
let wake = null;
const nap = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(t);
      resolve();
    };
  });

function start(alert) {
  const family = alert.family || familyOf(alert.variant?.type);
  const run = (running.get(family) ?? Promise.resolve())
    .then(() => playOne(alert))
    .catch(() => {})
    .finally(() => {
      if (running.get(family) === run) running.delete(family);
      wake?.(); // a family is free: ask for its next alert at once
    });
  running.set(family, run);
}

/**
 * Stale page (17/10/2026): Studio reports the version of the files it serves with each answer and hands this page no
 * alert while it differs. The page then claims nothing more, waits until every alert, report and donation TTS is
 * over, and reloads (same URL, token kept; files served no-store). One reload per new version: if the page still
 * comes back old (a cache), it keeps playing with its code (stale_ok) instead of reloading in a loop.
 */
const VERSION =
  document.querySelector('meta[name="alerts-player-version"]')?.content ?? '';
const RELOAD_KEY = 'alerts-player-reloaded-to';
let staleOk = false;

const triedReload = (version) => {
  try {
    return sessionStorage.getItem(RELOAD_KEY) === version;
  } catch {
    return true; // no storage: no guard against a loop, so no automatic reload
  }
};

async function reloadWhenIdle(version) {
  const tts = window.speechSynthesis;
  while (running.size || tts?.speaking || tts?.pending) await wait(250);
  try {
    sessionStorage.setItem(RELOAD_KEY, version);
  } catch {
    staleOk = true;
    return loop();
  }
  location.reload();
}

async function loop() {
  for (;;) {
    let res = null;
    try {
      res = await post('next', { version: VERSION, stale_ok: staleOk });
    } catch {
      /* Studio or Core unreachable: try again later */
    }
    if (res?.alert) start(res.alert);
    if (res?.version && res.version !== VERSION && !staleOk) {
      if (!triedReload(res.version)) return reloadWhenIdle(res.version);
      staleOk = true;
    }
    // An alert: ask again at once (another family may be waiting); nothing: wait for a family to end or the poll.
    if (!res?.alert) await nap(POLL_MS);
  }
}

if (/^[a-f0-9]{32}$/.test(token)) void loop();
