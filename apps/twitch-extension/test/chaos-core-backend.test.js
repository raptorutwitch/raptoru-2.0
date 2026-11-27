// Interactions branché sur le Core (modules/interactions/core-backend.js) : le prix affiché et payé est celui du Core,
// l'achat est bloqué tant que son devis n'est pas arrivé, chaque intention porte sa clé et le prix attendu, les refus
// du Core sont lisibles, l'état du Core alimente la vue (disponibilités, file, crédits, plafond).
import { describe, expect, it, vi } from 'vitest';
import { createCoreBackend } from '../extension/modules/interactions/core-backend.js';
import {
  defaultChoice,
  effectById,
  minPrice,
  PRICE_RANGES,
  usePriceRanges,
} from '../extension/modules/interactions/catalog.js';

const flush = () => new Promise((r) => globalThis.setTimeout(r, 0));
const STATE = {
  enabled: true,
  status: 'open',
  cap_s: 60,
  safe_mode: false,
  effects: { flash: { available: false, reason: 'safe_mode' } },
  active: [
    {
      id: 'a1',
      effect: 'fog',
      status: 'started',
      duration_ms: 20000,
      price: 30000,
      payment: 'jetons',
      viewer_name: 'Kiwi',
      remaining_s: 12,
      progress: 0.4,
    },
  ],
  queue: [
    {
      id: 'q1',
      effect: 'mirror',
      status: 'queued',
      duration_ms: 10000,
      price: 22600,
      payment: 'jetons',
      viewer_name: 'Bubulle',
      position: 1,
      eta_s: 12,
    },
  ],
  burst: [],
  mine: [
    {
      id: 'm1',
      effect: 'blur',
      status: 'failed',
      code: 'studio_offline',
      reason: 'Studio déconnecté',
      refund_status: 'refunded',
      price: 15950,
      payment: 'jetons',
      mine: true,
      duration_ms: 10000,
    },
  ],
  credits: [
    {
      id: 'c1',
      effect_id: 'flip',
      constraints: { max_duration_ms: 20000 },
      source_kind: 'moderator',
      source_by: 'Mod',
      reason: 'Bravo',
      state: 'available',
    },
  ],
  charges: { 'blink:ponctuel': { n: 7, max: 10, next_s: 4 } },
};

function backend(over = {}) {
  const client = {
    chaosState: vi.fn(async () => STATE),
    chaosQuote: vi.fn(async ({ choice }) => ({
      price: 12345,
      choice,
      outcome: { kind: 'queue', position: 2, eta_s: 20 },
      block: null,
    })),
    chaosBuy: vi.fn(async () => ({
      request: {
        id: 'r9',
        effect: 'fog',
        status: 'queued',
        price: 12345,
        payment: 'jetons',
        position: 2,
        duration_ms: 10000,
      },
      outcome: { kind: 'queue', position: 2 },
    })),
    ...over,
  };
  const b = createCoreBackend(
    { client, state: { wallet: { points: 50000 } } },
    () => ({ wallet: { points: 50000 } }),
  );
  return { b, client };
}

