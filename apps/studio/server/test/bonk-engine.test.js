import { describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '../bonk-overlay/bonk-v3-core.js';
import {
  AUDIO,
  createAudioGovernor,
  everyNth,
} from '../bonk-overlay/engine/audio.js';
import { DENSITY, densityDecision } from '../bonk-overlay/engine/density.js';
import {
  ENTRIES,
  FAMILIES,
  pickEntry,
  pickFamily,
} from '../bonk-overlay/engine/families.js';
import { sampleAt } from '../bonk-overlay/engine/physics.js';
import { planShot } from '../bonk-overlay/engine/plan.js';
import { createScene } from '../bonk-overlay/engine/scene.js';
import { SIZE_MEAN, sampleSize } from '../bonk-overlay/engine/size.js';
import {
  CANVAS,
  DEFAULT_TARGET,
  FULLSCREEN_CATEGORIES,
  FULLSCREEN_TARGET,
  IMPACT_CATEGORIES,
  inCore,
  pickFullscreenImpact,
  pickImpact,
} from '../bonk-overlay/engine/target.js';

// Bonk VNext lot 1 — renderer engine (pure parts + scene with a fake DOM and clock). Distributions
// are checked on fixed seeds: deterministic, with tolerances around the audit's targets.

/** Deterministic interaction-like ids (real ids are UUIDs: well-spread seeds). */
function ids(seed = 20261014) {
  const random = createSeededRandom(seed);
  return () =>
    Array.from({ length: 32 }, () =>
      Math.floor(random() * 16).toString(16),
    ).join('');
}
const share = (count, total) => count / total;

describe('sizes (audit §8, M = 140)', () => {
  it('mean dominant: 80 % within ±10 px, 94 % within ±20 px, big ones rare and capped', () => {
    const random = createSeededRandom(1);
    const N = 40_000;
    const sizes = Array.from({ length: N }, () => sampleSize(random));
    const within = (d) =>
      share(sizes.filter((s) => Math.abs(s - SIZE_MEAN) <= d).length, N);
    expect(SIZE_MEAN).toBe(140);
    expect(within(10)).toBeGreaterThan(0.78);
    expect(within(10)).toBeLessThan(0.83);
    expect(within(20)).toBeGreaterThan(0.925);
    expect(within(20)).toBeLessThan(0.955);
    expect(
      share(sizes.filter((s) => s > SIZE_MEAN + 20).length, N),
    ).toBeLessThan(0.025);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(SIZE_MEAN + 26);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(SIZE_MEAN - 44);
    const mean = sizes.reduce((a, b) => a + b, 0) / N;
    expect(Math.abs(mean - SIZE_MEAN)).toBeLessThan(3);
  });

  it('variance scales the offsets, never the mean', () => {
    const random = createSeededRandom(2);
    const sizes = Array.from({ length: 5000 }, () =>
      sampleSize(random, { mean: 100, variance: 0.6 }),
    );
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100 + Math.ceil(26 * 0.6));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(
      100 - Math.ceil(44 * 0.6),
    );
  });
});

describe('impact zone (audit §6)', () => {
  it('rim, inside, graze as weighted; the centre stays rare (≈ 3 %, core ≤ 4.5 %)', () => {
    const random = createSeededRandom(3);
    const N = 30_000;
    const counts = {};
    let core = 0;
    for (let i = 0; i < N; i++) {
      const p = pickImpact(random, { facing: ['top'] });
      counts[p.category] = (counts[p.category] ?? 0) + 1;
      if (inCore(DEFAULT_TARGET, p.x, p.y)) core += 1;
      expect(p.x).toBeGreaterThanOrEqual(40);
      expect(p.x).toBeLessThanOrEqual(CANVAS.width - 40);
      expect(p.y).toBeGreaterThanOrEqual(40);
      expect(p.y).toBeLessThanOrEqual(CANVAS.height - 40);
    }
    for (const [category, weight] of IMPACT_CATEGORIES)
      expect(Math.abs(share(counts[category], N) - weight)).toBeLessThan(0.015);
    expect(share(core, N)).toBeLessThan(0.045);
  });

  it('inside never lands in the core; rim points hug the edges', () => {
    const random = createSeededRandom(4);
    for (let i = 0; i < 5000; i++) {
      const p = pickImpact(random, { facing: ['left'] });
      if (p.category === 'inside')
        expect(inCore(DEFAULT_TARGET, p.x, p.y)).toBe(false);
      if (p.category === 'rim') {
        const r = DEFAULT_TARGET;
        const toEdge = Math.min(
          Math.abs(p.x - r.x),
          Math.abs(p.x - (r.x + r.w)),
          Math.abs(p.y - r.y),
          Math.abs(p.y - (r.y + r.h)),
        );
        expect(toEdge).toBeLessThanOrEqual(0.12 * Math.min(r.w, r.h) + 0.001);
      }
    }
  });

  it('anti-clustering: fewer impacts closer than half a size to the recent ones', () => {
    const crowded = (useRecent) => {
      const random = createSeededRandom(5);
      const recent = [];
      let n = 0;
      for (let i = 0; i < 4000; i++) {
        const p = pickImpact(random, {
          size: 140,
          recent: useRecent ? recent : [],
        });
        if (recent.some((r) => Math.hypot(r.x - p.x, r.y - p.y) < 70)) n += 1;
        recent.push(p);
        if (recent.length > 6) recent.shift();
      }
      return n;
    };
    expect(crowded(true)).toBeLessThan(crowded(false) * 0.4);
  });
});

