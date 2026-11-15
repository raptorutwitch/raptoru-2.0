/* global location, EventSource, Audio, setTimeout */
// Level Up V2 — the invisible OBS source (served by Studio; token in the URL hash), SOUND ONLY: never a banner, a text
// or a frame on the stream (docs/LEVEL_UP_V2.md § 5). Studio pushes each sound once (the Core decided: the viewer turned
// it on, the channel's cooldown); this page plays them one after the other, never two at once. Live only: a reload or a
// reconnection never replays the past.
const token = location.hash.slice(1);
const MAX_WAITING = 5;
// A sound longer than this does not hold the next one back.
const MAX_SOUND_MS = 8000;
const queue = [];
let busy = false;

function next() {
  const n = queue.shift();
  if (!n) {
    busy = false;
    return;
  }
  busy = true;
  const audio = new Audio('/level-up/sound');
  audio.volume = Math.max(0, Math.min(1, Number(n.volume) || 0));
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    next();
  };
  audio.addEventListener('ended', end);
  audio.addEventListener('error', end);
  setTimeout(end, MAX_SOUND_MS);
  void audio.play().catch(end);
}

const events = new EventSource(
  `/level-up/events?t=${encodeURIComponent(token)}`,
);
events.addEventListener('levelup', (e) => {
  let n;
  try {
    n = JSON.parse(e.data);
  } catch {
    return;
  }
  if (!n || n.sound !== true) return;
  // A burst never piles up: beyond 5 waiting, the oldest are dropped.
  queue.push(n);
  while (queue.length > MAX_WAITING) queue.shift();
  if (!busy) next();
});