describe('Interactions sur le Core', () => {
  it('l’état du Core alimente la vue : statut, plafond, file, indisponibilités, crédits, charges, échecs remboursés', async () => {
    const { b } = backend();
    const stop = b.subscribe(() => {});
    await flush();
    const s = b.mock.snapshot();
    stop();
    expect(s).toMatchObject({ status: 'open', capS: 60, balance: 50000 });
    expect(s.active[0]).toMatchObject({
      effect: 'fog',
      state: 'active',
      remaining: 12,
    });
    expect(s.queue[0]).toMatchObject({
      effect: 'mirror',
      state: 'queued',
      position: 1,
    });
    expect(s.effects.find((x) => x.id === 'flash').block).toMatchObject({
      code: 'safe_mode',
    });
    expect(s.credits[0]).toMatchObject({
      effect: 'flip',
      constraints: { maxS: 20 },
    });
    expect(s.mine[0]).toMatchObject({ state: 'failed', refunded: true });
    expect(s.effects.find((x) => x.id === 'blink').charges[0]).toMatchObject({
      n: 7,
      max: 10,
      nextS: 4,
    });
  });

  it('devis : bloqué tant que le Core n’a pas répondu, puis son prix (jamais l’estimation locale)', async () => {
    const { b, client } = backend();
    const e = effectById('fog');
    const first = b.mock.quote('fog', defaultChoice(e), Date.now());
    expect(first.block).toMatchObject({ code: 'quoting' });
    await flush();
    const q = b.mock.quote('fog', defaultChoice(e), Date.now());
    expect(q.block).toBeNull();
    expect(q.price).toBe(12345);
    expect(q.outcome).toMatchObject({ kind: 'queue', position: 2 });
    expect(client.chaosQuote).toHaveBeenCalledTimes(1);
    // Recalcul (après un achat, ou devis expiré) : le dernier prix du serveur reste affiché, le bouton ne se bloque pas.
    client.chaosQuote.mockImplementation(async ({ choice }) => ({
      price: 13000,
      choice,
      block: null,
    }));
    await b.mock.buy('fog', defaultChoice(e), 12345, Date.now(), undefined, {
      key: 'intent-q',
    });
    const during = b.mock.quote('fog', defaultChoice(e), Date.now());
    expect(during).toMatchObject({ price: 12345, block: null });
    await flush();
    expect(b.mock.quote('fog', defaultChoice(e), Date.now()).price).toBe(13000);
    expect(client.chaosQuote).toHaveBeenCalledTimes(2);
  });

  it('refus du Core : libellé court et phrase de la maquette validée, délais en compte à rebours', async () => {
    const { b } = backend({
      chaosState: vi.fn(async () => ({
        ...STATE,
        effects: { mirror: { available: false, reason: 'global_pause' } },
      })),
      chaosQuote: vi.fn(async ({ choice }) => ({
        price: 22600,
        choice,
        block: { code: 'cooldown', retry_after_ms: 65_000 },
      })),
    });
    const stop = b.subscribe(() => {});
    await flush();
    expect(
      b.mock.snapshot().effects.find((x) => x.id === 'mirror').block,
    ).toMatchObject({ label: 'Suspendu' });
    stop();
    const e = effectById('fog');
    b.mock.quote('fog', defaultChoice(e), Date.now());
    await flush();
    const q = b.mock.quote('fog', defaultChoice(e), Date.now());
    expect(q.block).toMatchObject({ code: 'cooldown', label: '1:05' });
    expect(q.block.detail).toContain('Brouillard');
  });

  it('achat : le prix du devis et la clé de l’intention partent au Core ; refus lisible ; réseau coupé : rien d’affirmé', async () => {
    const { b, client } = backend();
    const e = effectById('fog');
    const c = defaultChoice(e);
    const ok = await b.mock.buy('fog', c, 12345, Date.now(), undefined, {
      key: 'intent-1',
    });
    expect(ok).toMatchObject({
      ok: true,
      request: { id: 'r9', state: 'queued' },
    });
    expect(client.chaosBuy).toHaveBeenCalledWith(
      expect.objectContaining({ effect: 'fog', expected_price: 12345 }),
      'intent-1',
    );
    const refused = backend({
      chaosBuy: vi.fn(async () =>
        Promise.reject(
          Object.assign(new Error('x'), { code: 'price_changed' }),
        ),
      ),
    });
    expect(
      await refused.b.mock.buy('fog', c, 1, Date.now(), undefined, {
        key: 'k',
      }),
    ).toMatchObject({
      ok: false,
      code: 'price_changed',
      message: expect.stringContaining('prix'),
    });
    const offline = backend({
      chaosBuy: vi.fn(async () =>
        Promise.reject(
          Object.assign(new Error('x'), { code: 'network_error' }),
        ),
      ),
    });
    expect(
      await offline.b.mock.buy('fog', c, 1, Date.now(), undefined, {
        key: 'k',
      }),
    ).toMatchObject({ ok: false });
  });

  it('tarifs de la chaîne (Studio › Chaos › Tarifs) : « dès » suit la fourchette du Core ; un changement de tarif relance chaque devis', async () => {
    let prices = { ...PRICE_RANGES };
    const { b, client } = backend({
      chaosState: vi.fn(async () => ({ ...STATE, prices })),
    });
    try {
      const stop = b.subscribe(() => {});
      await flush();
      const fogFrom = () =>
        b.mock.snapshot().effects.find((x) => x.id === 'fog').minPrice;
      expect(fogFrom()).toBe(PRICE_RANGES.fog[0]);
      const e = effectById('fog');
      b.mock.quote('fog', defaultChoice(e), Date.now());
      await flush();
      expect(client.chaosQuote).toHaveBeenCalledTimes(1);
      // Prix modifiés dans Studio : l'état suivant les apporte, le devis est redemandé (le dernier reste affiché).
      prices = { ...PRICE_RANGES, fog: [30_000, 150_000] };
      b.changed();
      await flush();
      await flush();
      expect(fogFrom()).toBe(30_000);
      expect(minPrice(e)).toBe(30_000);
      expect(
        b.mock.quote('fog', defaultChoice(e), Date.now()).block,
      ).toBeNull();
      await flush();
      expect(client.chaosQuote).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      usePriceRanges(null);
    }
  });
});
