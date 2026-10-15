import { describe, expect, it, vi } from 'vitest';
import {
  COMBO,
  FINISHER,
  createCombo,
  finisherSize,
} from '../bonk-overlay/engine/combo.js';
import {
  IMPACT_FX_MS,
  PARTICLES,
  STREAKS,
  pickImpactFx,
  spawnImpactFx,
} from '../bonk-overlay/engine/impact-fx.js';
import {
  createSeededRandom,
  seedFromReference,
} from '../bonk-overlay/bonk-v3-core.js';
import { CANVAS } from '../bonk-overlay/engine/target.js';
import { finisherMass, planShot } from '../bonk-overlay/engine/plan.js';
import { createScene } from '../bonk-overlay/engine/scene.js';

// Bonk VNext lot 6 — historical impact FX, multi-viewer combo and its giant finisher.

/** Manual clock + timers (setTimeout / clearTimeout stand-ins). */
function clock() {
  let now = 0;
  let timers = [];
  let seq = 0;
  return {
    timer: (cb, ms) => {
      const t = { id: ++seq, at: now + ms, cb };
      timers.push(t);
      return t.id;
    },
    cancel: (id) => (timers = timers.filter((t) => t.id !== id)),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = timers
          .filter((t) => t.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        timers = timers.filter((t) => t !== next);
        next.cb();
      }
      now = end;
    },
    get pending() {
      return timers.length;
    },
  };
}

function comboHarness() {
  const c = clock();
  const finished = [];
  const combo = createCombo({
    timer: c.timer,
    cancel: c.cancel,
    onFinish: (f) => finished.push(f),
  });
  /** One played Bonk (`emote` defaults to a per-viewer emote). */
  const bonk = (viewerId, emote = `e-${viewerId}`) =>
    combo.add({ viewerId, key: emote, emote });
  return { c, combo, finished, bonk };
}

describe('combo (lot 6): distinct viewers, never shots', () => {
  it('1 viewer alone → no finisher, even after many Bonks', () => {
    const h = comboHarness();
    for (let i = 0; i < 10; i++) h.bonk('1');
    h.c.advance(COMBO.windowMs + 1);
    expect(h.finished).toEqual([]);
    expect(h.combo.open).toBe(false);
  });

  it.each([2, 3, 5, 10])(
    '%i viewers → one finisher sized by %i participants',
    (n) => {
      const h = comboHarness();
      for (let v = 1; v <= n; v++) h.bonk(String(v));
      h.c.advance(COMBO.windowMs + 1);
      expect(h.finished).toHaveLength(1);
      expect(h.finished[0].viewers).toBe(n);
    },
  );

  it('one viewer sending many Bonks counts once: A × 8 + B × 1 = 2 participants', () => {
    const h = comboHarness();
    for (let i = 0; i < 8; i++) h.bonk('100');
    h.bonk('200');
    h.c.advance(COMBO.windowMs + 1);
    expect(h.finished).toEqual([{ viewers: 2, emote: 'e-100' }]);
  });

  it('a salve by one viewer = 1 participant; two viewers with salves = 2', () => {
    const solo = comboHarness();
    for (let k = 0; k < 10; k++) solo.bonk('7'); // the 10 shots of one salve (same viewer_id)
    solo.c.advance(COMBO.windowMs + 1);
    expect(solo.finished).toEqual([]);

    const duo = comboHarness();
    for (let k = 0; k < 10; k++) duo.bonk('7');
    for (let k = 0; k < 6; k++) duo.bonk('8');
    duo.c.advance(COMBO.windowMs + 1);
    expect(duo.finished.map((f) => f.viewers)).toEqual([2]);
  });

  it('every Bonk refreshes the window; it closes once nothing arrives for windowMs; no orphan timer', () => {
    const h = comboHarness();
    h.bonk('1');
    h.c.advance(COMBO.windowMs - 100);
    h.bonk('2'); // refresh
    h.c.advance(COMBO.windowMs - 100);
    expect(h.finished).toEqual([]);
    expect(h.combo.viewers).toBe(2);
    expect(h.c.pending).toBe(1); // one timer only, the refreshed one
    h.c.advance(200);
    expect(h.finished).toHaveLength(1);
    expect(h.c.pending).toBe(0);
    expect(h.combo.open).toBe(false);
  });

  it('reset after the finisher: the next combo starts from zero; never a double finisher', () => {
    const h = comboHarness();
    h.bonk('1');
    h.bonk('2');
    h.c.advance(COMBO.windowMs + 1);
    h.c.advance(COMBO.windowMs * 3); // nothing left to fire
    expect(h.finished).toHaveLength(1);
    expect(h.combo.viewers).toBe(0);
    h.bonk('1'); // a new window: only 1 viewer, the old ones are not carried over
    h.c.advance(COMBO.windowMs + 1);
    expect(h.finished).toHaveLength(1);
  });

  it('a stale timer never closes a newer window (no ghost combo)', () => {
    let fire = null;
    const finished = [];
    const combo = createCombo({
      timer: (cb) => ((fire = cb), {}),
      cancel: () => {}, // a cancel that does nothing: the old callback stays callable
      onFinish: (f) => finished.push(f),
    });
    combo.add({ viewerId: '1', key: 'a', emote: 'a' });
    const stale = fire;
    combo.add({ viewerId: '2', key: 'b', emote: 'b' });
    stale();
    expect(finished).toEqual([]);
    fire();
    expect(finished).toEqual([{ viewers: 2, emote: 'b' }]);
    fire(); // the same timer firing twice
    expect(finished).toHaveLength(1);
  });

  it('finisher emote: the most used during the combo, the most recent on a tie (deterministic)', () => {
    const h = comboHarness();
    h.bonk('1', 'kappa');
    h.bonk('2', 'pog');
    h.bonk('3', 'kappa');
    h.bonk('4', 'lul');
    h.c.advance(COMBO.windowMs + 1);
    expect(h.finished[0].emote).toBe('kappa');
    const tie = comboHarness();
    tie.bonk('1', 'kappa');
    tie.bonk('2', 'pog');
    tie.c.advance(COMBO.windowMs + 1);
    expect(tie.finished[0].emote).toBe('pog');
  });

  it('a Bonk without a viewer id is ignored (never a participant)', () => {
    const h = comboHarness();
    h.bonk('');
    h.bonk(null);
    expect(h.combo.open).toBe(false);
  });
});

