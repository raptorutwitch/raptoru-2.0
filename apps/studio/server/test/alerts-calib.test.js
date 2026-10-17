import { describe, expect, it } from 'vitest';
import {
  identity,
  moveBy,
  nudge,
  placeOf,
  resizeFromCorner,
  samePlacement,
  scaleAbout,
  setField,
  textInstant,
} from '../../web/src/alerts-calib.ts';

// Twitch alerts — calibration editor math (Studio tab, pure part): everything in 1920×1080 stage pixels, the media
// transform being translate(x, y) scale(s) from the stage's top-left corner and the text one the same inside it.

/** Where a point of the element's own layout is drawn on the stage. */
const drawn = (p, el, pt) => {
  const inMedia =
    el === 'text'
      ? { x: p.text.x + p.text.scale * pt.x, y: p.text.y + p.text.scale * pt.y }
      : pt;
  return {
    x: p.media.x + p.media.scale * inMedia.x,
    y: p.media.y + p.media.scale * inMedia.y,
  };
};
const close = (a, b) => {
  expect(a.x).toBeCloseTo(b.x, 1);
  expect(a.y).toBeCloseTo(b.y, 1);
};

describe('calibration math (stage pixels)', () => {
  it('moves the animation by the drawn delta; the text inside a scaled animation too', () => {
    const p = moveBy(identity(), 'media', 120, -40);
    expect(p.media).toEqual({ x: 120, y: -40, scale: 1 });
    const scaled = { ...identity(), media: { x: 0, y: 0, scale: 0.5 } };
    const t = moveBy(scaled, 'text', 30, 10);
    // 30 px on the stage = 60 px inside an animation drawn at 50 %.
    expect(t.text).toEqual({ x: 60, y: 20, scale: 1 });
    const before = drawn(scaled, 'text', { x: 500, y: 300 });
    close(drawn(t, 'text', { x: 500, y: 300 }), {
      x: before.x + 30,
      y: before.y + 10,
    });
  });

  it('scales uniformly around a fixed point (no distortion, anchor still)', () => {
    const anchor = { x: 960, y: 540 };
    const p = scaleAbout(identity(), 'media', anchor, 0.5);
    expect(p.media.scale).toBe(0.5);
    close(drawn(p, 'media', anchor), anchor);
    // Text inside a moved, scaled animation: its own anchor stays put on the stage too.
    const base = {
      media: { x: 100, y: 50, scale: 0.8 },
      text: { x: 10, y: 0, scale: 1 },
    };
    const a = drawn(base, 'text', { x: 700, y: 120 });
    const t = scaleAbout(base, 'text', a, 1.5);
    expect(t.text.scale).toBe(1.5);
    expect(t.media).toEqual(base.media);
    close(drawn(t, 'text', { x: 700, y: 120 }), a);
  });

  it('a corner handle keeps the opposite corner fixed and the proportions', () => {
    const box = { x: 0, y: 0, w: 1920, h: 1080 };
    const p = resizeFromCorner(identity(), 'media', box, 'se', -960, -540);
    expect(p.media).toEqual({ x: 0, y: 0, scale: 0.5 });
    const q = resizeFromCorner(identity(), 'media', box, 'nw', 192, 108);
    expect(q.media.scale).toBeCloseTo(0.9, 4);
    close(drawn(q, 'media', { x: 1920, y: 1080 }), { x: 1920, y: 1080 });
    // A sideways drag still scales both axes alike (projection on the diagonal).
    const r = resizeFromCorner(identity(), 'media', box, 'se', -400, 0);
    expect(r.media.scale).toBeGreaterThan(0.5);
    expect(r.media.scale).toBeLessThan(1);
  });

  it('typed fields: X / Y place the box corner, scale % around its centre; limits kept', () => {
    const box = { x: 200, y: 100, w: 400, h: 200 };
    expect(setField(identity(), 'media', box, 'x', 260).media.x).toBe(60);
    expect(setField(identity(), 'media', box, 'y', 80).media.y).toBe(-20);
    const s = setField(identity(), 'media', box, 'scale', 50);
    expect(s.media.scale).toBe(0.5);
    close(drawn(s, 'media', { x: 400, y: 200 }), { x: 400, y: 200 });
    expect(setField(identity(), 'media', box, 'scale', 9000).media.scale).toBe(
      5,
    );
    expect(setField(identity(), 'media', box, 'x', NaN)).toEqual(identity());
  });

  it('arrows: 10 px, Shift = 1 px; other keys ignored', () => {
    expect(nudge(identity(), 'media', 'ArrowRight', false).media.x).toBe(10);
    expect(nudge(identity(), 'text', 'ArrowUp', true).text.y).toBe(-1);
    expect(nudge(identity(), 'media', 'a', false)).toBeNull();
  });

  it('unsaved detection and the instant where the texts are shown', () => {
    expect(samePlacement(identity(), identity())).toBe(true);
    expect(samePlacement(identity(), moveBy(identity(), 'text', 1, 0))).toBe(
      false,
    );
    expect(
      textInstant([
        { at: 1600, action: 'text-show' },
        { at: 3700, action: 'text-hide' },
      ]),
    ).toBe(2500);
    expect(textInstant([])).toBeNull();
  });

  it('text blocks (bits badge / sentence): moved inside scaled layers, scaled around their own centre', () => {
    const base = {
      media: { x: 100, y: 0, scale: 0.5 },
      text: { x: 0, y: 0, scale: 2 },
    };
    // Layers: parent scale 0.5 × 2 = 1, so 30 drawn px = 30 px for the block; the other block is untouched.
    const moved = moveBy(base, 'bitsBadge', 30, -12);
    expect(moved.parts).toEqual({ bitsBadge: { x: 30, y: -12, scale: 1 } });
    expect(placeOf(moved, 'bitsMessage')).toEqual({ x: 0, y: 0, scale: 1 });
    // A block drawn at 600,400 (200 × 50): the NW handle pulled in keeps its SE corner on the stage.
    const box = { x: 600, y: 400, w: 200, h: 50 };
    const r = resizeFromCorner(moved, 'bitsBadge', box, 'nw', 100, 25);
    const s = placeOf(r, 'bitsBadge');
    expect(s.scale).toBeCloseTo(0.5, 4);
    // Drawn box after: centre-origin transform → corner = centre_new + s_ratio × (corner - centre_old).
    const centreOld = { x: 700, y: 425 };
    const centreNew = {
      x: centreOld.x + (s.x - 30), // parent scale 1: offsets are stage px
      y: centreOld.y + (s.y + 12),
    };
    const ratio = s.scale / 1;
    expect(centreNew.x + ratio * (800 - centreOld.x)).toBeCloseTo(800, 1);
    expect(centreNew.y + ratio * (450 - centreOld.y)).toBeCloseTo(450, 1);
    // Back to where the layout puts it: not stored any more.
    expect(moveBy(moved, 'bitsBadge', -30, 12).parts).toBeUndefined();
    expect(samePlacement(moveBy(moved, 'bitsBadge', -30, 12), base)).toBe(true);
  });
});
