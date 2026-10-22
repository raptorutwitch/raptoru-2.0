/* global location, document, localStorage, EventSource, Audio */
// Jeu des mots V1 — OBS sound source (browser source, served by Studio; nothing visible). It listens to
// Studio's win events (pushed, never polled; token from the URL hash) and plays ShuffleWordsSong.ogg
// once per new winning message (model.js). The stream is live only: a reload or a reconnection never
// replays the past (a win during a disconnection is missed). EventSource reconnects on its own.
import { admit, soundVolume } from './model.js';

const PLAYED_KEY = 'raptoru-word-game-sound-played';
const SOUND_URL = '/word-game/ShuffleWordsSong.ogg';
const token = location.hash.slice(1);
const status = document.querySelector('#status');

let played = [];
try {
  const stored = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '[]');
  if (Array.isArray(stored))
    played = stored.filter((id) => typeof id === 'string');
} catch {
  played = [];
}

const events = new EventSource(
  `/word-game/events?t=${encodeURIComponent(token)}`,
);
events.addEventListener('win', (e) => {
  let win;
  try {
    win = JSON.parse(e.data);
  } catch {
    return;
  }
  const r = admit(played, win?.message_id);
  if (!r.play) return;
  played = r.played;
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify(played));
  } catch {
    /* storage unavailable: remembered in memory */
  }
  // The streamer's volume (Studio › Jeu des mots), for this sound only.
  const audio = new Audio(SOUND_URL);
  audio.volume = soundVolume(win);
  void audio.play().catch(() => {});
});
events.onopen = () => {
  if (status) status.textContent = 'ok';
};
events.onerror = () => {
  if (status)
    status.textContent =
      events.readyState === EventSource.CLOSED ? 'refused' : 'reconnecting';
};
