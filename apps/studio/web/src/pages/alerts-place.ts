// Alertes : le placement et le réglage d'une variante, partie pure. Tout se compte en pixels de la scène 1920 × 1080, jamais en
// pixels de la fenêtre. Même schéma que le serveur (apps/studio/server/src/alerts/placement-store.ts) et le moteur partagé :
// `media` = translate(x, y) scale(s) de toute l'alerte depuis le coin haut gauche de la source OBS, `text` = la même chose à
// l'intérieur de l'alerte, `parts` = des blocs de texte placés seuls, agrandis autour de leur centre (Bits : badge et phrase).
// `look` = ce que la variante change à son style : temps, transitions, couleur, phrase, volume. Sans DOM, sans fetch.

export interface Place {
  x: number;
  y: number;
  scale: number;
}
export interface Transition {
  kind: string;
  ms: number;
}
export interface VariantLook {
  showAt?: number;
  hideAt?: number;
  subtitles?: { showAt?: number; hideAt?: number; text?: string }[];
  text?: string;
  textEnter?: Transition;
  textExit?: Transition;
  mediaEnter?: Transition;
  mediaExit?: Transition;
  nameColor?: string;
  volume?: number;
}
export interface VariantPlacement {
  media: Place;
  text: Place;
  parts?: Record<string, Place>;
  look?: VariantLook;
}
/** 'media', 'text', ou l'identifiant d'un bloc de texte (`data-part` dans le moteur). */
export type CalibElement = string;
/** Une boîte en pixels de scène, telle qu'elle est dessinée. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export const STAGE = { w: 1920, h: 1080 };
export const SCALE_RANGE = { min: 0.1, max: 5 };
/** Le repère d'accroche s'enclenche à cette distance (pixels de scène). */
export const SNAP = 14;

/** Les blocs de texte qu'une variante peut placer seuls, par style de texte (Bits seulement). */
export const TEXT_PARTS: Record<string, { id: string; label: string }[]> = {
  'pseudo-bits': [
    { id: 'bitsBadge', label: 'Badge Bits' },
    { id: 'bitsMessage', label: 'Phrase' },
  ],
};

export const identity = (): VariantPlacement => ({
  media: { x: 0, y: 0, scale: 1 },
  text: { x: 0, y: 0, scale: 1 },
});
const ONE: Place = { x: 0, y: 0, scale: 1 };

const round = (v: number, d: number) => Math.round(v * d) / d;
const tidy = (p: Place): Place => ({
  x: round(p.x, 100),
  y: round(p.y, 100),
  scale: round(p.scale, 10_000),
});
const clampScale = (s: number) =>
  Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, s));
const same = (a: Place, b: Place) =>
  a.x === b.x && a.y === b.y && a.scale === b.scale;

/** La place d'un élément (un bloc jamais placé = où la mise en page le met). */
export const placeOf = (p: VariantPlacement, el: CalibElement): Place =>
  el === 'media' ? p.media : el === 'text' ? p.text : (p.parts?.[el] ?? ONE);

const withPlace = (
  p: VariantPlacement,
  el: CalibElement,
  place: Place,
): VariantPlacement => {
  if (el === 'media' || el === 'text') return { ...p, [el]: tidy(place) };
  const parts = { ...p.parts, [el]: tidy(place) };
  if (same(parts[el]!, ONE)) delete parts[el];
  const rest = { ...p };
  delete rest.parts;
  return Object.keys(parts).length ? { ...rest, parts } : rest;
};

export const samePlacement = (a: VariantPlacement, b: VariantPlacement) =>
  same(a.media, b.media) &&
  same(a.text, b.text) &&
  [
    ...new Set([...Object.keys(a.parts ?? {}), ...Object.keys(b.parts ?? {})]),
  ].every((k) => same(placeOf(a, k), placeOf(b, k))) &&
  JSON.stringify(a.look ?? {}) === JSON.stringify(b.look ?? {});

/** Où les coordonnées du parent d'un élément sont dessinées (alerte → calque de texte → bloc). */
function parentOf(p: VariantPlacement, el: CalibElement) {
  if (el === 'media') return { x: 0, y: 0, k: 1 };
  if (el === 'text') return { x: p.media.x, y: p.media.y, k: p.media.scale };
  return {
    x: p.media.x + p.media.scale * p.text.x,
    y: p.media.y + p.media.scale * p.text.y,
    k: p.media.scale * p.text.scale,
  };
}

/** Déplace un élément de (dx, dy) tels que VUS sur la scène (les calques intérieurs vivent dans des calques agrandis). */
export function moveBy(
  p: VariantPlacement,
  el: CalibElement,
  dx: number,
  dy: number,
): VariantPlacement {
  const { k } = parentOf(p, el);
  const cur = placeOf(p, el);
  return withPlace(p, el, { ...cur, x: cur.x + dx / k, y: cur.y + dy / k });
}

