import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { SHADOW_MODES } from '../src/loyalty/engine.js';
import { createTestDb, FakeClock } from './helpers.js';

// `!solde` during Halloween (docs/HALLOWEEN.md): the existing command (one owner, the Core's WalletChat) adds the
// viewer's Bonbons while the event is open — 0 for someone who never had any — and is exactly as before otherwise.

const CH = '83603689';
const ana = { twitchUserId: '9201', login: 'ana', displayName: 'Ana' };
const bob = { twitchUserId: '9202', login: 'bob', displayName: 'Bob' };

async function core() {
  const db = await createTestDb();
  const c = createCore(
    db,
    new FakeClock(new Date('2026-10-31T20:00:00Z')),
    new DevFakeCreditProvider(),
    SHADOW_MODES,
    null,
    undefined,
    { broadcasterId: CH },
  );
  await c.wallet.wallet.credit({
    key: 'fund-ana',
    viewer: ana,
    amount: 48250,
    source: 'test',
  });
  return c;
}
const solde = (
  c: Awaited<ReturnType<typeof core>>,
  viewer = ana,
  requester?: typeof ana,
) =>
  c.wallet.chat
    .balance({ viewer, ...(requester ? { requester } : {}) })
    .then((r) => r.message);

describe('!solde during Halloween', () => {
  it('no event set up, or the event closed: exactly the usual answer', async () => {
    const c = await core();
    const before = await solde(c);
    expect(before).not.toContain('Bonbon');
    await c.eventShop.updateSettings(CH, { enabled: false });
    expect(await solde(c)).toBe(before);
  });

  it('event open: Jetons | Bonbons (0 for a viewer who never had any), also for « !solde @Pseudo »', async () => {
    const c = await core();
    const usual = await solde(c);
    await c.eventShop.updateSettings(CH, { enabled: true });
    expect(await solde(c)).toBe(`${usual} | 0 Bonbon 🍬`);
    await c.eventShop.grant(
      {
        idempotency_key: randomUUID(),
        channel_id: CH,
        viewer: ana.twitchUserId,
        amount: 17,
        reason: 'grant',
      },
      'test',
    );
    expect(await solde(c)).toBe(`${usual} | 17 Bonbons 🍬`);
    expect(await solde(c, ana, bob)).toMatch(
      /^@Bob - @Ana a .* \| 17 Bonbons 🍬$/,
    );
    // Closed again: back to the usual answer, the Bonbons kept.
    await c.eventShop.updateSettings(CH, { enabled: false });
    expect(await solde(c)).toBe(usual);
  });

  it('the event line failing never breaks !solde', async () => {
    const c = await core();
    const usual = await solde(c);
    c.wallet.chat.balanceExtra = async () => {
      throw new Error('db down');
    };
    expect(await solde(c)).toBe(usual);
  });
});