describe('finisher size and mass (lot 6)', () => {
  it('grows with the viewers only, deliberately absurd, bounded only technically', () => {
    expect(finisherSize(1)).toBeNull();
    const sizes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map(finisherSize);
    for (let i = 1; i < sizes.length; i++)
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    expect(finisherSize(2)).toBeGreaterThan(140 + 26); // above the biggest normal Bonk
    expect(finisherSize(10)).toBeGreaterThanOrEqual(CANVAS.height); // covers the screen height
    expect(finisherSize(1000)).toBe(FINISHER.maxSize);
    expect(finisherSize(1e9)).toBe(FINISHER.maxSize);
  });

  it('heavier when bigger: slower entry, less spin, softer bounce, longer on the ground', () => {
    const small = finisherMass(140);
    const big = finisherMass(1100);
    expect(small).toMatchObject({
      weight: 0,
      flight: 1,
      spin: 1,
      restitution: 1,
      hold: 1,
    });
    expect(big.flight).toBeGreaterThan(small.flight);
    expect(big.spin).toBeLessThan(small.spin);
    expect(big.restitution).toBeLessThan(small.restitution);
    expect(big.hold).toBeGreaterThan(small.hold);
  });

  it('a finisher is a real projectile of the same engine: through its impact, finite, bounded in time', () => {
    for (const n of [2, 3, 5, 10, 25, 500]) {
      for (const mode of ['manual', 'fullscreen']) {
        const size = finisherSize(n);
        const plan = planShot(`fin-${n}-${mode}`, { mode, finisherSize: size });
        expect(plan.size).toBe(size);
        expect(plan.finisher).toBe(true);
        expect(plan.family).toBe('lourd');
        const t = plan.trajectory;
        const hit = t.points.find((p) => p.t === t.impactMs);
        expect(hit).toMatchObject({ x: plan.impact.x, y: plan.impact.y });
        for (const p of t.points)
          expect([p.x, p.y, p.rot, p.sx, p.sy].every(Number.isFinite)).toBe(
            true,
          );
        expect(t.durationMs).toBeLessThan(12000);
        if (size > 400) expect(t.exit).toBe('shrink');
      }
    }
  });

  it('the bigger, the slower its entry (same seed)', () => {
    const at = (n) =>
      planShot('same-seed', { finisherSize: finisherSize(n) }).trajectory
        .impactMs;
    expect(at(10)).toBeGreaterThan(at(5));
    expect(at(5)).toBeGreaterThan(at(2));
  });
});

