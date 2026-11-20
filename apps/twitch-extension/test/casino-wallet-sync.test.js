import { describe, expect, it } from 'vitest';
import { createWalletSync } from '../extension/shared/casino/wallet-sync.js';

/** A game screen as roulette.js / slot.js expose it. */
function fakeGame(balance) {
  const g = { balance, serial: 0, busy: false, synced: [] };
  g.wallet = () => ({ balance: g.balance, serial: g.serial, busy: g.busy });
  g.sync = (state) => {
    g.synced.push(state);
    g.balance = state.me.balance;
  };
  return g;
}
const deferred = () => {
  let ok;
  const p = new Promise((r) => (ok = r));
  return { p, ok };
};

describe('casino wallet sync (the roulette refused after an external credit, 19/11)', () => {
  it('a lost ALL-IN then +1 000 000 credited: the game reads the Core again and can play', async () => {
    const g = fakeGame(0);
    const sync = createWalletSync({
      pull: async () => ({ me: { balance: 1_000_000 } }),
      game: () => g,
    });
    expect(await sync({ available: 1_000_000 })).toBe(true);
    expect(g.balance).toBe(1_000_000);
  });

  it('takes the Core’s balance, never the session’s number', async () => {
    const g = fakeGame(0);
    const sync = createWalletSync({
      pull: async () => ({ me: { balance: 750 } }),
      game: () => g,
    });
    await sync({ available: 1_000_000 });
    expect(g.balance).toBe(750);
  });

  it('the same balance, an unavailable wallet, no game: no Core read', async () => {
    let pulls = 0;
    const g = fakeGame(500);
    const pull = async () => (pulls++, { me: { balance: 1 } });
    await createWalletSync({ pull, game: () => g })({ available: 500 });
    await createWalletSync({ pull, game: () => g })({ unavailable: true });
    await createWalletSync({ pull, game: () => g })(null);
    await createWalletSync({ pull, game: () => null })({ available: 9 });
    expect(pulls).toBe(0);
  });

  it('during a round (animation, Coffre): nothing applied — the round’s own answer carries the balance', async () => {
    const g = fakeGame(100);
    g.busy = true;
    let pulls = 0;
    const sync = createWalletSync({
      pull: async () => (pulls++, { me: { balance: 9 } }),
      game: () => g,
    });
    expect(await sync({ available: 9 })).toBe(false);
    expect(pulls).toBe(0);
  });

  it('a spin started while the Core was read: the older answer is dropped', async () => {
    const g = fakeGame(100);
    const d = deferred();
    const sync = createWalletSync({ pull: () => d.p, game: () => g });
    const run = sync({ available: 5000 });
    g.serial += 1; // the player launched (or the spin's answer arrived) meanwhile
    d.ok({ me: { balance: 5000 } });
    expect(await run).toBe(false);
    expect(g.balance).toBe(100);
  });

  it('two reads in flight (two tabs, quick polls): only the newest answer counts, whatever the order', async () => {
    const g = fakeGame(0);
    const a = deferred();
    const b = deferred();
    const answers = [a.p, b.p];
    const sync = createWalletSync({
      pull: () => answers.shift(),
      game: () => g,
    });
    const first = sync({ available: 1000 });
    const second = sync({ available: 2000 });
    b.ok({ me: { balance: 2000 } });
    a.ok({ me: { balance: 1000 } }); // the older one answers last
    expect(await second).toBe(true);
    expect(await first).toBe(false);
    expect(g.balance).toBe(2000);
  });

  it('the screen changed (other game, spectator) while reading: nothing applied', async () => {
    const g = fakeGame(0);
    let current = g;
    const d = deferred();
    const sync = createWalletSync({ pull: () => d.p, game: () => current });
    const run = sync({ available: 10 });
    current = fakeGame(0);
    d.ok({ me: { balance: 10 } });
    expect(await run).toBe(false);
    expect(g.synced).toHaveLength(0);
  });

  it('a Core failure leaves the balance as it was (the next session read retries)', async () => {
    const g = fakeGame(40);
    const sync = createWalletSync({
      pull: async () => Promise.reject(new Error('offline')),
      game: () => g,
    });
    expect(await sync({ available: 80 })).toBe(false);
    expect(g.balance).toBe(40);
  });
});
