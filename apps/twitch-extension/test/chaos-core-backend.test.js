// Interactions branché sur le Core (modules/interactions/core-backend.js) : le prix affiché et payé est celui du Core,
// l'achat est bloqué tant que son devis n'est pas arrivé, chaque intention porte sa clé et le prix attendu, les refus
// du Core sont lisibles, l'état du Core alimente la vue (disponibilités, file, crédits, plafond).
import { describe, expect, it, vi } from 'vitest';
import { createCoreBackend } from '../extension/modules/interactions/core-backend.js';
import {
  defaultChoice,
  effectById,
} from '../extension/modules/interactions/catalog.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
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
    chaosQuote: vi.fn(async ({ effect, choice }) => ({
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
});
