// Maquette « Effets live » (lab-modules/effets, Lab seulement) : les règles par défaut proposées pour Chaos V2 côté
// viewer, telles que le faux Core les applique (docs/chaos/EXTENSION_EFFETS_LIVE.md § 4). Le futur module `chaos` du Core
// devra donner les mêmes réponses ; ces cas serviront de base à ses tests.
import { describe, expect, it } from 'vitest';
import {
  EFFECTS,
  effectById,
  minPrice,
  mockPrice,
} from '../extension/lab-modules/effets/catalog.js';
import {
  QUEUE_MAX,
  QUEUE_TTL_S,
  VIEWER_COOLDOWN_S,
  createChaosMock,
} from '../extension/lab-modules/effets/model.js';

const T0 = 1_800_000_000_000;
const calm = (opts = {}) =>
  createChaosMock({ scenario: 'calme', now: T0, simulate: false, ...opts });
const buy = (m, effect, tier, duration, t = T0) =>
  m.buy(
    effect,
    tier,
    duration,
    mockPrice(effectById(effect), tier, duration),
    t,
  );

describe('catalogue', () => {
  it('reprend les 13 effets publics du registre, avec durées et paliers proposés aux viewers', () => {
    expect(EFFECTS.map((e) => e.id)).toEqual([
      'flip',
      'mirror',
      'shake',
      'zoom',
      'drunk',
      'tunnel',
      'blink',
      'flash',
      'fog',
      'blur',
      'pixelate',
      'color',
      'vhs',
    ]);
    for (const e of EFFECTS) {
      expect(e.durations.length).toBeGreaterThan(0);
      expect(e.tiers.length).toBeGreaterThan(0);
      expect(minPrice(e)).toBeGreaterThan(0);
    }
    expect(effectById('flash').photosensitive).toBe(true);
  });
  it('prix : l’intensité ne change le prix que pour un palier d’intensité, jamais pour un style', () => {
    const mirror = effectById('mirror');
    expect(mockPrice(mirror, 'horizontal', 10)).toBe(
      mockPrice(mirror, 'vertical', 10),
    );
    const shake = effectById('shake');
    expect(mockPrice(shake, 'extreme', 10)).toBeGreaterThan(
      mockPrice(shake, 'leger', 10),
    );
    expect(mockPrice(shake, 'marque', 30)).toBeGreaterThan(
      mockPrice(shake, 'marque', 10),
    );
  });
});

