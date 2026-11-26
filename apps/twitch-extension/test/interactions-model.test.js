// Maquette « Interactions » (lab-modules/interactions, Lab seulement) : catalogue viewer de Chaos V2 et règles provisoires
// du faux Core (docs/chaos/EXTENSION_INTERACTIONS.md). 1. Chaque option proposée au viewer est une capacité réelle du
// moteur : vérifiée contre l'extrait du registre (lab-modules/interactions/registry.js, généré depuis la branche
// feat/chaos-studio). 2. Les prix suivent la gêne mesurée sur les vraies valeurs. 3. Le futur module `chaos` du Core
// devra donner les mêmes réponses que le faux Core (file, remboursements, crédits) ; ces cas serviront à ses tests.
import { describe, expect, it } from 'vitest';
import { REGISTRY } from '../extension/lab-modules/interactions/registry.js';
import {
  EFFECTS,
  ENGINE,
  PLANNED,
  controlsFor,
  defaultChoice,
  durationRange,
  effectById,
  engineRequest,
  gene,
  hueHex,
  minPrice,
  normalizeChoice,
  priceOf,
  resolveParams,
} from '../extension/lab-modules/interactions/catalog.js';
import {
  QUEUE_MAX,
  QUEUE_TTL_S,
  VIEWER_COOLDOWN_S,
  createChaosMock,
} from '../extension/lab-modules/interactions/model.js';
import { blinkTimeline } from '../extension/lab-modules/interactions/preview.js';

const T0 = 1_800_000_000_000;
const calm = (opts = {}) =>
  createChaosMock({ scenario: 'calme', now: T0, simulate: false, ...opts });
const choice = (id, patch = {}, capS = ENGINE.safetyDurationS) => {
  const e = effectById(id);
  const d = defaultChoice(e);
  return normalizeChoice(
    e,
    { ...d, ...patch, opts: { ...d.opts, ...patch.opts } },
    capS,
    { reset: Boolean(patch.style || patch.level) && !patch.opts },
  );
};
const priceFor = (m, id, c, t = T0, pay) =>
  m.quote(id, c, t, undefined, pay).price;
const buy = (m, id, patch = {}, t = T0, buyer = undefined) => {
  const c = choice(id, patch);
  return m.buy(
    id,
    c,
    buyer ? m.quote(id, c, t, buyer).price : priceFor(m, id, c, t),
    t,
    buyer,
  );
};
const other = (i) => ({ id: `v${i}`, name: `V${i}` });

/** Every reachable setting: each preset × each level, then each option of each control, and both duration ends. */
function* settings(e, capS = ENGINE.maxDurationS) {
  for (const style of e.presets?.map((s) => s.id) ?? [null])
    for (const level of e.levels?.map((l) => l.id) ?? [null]) {
      const c = normalizeChoice(e, { style, level }, capS, { reset: true });
      yield c;
      for (const k of controlsFor(e, c)) {
        const variants = [];
        if (k.kind === 'choice') for (const o of k.options) variants.push(o.id);
        if (k.kind === 'slider')
          variants.push(
            ...(k.stops ? [k.stops[0], k.stops.at(-1)] : [k.min, k.max]),
          );
        if (k.kind === 'point') variants.push([0, 1]);
        if (k.kind === 'hue') variants.push(0, 359);
        if (k.kind === 'toggle') variants.push(true, false);
        for (const v of variants) {
          const n = normalizeChoice(
            e,
            { ...c, opts: { ...c.opts, [k.id]: v } },
            capS,
          );
          yield n;
          for (const k2 of controlsFor(e, n).filter(
            (x) => !controlsFor(e, c).includes(x),
          ))
            if (k2.kind === 'slider')
              for (const v2 of k2.stops
                ? [k2.stops[0], k2.stops.at(-1)]
                : [k2.min, k2.max])
                yield normalizeChoice(
                  e,
                  { ...n, opts: { ...n.opts, [k2.id]: v2 } },
                  capS,
                );
        }
      }
      const r = durationRange(e, c, capS);
      yield normalizeChoice(e, { ...c, duration: r.min }, capS);
      yield normalizeChoice(e, { ...c, duration: r.max }, capS);
    }
}

