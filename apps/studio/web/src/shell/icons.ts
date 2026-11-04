// Icônes linéaires du shell (une seule famille : 24 × 24, trait 1,6, sans remplissage). Décoratives : le libellé est
// toujours écrit à côté, ou porté par aria-label sur le bouton.
import type { IconName } from './registry.js';

const P: Record<IconName, string> = {
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z',
  live: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M8.8 8.8a4.5 4.5 0 0 0 0 6.4M15.2 8.8a4.5 4.5 0 0 1 0 6.4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.7 3 2.3 3.5 5.2',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19 12l2-1.2-2-3.5-2.3.6a7 7 0 0 0-1.6-.9L14.5 4h-5L9 6.9a7 7 0 0 0-1.6.9l-2.3-.6-2 3.5L5 12l-2 1.2 2 3.5 2.3-.6c.5.4 1 .7 1.6.9l.6 3h5l.6-3c.6-.2 1.1-.5 1.6-.9l2.3.6 2-3.5z',
  flask:
    'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M7.5 14h9',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.2-4.2',
  sound:
    'M4 10v4h4l5 4V6L8 10H4Zm12-1.5a4 4 0 0 1 0 7M18.5 6a7.5 7.5 0 0 1 0 12',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4',
  gift: 'M4 9h16v4H4zM5 13h14v7H5zM12 9v11M12 9c-2-4-6-4-6-1.5S10 9 12 9Zm0 0c2-4 6-4 6-1.5S14 9 12 9Z',
  dice: 'M5 5h14v14H5zM9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01',
  sparkle:
    'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z',
  music:
    'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  pumpkin:
    'M12 7c-5 0-8 3-8 7s3 6 8 6 8-2 8-6-3-7-8-7Zm0 0V4M12 7c-2 0-3 3-3 6.5S10 20 12 20s3-3 3-6.5S14 7 12 7Z',
  trophy:
    'M8 4h8v5a4 4 0 0 1-8 0V4Zm-3 1h3v3a3 3 0 0 1-3-3Zm11 0h3a3 3 0 0 1-3 3M10 14h4v3h3v3H7v-3h3z',
  shop: 'M5 8h14l-1 12H6L5 8Zm4 0a3 3 0 0 1 6 0',
  level: 'M4 18 10 12l4 4 6-8M14 8h6v6',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 20c1-4 4-6 8-6s7 2 8 6',
  mod: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3ZM9 12l2 2 4-4',
  puzzle:
    'M5 8h3a2 2 0 1 1 4 0h3v3a2 2 0 1 1 0 4v3h-3a2 2 0 1 0-4 0H5v-3a2 2 0 1 0 0-4z',
  wheel:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M9 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
};

export const icon = (n: IconName, cls = 'rs-ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${P[n]}"/></svg>`;
