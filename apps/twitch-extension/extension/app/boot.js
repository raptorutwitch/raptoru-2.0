// Entry of every viewer page (video_component.html, panel.html, mobile.html): chooses the shell, loads its
// stylesheets, then its entry module. The page markup (dock/drawer, m-head/m-body, #panel) is shared.
//   legacy (default until the switch, plan lot 5): the historical sheets and overlay.js / mobile.js, unchanged.
//   v2: the new socle (app/), rebuilt sheets, same views.
// Choice: ?shell=legacy|v2 (Lab, bench), else RUNTIME.shell (written by scripts/package.mjs --shell), else legacy.
// The entry module starts once the sheets are loaded. The page is never hidden: if anything here failed, the
// markup and the grey-screen guard of the entry would still show (a hidden body would recreate a grey screen).
import { RUNTIME } from '../shared/runtime-config.js';

const page = /(?:^|\/)(video_component|panel|mobile)\.html$/i.exec(window.location.pathname)?.[1]?.toLowerCase()
  ?? (document.body.classList.contains('overlay') ? 'video_component' : 'mobile');
const asked = new URLSearchParams(window.location.search).get('shell');
export const SHELL = asked === 'v2' || asked === 'legacy' ? asked : RUNTIME.shell === 'v2' ? 'v2' : 'legacy';

// Exact order of the historical <link> tags of each page (legacy shell).
const MODULE_SHEETS = ['picker.css', 'bonk-chargeur.css', 'soundboard.css', 'currency-switch.css', 'hub.css',
  'events-shop.css', 'tts-v2.css', 'moderation-v2.css'];
const LEGACY = {
  video_component: ['base.css', 'overlay.css', ...MODULE_SHEETS, 'commands-v2.css', 'tombola-v2.css'],
  panel: ['base.css', 'mobile.css', ...MODULE_SHEETS, 'tombola-v2.css'],
  mobile: ['base.css', 'mobile.css', ...MODULE_SHEETS, 'commands-v2.css', 'tombola-v2.css'],
};
// v2: what the Hub needs; module sheets come with their view (app/lazy-views.js), at their canonical place.
const V2_HUB = ['app/css/tokens.css', 'app/css/tokens-fonts.css', 'app/css/shell-base.css', 'app/css/currency-switch.css',
  'modules/hub/hub.css', 'modules/events/events.css', 'modules/tombola/tombola.css'];
const V2 = {
  video_component: [...V2_HUB, 'app/css/shell-video.css'],
  panel: [...V2_HUB, 'app/css/shell-panel.css'],
  mobile: [...V2_HUB, 'app/css/shell-panel.css'],
};

function loadSheets(hrefs) {
  // Appended in order before the first page-specific <link> (the calibration HUD sheet stays last).
  const anchor = document.head.querySelector('link[rel="stylesheet"]');
  return Promise.all(hrefs.map((href) => new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = resolve; // a missing sheet must not block the entry (grey-screen rule)
    document.head.insertBefore(link, anchor);
  })));
}

document.documentElement.dataset.shell = SHELL;
if (SHELL === 'v2') {
  const { loadStyles } = await import('./styles.js');
  await loadStyles(V2[page]);
  await import('./v2.js');
} else {
  await loadSheets(LEGACY[page]);
}
if (SHELL === 'v2') { /* started by v2.js */ }
else if (page === 'video_component') await import('../overlay.js');
else await import('../mobile.js');
