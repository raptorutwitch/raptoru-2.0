// LAB ONLY — page apercu.html : la maquette « Interactions » dans les tailles réelles de l'extension, côte à côte.
// Tailles et adresses : celles du banc Casino (test/responsive/casino-compose.mjs), dont l'adresse réelle de l'appli
// Twitch mobile (mobile.html?platform=mobile&anchor=component, correctif du 24/11).
import { EFFECTS } from './catalog.js';
import { SCENARIOS } from './model.js';

const VIDEO = 'video_component.html?anchor=component';
const MOBILE = 'mobile.html?platform=mobile&anchor=component&mode=viewer';
const FRAMES = [
  ['Lecteur Twitch normal', '563 × 376 (défaut)', VIDEO, 563, 376],
  ['Composant vidéo', '651 × 434 (référence)', VIDEO, 651, 434],
  ['Appli Twitch Android', 'sous la vidéo, 393 × 484', MOBILE, 393, 484],
  ['Petit Android', 'sous la vidéo, 360 × 409', MOBILE, 360, 409],
  ['iPhone (simulé)', 'sous la vidéo, 390 × 460', MOBILE, 390, 460],
  ['Panneau', '318 × 496', 'panel.html?anchor=panel', 318, 496],
  ['Plein écran', '1053 × 702', VIDEO, 1053, 702],
];
const state = { ixTab: 'chaos', ixRole: 'viewer', ixScenario: 'normal', ixOpen: '', ixCap: '30', ixPlanned: '' };
const base = new URL('../../', import.meta.url); // racine de l'extension servie

const scen = document.querySelector('[data-k="ixScenario"]');
for (const [id, label] of Object.entries(SCENARIOS)) scen.append(new globalThis.Option(label, id));
const open = document.querySelector('[data-k="ixOpen"]');
open.append(new globalThis.Option('— aucune —', ''));
for (const e of EFFECTS) open.append(new globalThis.Option(e.label, e.id));

function draw() {
  for (const seg of document.querySelectorAll('.seg'))
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === state[seg.dataset.k]));
  scen.value = state.ixScenario;
  open.value = state.ixOpen;
  const params = new URLSearchParams({ labModules: 'interactions', demoModule: 'interactions' });
  for (const [k, v] of Object.entries(state)) if (v) params.set(k, v);
  // « Modération FX » : rôle modérateur et section FX ouverte.
  if (state.ixRole === 'fx') {
    params.set('ixRole', 'mod');
    params.set('ixMod', '1');
  }
  const main = document.getElementById('frames');
  main.replaceChildren();
  for (const [title, size, page, w, h] of FRAMES) {
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<b>${title}</b> · ${size}`;
    const frame = document.createElement('iframe');
    frame.width = String(w);
    frame.height = String(h);
    frame.title = title;
    frame.src = new URL(`${page}&${params}`, base).href;
    fig.append(cap, frame);
    main.append(fig);
  }
}

document.addEventListener('click', (event) => {
  const b = event.target.closest('.seg button');
  if (!b) return;
  state[b.closest('.seg').dataset.k] = b.dataset.v;
  draw();
});
scen.addEventListener('change', () => {
  state.ixScenario = scen.value;
  draw();
});
open.addEventListener('change', () => {
  state.ixOpen = open.value;
  if (open.value) state.ixTab = 'chaos';
  draw();
});
draw();
