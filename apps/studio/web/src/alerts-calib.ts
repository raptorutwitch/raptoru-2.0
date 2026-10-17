// Twitch alerts — visual calibration (17/10/2026), pure part of the Studio editor: placement math in the 1920×1080
// stage (never in window pixels). Same schema as the server store (apps/studio/server/src/alerts/placement-store.ts)
// and the shared engine: `media` = translate(x, y) scale(s) of the whole animation from the stage's top-left corner,
// `text` = the same, inside the animation; `parts` = text blocks placed on their own inside the text layer, scaled
// around their own centre (bits: badge and sentence). No DOM, no fetch.

export interface Place {
  x: number;
  y: number;
  scale: number;
}
export interface VariantPlacement {
  media: Place;
  text: Place;
  parts?: Record<string, Place>;
}
/** 'media', 'text', or the id of a text block (`data-part` in the engine). */
export type CalibElement = string;
/** A box in stage pixels, as drawn (calibration included). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export const STAGE = { w: 1920, h: 1080 };
export const SCALE_RANGE = { min: 0.1, max: 5 };

/** Text blocks a variant can place on their own, by text style (only bits so far). */
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

/** An element's own place (a block never placed = where the layout puts it). */
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
  const rest: VariantPlacement = { media: p.media, text: p.text };
  return Object.keys(parts).length ? { ...rest, parts } : rest;
};

export const samePlacement = (a: VariantPlacement, b: VariantPlacement) =>
  same(a.media, b.media) &&
  same(a.text, b.text) &&
  [
    ...new Set([...Object.keys(a.parts ?? {}), ...Object.keys(b.parts ?? {})]),
  ].every((k) => same(placeOf(a, k), placeOf(b, k)));

/** Where an element's parent coordinates are drawn on the stage: offset + scale (animation → text layer → block). */
function parentOf(p: VariantPlacement, el: CalibElement) {
  if (el === 'media') return { x: 0, y: 0, k: 1 };
  if (el === 'text') return { x: p.media.x, y: p.media.y, k: p.media.scale };
  return {
    x: p.media.x + p.media.scale * p.text.x,
    y: p.media.y + p.media.scale * p.text.y,
    k: p.media.scale * p.text.scale,
  };
}

/** Moves an element by (dx, dy) as SEEN on the stage (inner layers live inside scaled ones). */
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
 * Scales an element by `ratio` around a stage point that stays still (the opposite corner when a handle is dragged,
 * the box centre when the scale is typed). Uniform: proportions kept. A text block scales around its own centre
 * (CSS transform-origin), found from its drawn `box`.
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
  // The anchor in the element's parent coordinates.
  const a = {
    x: (anchor.x - parent.x) / parent.k,
    y: (anchor.y - parent.y) / parent.k,
  };
  // The transform origin in the same coordinates: 0 for the layers, the block's untransformed centre for a block.
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

/** A corner handle dragged by (dx, dy) stage px: the ratio along the diagonal, around the opposite corner. */
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

/** Typed fields: X / Y = the box's top-left corner on the stage, scale in % (around the box centre). */
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

/** Keyboard nudge: 10 px per arrow, 1 px with Shift (fine). */
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

/** When a variant's texts are on screen (from the timeline marks): an instant to show them for the editor. */
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

/** The numbers shown in the panel for a box. */
export const boxLabel = (b: Box | null) =>
  b
    ? `${Math.round(b.w)} × ${Math.round(b.h)} px à (${Math.round(b.x)}, ${Math.round(b.y)})`
    : 'non visible à cet instant';