/**
 * Agrandit un élément de `ratio` autour d'un point fixe de la scène (le coin opposé quand on tire une poignée, le centre de la
 * boîte quand on saisit l'échelle). Proportions gardées. Un bloc s'agrandit autour de son centre (`box`).
 */
export function scaleAbout(
  p: VariantPlacement,
  el: CalibElement,
  anchor: { x: number; y: number },
  ratio: number,
  box?: Box,
): VariantPlacement {
  const cur = placeOf(p, el);
  const scale = clampScale(cur.scale * ratio);
  const r = scale / cur.scale;
  const parent = parentOf(p, el);
  const a = {
    x: (anchor.x - parent.x) / parent.k,
    y: (anchor.y - parent.y) / parent.k,
  };
  const o =
    el === 'media' || el === 'text' || !box
      ? { x: 0, y: 0 }
      : {
          x: (box.x + box.w / 2 - parent.x) / parent.k - cur.x,
          y: (box.y + box.h / 2 - parent.y) / parent.k - cur.y,
        };
  return withPlace(p, el, {
    x: a.x - o.x + r * (o.x + cur.x - a.x),
    y: a.y - o.y + r * (o.y + cur.y - a.y),
    scale,
  });
}

const corners = (b: Box) => ({
  nw: { x: b.x, y: b.y },
  ne: { x: b.x + b.w, y: b.y },
  sw: { x: b.x, y: b.y + b.h },
  se: { x: b.x + b.w, y: b.y + b.h },
});
const OPPOSITE: Record<Corner, Corner> = {
  nw: 'se',
  ne: 'sw',
  sw: 'ne',
  se: 'nw',
};

/** Une poignée tirée de (dx, dy) pixels de scène : le rapport le long de la diagonale, autour du coin opposé. */
export function resizeFromCorner(
  p: VariantPlacement,
  el: CalibElement,
  box: Box,
  corner: Corner,
  dx: number,
  dy: number,
): VariantPlacement {
  const c = corners(box);
  const anchor = c[OPPOSITE[corner]];
  const dX = c[corner].x - anchor.x;
  const dY = c[corner].y - anchor.y;
  const len = dX * dX + dY * dY;
  if (!len) return p;
  const ratio = Math.max(
    0.02,
    ((c[corner].x + dx - anchor.x) * dX + (c[corner].y + dy - anchor.y) * dY) /
      len,
  );
  return scaleAbout(p, el, anchor, ratio, box);
}

/** Champs saisis : X / Y = le coin haut gauche de la boîte sur la scène, échelle en % autour du centre de la boîte. */
export function setField(
  p: VariantPlacement,
  el: CalibElement,
  box: Box,
  field: 'x' | 'y' | 'scale',
  value: number,
): VariantPlacement {
  if (!Number.isFinite(value)) return p;
  if (field === 'x') return moveBy(p, el, value - box.x, 0);
  if (field === 'y') return moveBy(p, el, 0, value - box.y);
  const target = clampScale(value / 100);
  return scaleAbout(
    p,
    el,
    { x: box.x + box.w / 2, y: box.y + box.h / 2 },
    target / placeOf(p, el).scale,
    box,
  );
}

/** Au clavier : 10 px par flèche, 1 px avec Maj. */
export function nudge(
  p: VariantPlacement,
  el: CalibElement,
  key: string,
  fine: boolean,
): VariantPlacement | null {
  const step = fine ? 1 : 10;
  const d: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const v = d[key];
  return v ? moveBy(p, el, v[0], v[1]) : null;
}

/**
 * Repères d'accroche : les bords et le centre de la boîte déplacée s'accrochent aux bords et au centre de la source. Renvoie le
 * déplacement corrigé et les repères à montrer.
 */
export function snapMove(box: Box, dx: number, dy: number) {
  const fit = (start: number, size: number, d: number, stage: number) => {
    let best: { shift: number; line: number } | null = null;
    for (const line of [0, stage / 2, stage])
      for (const at of [start + d, start + d + size / 2, start + d + size]) {
        const shift = line - at;
        if (
          Math.abs(shift) <= SNAP &&
          (!best || Math.abs(shift) < Math.abs(best.shift))
        )
          best = { shift, line };
      }
    return best;
  };
  const sx = fit(box.x, box.w, dx, STAGE.w);
  const sy = fit(box.y, box.h, dy, STAGE.h);
  return {
    dx: dx + (sx?.shift ?? 0),
    dy: dy + (sy?.shift ?? 0),
    v: sx?.line ?? null,
    h: sy?.line ?? null,
  };
}

/** L'instant où une variante montre ses textes (d'après les repères de la timeline). */
export function textInstant(marks: { at: number; action: string }[]) {
  const show = marks.find(
    (m) => m.action === 'text-show' || m.action === 'subtitle-show',
  );
  if (!show) return null;
  const end = marks.find((m) => m.at > show.at);
  return Math.round(
    show.at + Math.min(900, ((end?.at ?? show.at + 1200) - show.at) / 2),
  );
}
