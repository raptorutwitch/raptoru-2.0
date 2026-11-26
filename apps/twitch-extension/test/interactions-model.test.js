// Maquette « Interactions » (lab-modules/interactions, Lab seulement) : catalogue viewer de Chaos V2 et règles provisoires
// du faux Core (docs/chaos/EXTENSION_INTERACTIONS.md). 1. Chaque option proposée au viewer est une capacité réelle du
// moteur : vérifiée contre un relevé du registre (test/fixtures/chaos-registry-viewer.json, branche feat/chaos-studio).
// 2. Le futur module `chaos` du Core devra donner les mêmes réponses que le faux Core ; ces cas serviront à ses tests.
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EFFECTS,
  ENGINE,
  controlsFor,
  defaultChoice,
  durationFactor,
  effectById,
  engineRequest,
  hueHex,
  maxDuration,
  minPrice,
  normalizeChoice,
  priceOf,
} from '../extension/lab-modules/interactions/catalog.js';
import {
  QUEUE_MAX,
  QUEUE_TTL_S,
  VIEWER_COOLDOWN_S,
  createChaosMock,
} from '../extension/lab-modules/interactions/model.js';

const REGISTRY = JSON.parse(
  readFileSync(
    new URL('./fixtures/chaos-registry-viewer.json', import.meta.url),
    'utf8',
  ),
);
const T0 = 1_800_000_000_000;
const calm = (opts = {}) =>
  createChaosMock({ scenario: 'calme', now: T0, simulate: false, ...opts });
const choice = (id, patch = {}) => {
  const d = defaultChoice(effectById(id));
  return { ...d, ...patch, opts: { ...d.opts, ...patch.opts } };
};
const priceFor = (m, id, c, t = T0) => m.quote(id, c, t).price;
const buy = (m, id, patch = {}, t = T0, buyer = undefined) => {
  const c = choice(id, patch);
  return m.buy(id, c, priceFor(m, id, c, t), t, buyer);
};
const other = (i) => ({ id: `v${i}`, name: `V${i}` });

/** Every reachable setting of an effect: each style × each level, then each option of each control, and both duration ends. */
function* settings(e, capS = ENGINE.maxDurationS) {
  const base = defaultChoice(e);
  for (const style of e.styles?.map((s) => s.id) ?? [null])
    for (const level of e.levels?.map((l) => l.id) ?? [null]) {
      const c = { ...base, style, level, opts: { ...base.opts } };
      yield c;
      for (const k of controlsFor(e, c)) {
        if (k.kind === 'choice')
          for (const o of k.options)
            yield { ...c, opts: { ...c.opts, [k.id]: o.id } };
        if (k.kind === 'slider')
          for (const v of [k.min, k.max])
            yield { ...c, opts: { ...c.opts, [k.id]: v } };
        if (k.kind === 'point')
          yield { ...c, opts: { ...c.opts, [k.id]: [0, 1] } };
        if (k.kind === 'hue')
          for (const v of [0, 359])
            yield { ...c, opts: { ...c.opts, [k.id]: v } };
        if (k.kind === 'toggle')
          yield { ...c, opts: { ...c.opts, [k.id]: true } };
      }
      yield { ...c, duration: e.duration.min };
      yield { ...c, duration: maxDuration(e, capS) };
    }
}

