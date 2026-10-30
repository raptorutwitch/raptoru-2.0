/* global location, document, EventSource, Audio, setTimeout */
// Level Up V2 — OBS source (served by Studio; token in the URL hash). Studio pushes each notice once (Core decided who,
// which level and whether the sound plays); this page shows them one after the other (5 s each) and plays the short
// sound only when the notice carries it. Live only: a reload or a reconnection never replays the past.
const token = location.hash.slice(1);
const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const SHOW_MS = 5000;
const MAX_WAITING = 10;
const queue = [];
let busy = false;

function next() {
  const n = queue.shift();
  if (!n) {
    busy = false;
    return;
  }
  busy = true;
  stage.textContent = '';
  const card = document.createElement('div');
  card.className = 'card';
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '⬆';
  const text = document.createElement('span');
  // Viewer data: always as text, never as HTML.
  text.textContent = `${n.name} passe `;
  const level = document.createElement('span');
  level.className = 'level';
  level.textContent = `niveau ${n.level}`;
  text.append(level, ' !');
  card.append(arrow, text);
  stage.append(card);
  if (n.sound) {
    const audio = new Audio('/level-up/sound');
    audio.volume = Math.max(0, Math.min(1, Number(n.volume) || 0));
    void audio.play().catch(() => {});
  }
  setTimeout(() => {
    card.remove();
    next();
  }, SHOW_MS);
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
  if (!n || typeof n.name !== 'string' || !Number.isInteger(n.level)) return;
  // A burst never piles up: beyond 10 waiting, the oldest are dropped.
  queue.push(n);
  while (queue.length > MAX_WAITING) queue.shift();
  if (!busy) next();
});
events.onopen = () => {
  if (status) status.textContent = 'ok';
};
events.onerror = () => {
  if (status)
    status.textContent =
      events.readyState === EventSource.CLOSED ? 'refused' : 'reconnecting';
};
