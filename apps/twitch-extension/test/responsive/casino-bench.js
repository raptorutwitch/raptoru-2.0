// Picker for the Casino responsive bench (served by casino-bench.mjs). Manual, visual — overflow/crop detection and
// screenshots are the batch script's job (casino-matrix.mjs), same split as compare-shells.html / matrix.mjs.
/* global document, window, URLSearchParams */
const GAMES = {
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
  '(aucun)': '',
  Règles: 'rules',
  'Historique — Cette table': 'hist',
  'Historique — Mes manches': 'histmine',
};
// [label, w, h] — the sizes test/responsive/matrix.mjs already measures, plus the Lot B mandate's explicit asks.
const SIZES = [
  ['très petite (zoom 150 %, 377×251)', 377, 251],
  ['compacte (zoom 125 %, 452×301)', 452, 301],
  ['panel court (318×300)', 318, 300],
  ['panel (318×496)', 318, 496],
  ['standard — référence (651×434)', 651, 434],
  ['3:2 (750×500)', 750, 500],
  ['large — théâtre 1080p (867×578)', 867, 578],
  ['plein écran 1080p (1053×702)', 1053, 702],
  ['portrait (400×500)', 400, 500],
  ['mobile petit (360×780)', 360, 780],
  ['mobile standard (390×844)', 390, 844],
  ['mobile paysage (844×390)', 844, 390],
];

const $ = (id) => document.getElementById(id);
for (const id of Object.keys(GAMES))
  $('game').append(new window.Option(id, id));
for (const [label, w, h] of SIZES)
  $('size').append(new window.Option(label, `${w}x${h}`));

function fillStates() {
  const sel = $('state');
  sel.innerHTML = '';
  for (const id of GAMES[$('game').value])
    sel.append(new window.Option(id, id));
  if ($('game').value === 'blackjack')
    for (const [label, v] of Object.entries(BJ_OPEN))
      sel.append(new window.Option(`→ ouvrir : ${label}`, `open:${v}`));
}

const params = new URLSearchParams(window.location.search);
$('game').value = params.get('g') ?? 'blackjack';
fillStates();
$('state').value = params.get('s') ?? 'several';
const [pw, ph] = (params.get('sz') ?? '651x434').split('x').map(Number);
$('size').value = `${pw}x${ph}`;
$('w').value = Number(params.get('w')) || pw;
$('h').value = Number(params.get('h')) || ph;

function src() {
  const game = $('game').value;
  const raw = $('state').value;
  const [state, open] = raw.startsWith('open:')
    ? ['several', raw.slice(5)]
    : [raw, ''];
  const w = Number($('w').value) || 651;
  const h = Number($('h').value) || 434;
  const url = `/demo/casino-harness.html?game=${game}&state=${state}${open ? `&open=${open}` : ''}`;
  return { url, w, h };
}

function show() {
  const { url, w, h } = src();
  const frame = $('frame');
  frame.width = w;
  frame.height = h;
  frame.src = url;
  $('open').href = url;
  $('wrap').dataset.size = `${w} × ${h}`;
  $('cap-game').textContent = `${$('game').value} — ${$('state').value}`;
  $('cap-size').textContent = `${w} × ${h}`;
  $('note').textContent =
    'Données fictives locales (test/responsive/casino-fixtures.js) : aucun appel au Core, à Twitch ni au Studio, aucun débit réel.';
  const next = new URLSearchParams({
    g: $('game').value,
    s: $('state').value,
    sz: $('size').value,
    w: String(w),
    h: String(h),
  });
  window.history.replaceState(null, '', `?${next}`);
}

$('game').addEventListener('change', () => (fillStates(), show()));
$('state').addEventListener('change', show);
$('size').addEventListener('change', () => {
  const [w, h] = $('size').value.split('x');
  $('w').value = w;
  $('h').value = h;
  show();
});
$('reload').addEventListener('click', show);
show();