describe('catalogue : chaque option est une capacité réelle du moteur', () => {
  it('les 13 effets publics du registre, rien de plus, dans leur emplacement', () => {
    expect(EFFECTS.map((e) => e.id).sort()).toEqual(
      Object.keys(REGISTRY.effects).sort(),
    );
    for (const e of EFFECTS) expect(e.slot).toBe(REGISTRY.effects[e.id].slot);
    expect(effectById('flash').photosensitive).toBe(
      REGISTRY.effects.flash.photosensitive,
    );
  });

  it('styles = variantes du registre (préréglages de Studio), forces = niveaux du registre', () => {
    for (const e of EFFECTS) {
      const reg = REGISTRY.effects[e.id];
      for (const s of e.styles ?? []) expect(reg.variants).toContain(s.id);
      for (const l of e.levels ?? []) expect(reg.levels).toContain(l.id);
    }
  });

  it('demande au moteur pour chaque réglage atteignable : paramètres exposés, valeurs dans les bornes, transitions permises', () => {
    let checked = 0;
    for (const e of EFFECTS) {
      const reg = REGISTRY.effects[e.id];
      for (const c of settings(e)) {
        const req = engineRequest(
          e,
          normalizeChoice(e, c, ENGINE.maxDurationS),
        );
        checked += 1;
        expect(req.effect).toBe(e.id);
        if (req.variant) expect(reg.variants).toContain(req.variant);
        if (req.level) expect(reg.levels).toContain(req.level);
        for (const [k, v] of Object.entries(req.params ?? {})) {
          const p = reg.params[k];
          expect(p, `${e.id}.${k}`).toBeTruthy();
          expect(p.exposed, `${e.id}.${k} exposé`).toBe(true);
          if (p.type === 'number') {
            expect(v).toBeGreaterThanOrEqual(p.min);
            expect(v).toBeLessThanOrEqual(p.max);
          }
          if (p.type === 'enum') expect(p.values).toContain(v);
          if (p.type === 'color') expect(v).toMatch(/^#[0-9a-f]{6}$/);
        }
        for (const side of ['in', 'out'])
          if (req.transition?.[side]) {
            expect(reg.transitions[side]).toContain(req.transition[side].kind);
            expect(req.transition[side].duration_ms ?? 0).toBeLessThanOrEqual(
              REGISTRY.engine_limits.max_transition_ms,
            );
          }
        expect(req.duration_ms).toBeGreaterThanOrEqual(
          REGISTRY.engine_limits.min_duration_ms,
        );
        expect(req.duration_ms).toBeLessThanOrEqual(
          REGISTRY.engine_limits.max_duration_ms,
        );
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('durée : le plafond Sécurité du streamer (30 s par défaut) borne la glissière ; 60 s seulement s’il est relevé', () => {
    expect(ENGINE.safetyDurationS * 1000).toBe(
      REGISTRY.safety_default_max_duration_ms,
    );
    const zoom = effectById('zoom');
    expect(maxDuration(zoom)).toBe(30);
    expect(maxDuration(zoom, 60)).toBe(60);
    expect(maxDuration(effectById('flash'), 60)).toBe(9); // effet photosensible : 9 s au plus
    expect(normalizeChoice(zoom, { duration: 45 }).duration).toBe(30);
    expect(normalizeChoice(zoom, { duration: 13 }, 60).duration).toBe(15); // crans de 5 s
  });

  it('teinte libre du Monochrome : une vraie couleur pour `tint` (paramètre couleur exposé du registre)', () => {
    expect(REGISTRY.effects.color.params.tint).toMatchObject({
      type: 'color',
      exposed: true,
    });
    expect(hueHex(0)).toBe('#d22d2d'); // hsl(0°, 65 %, 50 %)
    expect(hueHex(200)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('prix (fictifs) : transparents, jamais cachés', () => {
  it('base × style × force × options × durée, arrondi à 50 ; chaque coefficient est une ligne du détail', () => {
    const p = priceOf(
      effectById('mirror'),
      choice('mirror', { style: 'alterne', duration: 20 }),
    );
    expect(p.lines.map((l) => l.label)).toEqual([
      'Base · 10 s',
      'Alternance',
      '20 s',
    ]);
    expect(p.total).toBe(
      Math.round((700 * 1.3 * durationFactor(20)) / 50) * 50,
    );
  });

  it('plus long, plus fort, plus gros zoom : plus cher ; jamais moins de 50', () => {
    const shake = effectById('shake');
    expect(
      priceOf(shake, choice('shake', { level: 'extreme' })).total,
    ).toBeGreaterThan(
      priceOf(shake, choice('shake', { level: 'leger' })).total,
    );
    expect(
      priceOf(shake, choice('shake', { duration: 30 })).total,
    ).toBeGreaterThan(priceOf(shake, choice('shake', { duration: 10 })).total);
    const zoom = effectById('zoom');
    expect(
      priceOf(zoom, choice('zoom', { opts: { factor: 6 } })).total,
    ).toBeGreaterThan(
      priceOf(zoom, choice('zoom', { opts: { factor: 2 } })).total,
    );
    for (const e of EFFECTS) expect(minPrice(e)).toBeGreaterThanOrEqual(50);
  });

  it('« dès » est bien le moins cher atteignable', () => {
    for (const e of EFFECTS)
      for (const c of settings(e))
        expect(priceOf(e, normalizeChoice(e, c)).total).toBeGreaterThanOrEqual(
          minPrice(e),
        );
  });
});

describe('achat et file', () => {
  it('un effet dont l’emplacement est libre démarre tout de suite ; le solde est débité une fois, au prix affiché', () => {
    const m = calm();
    const before = m.snapshot(T0).balance;
    const c = choice('blur');
    const price = priceFor(m, 'blur', c);
    expect(m.buy('blur', c, price, T0)).toMatchObject({
      ok: true,
      outcome: { kind: 'now' },
    });
    expect(m.snapshot(T0).active.map((a) => a.effect)).toEqual(['blur']);
    expect(m.snapshot(T0).balance).toBe(before - price);
  });

  it('emplacements : un seul retournement à la fois, deux mouvements de caméra ; sécurité du moteur : 4 effets à la fois', () => {
    const m = calm();
    expect(buy(m, 'flip', {}, T0, other(1)).outcome.kind).toBe('now');
    expect(buy(m, 'mirror', {}, T0, other(2)).outcome.kind).toBe('queue'); // transformation : 1
    expect(buy(m, 'shake', {}, T0, other(3)).outcome.kind).toBe('now');
    expect(buy(m, 'zoom', {}, T0, other(4)).outcome.kind).toBe('now');
    expect(buy(m, 'drunk', {}, T0, other(5)).outcome.kind).toBe('queue'); // caméra : 2
    expect(buy(m, 'blur', {}, T0, other(6)).outcome.kind).toBe('now');
    expect(m.snapshot(T0).active).toHaveLength(4);
    // 4 effets actifs : un calque libre ne démarre pas (plafond Sécurité du moteur, 4 par défaut).
    expect(m.quote('fog', choice('fog'), T0).outcome.kind).toBe('queue');
  });

  it('le même effet ne tourne jamais deux fois en même temps : le second attend la fin du premier', () => {
    const m = calm();
    buy(m, 'fog', { duration: 10 }, T0, other(1));
    const q = m.quote(
      'fog',
      choice('fog', { level: 'leger', duration: 10 }),
      T0,
    );
    expect(q.outcome).toMatchObject({ kind: 'queue', position: 1, eta: 10 });
    buy(m, 'fog', { level: 'leger', duration: 10 });
    m.tick(T0 + 10_000);
    expect(m.snapshot(T0 + 10_000).active.map((a) => a.buyer.name)).toEqual([
      'Toi',
    ]);
  });

  it(`file de ${QUEUE_MAX} au plus : refusée avant tout débit, mais un effet qui part tout de suite reste possible`, () => {
    const m = createChaosMock({
      scenario: 'file_pleine',
      now: T0,
      simulate: false,
    });
    const before = m.snapshot(T0).balance;
    expect(buy(m, 'mirror')).toMatchObject({ ok: false, code: 'queue_full' });
    expect(m.snapshot(T0).balance).toBe(before);
    expect(buy(m, 'blur').ok).toBe(true);
  });

  it('un viewer : une seule demande en attente à la fois', () => {
    const m = calm();
    buy(m, 'flip', { duration: 30 }, T0, other(1));
    expect(buy(m, 'mirror').outcome.kind).toBe('queue');
    buy(m, 'fog', { duration: 30 }, T0, other(2));
    expect(buy(m, 'fog')).toMatchObject({ ok: false, code: 'one_waiting' });
  });

  it(`même viewer, même effet : ${VIEWER_COOLDOWN_S} s après sa fin ; un autre viewer peut le relancer aussitôt`, () => {
    const m = calm();
    buy(m, 'blur', { duration: 10 });
    m.tick(T0 + 10_000);
    expect(m.quote('blur', choice('blur'), T0 + 10_000).block?.code).toBe(
      'cooldown',
    );
    expect(buy(m, 'blur', {}, T0 + 10_000, other(1)).ok).toBe(true);
    m.tick(T0 + 20_000);
    expect(
      m.quote('blur', choice('blur'), T0 + 10_000 + VIEWER_COOLDOWN_S * 1000)
        .block,
    ).toBeNull();
  });

  it('effet photosensible : délai commun entre deux flashs, refusé en mode doux', () => {
    const m = calm();
    buy(m, 'flash');
    m.tick(T0 + 6000);
    expect(m.quote('flash', choice('flash'), T0 + 6000).block?.code).toBe(
      'cooldown',
    );
    expect(buy(m, 'flash', {}, T0 + 6000, other(1))).toMatchObject({
      ok: false,
    });
    const soft = createChaosMock({
      scenario: 'mode_doux',
      now: T0,
      simulate: false,
    });
    expect(soft.quote('flash', choice('flash'), T0).block?.code).toBe(
      'safe_mode',
    );
  });

  it('prix changé avant la confirmation, ou durée au-delà du plafond : refusé, rien débité', () => {
    const m = calm();
    const before = m.snapshot(T0).balance;
    expect(m.buy('blur', choice('blur'), 1, T0)).toMatchObject({
      ok: false,
      code: 'price_changed',
    });
    expect(
      m.buy('blur', choice('blur', { duration: 60 }), 99_999, T0),
    ).toMatchObject({ ok: false, code: 'duration_out_of_range' });
    expect(m.snapshot(T0).balance).toBe(before);
    m.setCap(60);
    expect(buy(m, 'blur', { duration: 60 }).ok).toBe(true);
  });

  it(`une demande jamais démarrée après ${QUEUE_TTL_S / 60} min est remboursée intégralement, une seule fois`, () => {
    const m = calm();
    buy(m, 'flip', { duration: 30 }, T0, other(1));
    const before = m.snapshot(T0).balance;
    buy(m, 'mirror');
    expect(m.snapshot(T0).queue).toHaveLength(1);
    m.moderation.setPaused(true); // rien ne démarre pendant la pause : la demande vieillit
    m.tick(T0 + (QUEUE_TTL_S + 1) * 1000);
    m.tick(T0 + (QUEUE_TTL_S + 2) * 1000);
    expect(m.snapshot(T0).mine[0]).toMatchObject({
      state: 'expired',
      refunded: true,
    });
    expect(m.snapshot(T0).balance).toBe(before);
  });

  it('hors live, pause, plein écran exclusif : refus en mots, aucun débit ; les calques restent en plein écran', () => {
    for (const [scenario, code] of [
      ['hors_live', 'offline'],
      ['pause', 'paused'],
    ]) {
      const m = createChaosMock({ scenario, now: T0, simulate: false });
      expect(m.quote('blur', choice('blur'), T0).block?.code).toBe(code);
    }
    const fs = createChaosMock({
      scenario: 'plein_ecran',
      now: T0,
      simulate: false,
    });
    expect(fs.quote('mirror', choice('mirror'), T0).block?.code).toBe(
      'incompatible',
    );
    expect(fs.quote('blink', choice('blink'), T0).block).toBeNull();
  });
});

describe('modération (rôles simulés : la vraie vérification sera côté Core)', () => {
  it('retirer une demande en file : remboursée intégralement par défaut ; sans remboursement, motif obligatoire', () => {
    const m = calm();
    buy(m, 'flip', { duration: 30 }, T0, other(1));
    const before = m.snapshot(T0).balance;
    const r = buy(m, 'mirror').request;
    expect(
      m.moderation.cancel(r.id, { refund: false, reason: '' }, T0).ok,
    ).toBe(false);
    expect(m.moderation.cancel(r.id, {}, T0).ok).toBe(true);
    expect(m.snapshot(T0).balance).toBe(before);
    expect(m.snapshot(T0).history[0]).toMatchObject({
      state: 'cancelled',
      refunded: true,
      actor: 'Modération',
    });
  });

  it('arrêter un effet en cours : remboursé d’office avant 25 %, sinon au choix (motif sans remboursement) ; rembourser après coup une seule fois, avec motif', () => {
    const m = calm();
    const before = m.snapshot(T0).balance;
    const r1 = buy(m, 'blur', { duration: 20 }).request;
    expect(m.moderation.remove(r1.id, {}, T0 + 2000)).toMatchObject({
      ok: true,
      refunded: true,
    });
    const r2 = buy(m, 'pixelate', { duration: 20 }).request;
    expect(m.moderation.remove(r2.id, { refund: false }, T0 + 12_000).ok).toBe(
      false,
    );
    expect(m.moderation.remove(r2.id, {}, T0 + 12_000)).toMatchObject({
      ok: true,
      refunded: false,
    });
    expect(m.moderation.refund(r2.id, '', T0 + 13_000).ok).toBe(false);
    expect(m.moderation.refund(r2.id, 'Bug d’affichage', T0 + 13_000).ok).toBe(
      true,
    );
    expect(m.moderation.refund(r2.id, 'deux fois', T0 + 14_000).ok).toBe(false);
    expect(m.snapshot(T0).balance).toBe(before);
  });

  it('tout arrêter : plus rien à l’écran, Chaos en pause, la file attend ; effet offert : gratuit, devant la file', () => {
    const m = calm();
    buy(m, 'blur', { duration: 20 });
    m.moderation.stopAll(T0 + 1000);
    const s = m.snapshot(T0 + 1000);
    expect(s.active).toHaveLength(0);
    expect(s.status).toBe('paused');
    m.moderation.setPaused(false);
    const gift = m.moderation.trigger('fog', choice('fog'), T0 + 2000);
    expect(gift.request).toMatchObject({
      price: 0,
      by: 'mod',
      state: 'active',
    });
  });
});