describe('trajectory families (audit §7)', () => {
  it('weighted families; never three times the same in a row; never the same entry twice in a row', () => {
    const random = createSeededRandom(6);
    const N = 30_000;
    const counts = {};
    const history = [];
    let lastEntry = null;
    for (let i = 0; i < N; i++) {
      const family = pickFamily(random, history);
      const entry = pickEntry(random, family, lastEntry);
      counts[family.id] = (counts[family.id] ?? 0) + 1;
      if (history.length === 2)
        expect(history[0] === history[1] && history[1] === family.id).toBe(
          false,
        );
      expect(entry).not.toBe(lastEntry);
      expect(ENTRIES[entry]).toBeDefined();
      history.push(family.id);
      if (history.length > 2) history.shift();
      lastEntry = entry;
    }
    const total = FAMILIES.reduce((s, f) => s + f.weight, 0);
    for (const f of FAMILIES)
      expect(Math.abs(share(counts[f.id], N) - f.weight / total)).toBeLessThan(
        0.02,
      );
  });
});

describe('trajectories (physics ported from the legacy engine)', () => {
  const next = ids();
  const plans = Array.from({ length: 1500 }, () => planShot(next()));

  it('pass exactly through the impact point, stay finite, end off screen or shrunk, within bounds', () => {
    for (const p of plans) {
      const { points, impactMs, durationMs } = p.trajectory;
      const at = points.find((q) => q.phase === 'impact');
      expect(at.t).toBeCloseTo(impactMs, 6);
      expect(Math.hypot(at.x - p.impact.x, at.y - p.impact.y)).toBeLessThan(1);
      for (const q of points)
        expect(Number.isFinite(q.x + q.y + q.rot + q.sx + q.sy)).toBe(true);
      const last = points.at(-1);
      const offscreen =
        last.x < -100 ||
        last.x > CANVAS.width + 100 ||
        last.y > CANVAS.height + 100;
      expect(offscreen || last.sx < 0.05).toBe(true);
      expect(durationMs).toBeGreaterThan(1500);
      expect(durationMs).toBeLessThan(4800);
      // Starts off screen, then hits a point of the canvas.
      const first = points[0];
      expect(
        first.x < 0 ||
          first.x > CANVAS.width ||
          first.y < 0 ||
          first.y > CANVAS.height,
      ).toBe(true);
    }
  });

  it('every projectile physically hits the target: it bounces back off it, never flies through or past', () => {
    const contact = (p) => {
      const pts = p.trajectory.points;
      const i = pts.findIndex((q) => q.phase === 'impact');
      const after = pts[i + 1];
      const vout = [after.x - pts[i].x, after.y - pts[i].y];
      const { category, nx, ny } = p.impact;
      if (category === 'rim' || category === 'graze')
        // Edge contact: it always leaves that edge outwards.
        return vout[0] * nx + vout[1] * ny > 0;
      // Surface knock: it goes back up.
      return vout[1] < 0;
    };
    const next2 = ids(31);
    for (const mode of ['manual', 'fullscreen']) {
      const counts = { strong: 0, normal: 0, weak: 0 };
      for (let i = 0; i < 3000; i++) {
        const p = planShot(next2(), { mode });
        expect(contact(p)).toBe(true);
        counts[p.trajectory.bounce] += 1;
      }
      expect(Math.abs(counts.strong / 3000 - 0.25)).toBeLessThan(0.03);
      expect(Math.abs(counts.normal / 3000 - 0.5)).toBeLessThan(0.03);
      expect(Math.abs(counts.weak / 3000 - 0.25)).toBeLessThan(0.03);
    }
  });

  it('a graze always lands close enough to touch the edge, even around a big zone', () => {
    const random = createSeededRandom(32);
    const rect = { x: 26, y: 60, w: 1190, h: 763 }; // the legacy « Just Chatting » camera
    for (let i = 0; i < 5000; i++) {
      const p = pickImpact(random, { rect, size: 140 });
      if (p.category !== 'graze') continue;
      const toEdge = Math.min(
        Math.abs(p.x - rect.x),
        Math.abs(p.x - (rect.x + rect.w)),
        Math.abs(p.y - rect.y),
        Math.abs(p.y - (rect.y + rect.h)),
      );
      expect(toEdge).toBeLessThanOrEqual(0.4 * 140 + 0.001);
    }
  });

  it('determinism: same id + same context → same projectile; different ids differ', () => {
    const id = 'f3b1c7d2-5a8e-4c11-9b2a-0d6e4f8a1b3c';
    const context = {
      recent: [{ x: 900, y: 300 }],
      history: ['chute'],
      lastEntry: 'left',
    };
    expect(planShot(id, context)).toEqual(planShot(id, context));
    expect(planShot(id).trajectory.points).not.toEqual(
      planShot(`${id}x`).trajectory.points,
    );
  });

  it('every family and every impact category actually occurs', () => {
    expect(new Set(plans.map((p) => p.family))).toEqual(
      new Set(FAMILIES.map((f) => f.id)),
    );
    expect(new Set(plans.map((p) => p.impact.category))).toEqual(
      new Set(IMPACT_CATEGORIES.map(([c]) => c)),
    );
  });

  it('dense scene (reduced): shorter, always a shrink exit', () => {
    const next2 = ids(7);
    let normal = 0;
    let reduced = 0;
    for (let i = 0; i < 300; i++) {
      const id = next2();
      normal += planShot(id).trajectory.durationMs;
      const r = planShot(id, { reduced: true }).trajectory;
      reduced += r.durationMs;
      expect(r.exit).toBe('shrink');
    }
    expect(reduced).toBeLessThan(normal * 0.85);
  });

  it('sampleAt interpolates between points and clamps at both ends', () => {
    const t = planShot('sample').trajectory;
    expect(sampleAt(t, -5)).toBe(t.points[0]);
    expect(sampleAt(t, t.durationMs + 100)).toBe(t.points.at(-1));
    const a = t.points[3];
    const b = t.points[4];
    const mid = sampleAt(t, (a.t + b.t) / 2);
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2, 6);
  });
});