describe('historical impact FX (lot 6)', () => {
  function fakeDom() {
    const made = [];
    const document = {
      createElement: () => {
        const el = {
          className: '',
          style: {
            vars: {},
            setProperty(k, v) {
              this.vars[k] = v;
            },
          },
          children: [],
          removed: false,
          append(c) {
            this.children.push(c);
          },
          remove() {
            this.removed = true;
          },
        };
        made.push(el);
        return el;
      },
    };
    return { document, made };
  }

  it('Legacy exact = wave + 12 streaks + 8 particles; Legacy sans cercle = the same without the wave', () => {
    const c = clock();
    const { document } = fakeDom();
    const stage = { append: vi.fn() };
    const exact = spawnImpactFx({
      document,
      stage,
      timer: c.timer,
      at: { x: 500, y: 300 },
      size: 140,
      variant: 'exact',
    });
    const nowave = spawnImpactFx({
      document,
      stage,
      timer: c.timer,
      at: { x: 500, y: 300 },
      size: 140,
      variant: 'nowave',
    });
    const count = (fx, cls) =>
      fx.children.filter((e) => e.className === cls).length;
    expect([
      count(exact, 'bonk-wave'),
      count(exact, 'bonk-streak'),
      count(exact, 'bonk-particle'),
    ]).toEqual([1, 12, 8]);
    expect([
      count(nowave, 'bonk-wave'),
      count(nowave, 'bonk-streak'),
      count(nowave, 'bonk-particle'),
    ]).toEqual([0, 12, 8]);
    expect(STREAKS).toHaveLength(12);
    expect(PARTICLES).toHaveLength(8);
    // legacy timings and easings, untouched
    const streak = exact.children.find((e) => e.className === 'bonk-streak');
    expect(streak.style.animation).toBe(
      'bonkStreak 576ms cubic-bezier(.1,.75,.22,1) forwards',
    );
    expect(exact.children[0].style.animation).toBe(
      'bonkWave 608ms cubic-bezier(.12,.7,.25,1) forwards',
    );
    expect(exact.children.at(-1).style.animation).toBe(
      'bonkParticle 640ms cubic-bezier(.1,.7,.3,1) forwards',
    );
    // legacy geometry at k = 1 (size 130): first streak [2.2, 92, 6.4, 29]
    const ref = spawnImpactFx({
      document,
      stage,
      timer: c.timer,
      at: { x: 0, y: 0 },
      size: 130,
      variant: 'nowave',
    });
    const first = ref.children[0];
    expect([
      first.style.width,
      first.style.height,
      first.style.vars['--inner'],
      first.style.vars['--travel'],
    ]).toEqual(['63px', '6.1px', '29px', '69px']);
    // removed after the legacy delay
    expect(exact.removed).toBe(false);
    c.advance(IMPACT_FX_MS);
    expect([exact.removed, nowave.removed, ref.removed]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('about 30 % Legacy exact, 70 % Legacy sans cercle, decided by the shot id', () => {
    let exact = 0;
    for (let i = 0; i < 4000; i++)
      if (
        pickImpactFx(createSeededRandom(seedFromReference(`shot-${i}:fx`))) ===
        'exact'
      )
        exact += 1;
    expect(exact / 4000).toBeGreaterThan(0.26);
    expect(exact / 4000).toBeLessThan(0.34);
  });
});

describe('scene with a finisher (fake DOM and clock)', () => {
  function fakeScene() {
    let now = 0;
    let frames = [];
    let timers = [];
    const fxs = [];
    const onStage = new Set();
    const element = () => ({
      className: '',
      style: { setProperty() {} },
      children: [],
      append(c) {
        this.children.push(c);
      },
      remove() {
        onStage.delete(this);
      },
    });
    const scene = createScene({
      stage: {
        append: (el) => {
          onStage.add(el);
          if (el.className === 'bonk-fx') fxs.push(el);
        },
      },
      audio: { play() {} },
      document: { createElement: element },
      now: () => now,
      frame: (cb) => frames.push(cb),
      timer: (cb, ms) => timers.push({ at: now + ms, cb }),
    });
    const step = (ms = 16) => {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.cb();
      const run = frames;
      frames = [];
      for (const cb of run) cb();
    };
    return { scene, step, element, fxs, onStage };
  }

  it('a giant finisher plays, hits with Legacy exact, then leaves: DOM clean, next Bonks normal', async () => {
    const f = fakeScene();
    const giant = await f.scene.play({
      id: 'finisher:a',
      image: f.element(),
      finisherViewers: 12,
    });
    expect(giant.plan.size).toBe(finisherSize(12));
    let done = false;
    void giant.finished.then(() => (done = true));
    for (let i = 0; i < 2000 && !done; i++) {
      f.step();
      await Promise.resolve();
    }
    expect(done).toBe(true);
    expect(f.fxs).toHaveLength(1);
    expect(
      f.fxs[0].children.filter((e) => e.className === 'bonk-wave'),
    ).toHaveLength(1);
    for (let i = 0; i < 80; i++) f.step(); // FX cleanup delay
    expect(f.scene.alive).toBe(0);
    expect(f.onStage.size).toBe(0); // projectile and FX removed
    // a normal Bonk right after: normal size, and the same as without the finisher
    const normal = await f.scene.play({
      id: 'after-giant',
      image: f.element(),
    });
    const alone = await fakeScene().scene.play({
      id: 'after-giant',
      image: f.element(),
    });
    expect(normal.plan).toEqual(alone.plan);
    expect(normal.plan.finisher).toBe(false);
  });

  it('a finisher needs at least 2 viewers', async () => {
    const f = fakeScene();
    await expect(
      f.scene.play({ id: 'x', image: f.element(), finisherViewers: 1 }),
    ).rejects.toThrow('finisher_needs_viewers');
    expect(f.scene.alive).toBe(0);
  });
});