describe('catalogue : chaque option est une capacité réelle du moteur', () => {
  it('les 13 effets publics du registre, dans leur emplacement ; les effets à venir ne sont jamais achetables', () => {
    expect(EFFECTS.map((e) => e.id).sort()).toEqual(
      Object.keys(REGISTRY.effects).sort(),
    );
    for (const e of EFFECTS) expect(e.slot).toBe(REGISTRY.effects[e.id].slot);
    for (const p of PLANNED) {
      expect(REGISTRY.effects[p.id]).toBeUndefined();
      expect(p.planned).toBe(true);
    }
    expect(
      createChaosMock({ now: T0, simulate: false }).buy('confetti', {}, 0, T0)
        .ok,
    ).toBe(false);
  });

  it('préréglages = variantes du registre (préréglages de Studio), forces = niveaux du registre', () => {
    for (const e of EFFECTS) {
      const reg = REGISTRY.effects[e.id];
      for (const s of e.presets ?? [])
        expect(Object.keys(reg.variants)).toContain(s.variant ?? s.id);
      for (const l of e.levels ?? [])
        expect(Object.keys(reg.levels)).toContain(l.id);
    }
  });

  it('libellés viewer seulement : Zoom, Ivresse, Flash gardent leurs identifiants moteur', () => {
    expect([
      effectById('zoom').label,
      effectById('drunk').label,
      effectById('flash').label,
    ]).toEqual(['Zoom', 'Ivresse', 'Flash']);
  });

  it('demande au moteur pour chaque réglage atteignable : paramètres exposés, valeurs dans les bornes, transitions permises', () => {
    let checked = 0;
    for (const e of EFFECTS) {
      const reg = REGISTRY.effects[e.id];
      for (const c of settings(e)) {
        const req = engineRequest(e, c);
        checked += 1;
        expect(req.effect).toBe(e.id);
        if (req.variant)
          expect(Object.keys(reg.variants)).toContain(req.variant);
        if (req.level) expect(Object.keys(reg.levels)).toContain(req.level);
        for (const [k, v] of Object.entries(req.params ?? {})) {
          const p = reg.params[k];
          expect(p, `${e.id}.${k}`).toBeTruthy();
          expect(p.exposed, `${e.id}.${k} exposé`).not.toBe(false);
          if (p.type === 'number') {
            expect(v, `${e.id}.${k}`).toBeGreaterThanOrEqual(p.min);
            expect(v, `${e.id}.${k}`).toBeLessThanOrEqual(p.max);
          }
          if (p.type === 'enum') expect(p.values).toContain(v);
          if (p.type === 'color') expect(v).toMatch(/^#[0-9a-f]{6}$/);
        }
        for (const side of ['in', 'out'])
          if (req.transition?.[side]) {
            expect(reg.transitions[side].kinds).toContain(
              req.transition[side].kind,
            );
            expect(req.transition[side].duration_ms ?? 0).toBeLessThanOrEqual(
              REGISTRY.limits.max_transition_ms,
            );
          }
        expect(req.duration_ms).toBeGreaterThanOrEqual(
          REGISTRY.limits.min_duration_ms,
        );
        expect(req.duration_ms).toBeLessThanOrEqual(
          REGISTRY.limits.max_duration_ms,
        );
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('tunnel : le zoom supplémentaire se retire (zoom ×1, paramètre réel) ou se règle', () => {
    const t = effectById('tunnel');
    expect(
      engineRequest(t, choice('tunnel', { opts: { zoomOn: false } })).params
        .zoom,
    ).toBe(1);
    expect(
      engineRequest(t, choice('tunnel', { opts: { zoom: 2.5 } })).params.zoom,
    ).toBe(2.5);
    expect(choice('tunnel', { level: 'extreme' }).opts.zoom).toBe(
      REGISTRY.effects.tunnel.levels.extreme.params.zoom > 3.5
        ? 3.5
        : REGISTRY.effects.tunnel.levels.extreme.params.zoom,
    );
  });

  it('pixelisation : la taille réelle des pixels (`block`) ; Rétro reste à Studio', () => {
    const p = effectById('pixelate');
    expect(p.presets.map((s) => s.id)).not.toContain('retro');
    expect(
      engineRequest(p, choice('pixelate', { opts: { block: 80 } })).params
        .block,
    ).toBe(80);
  });

  it('paupières : modes réels du moteur ; « Un clignement » = une seule fermeture (durée fixe, chronologie du moteur)', () => {
    const b = effectById('blink');
    const one = choice('blink', { style: 'ponctuel', opts: { shut: 1 } });
    expect(engineRequest(b, one)).toMatchObject({
      variant: 'naturel',
      duration_ms: 3000,
      params: { hold_ms: 1000 },
    });
    // Le moteur (mode naturel) : premier clignement ≤ 0,45 s, le suivant après l'intervalle → un seul dans 3 s.
    const p = resolveParams(b, one);
    expect(
      0.45 + (p.close_ms + p.hold_ms + p.open_ms + p.interval_ms) / 1000,
    ).toBeGreaterThan(one.duration);
    const tl = blinkTimeline(
      resolveParams(b, choice('blink', { style: 'serie', opts: { count: 4 } })),
    );
    expect(tl.keys.filter((k) => k.c > 0.9).length).toBe(8); // 4 fermetures (fermé puis maintien)
  });
});

describe('durées : registre, Sécurité de Studio, autorisation viewer', () => {
  it('Sécurité de Studio (30 s par défaut) borne la glissière ; 60 s seulement si elle est relevée (simulée en Lab)', () => {
    expect(ENGINE.safetyDurationS).toBe(30);
    expect(ENGINE.maxDurationS).toBe(60);
    const zoom = effectById('zoom');
    expect(durationRange(zoom, choice('zoom')).max).toBe(30);
    expect(durationRange(zoom, choice('zoom'), 60).max).toBe(60);
    expect(normalizeChoice(zoom, { duration: 45 }).duration).toBe(30);
    expect(normalizeChoice(zoom, { duration: 13 }, 60).duration).toBe(15);
  });

  it('limites propres : Flash 3 à 9 s, Yeux fermés 15 s au plus, Impact et Un clignement fixes, pulsations 20 s au plus', () => {
    expect(
      durationRange(effectById('flash'), choice('flash'), 60),
    ).toMatchObject({ min: 3, max: 9 });
    expect(
      durationRange(
        effectById('blink'),
        choice('blink', { style: 'ferme' }),
        60,
      ).max,
    ).toBe(15);
    expect(
      durationRange(
        effectById('shake'),
        choice('shake', { style: 'impact' }),
        60,
      ),
    ).toMatchObject({ fixed: false, min: 3, max: 3 });
    expect(
      durationRange(
        effectById('blink'),
        choice('blink', { style: 'ponctuel' }),
        60,
      ).fixed,
    ).toBe(true);
    expect(
      durationRange(
        effectById('zoom'),
        choice('zoom', { style: 'pulsations' }),
        60,
      ).max,
    ).toBe(20);
    expect(durationRange(effectById('fog'), choice('fog'), 60).min).toBe(10);
  });
});

describe('prix (fictifs) : la gêne mesurée sur les vraies valeurs, jamais sur un nom', () => {
  const p = (id, patch, capS) =>
    priceOf(effectById(id), choice(id, patch, capS)).total;
  it('le détail dit ce qui fait le prix : base, gêne du réglage (avec ses valeurs), durée', () => {
    const lines = priceOf(
      effectById('shake'),
      choice('shake', { style: 'seisme' }),
    ).lines;
    expect(lines.map((l) => l.label.split(' :')[0])).toEqual([
      'Base · 10 s, réglage de référence',
      'Gêne de ce réglage',
      'Durée 10 s',
    ]);
    expect(lines[1].label).toContain('4,5 %'); // amplitude réelle du Séisme (amp_y 4,5 % à intensité 100 %)
  });

  it('Tremblement : prix selon l’amplitude réelle et le temps où ça bouge (Impact : un choc de moins d’une seconde)', () => {
    expect(p('shake', { style: 'seisme' })).toBeGreaterThan(
      p('shake', { style: 'secousse' }),
    );
    expect(p('shake', { style: 'impact' })).toBeLessThan(
      p('shake', { style: 'secousse' }),
    );
    expect(p('shake', { style: 'vibration' })).toBeLessThan(
      p('shake', { style: 'leger' }) * 1.01,
    );
    expect(p('shake', { opts: { intensity: 1 } })).toBeGreaterThan(
      p('shake', { opts: { intensity: 0.4 } }),
    );
  });

  it('ce qui cache l’écran coûte plus qu’une coloration ; plus long, plus cher', () => {
    expect(p('fog', { level: 'extreme' })).toBeGreaterThan(
      p('fog', { level: 'dense' }),
    );
    expect(p('fog', { level: 'dense' })).toBeGreaterThan(
      p('fog', { level: 'marque' }),
    );
    expect(p('blink', { style: 'ferme', duration: 10 })).toBeGreaterThan(
      p('blink', { style: 'naturel' }) * 3,
    );
    expect(p('flip')).toBeGreaterThan(p('color') * 4);
    expect(p('fog', { level: 'extreme' })).toBeGreaterThan(
      p('color', { style: 'inversion' }) * 3,
    );
    expect(p('flip', { duration: 30 })).toBeGreaterThan(
      p('flip', { duration: 10 }),
    );
    expect(p('pixelate', { opts: { block: 80 } })).toBeGreaterThan(
      p('pixelate', { opts: { block: 10 } }),
    );
    expect(p('tunnel', { opts: { zoomOn: false } })).toBeLessThan(p('tunnel'));
    // Pulsations : quatre zooms, quelle que soit la durée → même prix à 5 et à 20 s (à l'arrondi près).
    expect(
      Math.abs(
        p('zoom', { style: 'pulsations', duration: 20 }, 60) -
          p('zoom', { style: 'pulsations', duration: 5 }, 60),
      ),
    ).toBeLessThanOrEqual(50);
  });

  it('« dès » est bien le moins cher atteignable, jamais moins de 50', () => {
    for (const e of EFFECTS) {
      expect(minPrice(e)).toBeGreaterThanOrEqual(50);
      for (const c of settings(e, 60))
        expect(priceOf(e, c).total).toBeGreaterThanOrEqual(minPrice(e));
      expect(gene(e, defaultChoice(e))).toBeGreaterThan(0);
    }
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
    expect(buy(m, 'mirror', {}, T0, other(2)).outcome.kind).toBe('queue');
    expect(buy(m, 'shake', {}, T0, other(3)).outcome.kind).toBe('now');
    expect(buy(m, 'zoom', {}, T0, other(4)).outcome.kind).toBe('now');
    expect(buy(m, 'drunk', {}, T0, other(5)).outcome.kind).toBe('queue');
    expect(buy(m, 'blur', {}, T0, other(6)).outcome.kind).toBe('now');
    expect(m.snapshot(T0).active).toHaveLength(4);
    expect(m.quote('fog', choice('fog'), T0).outcome.kind).toBe('queue');
  });

  it('le même effet ne tourne jamais deux fois en même temps : le second attend la fin du premier', () => {
    const m = calm();
    buy(m, 'fog', { duration: 10 }, T0, other(1));
    const q = m.quote(
      'fog',
      choice('fog', { level: 'dense', duration: 10 }),
      T0,
    );
    expect(q.outcome).toMatchObject({ kind: 'queue', position: 1, eta: 10 });
    buy(m, 'fog', { level: 'dense', duration: 10 });
    m.tick(T0 + 10_000);
    expect(m.snapshot(T0 + 10_000).active.map((a) => a.buyer.name)).toEqual([
      'Toi',
    ]);
  });

  it(`file de ${QUEUE_MAX} au plus, refusée avant tout débit ; un viewer : une seule demande en attente`, () => {
    const full = createChaosMock({
      scenario: 'file_pleine',
      now: T0,
      simulate: false,
    });
    const before = full.snapshot(T0).balance;
    expect(buy(full, 'mirror')).toMatchObject({
      ok: false,
      code: 'queue_full',
    });
    expect(full.snapshot(T0).balance).toBe(before);
    expect(buy(full, 'blur').ok).toBe(true);
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
  });

  it('flash : délai commun entre deux flashs, refusé en mode doux', () => {
    const m = calm();
    buy(m, 'flash');
    m.tick(T0 + 9000);
    expect(m.quote('flash', choice('flash'), T0 + 9000).block?.code).toBe(
      'cooldown',
    );
    expect(buy(m, 'flash', {}, T0 + 9000, other(1)).ok).toBe(false);
    const soft = createChaosMock({
      scenario: 'mode_doux',
      now: T0,
      simulate: false,
    });
    expect(soft.quote('flash', choice('flash'), T0).block?.code).toBe(
      'safe_mode',
    );
  });

  it('prix changé avant la confirmation, ou durée au-delà du plafond : refusé, rien débité ; 60 s quand le plafond est relevé', () => {
    const m = calm();
    const before = m.snapshot(T0).balance;
    expect(m.buy('blur', choice('blur'), 1, T0)).toMatchObject({
      ok: false,
      code: 'price_changed',
    });
    expect(
      m.buy('blur', { ...choice('blur'), duration: 60 }, 99_999, T0),
    ).toMatchObject({ ok: false, code: 'duration_out_of_range' });
    expect(m.snapshot(T0).balance).toBe(before);
    m.setCap(60);
    const c = choice('blur', { duration: 60 }, 60);
    expect(m.buy('blur', c, priceFor(m, 'blur', c), T0).ok).toBe(true);
  });

  it(`jamais démarrée après ${QUEUE_TTL_S / 60} min : remboursée intégralement, une seule fois`, () => {
    const m = calm();
    buy(m, 'flip', { duration: 30 }, T0, other(1));
    const before = m.snapshot(T0).balance;
    buy(m, 'mirror');
    m.moderation.setPaused(true);
    m.tick(T0 + (QUEUE_TTL_S + 1) * 1000);
    m.tick(T0 + (QUEUE_TTL_S + 2) * 1000);
    expect(m.snapshot(T0).mine[0]).toMatchObject({
      state: 'expired',
      refunded: true,
    });
    expect(m.snapshot(T0).balance).toBe(before);
  });
});

describe('crédits d’effets offerts (simulation ; le Core les rendra persistants et consommés une seule fois)', () => {
  const creditFor = (m, effect) =>
    m.snapshot(T0).credits.find((c) => c.effect === effect);
  it('payer avec un crédit : prix 0, solde intact, crédit consommé une fois', () => {
    const m = calm();
    const cr = creditFor(m, 'flip');
    const before = m.snapshot(T0).balance;
    const c = choice('flip', { duration: 20 });
    const q = m.quote('flip', c, T0, undefined, { credit: cr.id });
    expect(q).toMatchObject({ price: 0, block: null });
    expect(m.buy('flip', c, 0, T0, undefined, { credit: cr.id }).ok).toBe(true);
    expect(m.snapshot(T0).balance).toBe(before);
    expect(creditFor(m, 'flip')).toBeUndefined();
    expect(m.buy('flip', c, 0, T0 + 1, undefined, { credit: cr.id }).ok).toBe(
      false,
    );
  });

  it('le crédit borne le réglage : durée et force', () => {
    const m = calm();
    const flip = creditFor(m, 'flip'); // 20 s au plus
    expect(
      m.quote('flip', choice('flip', { duration: 30 }), T0, undefined, {
        credit: flip.id,
      }).block?.code,
    ).toBe('credit_mismatch');
    const fog = creditFor(m, 'fog'); // Marqué ou Dense, 15 s
    expect(
      m.quote(
        'fog',
        choice('fog', { level: 'extreme', duration: 15 }),
        T0,
        undefined,
        { credit: fog.id },
      ).block?.code,
    ).toBe('credit_mismatch');
    expect(
      m.quote(
        'fog',
        choice('fog', { level: 'dense', duration: 15 }),
        T0,
        undefined,
        { credit: fog.id },
      ).block,
    ).toBeNull();
    expect(
      m.quote('mirror', choice('mirror'), T0, undefined, { credit: fog.id })
        .block?.code,
    ).toBe('credit_mismatch');
  });

  it('demande payée par crédit et jamais jouée : le crédit est rendu (pas des Jetons)', () => {
    const m = calm();
    buy(m, 'flip', { duration: 30 }, T0, other(1));
    const cr =
      creditFor(m, 'mirror') ??
      m.moderation.grantCredit(
        { viewer: m.me, effect: 'mirror', reason: 'Test du Lab' },
        T0,
      ).credit;
    const before = m.snapshot(T0).balance;
    const r = m.buy('mirror', choice('mirror'), 0, T0, undefined, {
      credit: cr.id,
    }).request;
    expect(m.moderation.cancel(r.id, {}, T0).ok).toBe(true);
    expect(m.snapshot(T0).balance).toBe(before);
    expect(creditFor(m, 'mirror')?.id).toBe(cr.id);
    expect(
      m
        .snapshot(T0)
        .creditLog.map((l) => l.kind)
        .slice(0, 3),
    ).toEqual(['restored', 'used', 'granted']);
  });

  it('attribution par la modération : motif obligatoire ; retrait d’un crédit pas encore utilisé', () => {
    const m = calm();
    expect(
      m.moderation.grantCredit(
        { viewer: other(1), effect: 'flip', reason: '' },
        T0,
      ).ok,
    ).toBe(false);
    const g = m.moderation.grantCredit(
      {
        viewer: other(1),
        effect: 'flip',
        constraints: { maxS: 10 },
        reason: 'Gagnant du quiz',
      },
      T0,
    );
    expect(g.ok).toBe(true);
    expect(
      m.snapshot(T0).allCredits.find((c) => c.id === g.credit.id),
    ).toMatchObject({ state: 'available', viewer: { id: 'v1' } });
    expect(m.moderation.revokeCredit(g.credit.id, '', T0).ok).toBe(false);
    expect(
      m.moderation.revokeCredit(g.credit.id, 'Erreur de viewer', T0).ok,
    ).toBe(true);
    expect(m.moderation.revokeCredit(g.credit.id, 'deux fois', T0).ok).toBe(
      false,
    );
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
  });

  it('arrêter un effet en cours : remboursé d’office avant 25 %, sinon au choix (motif sans remboursement) ; rembourser après coup une seule fois', () => {
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

  it('tout arrêter : plus rien à l’écran, achats suspendus, la file attend ; effet offert : gratuit, devant la file', () => {
    const m = calm();
    buy(m, 'blur', { duration: 20 });
    m.moderation.stopAll(T0 + 1000);
    const s = m.snapshot(T0 + 1000);
    expect(s.active).toHaveLength(0);
    expect(s.status).toBe('paused');
    m.moderation.setPaused(false);
    expect(
      m.moderation.trigger('fog', choice('fog'), T0 + 2000).request,
    ).toMatchObject({ price: 0, by: 'mod', state: 'active' });
  });
});

describe('divers', () => {
  it('teinte libre du Monochrome : une vraie couleur pour `tint` (paramètre couleur exposé du registre)', () => {
    expect(REGISTRY.effects.color.params.tint).toMatchObject({ type: 'color' });
    expect(hueHex(0)).toBe('#d22d2d');
  });
});