describe('density (audit §11)', () => {
  it('normal under 18; reduced + oldest accelerated from 18; wait from 30, bounded', () => {
    expect(densityDecision(17)).toEqual({
      wait: false,
      reduced: false,
      accelerate: 0,
    });
    expect(densityDecision(18)).toEqual({
      wait: false,
      reduced: true,
      accelerate: 1,
    });
    expect(densityDecision(30, 0)).toEqual({
      wait: true,
      reduced: true,
      accelerate: 1,
    });
    expect(densityDecision(30, DENSITY.maxWaitMs)).toEqual({
      wait: false,
      reduced: true,
      accelerate: 1,
    });
  });
});

describe('adaptive sound (audit §10)', () => {
  const run = (gapMs, count, governor = createAudioGovernor(), start = 0) => {
    const random = createSeededRandom(9);
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = start + i * gapMs;
      out.push({ t, ...governor.onImpact(t, random) });
    }
    return out;
  };

  it('isolated impacts: every one plays at full volume', () => {
    const out = run(2000, 10);
    expect(out.every((o) => o.play && o.gain === AUDIO.volume)).toBe(true);
  });

  it('small burst ≈ 1 in 2, bigger ≈ 1 in 3, heavy spam ≤ 1 in 5; ≤ 5 sounds/s, ≥ 90 ms apart', () => {
    expect([everyNth(1), everyNth(2), everyNth(4), everyNth(8)]).toEqual([
      1, 2, 3, 5,
    ]);
    const steady = (gap) => run(gap, 120).slice(40); // after the rate estimate settled
    const ratio = (out) => out.filter((o) => o.play).length / out.length;
    expect(ratio(steady(500))).toBeCloseTo(1 / 2, 1);
    expect(ratio(steady(200))).toBeCloseTo(1 / 3, 1);
    expect(ratio(steady(50))).toBeLessThanOrEqual(1 / 5 + 0.01);
    for (const gap of [50, 100, 200]) {
      const played = run(gap, 200)
        .filter((o) => o.play)
        .map((o) => o.t);
      for (let i = 1; i < played.length; i++)
        expect(played[i] - played[i - 1]).toBeGreaterThanOrEqual(
          AUDIO.minGapMs,
        );
      for (const t of played)
        expect(
          played.filter((u) => u > t - 1000 && u <= t).length,
        ).toBeLessThanOrEqual(5);
    }
  });

  it('a long burst lowers the volume down to 45 %, a calm brings it back', () => {
    const governor = createAudioGovernor();
    const burst = run(200, 60, governor); // 12 s at 5/s
    const gains = burst.map((o) => o.gain);
    for (let i = 1; i < gains.length; i++)
      expect(gains[i]).toBeLessThanOrEqual(gains[i - 1] + 1e-9);
    expect(gains.at(-1)).toBeCloseTo(AUDIO.volume * AUDIO.floor, 6);
    // 1.5 s calm + 2 s recovery: back to the normal volume.
    const after = run(2000, 1, governor, burst.at(-1).t + 3600);
    expect(after[0].gain).toBeCloseTo(AUDIO.volume, 6);
    expect(after[0].play).toBe(true);
  });

  it('never the same sound twice in a row among the played ones', () => {
    const played = run(300, 200)
      .filter((o) => o.play)
      .map((o) => o.file);
    for (let i = 1; i < played.length; i++)
      expect(played[i]).not.toBe(played[i - 1]);
  });
});

