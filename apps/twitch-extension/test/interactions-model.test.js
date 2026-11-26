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
  PRICE_RANGES,
  reachableSettings,
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
  FAILURES,
  REFUND_POLICY,
  STUDIO_GRACE_S,
  QUEUE_MAX,
  QUEUE_TTL_S,
  VIEWER_COOLDOWN_S,
  conditionsFor,
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
      'Fourchette Tremblement',
      'Gêne de ce réglage',
      'Durée 10 s',
      'Place dans la fourchette (sévérité / réglage le plus sévère)',
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
    expect(p('flip')).toBeGreaterThan(p('color') * 3);
    expect(p('fog', { level: 'extreme' })).toBeGreaterThan(
      p('color', { style: 'inversion' }) * 2,
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
    const m = calm({ balance: 1_000_000 });
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

describe('Un clignement : charges (10, recharge progressive) ; plafonds distincts des demandes, de la cadence et de la sécurité', () => {
  const blinkOnce = (patch = {}) =>
    choice('blink', { style: 'ponctuel', ...patch });
  const quick = (m, t, buyer, key) => {
    const c = blinkOnce();
    const q = m.quote('blink', c, t, buyer);
    return m.buy('blink', c, q.price, t, buyer, key ? { key } : {});
  };

  it('10 charges au plus, une par clignement confirmé, une revient toutes les 6 s ; pas de délai d’une minute', () => {
    const m = calm({ balance: 1_000_000 });
    const c = blinkOnce();
    expect(m.quote('blink', c, T0).charges).toMatchObject({ n: 10, max: 10 });
    for (let i = 0; i < 10; i += 1)
      expect(quick(m, T0 + i * 100).ok).toBe(true);
    const empty = m.quote('blink', c, T0 + 1000);
    expect(empty.block).toMatchObject({ code: 'no_charge' });
    expect(empty.charges).toMatchObject({ n: 0, nextS: 5 });
    expect(m.quote('blink', c, T0 + 6000).charges.n).toBe(1);
    expect(m.quote('blink', c, T0 + 61_000).charges.n).toBe(10);
    // Les autres préréglages gardent leurs règles (délai, une demande en attente).
    expect(m.quote('blink', choice('blink'), T0 + 1000).charges).toBeNull();
  });

  it('dix clignements demandés d’un coup : joués un par un, dans l’ordre, sans chevauchement ni doublon', () => {
    const m = calm({ balance: 1_000_000 });
    const ids = [];
    for (let i = 0; i < 10; i += 1) ids.push(quick(m, T0 + i * 50).request.id);
    expect(new Set(ids).size).toBe(10);
    const started = [];
    for (let t = T0; t < T0 + 60_000; t += 250) {
      m.tick(t);
      const s = m.snapshot(t);
      expect(
        s.active.filter((a) => a.effect === 'blink').length,
      ).toBeLessThanOrEqual(1);
      for (const a of s.active) if (!started.includes(a.id)) started.push(a.id);
    }
    expect(started).toEqual(ids);
    const done = m
      .snapshot(T0 + 60_000)
      .history.filter((r) => ids.includes(r.id));
    expect(done.every((r) => r.state === 'done')).toBe(true);
    // Jamais deux à la fois, et au moins BURST.gapS entre la fin de l’un et le départ du suivant.
    const sorted = [...done].sort((a, b) => a.started - b.started);
    for (let i = 1; i < sorted.length; i += 1)
      expect(sorted[i].started - sorted[i - 1].finished).toBeGreaterThanOrEqual(
        500,
      );
  });

  it('deux viewers ne cumulent pas au-delà des plafonds communs (file de 10, 20 par minute) ; double clic = un seul achat', () => {
    const m = calm({ balance: 1_000_000 });
    let ok = 0;
    for (let i = 0; i < 10; i += 1) ok += quick(m, T0 + i * 10).ok ? 1 : 0;
    // Le premier joue, neuf attendent : un autre viewer prend la 10e place d’attente, le suivant est refusé.
    expect(ok).toBe(10);
    expect(quick(m, T0 + 200, other(1)).ok).toBe(true);
    expect(m.snapshot(T0 + 200).burst).toHaveLength(10);
    expect(quick(m, T0 + 210, other(2))).toMatchObject({
      ok: false,
      code: 'burst_full',
    });
    // Minute glissante : 20 départs + en attente au plus, quel que soit le nombre de viewers.
    const r = calm({ balance: 1_000_000 });
    let accepted = 0;
    for (let t = T0; t < T0 + 50_000; t += 1000) {
      r.tick(t);
      for (const v of [other(1), other(2), other(3)])
        accepted += quick(r, t, v).ok ? 1 : 0;
    }
    expect(accepted).toBeLessThanOrEqual(20);
    // Idempotence : la même intention envoyée deux fois ne débite et ne consomme qu’une fois.
    const d = calm();
    const before = d.snapshot(T0).balance;
    const a = quick(d, T0, undefined, 'k-1');
    const b = quick(d, T0 + 30, undefined, 'k-1');
    expect(b).toMatchObject({ ok: true, duplicate: true });
    expect(b.request.id).toBe(a.request.id);
    expect(before - d.snapshot(T0 + 30).balance).toBe(a.request.price);
    expect(d.quote('blink', blinkOnce(), T0 + 30).charges.n).toBe(9);
  });

  it('jamais joué (retiré) : Jetons et charge rendus ; la modération voit les clignements en attente', () => {
    const m = calm({ balance: 1_000_000 });
    quick(m, T0);
    const second = quick(m, T0 + 10).request;
    expect(m.snapshot(T0 + 10).burst.map((r) => r.id)).toEqual([second.id]);
    const before = m.snapshot(T0 + 20).balance;
    expect(m.moderation.cancel(second.id, {}, T0 + 20).ok).toBe(true);
    expect(m.snapshot(T0 + 20).balance).toBe(before + second.price);
    expect(m.quote('blink', blinkOnce(), T0 + 20).charges.n).toBe(9);
  });
});

describe('parcours : achats simultanés, file, incompatibilités', () => {
  it('plusieurs viewers, effets compatibles : ensemble à l’écran ; familles différentes cumulées jusqu’à la sécurité (4)', () => {
    const m = calm();
    expect(buy(m, 'fog').outcome.kind).toBe('now');
    expect(buy(m, 'blur', {}, T0, other(1)).outcome.kind).toBe('now');
    expect(buy(m, 'shake', {}, T0, other(2)).outcome.kind).toBe('now');
    expect(buy(m, 'flip', {}, T0, other(3)).outcome.kind).toBe('now');
    expect(m.snapshot(T0).active).toHaveLength(4);
    expect(buy(m, 'color', {}, T0, other(4)).outcome.kind).toBe('queue');
  });

  it('deux viewers, même effet : le second attend la fin du premier ; incompatibles (même emplacement) : en file', () => {
    const m = calm();
    buy(m, 'zoom');
    const second = buy(m, 'zoom', {}, T0, other(1));
    expect(second.outcome).toMatchObject({ kind: 'queue', position: 1 });
    buy(m, 'flip', {}, T0, other(2));
    expect(buy(m, 'mirror', {}, T0, other(3)).outcome.kind).toBe('queue');
  });

  it('annulé pendant son démarrage : la demande a démarré entre-temps, elle est arrêtée avec le remboursement voulu', () => {
    const m = calm();
    buy(m, 'flip', { duration: 5 }, T0, other(1));
    const waiting = buy(m, 'mirror').request;
    m.tick(T0 + 5000); // le retournement finit, le miroir démarre…
    expect(m.snapshot(T0 + 5000).active.map((a) => a.id)).toContain(waiting.id);
    const before = m.snapshot(T0 + 5000).balance;
    const out = m.moderation.cancel(waiting.id, {}, T0 + 5000); // … pendant que la modération le retirait
    expect(out).toMatchObject({ ok: true, started: true, refunded: true });
    expect(m.snapshot(T0 + 5000).balance).toBe(before + waiting.price);
  });

  it('tout arrêter pendant plusieurs effets : tout s’arrête, remboursés s’ils avaient joué moins de 25 %', () => {
    const m = calm();
    const a = buy(m, 'fog', { duration: 20 }).request;
    buy(m, 'blur', { duration: 20 }, T0, other(1));
    const before = m.snapshot(T0).balance;
    m.moderation.stopAll(T0 + 2000);
    const s = m.snapshot(T0 + 2000);
    expect(s.active).toHaveLength(0);
    expect(s.status).toBe('paused');
    expect(s.balance).toBe(before + a.price);
  });

  it('Chaos désactivé, Studio interrompu, hors live : refusé avant tout débit, avec la raison ; Studio interrompu rend ce qui jouait', () => {
    for (const [scenario, code] of [
      ['desactive', 'disabled'],
      ['studio_coupe', 'engine_down'],
      ['hors_live', 'offline'],
    ]) {
      const m = createChaosMock({ scenario, now: T0, simulate: false });
      const before = m.snapshot(T0).balance;
      const out = buy(m, 'blur');
      expect(out).toMatchObject({ ok: false, code });
      expect(out.message.length).toBeGreaterThan(10);
      expect(m.snapshot(T0).balance).toBe(before);
      // La modération ne lève pas ces états avec « Reprendre les achats ».
      m.moderation.setPaused(false);
      expect(m.snapshot(T0).status).not.toBe('open');
    }
    const cut = createChaosMock({
      scenario: 'studio_coupe',
      now: T0,
      simulate: false,
    });
    const interrupted = cut
      .snapshot(T0)
      .history.filter((r) => r.state === 'interrupted');
    expect(interrupted.length).toBeGreaterThan(0);
    // Politique des interruptions : rendu s'il a joué moins de la moitié, sinon non ; tracé dans le motif.
    for (const r of interrupted) {
      const played = (T0 - r.started) / (r.duration * 1000);
      expect(r.refunded).toBe(played < REFUND_POLICY.interruptedBelow);
      expect(r.reason).toMatch(/Studio interrompu à [0-9]+ %/);
    }
  });
});

describe('persistance (Lab) : ce que le Core gardera en base', () => {
  it('un rechargement retrouve solde, demandes en cours, file, crédits et charges', () => {
    const m = calm({ balance: 100_000 });
    buy(m, 'fog', { duration: 20 });
    const c = choice('blink', { style: 'ponctuel' });
    m.buy('blink', c, m.quote('blink', c, T0).price, T0);
    const saved = m.exportState();
    const r = createChaosMock({
      scenario: 'calme',
      now: T0 + 3000,
      simulate: false,
      restore: saved,
    });
    expect(r.restored).toBe(true);
    const a = m.snapshot(T0 + 3000);
    const b = r.snapshot(T0 + 3000);
    expect(b.balance).toBe(a.balance);
    expect(b.active.map((x) => x.id)).toEqual(a.active.map((x) => x.id));
    expect(b.credits.map((x) => x.id)).toEqual(a.credits.map((x) => x.id));
    expect(r.quote('blink', c, T0 + 3000).charges.n).toBe(9);
    // Un autre scénario repart de zéro.
    expect(
      createChaosMock({
        scenario: 'normal',
        now: T0,
        simulate: false,
        restore: saved,
      }).restored,
    ).toBe(false);
  });
});

describe('Flou et Pixelisation : une glissière sur le vrai paramètre', () => {
  it('Flou : puissance = `amount` (1 à 100 au moteur), sans boutons de force ; Pixelisation : une seule glissière (`block`)', () => {
    const blur = effectById('blur');
    expect(blur.levels).toBeNull();
    const k = blur.controls.find((x) => x.id === 'amount');
    const p = REGISTRY.effects.blur.params.amount;
    expect(k.min).toBeGreaterThanOrEqual(p.min);
    expect(k.max).toBeLessThanOrEqual(p.max);
    const strong = choice('blur', { opts: { amount: 90 } });
    expect(engineRequest(blur, strong).params.amount).toBe(90);
    expect(priceOf(blur, strong).total).toBeGreaterThan(
      priceOf(blur, choice('blur', { opts: { amount: 25 } })).total,
    );
    const pix = effectById('pixelate');
    expect(pix.levels).toBeNull();
    expect(pix.controls.filter((x) => x.kind === 'slider')).toHaveLength(1);
  });
});

describe('remboursements : jamais démarré = tout rendu ; idempotents ; journal des transactions', () => {
  it('chaque échec avant démarrage rend intégralement les Jetons, une seule fois, avec sa raison', () => {
    for (const code of Object.keys(FAILURES).filter(
      (c) => c !== 'queue_expired',
    )) {
      const m = calm();
      const before = m.snapshot(T0).balance;
      m.failNext(code);
      const out = buy(m, 'fog');
      expect(out.ok).toBe(true);
      const r = m.snapshot(T0).history.find((x) => x.id === out.request.id);
      expect(r).toMatchObject({
        state: 'failed',
        refunded: true,
        code,
        reason: FAILURES[code],
      });
      expect(m.snapshot(T0).balance).toBe(before);
      // Rembourser encore (modération, nouvel envoi) : refusé, aucun second remboursement au journal.
      expect(m.moderation.refund(r.id, 'essai double', T0 + 10).ok).toBe(false);
      const refunds = m
        .snapshot(T0 + 10)
        .ledger.filter((l) => l.request === r.id && l.kind === 'refund');
      expect(refunds).toHaveLength(1);
      expect(m.snapshot(T0 + 10).balance).toBe(before);
    }
  });

  it('payé avec un crédit : c’est le crédit qui revient ; un clignement : sa charge aussi', () => {
    const m = calm();
    const c = m.snapshot(T0).credits.find((x) => x.effect === 'flip');
    m.failNext('engine_unavailable');
    const choiceFlip = choice('flip', { duration: 10 });
    const out = m.buy('flip', choiceFlip, 0, T0, undefined, { credit: c.id });
    expect(out.ok).toBe(true);
    expect(m.snapshot(T0).credits.map((x) => x.id)).toContain(c.id);
    expect(
      m
        .snapshot(T0)
        .ledger.find(
          (l) => l.request === out.request.id && l.kind === 'credit_restored',
        ),
    ).toBeTruthy();
    const b = calm({ balance: 100_000 });
    const once = choice('blink', { style: 'ponctuel' });
    b.failNext('no_ack');
    b.buy('blink', once, b.quote('blink', once, T0).price, T0);
    expect(b.quote('blink', once, T0).charges.n).toBe(10);
  });

  it('réponse réseau perdue : le renvoi de la même intention ne débite pas deux fois ; le journal a un seul débit', () => {
    const m = calm();
    const c = choice('vhs');
    const p = m.quote('vhs', c, T0).price;
    const before = m.snapshot(T0).balance;
    const first = m.buy('vhs', c, p, T0, undefined, { key: 'intent-42' });
    const retry = m.buy('vhs', c, p, T0 + 2000, undefined, {
      key: 'intent-42',
    });
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    expect(retry.request.id).toBe(first.request.id);
    expect(m.snapshot(T0 + 2000).balance).toBe(before - p);
    expect(
      m.snapshot(T0 + 2000).ledger.filter((l) => l.kind === 'debit'),
    ).toHaveLength(1);
  });

  it(`Studio déconnecté : la file attend ${STUDIO_GRACE_S} s, puis tout ce qui attendait est rendu`, () => {
    const m = createChaosMock({
      scenario: 'studio_coupe',
      now: T0,
      simulate: false,
    });
    const waiting = m.snapshot(T0).queue;
    expect(waiting.length).toBeGreaterThan(0);
    m.tick(T0 + (STUDIO_GRACE_S - 1) * 1000);
    expect(m.snapshot(T0 + (STUDIO_GRACE_S - 1) * 1000).queue).toHaveLength(
      waiting.length,
    );
    m.tick(T0 + STUDIO_GRACE_S * 1000);
    const s = m.snapshot(T0 + STUDIO_GRACE_S * 1000);
    expect(s.queue).toHaveLength(0);
    for (const w of waiting)
      expect(s.history.find((r) => r.id === w.id)).toMatchObject({
        state: 'failed',
        code: 'studio_offline',
        refunded: true,
      });
  });

  it('image du jeu indisponible (signalée par Studio) : seuls les effets qui la transforment attendent ; aucun « plein écran » supposé', () => {
    const m = createChaosMock({
      scenario: 'capture_ko',
      now: T0,
      simulate: false,
    });
    expect(buy(m, 'blur')).toMatchObject({
      ok: false,
      code: 'capture_unavailable',
    });
    expect(buy(m, 'fog').ok).toBe(true);
    for (const e of EFFECTS)
      for (const line of conditionsFor(e, defaultChoice(e)))
        expect(line.text).not.toMatch(/plein écran/u);
  });
});

describe('durées jusqu’à 60 s : l’extension ne bride rien en dessous du plafond de Studio', () => {
  it('plafond Sécurité à 60 s : chaque effet atteint 60 s, sauf les variantes courtes par nature', () => {
    const SHORT = new Set([
      'flash',
      'shake:impact',
      'blink:ponctuel',
      'blink:ferme',
      'zoom:pulsations',
      'zoom:aller_retour',
      'zoom:intermittent',
    ]);
    for (const e of EFFECTS)
      for (const p of e.presets ?? [null]) {
        const c = normalizeChoice(e, { style: p?.id ?? null }, 60, {
          reset: true,
        });
        const r = durationRange(e, c, 60);
        if (SHORT.has(e.id) || SHORT.has(`${e.id}:${p?.id}`))
          expect(r.max).toBeLessThan(60);
        else expect(r.max, `${e.id} ${p?.id ?? ''}`).toBe(60);
      }
  });
});

describe('fourchettes de prix (Antoni, 28/11) : une activation coûte entre le minimum et le maximum de son effet', () => {
  it('chaque réglage atteignable est dans sa fourchette ; le maximum n’est atteint qu’au réglage le plus sévère', () => {
    for (const e of EFFECTS) {
      const [lo, hi] = PRICE_RANGES[e.id];
      let top = 0;
      for (const c of reachableSettings(e)) {
        const p = priceOf(e, c).total;
        expect(p, e.id).toBeGreaterThanOrEqual(lo);
        expect(p, e.id).toBeLessThanOrEqual(hi);
        top = Math.max(top, p);
      }
      expect(top, e.id).toBe(hi);
    }
  });

  it('pas de plateau : 30 s coûte moins que 60 s pour le même réglage (effets qui vont jusqu’à 60 s)', () => {
    for (const e of EFFECTS)
      for (const c of reachableSettings(e)) {
        const r = durationRange(e, c, 60);
        if (r.fixed || r.max < 60 || r.min > 30) continue;
        const at = (d) =>
          priceOf(e, normalizeChoice(e, { ...c, duration: d }, 60)).total;
        if (
          e.id === 'zoom' &&
          ['pulsations', 'intermittent', 'aller_retour'].includes(c.style)
        )
          continue;
        expect(at(30), `${e.id} ${c.style ?? ''}`).toBeLessThan(at(60));
      }
  });

  it('un effet cosmétique coûte moins qu’un effet qui rend le jeu presque injouable', () => {
    const p = (id, patch) => priceOf(effectById(id), choice(id, patch)).total;
    expect(p('color', { style: 'nb' })).toBeLessThan(
      p('fog', { level: 'extreme' }),
    );
    expect(p('vhs', { style: 'legere' })).toBeLessThan(
      p('blink', { style: 'ferme', duration: 10 }),
    );
    expect(p('shake', { style: 'leger' })).toBeLessThan(p('flip'));
    // Courts par nature : Un clignement et Flash restent dans le bas de leur fourchette.
    expect(p('blink', { style: 'ponctuel' })).toBeLessThan(
      PRICE_RANGES.blink[0] * 2,
    );
    expect(p('flash', { style: 'court', duration: 3 })).toBeLessThan(
      PRICE_RANGES.flash[1] / 2,
    );
  });
});