describe('achat et file', () => {
  it('un effet dont l’emplacement est libre démarre tout de suite ; le solde est débité une fois', () => {
    const m = calm();
    const before = m.snapshot(T0).balance;
    const r = buy(m, 'blur', 'marque', 10);
    expect(r).toMatchObject({ ok: true, outcome: { kind: 'now' } });
    expect(m.snapshot(T0).active.map((a) => a.effect)).toEqual(['blur']);
    expect(m.snapshot(T0).balance).toBe(
      before - mockPrice(effectById('blur'), 'marque', 10),
    );
  });

  it('emplacements : un seul retournement à la fois, deux mouvements de caméra, trois filtres, quatre calques', () => {
    const m = calm();
    const viewer = (i) => ({ id: `v${i}`, name: `V${i}` });
    const b = (effect, tier, i) =>
      m.buy(
        effect,
        tier,
        10,
        mockPrice(effectById(effect), tier, 10),
        T0,
        viewer(i),
      );
    expect(b('flip', 'marque', 1).outcome.kind).toBe('now');
    expect(b('mirror', 'horizontal', 2).outcome.kind).toBe('queue'); // transformation : 1
    expect(b('shake', 'marque', 3).outcome.kind).toBe('now');
    expect(b('zoom', 'marque', 4).outcome.kind).toBe('now');
    expect(b('drunk', 'marque', 5).outcome.kind).toBe('queue'); // caméra : 2
    for (const [i, e] of ['blur', 'pixelate', 'color'].entries())
      expect(b(e, effectById(e).tiers[0], 6 + i).outcome.kind).toBe('now');
    expect(b('fog', 'marque', 9).outcome.kind).toBe('now'); // calques indépendants des filtres
  });

  it('le même effet ne tourne jamais deux fois en même temps : le second attend la fin du premier', () => {
    const m = calm();
    m.buy('fog', 'marque', 10, mockPrice(effectById('fog'), 'marque', 10), T0, {
      id: 'a',
      name: 'A',
    });
    const q = m.quote('fog', 'leger', 10, T0);
    expect(q.outcome).toMatchObject({ kind: 'queue', position: 1, eta: 10 });
    buy(m, 'fog', 'leger', 10);
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
    const r = buy(m, 'mirror', 'horizontal', 10);
    expect(r).toMatchObject({ ok: false, code: 'queue_full' });
    expect(m.snapshot(T0).balance).toBe(before);
    expect(buy(m, 'blur', 'marque', 10).ok).toBe(true);
  });

  it('un viewer : une seule demande en attente à la fois', () => {
    const m = calm();
    m.buy(
      'flip',
      'marque',
      30,
      mockPrice(effectById('flip'), 'marque', 30),
      T0,
      { id: 'a', name: 'A' },
    );
    expect(buy(m, 'mirror', 'horizontal', 10).outcome.kind).toBe('queue');
    m.buy('fog', 'marque', 30, mockPrice(effectById('fog'), 'marque', 30), T0, {
      id: 'b',
      name: 'B',
    });
    expect(buy(m, 'fog', 'marque', 10)).toMatchObject({
      ok: false,
      code: 'one_waiting',
    });
  });

  it(`même viewer, même effet : ${VIEWER_COOLDOWN_S} s après sa fin ; un autre viewer peut le relancer aussitôt`, () => {
    const m = calm();
    buy(m, 'blur', 'marque', 10);
    m.tick(T0 + 10_000);
    expect(m.quote('blur', 'marque', 10, T0 + 10_000).block?.code).toBe(
      'cooldown',
    );
    expect(
      m.buy(
        'blur',
        'marque',
        10,
        mockPrice(effectById('blur'), 'marque', 10),
        T0 + 10_000,
        { id: 'x', name: 'X' },
      ).ok,
    ).toBe(true);
    m.tick(T0 + 20_000);
    expect(
      m.quote('blur', 'marque', 10, T0 + 10_000 + VIEWER_COOLDOWN_S * 1000)
        .block,
    ).toBeNull();
  });

  it('effet photosensible : délai commun entre deux flashs, refusé en mode doux', () => {
    const m = calm();
    buy(m, 'flash', 'intense', 6);
    m.tick(T0 + 6000);
    expect(m.quote('flash', 'intense', 6, T0 + 6000).block?.code).toBe(
      'cooldown',
    ); // le sien
    expect(
      m.buy(
        'flash',
        'intense',
        6,
        mockPrice(effectById('flash'), 'intense', 6),
        T0 + 6000,
        { id: 'x', name: 'X' },
      ),
    ).toMatchObject({ ok: false });
    const soft = createChaosMock({
      scenario: 'mode_doux',
      now: T0,
      simulate: false,
    });
    expect(soft.quote('flash', 'intense', 6, T0).block?.code).toBe('safe_mode');
  });

  it('prix changé entre l’affichage et la confirmation : refusé, rien débité', () => {
    const m = calm();
    const before = m.snapshot(T0).balance;
    expect(m.buy('blur', 'marque', 10, 1, T0)).toMatchObject({
      ok: false,
      code: 'price_changed',
    });
    expect(m.snapshot(T0).balance).toBe(before);
  });

  it(`une demande non jouée après ${QUEUE_TTL_S / 60} min est remboursée d’office, une seule fois`, () => {
    const m = calm();
    m.buy(
      'flip',
      'marque',
      30,
      mockPrice(effectById('flip'), 'marque', 30),
      T0,
      { id: 'a', name: 'A' },
    );
    const before = m.snapshot(T0).balance;
    buy(m, 'mirror', 'horizontal', 10);
    const s = m.snapshot(T0);
    expect(s.queue).toHaveLength(1);
    m.moderation.setPaused(true); // rien ne démarre pendant la pause : la demande vieillit
    m.tick(T0 + (QUEUE_TTL_S + 1) * 1000);
    m.tick(T0 + (QUEUE_TTL_S + 2) * 1000);
    const mine = m.snapshot(T0 + (QUEUE_TTL_S + 2) * 1000).mine[0];
    expect(mine).toMatchObject({ state: 'expired', refunded: true });
    expect(m.snapshot(T0).balance).toBe(before);
  });

  it('hors live, pause, plein écran exclusif : refus en mots, aucun débit ; les calques restent en plein écran', () => {
    for (const [scenario, code] of [
      ['hors_live', 'offline'],
      ['pause', 'paused'],
    ]) {
      const m = createChaosMock({ scenario, now: T0, simulate: false });
      expect(m.quote('blur', 'marque', 10, T0).block?.code).toBe(code);
    }
    const fs = createChaosMock({
      scenario: 'plein_ecran',
      now: T0,
      simulate: false,
    });
    expect(fs.quote('mirror', 'horizontal', 10, T0).block?.code).toBe(
      'incompatible',
    );
    expect(fs.quote('blink', 'naturel', 10, T0).block).toBeNull();
  });
});

