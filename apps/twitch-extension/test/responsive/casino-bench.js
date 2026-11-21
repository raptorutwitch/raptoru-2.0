// The Casino test bench (served by casino-bench.mjs). Two modes:
//  - « Extension complète » (default): the extension's REAL pages (video_component.html, panel.html, mobile.html) in
//    demo mode — Raptoru Live's header, the Mini-jeux module, its ‹ and the fictitious balance — playing against the
//    casino demo's local Core (casino-demo/local-core.js: the Core's own game engines, fictitious Jetons, no network).
//    The demo strip below drives it (next result, simulated players, balance) through the frame's window.__casinoDemo.
//  - « Jeu isolé »: one game screen alone, fed frozen fixture states (casino-harness.js) — for debugging a state; NOT
//    the extension's real space (no header, the whole frame is the game).
/* global document, window, URLSearchParams */
const GAMES = {
  blackjack: { label: 'Blackjack', tile: 'casino_blackjack' },
  slot: { label: 'Machine à fruits', tile: 'casino_slot' },
  book: { label: 'Machine à émotes', tile: 'casino_book' },
  roulette: { label: 'Roulette', tile: 'casino_roulette' },
};
const FROZEN = {
  blackjack: [
    'empty',
    'several',
    'full',
    'myTurn',
    'blackjackHand',
    'split2',
    'splitMixed',
    'dealerBlackjack',
    'spectator',
  ],
  slot: ['resting', 'lineWin', 'bigWin', 'loss', 'error'],
  book: ['resting', 'lineWin', 'bigWin', 'loss', 'error'],
  roulette: ['red7', 'black22', 'loss'],
};
const BJ_OPEN = {
  Règles: 'rules',
  'Historique — Cette table': 'hist',
  'Historique — Mes manches': 'histmine',
};
const SURFACES = {
  video: {
    label: 'Composant vidéo (PC)',
    page: 'video_component.html?anchor=component',
  },
  panel: { label: 'Panneau sous le stream', page: 'panel.html?anchor=panel' },
  mobile: {
    label: 'Mobile (application Twitch)',
    page: 'mobile.html?anchor=panel&platform=mobile',
  },
};
// [label, w, h] per surface — width AND real height (the frame Twitch gives the extension).
const SIZES = {
  video: [
    ['75 % — référence (651×434)', 651, 434],
    ['65 % — réglage de la chaîne (565×376)', 565, 376],
    ['zoom navigateur 125 % (452×301)', 452, 301],
    ['zoom navigateur 150 % (377×251)', 377, 251],
    ['3:2 (750×500)', 750, 500],
    ['mode théâtre 1080p (867×578)', 867, 578],
    ['plein écran 1080p (1053×702)', 1053, 702],
  ],
  panel: [
    ['panel (318×496)', 318, 496],
    ['panel court (318×300)', 318, 300],
    ['pop-out (400×700)', 400, 700],
  ],
  mobile: [
    ['téléphone standard (390×844)', 390, 844],
    ['petit téléphone (360×780)', 360, 780],
    ['grand téléphone (430×932)', 430, 932],
    ['sous la vidéo, estimé (390×560)', 390, 560],
    ['paysage (844×390)', 844, 390],
  ],
};
const NEXT_SLOT = [
  ['random', 'aléatoire'],
  ['loss', 'perte'],
  ['line', 'une ligne'],
  ['wild', 'une ligne avec WILD (BONUS pour les émotes)'],
  ['lines', 'plusieurs lignes'],
  ['big', 'gros gain (fruits)'],
  ['bonus', 'BONUS : Coffre / tours gratuits'],
  ['bigbonus', 'tours gratuits avec expansion (émotes)'],
];
const NEXT_BJ = [
  ['random', 'aléatoire'],
  ['pair', 'une paire de 8 (Split)'],
  ['aces', 'deux As (Split d’As)'],
  ['double', '6 + 5 = 11 (Doubler)'],
  ['blackjack', 'Blackjack'],
  ['insurance', 'banque As, blackjack (Assurance)'],
  ['even', 'Blackjack contre un As (gain assuré, Even Money)'],
  ['dealer_bust', 'la banque saute'],
  ['bust', '10 + 6 puis un 10 (Tirer = dépasser 21)'],
  ['many', 'petites cartes (main de 6 cartes ou plus)'],
];

const $ = (id) => document.getElementById(id);
const opt = (sel, value, label) => sel.append(new window.Option(label, value));
for (const [id, g] of Object.entries(GAMES)) opt($('game'), id, g.label);
for (const [id, s] of Object.entries(SURFACES)) opt($('surface'), id, s.label);
for (const [v, l] of NEXT_SLOT) opt($('next-slot'), v, l);
opt($('next-roulette'), 'random', 'aléatoire');
for (let n = 0; n <= 36; n++) opt($('next-roulette'), String(n), String(n));
for (const [v, l] of NEXT_BJ) opt($('next-bj'), v, l);
for (const n of [0, 1, 2, 3, 4, 5, 6, 9])
  opt($('bots'), String(n), n ? `${n}` : 'aucun');

const params = new URLSearchParams(window.location.search);
let mode = params.get('mode') === 'isolated' ? 'isolated' : 'full';
$('game').value = GAMES[params.get('g')] ? params.get('g') : 'blackjack';
$('surface').value = SURFACES[params.get('surface')]
  ? params.get('surface')
  : 'video';
// Seul contre la banque par défaut (retour d'Antoni du 21/11) : les joueurs fictifs s'ajoutent au besoin.
$('bots').value = params.get('bots') ?? '0';