describe('scene (fake DOM and clock): nothing paid is ever dropped', () => {
  function fakeScene() {
    let clock = 0;
    let frames = [];
    let timers = [];
    const sounds = [];
    const puffs = [];
    const scene = createScene({
      stage: { append() {} },
      audio: { play: (s) => sounds.push(s) },
      document: {
        createElement: () => {
          const el = { style: {}, remove() {} };
          puffs.push(el);
          return el;
        },
      },
      now: () => clock,
      frame: (cb) => frames.push(cb),
      timer: (cb, ms) => timers.push({ at: clock + ms, cb }),
    });
    const step = (ms = 16) => {
      clock += ms;
      const due = timers.filter((t) => t.at <= clock);
      timers = timers.filter((t) => t.at > clock);
      for (const t of due) t.cb();
      const run = frames;
      frames = [];
      for (const cb of run) cb();
    };
    const image = () => ({ style: {}, className: '', remove: vi.fn() });
    return { scene, step, image, sounds, puffs, now: () => clock };
  }

  it('40 shots in a row: every one starts and finishes; never more than 30 on screen; dense ones reduced', async () => {
    const f = fakeScene();
    const next = ids(11);
    const shown = [];
    let maxAlive = 0;
    for (let i = 0; i < 40; i++) {
      const pending = f.scene.play({ id: next(), image: f.image() });
      let done = false;
      void pending.then(() => (done = true));
      while (!done) {
        f.step();
        await Promise.resolve();
      }
      const s = await pending;
      maxAlive = Math.max(maxAlive, f.scene.alive);
      shown.push(s);
      f.step(30); // the overlay polls again ~100 ms later; shots arrive close together
      await Promise.resolve();
    }
    let finished = 0;
    for (const s of shown) void s.finished.then(() => (finished += 1));
    for (let i = 0; i < 400 && finished < 40; i++) {
      f.step();
      await Promise.resolve();
    }
    expect(finished).toBe(40);
    expect(maxAlive).toBeLessThanOrEqual(DENSITY.hard);
    expect(
      shown.filter((s) => s.plan.trajectory.exit === 'shrink').length,
    ).toBeGreaterThan(0);
    expect(f.scene.alive).toBe(0);
  });

  it('impact: one puff when the scene is calm, the sound goes through the governor', async () => {
    const f = fakeScene();
    const s = await f.scene.play({ id: 'one', image: f.image() });
    while (f.now() < s.plan.trajectory.impactMs + 20) f.step();
    expect(f.puffs).toHaveLength(1);
    expect(f.sounds).toHaveLength(1);
    expect(f.sounds[0].gain).toBe(AUDIO.volume);
  });

  it('a new target applies to the next projectiles only; a malformed one is ignored', async () => {
    const f = fakeScene();
    const first = await f.scene.play({ id: 'before', image: f.image() });
    const before = JSON.parse(JSON.stringify(first.plan));
    f.scene.setTarget({ mode: 'fullscreen' });
    expect(JSON.parse(JSON.stringify(first.plan))).toEqual(before); // in flight: untouched
    const second = await f.scene.play({ id: 'after', image: f.image() });
    expect(second.plan.impact.category).toBe('glass');
    const zone = { mode: 'manual', rect: { x: 100, y: 600, w: 640, h: 360 } };
    f.scene.setTarget(zone);
    expect(f.scene.target).toEqual(zone);
    for (const bad of [
      null,
      { mode: 'auto' },
      { mode: 'manual', rect: { x: -5, y: 0, w: 300, h: 300 } },
      { mode: 'manual', rect: { x: 0, y: 0, w: 10, h: 300 } },
      { mode: 'manual', rect: { x: 1800, y: 0, w: 300, h: 300 } },
    ]) {
      f.scene.setTarget(bad);
      expect(f.scene.target).toEqual(zone);
    }
  });
});

