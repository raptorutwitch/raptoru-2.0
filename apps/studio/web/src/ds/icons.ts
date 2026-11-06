// Une seule famille d'icônes : 24 × 24, trait fin, sans remplissage (sauf lecture). Décoratives : le libellé est écrit à côté, ou
// porté par aria-label sur le bouton.
const I = {
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  ban: '<circle cx="12" cy="12" r="8.4"/><path d="M6 6l12 12"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.6 2H4.4z"/><path d="M10 21h4"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7v5.4l3.4 2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  coin: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.5v9M9.5 9.8c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2-1 1.8-2.5 2.2-2.5 1-2.5 2.2 1.1 2 2.5 2 2.5-.8 2.5-2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  crown: '<path d="M4 8l4 4 4-7 4 7 4-4-1.6 10H5.6z"/>',
  dice: '<path d="M5 5h14v14H5zM9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  ext: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
  film: '<path d="M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  flask:
    '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.2"/><path d="M4 13h16M12 9v11M12 9S10 4 7.6 4.8 8 9 12 9zM12 9s2-5 4.4-4.2S16 9 12 9z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>',
  hand: '<path d="M8 12V6a1.5 1.5 0 0 1 3 0v4M11 10V4.5a1.5 1.5 0 0 1 3 0V10M14 10V6a1.5 1.5 0 0 1 3 0v8a6.5 6.5 0 0 1-12 3.4L3 14a1.6 1.6 0 0 1 2.6-1.8L8 14.5"/>',
  hist: '<path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4.4l3 1.8"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  image:
    '<rect x="3.5" y="5" width="17" height="14" rx="1.6"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 3.5 2.6L16 12l4.5 4"/>',
  info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5M12 8v.4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  level: '<path d="M4 18 10 12l4 4 6-8M14 8h6v6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  live: '<circle cx="12" cy="12" r="2.4"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.4 10.4 0 0 0 0 14.8M19.4 4.6a10.4 10.4 0 0 1 0 14.8"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  minus: '<path d="M5 12h14"/>',
  mod: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3ZM9 12l2 2 4-4"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  music:
    '<path d="M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"/>',
  note: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8.5 9h7M8.5 13h4"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  pumpkin:
    '<path d="M12 7c-5 0-8 3-8 7s3 6 8 6 8-2 8-6-3-7-8-7Zm0 0V4M12 7c-2 0-3 3-3 6.5S10 20 12 20s3-3 3-6.5S14 7 12 7Z"/>',
  puzzle:
    '<path d="M5 8h3a2 2 0 1 1 4 0h3v3a2 2 0 1 1 0 4v3h-3a2 2 0 1 0-4 0H5v-3a2 2 0 1 0 0-4z"/>',
  refund: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  repeat:
    '<path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M16 16l4.5 4.5"/>',
  settings:
    '<path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19 12l2-1.2-2-3.5-2.3.6a7 7 0 0 0-1.6-.9L14.5 4h-5L9 6.9a7 7 0 0 0-1.6.9l-2.3-.6-2 3.5L5 12l-2 1.2 2 3.5 2.3-.6c.5.4 1 .7 1.6.9l.6 3h5l.6-3c.6-.2 1.1-.5 1.6-.9l2.3.6 2-3.5z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/>',
  shop: '<path d="M5 8h14l-1 12H6L5 8Zm4 0a3 3 0 0 1 6 0"/>',
  skip: '<path d="M6 5v14l10-7z" fill="currentColor"/><path d="M18 5v14" stroke-width="2.4"/>',
  sliders:
    '<path d="M5 4v6M5 14v6M12 4v2M12 10v10M19 4v9M19 17v3"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="19" cy="15" r="2"/>',
  sound:
    '<path d="M4 10v4h4l5 4V6L8 10H4Zm12-1.5a4 4 0 0 1 0 7M18.5 6a7.5 7.5 0 0 1 0 12"/>',
  sparkle:
    '<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z"/>',
  star: '<path d="M12 4l2.5 5.2 5.6.8-4 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4-4 5.6-.8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
  terminal: '<path d="M4 5h16v14H4zM7 9l3 3-3 3M12 15h5"/>',
  ticket:
    '<path d="M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.4a1.8 1.8 0 0 0 0 3.2V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.4a1.8 1.8 0 0 0 0-3.2z"/><path d="M14 7v10" stroke-dasharray="2 2.4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
  trophy:
    '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Zm-3 1h3v3a3 3 0 0 1-3-3Zm11 0h3a3 3 0 0 1-3 3M10 14h4v3h3v3H7v-3h3z"/>',
  upload: '<path d="M12 16V5M7.5 9L12 4.5 16.5 9M5 19.5h14"/>',
  user: '<path d="M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 20c1-4 4-6 8-6s7 2 8 6"/>',
  users:
    '<circle cx="9" cy="8" r="3.4"/><path d="M3 20c.5-3.8 2.8-5.6 6-5.6s5.5 1.8 6 5.6"/><path d="M15.5 5a3.3 3.3 0 0 1 0 6.3M17.5 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  vol: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  warn: '<path d="M12 4 2.8 20h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  wave: '<path d="M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4"/>',
  wheel:
    '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
} as const;

export type IcName = keyof typeof I;
export const ic = (n: IcName, cls = '') =>
  `<svg class="d-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${I[n]}</svg>`;
