import { describe, expect, it } from 'vitest';
import {
  availability,
  clock,
  shopHtml,
} from '../extension/shared/events-shop.js';

// Halloween shop (docs/HALLOWEEN.md): the pure rendering of Core's projection.
const item = (over = {}) => ({
  item_id: 'blink',
  kind: 'effect',
  label: 'Clignement',
  description: 'Les paupières lourdes',
  price: 2,
  thumb: 'assets/halloween/fx-blink.svg',
  available: true,
  ...over,
});
const state = (over = {}) => ({
  enabled: true,
  engine_ready: true,
  balance: 5,
  earn: { sub_reward: 10, gift_giver_per_sub: 5, gift_recipient: 3 },
  conversion: { rate: 1000, cap_per_hour: 10, remaining: 10 },
  items: [item()],
  recent: [],
  ...over,
});

describe('events shop', () => {
  it('clock: seconds, then minutes', () => {
    expect(clock(45_000)).toBe('45 s');
    expect(clock(125_000)).toBe('2:05');
    expect(clock(-5)).toBe('0 s');
  });

  it('availability: a cooldown counts down from the projection, then frees the card', () => {
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

  it('closed or loading: no card, no button', () => {
    expect(shopHtml(null)).toContain('Chargement');
    expect(shopHtml({ enabled: false })).toContain('fermée');
    expect(shopHtml({ enabled: false })).not.toContain('data-buy');
  });

  it('a card is buyable only when available and affordable; two taps', () => {
    const html = shopHtml(
      state({
        items: [
          item(),
          item({ item_id: 's-foxy', kind: 'screamer', price: 10 }),
        ],
      }),
    );
    expect(html).not.toMatch(/data-buy="blink" disabled/);
    expect(html).toMatch(/data-buy="s-foxy" disabled/);
    expect(shopHtml(state(), { confirming: 'blink' })).toContain('Confirmer ?');
    // No identity (balance null): nothing buyable, no exchange.
    const anon = shopHtml(state({ balance: null }));
    expect(anon).toMatch(/data-buy="blink" disabled/);
    expect(anon).not.toContain('data-convert');
  });

  it('the exchange shows the cap left and is closed when it is reached', () => {
    expect(shopHtml(state(), { convertN: 3 })).toMatch(/3.000 Jetons → 3/);
    expect(
      shopHtml(
        state({ conversion: { rate: 1000, cap_per_hour: 10, remaining: 0 } }),
      ),
    ).toMatch(/data-convert="1" disabled/);
  });

  it('escapes Core text and filters by kind', () => {
    const html = shopHtml(
      state({ items: [item({ label: '<img src=x onerror=1>' })] }),
    );
    expect(html).not.toContain('<img src=x');
    expect(shopHtml(state(), { filter: 'screamer' })).toContain('Rien ici');
  });

  it('warns when the engine is offline', () => {
    expect(shopHtml(state({ engine_ready: false }))).toContain('pas prêt');
  });
});
