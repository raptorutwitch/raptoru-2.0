// Stylesheets of the v2 shell, inserted in ONE canonical order whatever the loading order (a module sheet loaded on
// demand lands at its legacy position, so the cascade between sheets is the legacy one).
export const V2_ORDER = [
  'app/css/tokens.css',
  'app/css/tokens-fonts.css',
  'app/css/shell-base.css',
  'app/css/shell-video.css',
  'app/css/shell-panel.css',
  'app/css/picker.css',
  'modules/bonk/bonk-chargeur.css',
  'modules/soundboard/soundboard.css',
  'app/css/currency-switch.css',
  'modules/hub/hub.css',
  'modules/events/events.css',
  'modules/tts/tts.css',
  'modules/moderation/moderation.css',
  'modules/commands/commands.css',
  'modules/tombola/tombola.css',
  'app/css/targets.css',
];

const loaded = new Map();

/** Loads the sheets (once each) at their canonical place; resolves when all are applied (or failed). */
export function loadStyles(hrefs, order = V2_ORDER) {
  return Promise.all(hrefs.map((href) => {
    if (loaded.has(href)) return loaded.get(href);
    const rank = order.indexOf(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.rank = String(rank);
    // Before the first loaded sheet of a higher rank; else before any page sheet (calibration HUD stays last).
    const next = [...document.head.querySelectorAll('link[rel="stylesheet"]')]
      .find((l) => (l.dataset.rank === undefined ? true : Number(l.dataset.rank) > rank));
    const p = new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; });
    document.head.insertBefore(link, next ?? null);
    loaded.set(href, p);
    return p;
  }));
}
