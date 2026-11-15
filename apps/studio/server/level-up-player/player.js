/* global location, EventSource, Audio, setTimeout */
// Level Up V2 — the invisible OBS source (served by Studio; token in the URL hash), SOUND ONLY: never a banner, a text
// or a frame on the stream (docs/LEVEL_UP_V2.md § 5). Studio pushes each sound once (the Core decided: the viewer turned
// it on, the channel's cooldown); this page plays them one after the other, never two at once. Live only: a reload or a
// reconnection never replays the past. It also plays the Commands « sound » actions (`event: sound`, a file Studio
// serves under /level-up/cmd/<id>), in the same queue.
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
  const audio = new Audio(n.src ?? '/level-up/sound');
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
function enqueue(n) {
  // A burst never piles up: beyond 5 waiting, the oldest are dropped.
  queue.push(n);
  while (queue.length > MAX_WAITING) queue.shift();
  if (!busy) next();
}
const parse = (e) => {
  try {
    return JSON.parse(e.data);
  } catch {
    return null;
  }
};
events.addEventListener('levelup', (e) => {
  const n = parse(e);
  if (n && n.sound === true) enqueue({ volume: n.volume });
});
// A command's sound: only a file Studio serves for the commands (never another address).
events.addEventListener('sound', (e) => {
  const n = parse(e);
  if (n && /^\/level-up\/cmd\/[a-f0-9]{16}$/.test(n.src))
    enqueue({ volume: n.volume, src: n.src });
});