describe('modération', () => {
  it('annuler une demande en file : avec remboursement, ou sans (motif)', () => {
    const m = calm();
    m.buy(
      'flip',
      'marque',
      30,
      mockPrice(effectById('flip'), 'marque', 30),
      T0,
      { id: 'a', name: 'A' },
    );
    const before = m.snapshot(T0).balance;
    const r = buy(m, 'mirror', 'horizontal', 10).request;
    expect(
      m.moderation.cancel(r.id, { refund: true, reason: null }, T0).ok,
    ).toBe(true);
    expect(m.snapshot(T0).balance).toBe(before);
    expect(m.snapshot(T0).history[0]).toMatchObject({
      state: 'cancelled',
      refunded: true,
      actor: 'Modération',
    });
  });

  it('arrêter un effet en cours : remboursé d’office s’il a joué moins de 25 %, sinon au choix ; rembourser après coup une seule fois', () => {
    const m = calm();
    const before = m.snapshot(T0).balance;
    const r1 = buy(m, 'blur', 'marque', 20).request;
    expect(
      m.moderation.remove(r1.id, { refund: undefined }, T0 + 2000),
    ).toMatchObject({ ok: true, refunded: true });
    const r2 = buy(m, 'pixelate', 'marque', 20).request;
    expect(
      m.moderation.remove(r2.id, { refund: undefined }, T0 + 12_000),
    ).toMatchObject({ ok: true, refunded: false });
    expect(m.moderation.refund(r2.id, 'Bug d’affichage', T0 + 13_000).ok).toBe(
      true,
    );
    expect(m.moderation.refund(r2.id, 'deux fois', T0 + 14_000).ok).toBe(false);
    expect(m.snapshot(T0).balance).toBe(before);
  });

  it('tout arrêter : plus rien à l’écran, Chaos en pause, la file attend ; effet offert : gratuit, devant la file', () => {
    const m = calm();
    buy(m, 'blur', 'marque', 20);
    m.moderation.stopAll(T0 + 1000);
    const s = m.snapshot(T0 + 1000);
    expect(s.active).toHaveLength(0);
    expect(s.status).toBe('paused');
    m.moderation.setPaused(false);
    const gift = m.moderation.trigger('fog', 'marque', 10, T0 + 2000);
    expect(gift.request).toMatchObject({
      price: 0,
      by: 'mod',
      state: 'active',
    });
  });
});