function fillStates() {
  const sel = $('state');
  sel.innerHTML = '';
  for (const id of FROZEN[$('game').value]) opt(sel, id, id);
  if ($('game').value === 'blackjack')
    for (const [label, v] of Object.entries(BJ_OPEN))
      opt(sel, `open:${v}`, `→ ouvrir : ${label}`);
}
function fillSizes() {
  const sel = $('size');
  sel.innerHTML = '';
  // The isolated game has no surface: every format, grouped.
  const groups = mode === 'full' ? [$('surface').value] : Object.keys(SIZES);
  for (const s of groups) {
    const og = document.createElement('optgroup');
    og.label = SURFACES[s].label;
    for (const [label, w, h] of SIZES[s])
      og.append(new window.Option(label, `${w}x${h}`));
    sel.append(og);
  }
}
fillStates();
fillSizes();
if (params.get('s')) $('state').value = params.get('s');
const [pw, ph] = (params.get('sz') ?? $('size').value).split('x').map(Number);
if ([...$('size').options].some((o) => o.value === `${pw}x${ph}`))
  $('size').value = `${pw}x${ph}`;
$('w').value = Number(params.get('w')) || pw;
$('h').value = Number(params.get('h')) || ph;

function src() {
  const game = $('game').value;
  if (mode === 'full')
    return `/casino-v2/${SURFACES[$('surface').value].page}&casinoGame=${GAMES[game].tile}`;
  const raw = $('state').value;
  const [state, open] = raw.startsWith('open:')
    ? ['several', raw.slice(5)]
    : [raw, ''];
  return `/demo/casino-harness.html?game=${game}&state=${state}${open ? `&open=${open}` : ''}`;
}

/** The demo strip: only what the shown game uses; applied to the frame's local Core (again after each reload). */
function demoControls() {
  const game = $('game').value;
  $('demo').hidden = mode !== 'full';
  $('d-slot').hidden = game !== 'slot' && game !== 'book';
  $('d-roulette').hidden = game !== 'roulette';
  $('d-bj').hidden = game !== 'blackjack';
  $('d-bots').hidden = game !== 'blackjack';
}
function applyDemo() {
  const demo = $('frame').contentWindow?.__casinoDemo;
  if (!demo) return false;
  demo.next('slot', $('next-slot').value);
  demo.next('book', $('next-slot').value);
  demo.next('roulette', $('next-roulette').value);
  demo.next('blackjack', $('next-bj').value);
  demo.bots($('bots').value);
  return true;
}
$('frame').addEventListener('load', () => {
  // The local Core is a module of the page: ready a moment after `load`.
  let k = 0;
  const t = window.setInterval(() => {
    if (mode !== 'full' || applyDemo() || ++k > 50) window.clearInterval(t);
  }, 100);
});
for (const id of ['next-slot', 'next-roulette', 'next-bj', 'bots'])
  $(id).addEventListener('change', applyDemo);
$('refill').addEventListener('click', () => {
  $('frame').contentWindow?.__casinoDemo?.balance(50_000);
  $('note').textContent =
    'Solde fictif remis à 50 000 : l’en-tête se met à jour à la prochaine lecture de session (quelques secondes).';
});

function show() {
  const url = src();
  const w = Number($('w').value) || 651;
  const h = Number($('h').value) || 434;
  const frame = $('frame');
  frame.width = w;
  frame.height = h;
  frame.src = url;
  $('open').href = url;
  $('wrap').dataset.size =
    `${w} × ${h}${mode === 'full' ? ` · ${SURFACES[$('surface').value].label}` : ' · jeu isolé'}`;
  $('wrap').dataset.mode = mode;
  $('cap-game').textContent =
    mode === 'full'
      ? `${GAMES[$('game').value].label} — démo interactive`
      : `${GAMES[$('game').value].label} — état figé « ${$('state').value} »`;
  $('cap-size').textContent = `${w} × ${h}`;
  $('mode-full').setAttribute('aria-pressed', String(mode === 'full'));
  $('mode-isolated').setAttribute('aria-pressed', String(mode === 'isolated'));
  $('surface-wrap').hidden = mode !== 'full';
  $('state-wrap').hidden = mode === 'full';
  demoControls();
  $('note').innerHTML =
    mode === 'full'
      ? '<b>Démo locale</b> : la vraie extension (en-tête Raptoru Live, Mini-jeux, ‹ retour, solde) joue contre les moteurs de jeu du Core, exécutés dans cette page avec des Jetons fictifs. Aucun appel au Core, à Twitch ni au Wallet ; recharger remet 50 000 Jetons. Les autres modules du Hub ne sont pas simulés.'
      : '<b>Vue isolée</b> : le jeu seul, sans l’en-tête de Raptoru Live, sur des états figés (test/responsive/casino-fixtures.js). Utile pour déboguer un état précis ; ce n’est PAS la place réelle du jeu dans l’extension.';
  const next = new URLSearchParams({
    mode,
    g: $('game').value,
    surface: $('surface').value,
    s: $('state').value,
    sz: $('size').value,
    w: String(w),
    h: String(h),
    bots: $('bots').value,
  });
  window.history.replaceState(null, '', `?${next}`);
}

const pickSize = () => {
  const [w, h] = $('size').value.split('x');
  $('w').value = w;
  $('h').value = h;
};
const setMode = (m) => {
  mode = m;
  fillSizes();
  pickSize();
  show();
};
$('mode-full').addEventListener('click', () => setMode('full'));
$('mode-isolated').addEventListener('click', () => setMode('isolated'));
$('game').addEventListener('change', () => (fillStates(), show()));
$('surface').addEventListener(
  'change',
  () => (fillSizes(), pickSize(), show()),
);
$('state').addEventListener('change', show);
$('size').addEventListener('change', () => (pickSize(), show()));
$('reload').addEventListener('click', show);
show();
