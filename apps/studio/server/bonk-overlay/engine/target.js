// Bonk VNext lot 1 — target zone and impact point (audit §6). The target is a rectangle of the
// 1920 × 1080 canvas: fixed in this lot (Manuel / Fullscreen in lot 2, Auto OBS in lot 3).
// Impacts land mostly on the rim and around the target; the centre stays rare (3 %).

export const CANVAS = Object.freeze({ width: 1920, height: 1080 });
/** Default target: 480 × 300 centred on the former fixed impact point (960, 400). */
export const DEFAULT_TARGET = Object.freeze({ x: 720, y: 250, w: 480, h: 300 });
const MARGIN = 40;

export const IMPACT_CATEGORIES = Object.freeze([
  ['rim', 0.45],
  ['traverse', 0.22],
  ['graze', 0.15],
  ['offset', 0.15],
  ['center', 0.03],
]);
/** Central core of the target (fraction of each side, around the centre). */
export const CORE = 0.15;
const NORMALS = {
  top: [0, -1],
  bottom: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

const between = (random, min, max) => min + random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function pickWeighted(random, entries) {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = random() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r < 0) return value;
  }
  return entries.at(-1)[0];
}

/**
 * Edge of the target, by length, favouring the edges that face where the projectile comes from
 * (`facing`: edges seen from the entry side) so that a rim impact is plausible.
 */
function pickEdge(random, rect, facing) {
  const weight = (edge) => {
    const length = edge === 'top' || edge === 'bottom' ? rect.w : rect.h;
    if (facing.includes(edge)) return length * 3;
    if (facing.some((f) => OPPOSITE[f] === edge)) return length * 0.35;
    return length;
  };
  return pickWeighted(
    random,
    ['top', 'bottom', 'left', 'right'].map((e) => [e, weight(e)]),
  );
}

/** Point on `edge` at `along` (0..1 of its length), `out` px along its outward normal. */
function edgePoint(rect, edge, along, out) {
  const [nx, ny] = NORMALS[edge];
  const x =
    edge === 'left'
      ? rect.x
      : edge === 'right'
        ? rect.x + rect.w
        : rect.x + rect.w * along;
  const y =
    edge === 'top'
      ? rect.y
      : edge === 'bottom'
        ? rect.y + rect.h
        : rect.y + rect.h * along;
  return { x: x + nx * out, y: y + ny * out, nx, ny };
}

export function inCore(rect, x, y) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return Math.abs(x - cx) < CORE * rect.w && Math.abs(y - cy) < CORE * rect.h;
}

function samplePoint(random, rect, category, edge) {
  const m = Math.min(rect.w, rect.h);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  if (category === 'rim')
    return edgePoint(
      rect,
      edge,
      between(random, 0.08, 0.92),
      between(random, -0.12, 0.12) * m,
    );
  if (category === 'graze')
    return edgePoint(
      rect,
      edge,
      between(random, 0.05, 0.95),
      between(random, 0.12, 0.22) * m,
    );
  if (category === 'offset')
    return edgePoint(
      rect,
      edge,
      between(random, -0.1, 1.1),
      between(random, 0.22, 0.4) * m,
    );
  let x;
  let y;
  if (category === 'center') {
    x = cx + between(random, -CORE, CORE) * rect.w;
    y = cy + between(random, -CORE, CORE) * rect.h;
  } else {
    // Traverse: inside the target, outside its central core.
    for (let i = 0; i < 6; i++) {
      x = rect.x + rect.w * between(random, 0.1, 0.9);
      y = rect.y + rect.h * between(random, 0.1, 0.9);
      if (!inCore(rect, x, y)) break;
    }
    if (inCore(rect, x, y))
      x =
        cx +
        (random() < 0.5 ? -1 : 1) * between(random, CORE + 0.02, 0.4) * rect.w;
  }
  const d = Math.hypot(x - cx, y - cy) || 1;
  return { x, y, nx: (x - cx) / d, ny: (y - cy) / d };
}

/**
 * Impact point for one projectile. `recent`: the last impacts of the scene ({x, y}); a point closer
 * than half a size to one of them is drawn again (twice at most), then kept.
 */
export function pickImpact(
  random,
  { rect = DEFAULT_TARGET, facing = ['top'], size = 140, recent = [] } = {},
) {
  const category = pickWeighted(random, IMPACT_CATEGORIES);
  const edge = pickEdge(random, rect, facing);
  let point;
  for (let attempt = 0; attempt < 3; attempt++) {
    point = samplePoint(random, rect, category, edge);
    point.x = clamp(point.x, MARGIN, CANVAS.width - MARGIN);
    point.y = clamp(point.y, MARGIN, CANVAS.height - MARGIN);
    const crowded = recent.some(
      (r) => Math.hypot(r.x - point.x, r.y - point.y) < size / 2,
    );
    if (!crowded) break;
  }
  return { ...point, category, edge };
}
