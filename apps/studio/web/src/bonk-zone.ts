// Bonk VNext lot 2 — geometry of the zone editor (pure). A zone is a fraction of the 1920 × 1080
// canvas; dragging moves it or one of its edges/corners, never out of the canvas nor under the
// minimum size, and snaps to the canvas edges.

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const CANVAS = { width: 1920, height: 1080 } as const;
/** Smallest side (fraction of the canvas side): same rule as the Studio server. */
export const MIN_ZONE = 0.05;
/** Snap distance to the canvas edges (fraction). */
export const SNAP = 0.01;
export const DEFAULT_ZONE: Zone = {
  x: 720 / CANVAS.width,
  y: 250 / CANVAS.height,
  w: 480 / CANVAS.width,
  h: 300 / CANVAS.height,
};

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** One axis: [start, end] after moving `delta` with the edges named by `low` / `high`. */
function axis(
  start: number,
  size: number,
  delta: number,
  low: boolean,
  high: boolean,
): [number, number] {
  let a = start;
  let b = start + size;
  if (low && high) {
    a = clamp(start + delta, 0, 1 - size);
    if (a < SNAP) a = 0;
    if (1 - (a + size) < SNAP) a = 1 - size;
    return [a, a + size];
  }
  if (low) {
    a = clamp(start + delta, 0, b - MIN_ZONE);
    if (a < SNAP) a = 0;
  }
  if (high) {
    b = clamp(start + size + delta, a + MIN_ZONE, 1);
    if (1 - b < SNAP) b = 1;
  }
  return [a, b];
}

/** The zone after dragging `handle` by (dx, dy) canvas fractions from `start`. */
export function dragZone(
  start: Zone,
  handle: Handle,
  dx: number,
  dy: number,
): Zone {
  const move = handle === 'move';
  const [x0, x1] = axis(
    start.x,
    start.w,
    dx,
    move || handle.includes('w'),
    move || handle.includes('e'),
  );
  const [y0, y1] = axis(
    start.y,
    start.h,
    dy,
    move || handle.includes('n'),
    move || handle.includes('s'),
  );
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function toPixels(z: Zone): Zone {
  return {
    x: Math.round(z.x * CANVAS.width),
    y: Math.round(z.y * CANVAS.height),
    w: Math.round(z.w * CANVAS.width),
    h: Math.round(z.h * CANVAS.height),
  };
}

/** Pixels typed in the fields → a valid zone (kept inside the canvas, minimum size). */
export function fromPixels(p: Zone): Zone {
  const w = clamp(p.w / CANVAS.width, MIN_ZONE, 1);
  const h = clamp(p.h / CANVAS.height, MIN_ZONE, 1);
  return {
    x: clamp(p.x / CANVAS.width, 0, 1 - w),
    y: clamp(p.y / CANVAS.height, 0, 1 - h),
    w,
    h,
  };
}

export function sameZone(a: Zone, b: Zone) {
  const eq = (u: number, v: number) => Math.abs(u - v) < 1e-9;
  return eq(a.x, b.x) && eq(a.y, b.y) && eq(a.w, b.w) && eq(a.h, b.h);
}
