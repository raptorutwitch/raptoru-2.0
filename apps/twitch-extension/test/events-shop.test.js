import { describe, expect, it } from 'vitest';
import {
  availability,
  clock,
  shopHtml,
  viewerWait,
} from '../extension/shared/events-shop.js';

// « Événements » (docs/HALLOWEEN.md): the pure rendering of Core's projection.
const item = (over = {}) => ({
  item_id: 'blink',
  kind: 'effect',
  category: 'disruption',
  label: 'Clignement',
  description: 'Ses yeux se ferment…',
  price: 2,
  thumb: 'assets/halloween/fx-blink.svg',
  available: true,
  ...over,
});
const state = (over = {}) => ({
  enabled: true,
  edition: { id: 'halloween-2026', title: 'Halloween 2026' },
  engine_ready: true,
  balance: 5,
  earn: { sub_reward: 10, gift_giver_per_sub: 5, gift_recipient: 3 },
  conversion: { rate: 1000, cap_per_hour: 10, remaining: 10, frees_at: null },
  items: [item()],
  recent: [],
  ...over,
});

describe('events module', () => {
  it('clock: seconds, then minutes', () => {
    expect(clock(45_000)).toBe('45 s');
    expect(clock(125_000)).toBe('2:05');
    expect(clock(-5)).toBe('0 s');
  });

  it('availability: a cooldown counts down from the projection, then frees the row', () => {
    const cd = item({
      available: false,
      reason: 'item_cooldown',
      retry_after_ms: 10_000,
    });
    expect(availability(cd, 0)).toEqual({
      ok: false,
      text: '10 s',
      wait: true,
    });
    expect(availability(cd, 12_000)).toEqual({ ok: true, text: '' });
    expect(
      availability(item({ available: false, reason: 'engine_offline' })),
    ).toEqual({ ok: false, text: 'Hors ligne' });
    expect(availability(item({ available: false, reason: 'busy' })).text).toBe(
      'Occupé',
    );
  });

  it('loading, unreachable, closed: a sentence, no button', () => {
    expect(shopHtml(null)).toContain('Chargement');
    expect(shopHtml(null, { unreachable: true })).toContain('injoignable');
    expect(shopHtml({ enabled: false })).toContain('Aucun événement en cours');
    expect(shopHtml({ enabled: false })).not.toContain('data-buy');
  });

  it('the header names the edition the Core announces, with the balance', () => {
    const html = shopHtml(state());
    expect(html).toContain('Halloween 2026');
    expect(html).toContain('🍬 5');
    expect(html).toContain('data-section="bonbons"');
  });

  it('interactions grouped by the Core categories, in their order; an empty category is not shown', () => {
    const html = shopHtml(
      state({
        items: [
          item(),
          item({
            item_id: 's-foxy',
            kind: 'screamer',
            category: 'screamer',
            label: 'Foxy',
            price: 10,
          }),
          item({
            item_id: 'eyes',
            category: 'apparition',
            label: 'Yeux',
            price: 4,
          }),
        ],
      }),
    );
    const order = ['Perturbations', 'Apparitions', 'Screamers'].map((l) =>
      html.indexOf(`<h4>${l}`),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('<h4>Sons');
    // A filter shows one category.
    const only = shopHtml(
      state({
        items: [
          item(),
          item({ item_id: 's-foxy', kind: 'screamer', category: 'screamer' }),
        ],
      }),
      { filter: 'screamer' },
    );
    expect(only).not.toContain('<h4>Perturbations');
  });

  it('a row is buyable only when available and affordable; two taps; « Envoi… » blocks a second tap', () => {
    const html = shopHtml(
      state({
        items: [
          item(),
          item({
            item_id: 's-foxy',
            kind: 'screamer',
            category: 'screamer',
            price: 10,
          }),
        ],
      }),
    );
    expect(html).not.toMatch(/data-buy="blink" disabled/);
    expect(html).toMatch(/data-buy="s-foxy" disabled/);
    expect(shopHtml(state(), { confirming: 'blink' })).toContain('Confirmer ?');
    const sending = shopHtml(
      state({ items: [item(), item({ item_id: 'fog', label: 'Brouillard' })] }),
      { sending: 'blink' },
    );
    expect(sending).toContain('Envoi…');
    expect(sending).toMatch(/data-buy="fog" disabled/);
    expect(shopHtml(state({ balance: null }))).toMatch(
      /data-buy="blink" disabled/,
    );
  });

  it('after a purchase: the viewer’s own wait is spelled out; countdowns are tagged for in-place updates', () => {
    const s = state({
      items: [
        item({
          available: false,
          reason: 'viewer_cooldown',
          retry_after_ms: 113_000,
        }),
      ],
    });
    expect(viewerWait(s)).toBe(113_000);
    expect(viewerWait(s, 120_000)).toBe(0);
    const html = shopHtml(s);
    expect(html).toContain('Ton prochain achat dans <b data-next>1:53</b>');
    expect(html).toContain('data-wait="blink"');
  });

  it('Bonbons: balance and the real ways to earn; no Jetons exchange any more', () => {
    const html = shopHtml(state(), { section: 'bonbons' });
    expect(html).toContain('+10</b> à chaque sub');
    expect(html).toContain('+5</b> par sub offert');
    expect(html).toContain('+3</b> quand on t’offre un sub');
    expect(html).not.toMatch(/Jetons|data-convert/);
    // A way the Core does not announce is not shown.
    expect(html).not.toContain('tombola');
    expect(html).not.toContain('Bits');
    const all = shopHtml(
      state({
        earn: {
          sub_reward: 10,
          prime_reward: 5,
          resub_reward: 10,
          presence: { every_min: 10, bonbons: 1 },
          bits: { step: 100, bonbons: 2 },
          donation_per_euro: 3,
          raffle: true,
        },
      }),
      { section: 'bonbons' },
    );
    for (const way of [
      '+1</b> toutes les 10 min',
      '+5</b> pour un sub Prime',
      '+10</b> quand tu partages ton réabonnement',
      '+2</b> tous les 100 Bits',
      '+3</b> par euro de don',
      'tombolas',
    ])
      expect(all).toContain(way);
    expect(
      shopHtml(state({ earn: { sub_reward: 0 } }), { section: 'bonbons' }),
    ).not.toContain('à chaque sub');
  });

  it('escapes Core text; feedback is a toast', () => {
    const html = shopHtml(
      state({ items: [item({ label: '<img src=x onerror=1>' })] }),
    );
    expect(html).not.toContain('<img src=x');
    expect(shopHtml(state(), { notice: { text: 'Envoyé !' } })).toContain(
      'evs-notice evs-toast',
    );
  });

  it('warns when the engine is offline', () => {
    expect(shopHtml(state({ engine_ready: false }))).toContain('pas prêt');
  });
});
