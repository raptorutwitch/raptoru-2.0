// Comparison page of the two shells (served by compare-shells.mjs): the same page, size, screen and data, legacy on
// the left, v2 on the right. Choices are kept in the address (a reload or a shared link reopens the same comparison).
/* global document, window, URLSearchParams */
const PAGES = {
  video: 'video_component.html?anchor=component',
  panel: 'panel.html?anchor=panel',
  mobile: 'mobile.html?anchor=panel&platform=mobile',
};
// [id, surface, width, height, label] — the sizes of the responsive matrix (test/responsive/matrix.mjs).
const SIZES = [
  ['Composant vidéo', [
    ['v565', 'video', 565, 376, '65 % — réglage de la chaîne (565 × 376)'],
    ['v651', 'video', 651, 434, '75 % — référence artistique (651 × 434)'],
    ['v521', 'video', 521, 347, '60 % (521 × 347)'],
    ['v514', 'video', 514, 342, 'zoom navigateur 110 % (514 × 342)'],
    ['v452', 'video', 452, 301, 'zoom navigateur 125 % (452 × 301)'],
    ['v377', 'video', 377, 251, 'zoom navigateur 150 % (377 × 251)'],
    ['v750', 'video', 750, 500, '3:2 (750 × 500)'],
    ['v867', 'video', 867, 578, 'mode théâtre 1080p (867 × 578)'],
    ['v1053', 'video', 1053, 702, 'plein écran 1080p (1053 × 702)'],
    ['v400', 'video', 400, 500, 'portrait (400 × 500)'],
  ]],
  ['Panel sous le stream', [
    ['p318', 'panel', 318, 496, 'panel (318 × 496)'],
    ['p318c', 'panel', 318, 300, 'panel court (318 × 300)'],
    ['p400', 'panel', 400, 700, 'pop-out (400 × 700)'],
    ['p800', 'panel', 800, 900, 'pop-out large (800 × 900)'],
  ]],
  ['Mobile (application Twitch)', [
    ['m360', 'mobile', 360, 780, 'petit téléphone (360 × 780)'],
    ['m390', 'mobile', 390, 844, 'téléphone standard (390 × 844)'],
    ['m430', 'mobile', 430, 932, 'grand téléphone (430 × 932)'],
    ['m844', 'mobile', 844, 390, 'paysage (844 × 390)'],
  ]],
];
const VIEWS = [
  ['hub', 'Hub'], ['tts', 'TTS'], ['soundboard', 'Soundboard'], ['bonk', 'Bonk'], ['raffle_join', 'Tombola'],
  ['moderation', 'Modération (calibration)'], ['actions', 'Historique'], ['lab_demo', 'Démo Lab (module fictif, v2 seulement)'],
];

const $ = (id) => document.getElementById(id);
const sizeSelect = $('size');
for (const [group, items] of SIZES) {
  const og = document.createElement('optgroup');
  og.label = group;
  for (const [id, , , , label] of items) og.append(new window.Option(label, id));
  sizeSelect.append(og);
}
for (const [id, label] of VIEWS) $('view').append(new window.Option(label, id));

const params = new URLSearchParams(window.location.search);
sizeSelect.value = params.get('s') ?? 'v565';
$('view').value = params.get('m') ?? 'hub';
$('data').value = params.get('d') ?? 'calib';

function src(shell) {
  const size = SIZES.flatMap(([, items]) => items).find(([id]) => id === sizeSelect.value);
  const view = $('view').value;
  let url = `/${$('data').value}-${shell}/${PAGES[size[1]]}`;
  if (view === 'lab_demo') url += '&labModules=1&demoModule=lab_demo';
  else if (view !== 'hub') url += `&demoModule=${view}`;
  return { url, size };
}

function show() {
  const { size } = src('v2');
  for (const shell of ['legacy', 'v2']) {
    const frame = $(shell);
    frame.width = size[2];
    frame.height = size[3];
    frame.src = src(shell).url;
    $(`open-${shell}`).href = src(shell).url;
  }
  const zoom = /zoom navigateur (\d+)/.exec(size[4]);
  $('note').textContent = `${zoom ? `Taille vue par l’extension quand le navigateur est zoomé à ${zoom[1]} % (zoom simulé). ` : ''}`
    + 'Données fictives locales : aucun appel au Core, à Twitch ni au Studio. Les deux cadres partagent les préférences '
    + 'du navigateur (favoris, brouillons, tutoriels vus).';
  const next = new URLSearchParams({ s: sizeSelect.value, m: $('view').value, d: $('data').value });
  window.history.replaceState(null, '', `?${next}`);
}

for (const id of ['size', 'view', 'data']) $(id).addEventListener('change', show);
$('reload').addEventListener('click', show);
show();
