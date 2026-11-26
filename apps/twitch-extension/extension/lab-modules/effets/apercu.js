// LAB ONLY — page apercu.html : la maquette « Effets live » dans les tailles réelles de l'extension, côte à côte.
import { EFFECTS } from './catalog.js';
import { SCENARIOS } from './model.js';

const FRAMES = [
  ['Composant vidéo', '651 × 434 (référence)', 'video_component.html?anchor=component', 651, 434],
  ['Appli Twitch mobile', 'zone sous la vidéo, 393 × 484', 'mobile.html?anchor=panel&platform=mobile', 393, 484],
  ['Petit Android', 'zone 360 × 409', 'mobile.html?anchor=panel&platform=mobile', 360, 409],
  ['Panneau', '318 × 496', 'panel.html?anchor=panel', 318, 496],
  ['Composant vidéo plein écran', '1053 × 702', 'video_component.html?anchor=component', 1053, 702],
];
const state = { ixDir: 'a', ixTab: 'chaos', ixRole: 'viewer', ixScenario: 'normal', ixOpen: '' };
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
  const params = new URLSearchParams({ labModules: 'effets', demoModule: 'effets_live' });
  for (const [k, v] of Object.entries(state)) if (v) params.set(k, v);
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
  if (b.dataset.v === 'regie') state.ixRole = 'mod';
  draw();
});
scen.addEventListener('change', () => { state.ixScenario = scen.value; draw(); });
open.addEventListener('change', () => { state.ixOpen = open.value; if (open.value) state.ixTab = 'chaos'; draw(); });
draw();
