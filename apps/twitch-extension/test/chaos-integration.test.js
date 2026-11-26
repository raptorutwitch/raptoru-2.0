// Intégration Chaos V2 ↔ Interactions (branche feat/chaos-integration) : l'extension et le moteur ne sont compatibles que
// si (1) l'extrait du registre de l'extension (lab-modules/interactions/registry.js) est fidèle au VRAI registre du
// moteur (packages/schemas/src/chaos-registry.json) et (2) chaque demande qu'une fiche peut construire passe le schéma
// que Studio valide avant le moteur (chaosEffectRequestSchema). Deux suites vertes séparément ne prouvent pas cela.
import { describe, expect, it } from 'vitest';
import realRegistry from '../../../packages/schemas/src/chaos-registry.json';
import { chaosEffectRequestSchema } from '../../../packages/schemas/src/chaos.ts';
import { REGISTRY } from '../extension/lab-modules/interactions/registry.js';
import {
  EFFECTS,
  controlsFor,
  engineRequest,
  normalizeChoice,
} from '../extension/lab-modules/interactions/catalog.js';

const real = Object.fromEntries(
  realRegistry.effects.filter((e) => !e.internal).map((e) => [e.id, e]),
);

/** Chaque réglage atteignable : préréglage × force, puis chaque valeur extrême de chaque contrôle, deux durées. */
function* settings(e) {
  for (const style of e.presets?.map((s) => s.id) ?? [null])
    for (const level of e.levels?.map((l) => l.id) ?? [null]) {
      const c = normalizeChoice(e, { style, level }, 60, { reset: true });
      yield c;
      yield normalizeChoice(e, { ...c, duration: 60 }, 60);
      for (const k of controlsFor(e, c)) {
        const values =
          k.kind === 'choice'
            ? k.options.map((o) => o.id)
            : k.kind === 'slider'
              ? k.stops
                ? [k.stops[0], k.stops.at(-1)]
                : [k.min, k.max]
              : k.kind === 'toggle'
                ? [true, false]
                : k.kind === 'hue'
                  ? [0, 359]
                  : k.kind === 'point'
                    ? [[0, 1]]
                    : [];
        for (const v of values)
          yield normalizeChoice(
            e,
            { ...c, opts: { ...c.opts, [k.id]: v } },
            60,
          );
      }
    }
}

describe('extension ↔ moteur : même registre, mêmes demandes', () => {
  it('l’extrait de l’extension est fidèle au registre réel (effets publics, emplacements, limites, paramètres, variantes, niveaux)', () => {
    expect(Object.keys(REGISTRY.effects).sort()).toEqual(
      Object.keys(real).sort(),
    );
    expect(REGISTRY.limits.max_duration_ms).toBe(
      realRegistry.engine_limits.max_duration_ms,
    );
    expect(REGISTRY.limits.max_transition_ms).toBe(
      realRegistry.engine_limits.max_transition_ms,
    );
    for (const [slot, s] of Object.entries(REGISTRY.slots))
      expect(s.max_active).toBe(realRegistry.slots[slot].max_active);
    for (const [id, x] of Object.entries(REGISTRY.effects)) {
      const r = real[id];
      expect(x.slot, id).toBe(r.slot);
      for (const p of r.params) {
        const q = x.params[p.id];
        expect(q, `${id}.${p.id}`).toBeTruthy();
        expect(q.def, `${id}.${p.id} défaut`).toEqual(p.default);
        if (p.min !== undefined) expect(q.min, `${id}.${p.id} min`).toBe(p.min);
        if (p.max !== undefined) expect(q.max, `${id}.${p.id} max`).toBe(p.max);
        if (p.values)
          expect(q.values, `${id}.${p.id} valeurs`).toEqual(p.values);
        expect(q.exposed !== false, `${id}.${p.id} exposé`).toBe(
          p.exposed !== false,
        );
      }
      for (const v of r.variants ?? [])
        expect(x.variants[v.id]?.params, `${id} variante ${v.id}`).toEqual(
          v.params ?? {},
        );
      for (const l of r.levels ?? [])
        expect(x.levels[l.id]?.params, `${id} niveau ${l.id}`).toEqual(
          l.params ?? {},
        );
    }
  });

  it('chaque demande construite par une fiche passe le schéma que Studio valide (source extension)', () => {
    let n = 0;
    for (const e of EFFECTS)
      for (const c of settings(e)) {
        const req = {
          ...engineRequest(e, c),
          request_id: `ext-test-${n}`,
          source: { kind: 'extension', ref: 'test' },
        };
        const out = chaosEffectRequestSchema.safeParse(req);
        expect(
          out.success,
          `${e.id} ${JSON.stringify(req)} ${out.success ? '' : out.error.issues.map((i) => i.message).join(';')}`,
        ).toBe(true);
        // Le moteur refuse à une source externe tout paramètre non exposé : la fiche n'en envoie jamais.
        for (const k of Object.keys(req.params ?? {}))
          expect(
            real[e.id].params.find((p) => p.id === k)?.exposed,
            `${e.id}.${k} non exposé`,
          ).not.toBe(false);
        n += 1;
      }
    expect(n).toBeGreaterThan(250);
  });
});
