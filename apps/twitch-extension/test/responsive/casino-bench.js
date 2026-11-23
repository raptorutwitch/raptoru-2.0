// The Casino test bench (served by casino-bench.mjs). Two modes:
//  - « Extension complète » (default): the extension's REAL pages (video_component.html, panel.html, mobile.html) in
//    demo mode — Raptoru Live's header, the Mini-jeux module, its ‹ and the fictitious balance — playing against the
//    casino demo's local Core (casino-demo/local-core.js: the Core's own game engines, fictitious Jetons, no network).
//    The demo strip below drives it (next result, simulated players, balance) through the frame's window.__casinoDemo.
//  - « Jeu isolé »: one game screen alone, fed frozen fixture states (casino-harness.js) — for debugging a state; NOT
//    the extension's real space (no header, the whole frame is the game).
/* global document, window, URLSearchParams */
const GAMES = {
  // The Hub (TTS, Soundboard, Tombola, Mini-jeux · Random Ban, Bonk…): every module, without opening a game.
  hub: { label: 'Accueil — tous les modules', tile: '' },
  catalogue: { label: 'Mini-jeux — catalogue', tile: 'none' },
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
// Video component (console Twitch « Paramètres de taille des éléments vidéo », 22/11 : hauteur cible 65 % (60 %
// avant), format 3:2, « Dimensions automatiques » désactivées) : the iframe is 3:2 at 65 % of the player's height.
// Measured on Antoni's captures of 22/11 at 60 %: ≈ 520×347 in a normal player (1080p screen, chat open), ≈ 760×507 in
// a big window; × 65/60 here. The normal player is the DEFAULT: what most viewers see. 651×434 is the COMPOSITION
// reference: below it the Casino is scaled down as one block (extension/app/fit.js).
const SIZES = {
  video: [
    ['lecteur normal — par défaut (563×376)', 563, 376],
    ['petit lecteur (490×326)', 490, 326],
    ['très petit lecteur (390×260)', 390, 260],
    ['lecteur normal à 60 %, avant le 22/11 (520×347)', 520, 347],
    ['référence de composition (651×434)', 651, 434],
    ['grande fenêtre / mode théâtre (823×549)', 823, 549],
    ['plein écran 1080p (1141×761)', 1141, 761],
  ],
  panel: [
    ['panel (318×496)', 318, 496],
    ['panel court (318×300)', 318, 300],
    ['pop-out (400×700)', 400, 700],
  ],
  // Twitch app (portrait): the extension only gets the CHAT area below the 16:9 video, the channel bar and the
  // tabs — never the whole screen (23/11: the bench used to give it 390 × 844 and hid every mobile problem). `p` =
  // a phone drawn as the app shows it (the iframe = the area left, it scrolls for real), `l` = landscape with the
  // chat panel open, `f` = landscape full screen (no extension), no letter = the extension area alone.
  mobile: [
    ['Android courant — Pixel 7/8 (393 × 873)', 'p', 393, 873],
    ['petit Android (360 × 780)', 'p', 360, 780],
    ['grand Android (412 × 915)', 'p', 412, 915],
    ['petit écran ancien (360 × 640)', 'p', 360, 640],
    ['iPhone 13/14 (390 × 844)', 'p', 390, 844],
    ['paysage, chat ouvert (873 × 393)', 'l', 873, 393],
    ['paysage plein écran (873 × 393)', 'f', 873, 393],
    ['zone seule, sous la vidéo (393 × 484)', 'z', 393, 484],
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
  ['resplit', 'quatre 8 (Split jusqu’à 4 mains)'],
  ['aces', 'deux As (Split d’As)'],
  ['aces21', 'deux As → 21 puis A + 5'],
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
  for (const id of FROZEN[$('game').value] ?? []) opt(sel, id, id);
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
    for (const row of SIZES[s]) {
      const [label, kind, w, h] =
        row.length === 4 ? row : [row[0], 'z', row[1], row[2]];
      og.append(
        new window.Option(label, `${kind === 'z' ? '' : kind}${w}x${h}`),
      );
    }
    sel.append(og);
  }
}
fillStates();
fillSizes();
if (params.get('s')) $('state').value = params.get('s');
const wanted = params.get('sz') ?? $('size').value;
if ([...$('size').options].some((o) => o.value === wanted))
  $('size').value = wanted;
const [pw, ph] = $('size')
  .value.replace(/^[plf]/, '')
  .split('x')
  .map(Number);
$('w').value = Number(params.get('w')) || pw;
$('h').value = Number(params.get('h')) || ph;

function src() {
  const game = $('game').value;
  if (mode === 'full')
    return `/casino-v2/${SURFACES[$('surface').value].page}${GAMES[game].tile ? `&casinoGame=${GAMES[game].tile}` : ''}${$('fault').value ? `&casinoFault=${$('fault').value}` : ''}`;
  const raw = $('state').value;
  const [state, open] = raw.startsWith('open:')
    ? ['several', raw.slice(5)]
    : [raw, ''];
  if (!FROZEN[game])
    return `/demo/casino-harness.html?game=blackjack&state=several`; // the Hub has no isolated view
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
  $('d-multi').hidden = game !== 'blackjack';
  $('d-sub').hidden = game !== 'blackjack';
}
function applyDemo() {
  const demo = $('frame').contentWindow?.__casinoDemo;
  if (!demo) return false;
  demo.next('slot', $('next-slot').value);
  demo.next('book', $('next-slot').value);
  demo.next('roulette', $('next-roulette').value);
  demo.next('blackjack', $('next-bj').value);
  demo.bots($('bots').value);
  demo.sub?.($('sub').value);
  return true;
}
$('frame').addEventListener('load', () => {
  // The local Core is a module of the page: ready a moment after `load`.
  let k = 0;
  const t = window.setInterval(() => {
    if (mode !== 'full' || applyDemo() || ++k > 50) window.clearInterval(t);
  }, 100);
});
for (const id of ['next-slot', 'next-roulette', 'next-bj', 'bots', 'sub'])
  $(id).addEventListener('change', applyDemo);
// Plusieurs tables, leurs joueurs fictifs, leurs réactions (la politique et le magasin de réactions du Core).
const demo = () => $('frame').contentWindow?.__casinoDemo;
$('bj-table').addEventListener('click', () => {
  const no = demo()?.table(3);
  $('note').textContent = no
    ? `Table ${no} ouverte avec 3 joueurs fictifs : reviens au salon (Tables) pour la voir, la regarder ou la rejoindre.`
    : 'Démo pas encore prête.';
});
$('bj-react').addEventListener('click', () => {
  $('note').textContent = demo()?.react()
    ? 'Un joueur fictif de ta table réagit.'
    : 'Assieds-toi à une table avec au moins un joueur fictif.';
});
$('bj-sweep').addEventListener('click', () => {
  const n = demo()?.sweep() ?? 0;
  const s = n > 1 ? 's' : '';
  $('note').textContent =
    `${n} table${s} vide${s} fermée${s} (le Core le fait après 10 minutes ; la plus petite table reste).`;
});
$('refill').addEventListener('click', () => {
  $('frame').contentWindow?.__casinoDemo?.balance(50_000);
  $('note').textContent =
    'Solde fictif remis à 50 000 : l’en-tête se met à jour à la prochaine lecture de session (quelques secondes).';
});

// Twitch app chrome, in CSS px: estimated from the Android app, not documented by Twitch (docs/CASINO.md § 16.0.1).
const CHROME = { status: 24, channel: 52, tabs: 44, nav: 48, side: 0.42 };
/** Draws the phone around the frame; returns the extension area [w, h] ([0, 0] in landscape full screen), or null. */
function phone(kind, W, H) {
  const box = $('phone');
  box.hidden = !kind;
  if (!kind) return null;
  box.dataset.kind = kind;
  box.style.width = `${W + 20}px`;
  box.style.height = `${H + 20}px`;
  if (kind === 'p') {
    box.style.setProperty('--video-h', `${Math.round((W * 9) / 16)}px`);
    return [
      W,
      H -
        CHROME.status -
        Math.round((W * 9) / 16) -
        CHROME.channel -
        CHROME.tabs -
        CHROME.nav,
    ];
  }
  if (kind === 'l') {
    const side = Math.max(300, Math.round(W * CHROME.side));
    box.style.setProperty('--video-w', `${W - side}px`);
    return [side, H - CHROME.tabs];
  }
  return [0, 0];
}

function show() {
  const url = src();
  const kind =
    mode === 'full' && $('surface').value === 'mobile'
      ? (/^[plf]/.exec($('size').value)?.[0] ?? '')
      : '';
  let w = Number($('w').value) || 563;
  let h = Number($('h').value) || 376;
  const area = phone(kind, w, h);
  const screen = area ? `écran ${w} × ${h} → ` : '';
  if (area) [w, h] = area;
  (area ? $('phone-slot') : $('main-slot')).append($('wrap'));
  $('wrap').classList.toggle('in-phone', !!area);
  const frame = $('frame');
  frame.hidden = !w;
  frame.width = w;
  frame.height = h;
  frame.src = w ? url : 'about:blank';
  $('phone-note').textContent = !area
    ? ''
    : kind === 'f'
      ? 'Plein écran paysage : l’application Twitch n’y affiche pas les extensions (aucun point d’accès documenté). Le viewer quitte le plein écran ou repasse en portrait.'
      : 'Barre d’état, vidéo 16:9, bandeau de chaîne, onglets et barre de navigation : dimensions estimées de l’application Android (non documentées par Twitch). L’extension défile dans sa zone comme dans l’application ; seul un vrai téléphone fait foi.';
  $('open').href = url;
  $('wrap').dataset.size =
    `${screen}${w} × ${h}${mode === 'full' ? ` · ${SURFACES[$('surface').value].label}` : ' · jeu isolé'}`;
  $('wrap').dataset.mode = mode;
  $('cap-game').textContent =
    mode === 'full'
      ? `${GAMES[$('game').value].label} — démo interactive`
      : `${GAMES[$('game').value].label} — état figé « ${$('state').value} »`;
  $('cap-size').textContent = w
    ? `${screen}zone d’extension ${w} × ${h}`
    : `${screen}pas d’extension`;
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
  const [w, h] = $('size')
    .value.replace(/^[plf]/, '')
    .split('x');
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
if (params.get('fault')) $('fault').value = params.get('fault');
$('fault').addEventListener('change', show);
show();
