/* global document, location, fetch, crypto, Audio, AudioContext, setTimeout, clearTimeout, setInterval, AbortSignal */

// Raptoru effects player (P0.1, docs/EFFECTS_PLAYER.md) — ONE OBS browser source. Every effect handed by Studio plays
// at once in its own audio element (effects overlap; Studio caps how many) at the volume Studio gives, and reports
// started → completed / failed / unknown. Nothing is ever replayed: an effect handed to this page is played once or
// reported failed; one whose end never comes is released and reported unknown.
//
// In OBS the page may play sound without a click. In a normal browser it shows « Activer le son » and takes no effect
// until sound is allowed (Studio then reports the player as muted instead of handing effects to a silent page).
const player = crypto.randomUUID();
const token = location.hash.slice(1);
const panel = document.getElementById('panel');
const status = document.getElementById('status');
const enable = document.getElementById('enable');
const seen = new Set();
let playing = 0;
let audioEnabled = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Started, end never signalled: released after its duration plus this margin (Studio waits longer). */
const END_MARGIN_MS = 15_000;
const START_TIMEOUT_MS = 5000;

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

const SOUND_URL = /^media\/[a-z0-9][a-z0-9-]{0,47}$/;

async function play(effect) {
  if (seen.has(effect.delivery_id)) return;
  seen.add(effect.delivery_id);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  if (effect.kind !== 'sound' || !SOUND_URL.test(effect.url)) {
    await report(effect, 'failed', 'invalid_effect');
    return;
  }
  const audio = new Audio(effect.url);
  audio.volume = Math.min(1, Math.max(0, Number(effect.volume)));
  let started = false;
  let endGuard = null;
  const outcome = new Promise((resolve) => {
    audio.addEventListener('playing', () => {
      if (started) return;
      started = true;
      playing += 1;
      document.body.dataset.playing = String(playing);
      void report(effect, 'started');
      const ms = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      endGuard = setTimeout(
        () => resolve({ event: 'unknown' }),
        ms + END_MARGIN_MS,
      );
    });
    audio.addEventListener('ended', () => resolve({ event: 'completed' }));
    audio.addEventListener('error', () =>
      resolve({
        event: 'failed',
        error: started ? 'playback_error' : 'file_missing',
      }),
    );
    setTimeout(() => {
      if (!started) resolve({ event: 'failed', error: 'start_timeout' });
    }, START_TIMEOUT_MS);
  });
  audio.play().catch((e) => {
    if (e && e.name === 'NotAllowedError') {
      audioEnabled = false;
      show();
    }
  });
  const result = await outcome;
  clearTimeout(endGuard);
  // Release the element: no player kept alive after a burst.
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
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
