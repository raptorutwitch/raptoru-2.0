// Chaos V2, lot 2 — the Core's catalogue (apps/core-api/src/chaos/catalog.ts) is a PORT of the extension's
// (extension/modules/interactions/catalog.js): the Core normalizes the viewer's choice, builds the engine request and
// prices it with the same code. Two catalogues that drift = a price shown that the Core refuses (price_changed) or an
// effect played differently than announced. This lockstep test asserts, for every reachable setting of every effect
// (the extension's reachableSettings plus every control extreme, hue and point included, both duration ends, two
// Safety ceilings) and for hostile inputs, an identical normalized choice, engine request and range price.
import { describe, expect, it } from 'vitest';
import { REGISTRY as EXT_REGISTRY } from '../extension/modules/interactions/registry.js';
import * as ext from '../extension/modules/interactions/catalog.js';
import { REGISTRY as CORE_REGISTRY } from '../../core-api/src/chaos/registry.ts';
import * as core from '../../core-api/src/chaos/catalog.ts';

/** Every setting a sheet can build: preset × level, each extreme of each control, both duration ends. */
function* settings(e, capS) {
  yield* ext.reachableSettings(e, capS);
  for (const style of e.presets?.map((s) => s.id) ?? [null])
    for (const level of e.levels?.map((l) => l.id) ?? [null]) {
      const c = ext.normalizeChoice(e, { style, level }, capS, { reset: true });
      yield c;
      yield { ...c, duration: 60 };
      for (const k of ext.controlsFor(e, c)) {
        const values =
          k.kind === 'choice'
            ? k.options.map((o) => o.id)
            : k.kind === 'slider'
              ? k.stops
                ? [k.stops[0], k.stops.at(-1), k.stops[3]]
                : [k.min, k.max, (k.min + k.max) / 2]
              : k.kind === 'toggle'
                ? [true, false]
                : k.kind === 'hue'
                  ? [0, 359, 120]
                  : k.kind === 'point'
                    ? [
                        [0, 1],
                        [0.33, 0.77],
                      ]
                    : [];
        for (const v of values) {
          const opts = { ...c.opts, [k.id]: v };
          yield { ...c, opts };
          yield { ...c, opts, duration: 60 };
        }
      }
    }
}

/** Inputs a hostile or buggy client could send: unknown ids, out-of-range numbers, wrong types. */
function* hostile(e) {
  const d = ext.defaultChoice(e);
  yield {};
  yield { style: 'nope', level: 'nope', duration: 'x' };
  yield { ...d, duration: 0 };
  yield { ...d, duration: 9999 };
  yield { ...d, duration: -7.3 };
  yield { ...d, duration: 12.6 };
  yield { ...d, duration: null };
  for (const k of e.controls ?? [])
    for (const v of [
      -1e9,
      1e9,
      '12',
      'abc',
      true,
      false,
      0,
      NaN,
      [5],
      [2, -3, 9],
      ['0.5', 'x'],
      { a: 1 },
      null,
    ])
      yield { ...d, opts: { ...d.opts, [k.id]: v } };
}

describe('Core ↔ extension: one catalogue', () => {
  it('the Core carries the same registry extract and the same price ranges', () => {
    expect(CORE_REGISTRY).toEqual(EXT_REGISTRY);
    expect(core.PRICE_RANGES).toEqual(ext.PRICE_RANGES);
    expect(core.EFFECTS.map((e) => e.id)).toEqual(ext.EFFECTS.map((e) => e.id));
    for (const e of ext.EFFECTS) {
      const c = core.effectById(e.id);
      expect(c.slot, e.id).toBe(e.slot);
      expect(c.capture, e.id).toBe(e.capture);
      expect(Boolean(c.photosensitive), e.id).toBe(Boolean(e.photosensitive));
      expect(c.globalCooldown ?? null, e.id).toBe(e.globalCooldown ?? null);
      expect(c.duration, e.id).toEqual(e.duration);
      expect(
        c.presets?.map((p) => [
          p.id,
          p.variant ?? null,
          !!p.default,
          p.charges ?? null,
        ]),
        e.id,
      ).toEqual(
        e.presets?.map((p) => [
          p.id,
          p.variant ?? null,
          !!p.default,
          p.charges ?? null,
        ]),
      );
      expect(c.levels, e.id).toEqual(
        e.levels?.map((l) => ({
          id: l.id,
          ...(l.default !== undefined ? { default: l.default } : {}),
        })) ?? null,
      );
      expect(core.defaultChoice(c), e.id).toEqual(ext.defaultChoice(e));
      expect(core.maxSeverity(c), e.id).toBe(ext.maxSeverity(e));
    }
  });

  it('every reachable setting: same normalized choice, same engine request, same price (two Safety ceilings)', () => {
    let n = 0;
    for (const capS of [30, 60])
      for (const e of ext.EFFECTS) {
        const c = core.effectById(e.id);
        for (const input of settings(e, capS)) {
          const a = ext.normalizeChoice(e, input, capS);
          const b = core.normalizeChoice(c, input, capS);
          const at = `${e.id} ${JSON.stringify(input)} cap ${capS}`;
          expect(b, at).toEqual(a);
          expect(core.engineRequest(c, b), at).toEqual(ext.engineRequest(e, a));
          expect(core.rangePrice(c, b).total, at).toBe(
            ext.rangePrice(e, a).total,
          );
          expect(core.durationRange(c, b, capS), at).toEqual(
            ext.durationRange(e, a, capS),
          );
          n += 1;
        }
      }
    expect(n).toBeGreaterThan(1000);
  });

  it('reset after a preset / level change: the same values follow the preset', () => {
    for (const e of ext.EFFECTS) {
      const c = core.effectById(e.id);
      for (const input of settings(e, 60))
        expect(
          core.normalizeChoice(c, input, 60, { reset: true }),
          e.id,
        ).toEqual(ext.normalizeChoice(e, input, 60, { reset: true }));
    }
  });

  it('hostile inputs are normalized the same way (unknown ids, wrong types, out-of-range values)', () => {
    for (const e of ext.EFFECTS) {
      const c = core.effectById(e.id);
      for (const input of hostile(e)) {
        const a = ext.normalizeChoice(e, input, 30);
        const b = core.normalizeChoice(c, input, 30);
        expect(b, `${e.id} ${JSON.stringify(input)}`).toEqual(a);
        expect(core.rangePrice(c, b).total).toBe(ext.rangePrice(e, a).total);
      }
    }
  });

  it('the Core’s own reachable settings are the extension’s', () => {
    for (const e of ext.EFFECTS)
      expect([...core.reachableSettings(core.effectById(e.id))], e.id).toEqual([
        ...ext.reachableSettings(e),
      ]);
  });
});