describe('targets (lot 2): Manuel zone and Fullscreen', () => {
  it('Fullscreen: its own impact logic (always a knock on the screen), anywhere on the canvas minus 6 %, no edge', () => {
    const random = createSeededRandom(21);
    const N = 20_000;
    const counts = {};
    const r = FULLSCREEN_TARGET;
    for (let i = 0; i < N; i++) {
      const p = pickFullscreenImpact(random);
      counts[p.category] = (counts[p.category] ?? 0) + 1;
      expect(p.edge).toBeNull();
      expect(p.x).toBeGreaterThanOrEqual(r.x);
      expect(p.x).toBeLessThanOrEqual(r.x + r.w);
      expect(p.y).toBeGreaterThanOrEqual(r.y);
      expect(p.y).toBeLessThanOrEqual(r.y + r.h);
    }
    for (const [category, weight] of FULLSCREEN_CATEGORIES)
      expect(Math.abs(share(counts[category], N) - weight)).toBeLessThan(0.015);
    expect(Object.keys(counts)).toEqual(['glass']);
    // Spread over the whole screen, not around one spot: every quarter gets its share.
    const random2 = createSeededRandom(22);
    const quarters = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) {
      const p = pickFullscreenImpact(random2);
      quarters[(p.x > 960 ? 1 : 0) + (p.y > 540 ? 2 : 0)] += 1;
    }
    for (const q of quarters) expect(share(q, 8000)).toBeGreaterThan(0.2);
  });

  it('Fullscreen projectiles: valid trajectories through their impact, always glass', () => {
    const next = ids(23);
    for (let i = 0; i < 500; i++) {
      const p = planShot(next(), { mode: 'fullscreen' });
      expect(p.impact.category).toBe('glass');
      const at = p.trajectory.points.find((q) => q.phase === 'impact');
      expect(Math.hypot(at.x - p.impact.x, at.y - p.impact.y)).toBeLessThan(1);
      for (const q of p.trajectory.points)
        expect(Number.isFinite(q.x + q.y + q.rot + q.sx + q.sy)).toBe(true);
    }
  });

  it('Manuel with another zone: same categories, centre still rare, around that zone', () => {
    const rect = { x: 100, y: 600, w: 640, h: 360 };
    const random = createSeededRandom(24);
    const N = 20_000;
    let core = 0;
    let near = 0;
    for (let i = 0; i < N; i++) {
      const p = pickImpact(random, { rect });
      if (inCore(rect, p.x, p.y)) core += 1;
      const m = 0.4 * Math.min(rect.w, rect.h);
      if (
        p.x >= rect.x - m &&
        p.x <= rect.x + rect.w + m &&
        p.y >= rect.y - m &&
        p.y <= rect.y + rect.h + m
      )
        near += 1;
    }
    expect(share(core, N)).toBeLessThan(0.045);
    expect(share(near, N)).toBeGreaterThan(0.97);
  });

  it('default zone: exactly the lot 1 projectiles (validated render unchanged)', () => {
    const next = ids(25);
    for (let i = 0; i < 200; i++) {
      const id = next();
      const context = { recent: [{ x: 900, y: 300 }], history: ['arc'] };
      expect(
        planShot(id, { ...context, mode: 'manual', rect: DEFAULT_TARGET }),
      ).toEqual(planShot(id, context));
    }
  });
});
