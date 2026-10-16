/* global location, document, localStorage, fetch, Audio, setTimeout */
// Jeu des mots V1 — OBS sound source (browser source, served by Studio; nothing visible). Every second it
// reads Core's recent wins through Studio (token from the URL hash) and plays ShuffleWordsSong.ogg once
// per new winning message (model.js). The cursor is remembered by the source: a reload never replays.
import { winsToPlay } from './model.js';

const POLL_MS = 1000;
const CURSOR_KEY = 'raptoru-word-game-sound-cursor';
const SOUND_URL = '/word-game/ShuffleWordsSong.ogg';
const token = location.hash.slice(1);
const status = document.querySelector('#status');

let cursor = null;
try {
  cursor = JSON.parse(localStorage.getItem(CURSOR_KEY) ?? 'null');
} catch {
  cursor = null;
}

function remember(next) {
  cursor = next;
  try {
    localStorage.setItem(CURSOR_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the cursor stays in memory */
  }
}

async function poll() {
  try {
    const res = await fetch('/word-game/feed', {
      headers: { 'x-word-game-token': token },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const { recent } = await res.json();
    const { play, cursor: next } = winsToPlay(recent ?? [], cursor, Date.now());
    remember(next);
    play.forEach(() => void new Audio(SOUND_URL).play().catch(() => {}));
    if (status) status.textContent = 'ok';
  } catch (e) {
    if (status) status.textContent = String(e);
  } finally {
    setTimeout(poll, POLL_MS);
  }
}

void poll();
