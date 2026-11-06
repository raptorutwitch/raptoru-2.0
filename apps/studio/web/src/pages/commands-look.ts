// L'apparence d'une commande ou d'une catégorie : le streamer choisit un nom d'icône et une couleur, le Core les garde et
// l'extension les dessine sous les mêmes noms (shared/commands-v2-icons.js). Ces noms sont donc un contrat : on n'en retire aucun.

const LOOK: Record<string, string> = {
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  heart:
    '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  sound:
    '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  duck: '<path d="M8 13a4 4 0 1 1 6-3.5V11h3l3-2v3a7 7 0 0 1-7 7H8a4 4 0 0 1-4-4z"/><circle cx="11" cy="8" r=".8"/>',
  music:
    '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4M12 7.5v1.5M12 15.5V17"/>',
  ticket:
    '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2.5"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M3 12h18M12 8v13M12 8c-2-4-6-4-6-1.5S10 8 12 8c2 0 6 1 6-1.5S14 4 12 8"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>',
  sword:
    '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  game: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10v5M4.5 12.5h5"/><circle cx="16" cy="11.5" r=".9"/><circle cx="18.5" cy="14" r=".9"/>',
  sparkles:
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  fire: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-3-2 2-3 4.5-3 7a6 6 0 0 0 6 6z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.6-1.5L8 15"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  scene:
    '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  scissors:
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.6 7.7 20 18M8.6 16.3 20 6"/>',
  megaphone: '<path d="M3 10v4l11 5V5zM14 8a4 4 0 0 1 0 8M6 15l1 5h3l-1-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  gavel: '<path d="m14 4 6 6M11 7l6 6M9 9l6-6 6 6-6 6zM12 12l-8 8"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.7c0 1.8-2.4 2.1-2.4 3.8M12 17v.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  tv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m9 2 3 4 3-4"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  cards:
    '<rect x="3" y="5" width="12" height="16" rx="2"/><path d="M15 7.5 19 9a2 2 0 0 1 1.2 2.5L17 20"/>',
  crystal:
    '<circle cx="12" cy="10" r="7"/><path d="M6 21h12M8 17.5 7 21M16 17.5l1 4"/>',
  wand: '<path d="m4 20 12-12M14 4l1.5 1.5M18.5 8.5 20 10M14 9l1-1"/><path d="M18 2v3M16.5 3.5h3"/>',
  folder:
    '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
};

export const ICONS = Object.keys(LOOK).filter((k) => k !== 'cube');
export const COLORS = [
  '#a855f7',
  '#ec4899',
  '#f59e0b',
  '#f2c65f',
  '#10b981',
  '#2fd8c4',
  '#06b6d4',
  '#3b82f6',
  '#ef4444',
  '#94a3b8',
];

export const lookIc = (name: string) =>
  `<svg class="d-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${LOOK[name] ?? LOOK.cube}</svg>`;
