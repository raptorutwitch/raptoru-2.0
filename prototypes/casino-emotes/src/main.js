// Machine n°2 — la page : le jeu dans son Shadow DOM (comme l'extension), ses feuilles CONSTRUITES et adoptées AVANT le
// premier affichage (aucune image sans styles, aucune icône à sa taille d'origine), les images décodées d'abord ; le
// bandeau (solde fictif) et le panneau Lab.
import { fmt } from '../vendor/frame.js';
import { PAYING } from './engine.js';
import { mountBook } from './game.js';
import { BY_ID, isProvisional, preload } from './symbols.js';

const SHEETS = ['vendor/casino.css', 'vendor/slot.css', 'src/book.css'];
const host = document.createElement('div');
host.className = 'cz-host is-loading';
document.getElementById('host').append(host);
const D = host.attachShadow({ mode: 'open' });
const css = await Promise.all(SHEETS.map((u) => fetch(u).then((r) => r.text())));
D.adoptedStyleSheets = css.map((t) => {
  const s = new CSSStyleSheet();
  s.replaceSync(t);
  return s;
});
D.innerHTML = '<div id="body" class="cz"></div>';
await preload();

const balEl = document.getElementById('balance');
const deltaEl = document.getElementById('delta');
function onWallet(balance, delta) {
  balEl.textContent = fmt(balance);
  if (!delta) return;
  deltaEl.textContent = `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}`;
  deltaEl.className = `delta ${delta > 0 ? 'plus' : 'minus'}`;
  void deltaEl.offsetWidth;
  deltaEl.classList.add('show');
}
const armedEl = document.getElementById('armed');
const game = mountBook(D, {
  onWallet,
  onState: (st) => {
    armedEl.textContent = st.armed ? `Armé : ${describe(st.armed)}` : '';
    document.querySelectorAll('[data-lab="reset"], [data-lab="now"]').forEach((b) => (b.disabled = st.busy));
  },
});
host.classList.remove('is-loading');
window.__book = game; // (Lab et contrôles automatiques)

// --- Le Lab -------------------------------------------------------------------------------------------------------
const symSel = document.getElementById('labSym');
for (const id of PAYING) symSel.insertAdjacentHTML('beforeend', `<option value="${id}">${id} · ${BY_ID[id].name} (${BY_ID[id].rank})</option>`);
function describe(t) {
  const parts = [`${t.bonus} BONUS`];
  if (t.symbol) parts.push(`symbole ${BY_ID[t.symbol].name}`);
  if (t.big) parts.push('extension sur 5 rouleaux');
  else if (t.expand) parts.push(`extension sur ${t.expand} rouleaux`);
  if (t.retrigger) parts.push('prolongation');
  return parts.join(' · ');
}
const scenario = (bonus = 3) => {
  const t = { bonus };
  if (symSel.value) t.symbol = symSel.value;
  const ex = document.getElementById('labExp').value;
  if (ex) t.expand = Number(ex);
  if (document.getElementById('labRe').checked) t.retrigger = true;
  return t;
};
document.getElementById('lab').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lab]');
  if (!b) return;
  const k = b.dataset.lab;
  if (k === 'give') game.give(Number(b.dataset.n));
  else if (k === 'reset') game.reset() || alert('Attends la fin du tour.');
  else if (k === 'bonus') game.arm(scenario(Number(b.dataset.k)));
  else if (k === 'arm') game.arm(scenario(3));
  else if (k === 'big') game.arm({ bonus: 3, symbol: 'p1', big: true });
  else if (k === 'now') {
    game.arm(scenario(3));
    if (!game.busy) game.spin();
  } else if (k === 'clear') game.arm(null);
});
const snd = document.getElementById('labSound');
const vol = document.getElementById('labVol');
const prefs = JSON.parse(localStorage.getItem('casino:book') ?? '{}');
snd.checked = !!prefs.sound;
vol.value = Math.round((prefs.volume ?? 0.6) * 100);
snd.addEventListener('change', () => game.setSound(snd.checked));
vol.addEventListener('input', () => game.setVolume(vol.value / 100));
const missing = Object.keys(BY_ID).filter(isProvisional);
document.getElementById('labInfo').innerHTML = missing.length
  ? `Visuels provisoires : <code>${missing.join(', ')}</code>. Le BONUS attend ton logo ou ta photo de profil : mets son fichier dans le dossier des émotes et son nom dans <code>src/manifest.js</code>, puis relance.`
  : 'Toutes les émotes du manifeste sont en place.';
