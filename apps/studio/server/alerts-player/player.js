/* global document, location, crypto, fetch, setTimeout */
// Twitch alerts V1 (A2) — the OBS browser source (1920×1080, transparent). The ONLY consumer of Core's alert queue:
// it asks Studio for the next alert (Studio claims it from Core with this page's consumer id), plays it with the
// shared engine and reports « started » when the video really starts, then « completed » or « failed » with the
// reason. One alert at a time; nothing is kept in memory between alerts (no parallel queue). A closed / crashed
// source simply stops reporting: Core's leases requeue an alert never started, and never replay one already seen.
import { createAlertEngine } from './engine.js';

const token = location.hash.slice(1);
const consumerId = 'obs-' + crypto.randomUUID().slice(0, 8);
const POLL_MS = 1000;
const OK = new Set(['video-ended', 'audio-ended', 'duration']);

const engine = createAlertEngine({
  stage: document.getElementById('stage'),
  mediaUrl: (name) => `media/${encodeURIComponent(name)}`,
});

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

async function loop() {
  for (;;) {
    let alert = null;
    try {
      alert = (await post('next', {})).alert;
    } catch {
      /* Studio or Core unreachable: try again later */
    }
    if (!alert) {
      await wait(POLL_MS);
      continue;
    }
    let started = null;
    const { reason } = await engine.play(alert.variant, alert.data, {
      placement: alert.placement, // saved calibration, read by Studio when the alert was claimed
      onStarted: () => {
        started = ack(alert, 'started');
      },
    });
    await started;
    if (OK.has(reason)) await ack(alert, 'completed');
    else await ack(alert, 'failed', reason);
  }
}

if (/^[a-f0-9]{32}$/.test(token)) void loop();
