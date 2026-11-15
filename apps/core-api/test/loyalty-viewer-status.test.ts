import { describe, expect, it } from 'vitest';
import { viewerLoyaltyStatus } from '../src/loyalty/viewer-status.js';
import { setup, viewer, type TestCore } from './helpers.js';

// The extension's mini-profile: the Loyalty status of the JWT viewer — the engine's own rules (calc.ts passiveReward),
// never a multiplier written in the extension. Default config: ×1 without a sub, ×2 for every tier.

const CH = '83603689';
const ana = viewer('3001', 'Ana');
const bob = viewer('3002', 'Bob');
const cid = viewer('3003', 'Cid');
const dan = viewer('3004', 'Dan');

const status = (core: TestCore, id: string) =>
  viewerLoyaltyStatus(core.db, CH, id, core.clock.now(), core.loyalty.modes);

async function withSnapshot() {
  const core = await setup({ loyalty: { passiveCredits: true } });
  await core.loyalty.applySubscriptionSnapshot({
    fetchedAt: core.clock.now().toISOString(),
    subscribers: [
      { viewer: ana, tier: 't1', isGift: false },
      { viewer: bob, tier: 't3', isGift: true },
    ],
  });
  return core;
}

describe('the mini-profile’s Loyalty status (one viewer)', () => {
  it('a sub: its tier’s presence multiplier (×2); a gift says so; not a sub: ×1; credited follows the Loyalty mode', async () => {
    const core = await withSnapshot();
    expect(await status(core, ana.twitchUserId)).toMatchObject({
      subscription: { tier: 't1', subscribed: true, gift: false, months: null },
      presence: { credited: true, multiplier: 2, source: 'tier' },
    });
    expect(await status(core, bob.twitchUserId)).toMatchObject({
      subscription: { tier: 't3', subscribed: true, gift: true },
      presence: { multiplier: 2, source: 'tier' },
    });
    expect(await status(core, cid.twitchUserId)).toMatchObject({
      subscription: { tier: 'none', subscribed: false },
      presence: { multiplier: 1, source: 'tier' },
    });
  });

  it('a personal rate replaces the tier’s (never multiplied by it); an excluded account earns nothing', async () => {
    const core = await withSnapshot();
    await core.wallet.loyalty.setRate(ana, 3, 'studio', 'VIP');
    await core.loyalty.exclude(cid, 'bot account', 'studio');
    expect((await status(core, ana.twitchUserId)).presence).toMatchObject({
      multiplier: 3,
      source: 'personal',
    });
    expect((await status(core, cid.twitchUserId)).presence).toMatchObject({
      multiplier: null,
      source: 'excluded',
    });
  });

  it('no fresh Twitch snapshot: the tier is unknown, never guessed — paid the base rate until verified', async () => {
    const core = await setup();
    expect(await status(core, dan.twitchUserId)).toMatchObject({
      subscription: { tier: 'unknown', subscribed: false },
      presence: { credited: false, multiplier: 1, source: 'unknown' },
    });
  });

  it('the subscription months: the highest cumulative month Twitch announced (dated), never extrapolated', async () => {
    const core = await withSnapshot();
    const proof = (id: string, months: number | null, at: string) =>
      core.db.query(
        `insert into sw_spin_sources (channel_id, source, source_event_id, viewer_id, occurred_at, months, received_at)
         values ($1, 'message', $2, $3, $4, $5, $4)`,
        [CH, `ev-${id}-${at}`, ana.twitchUserId, at, months],
      );
    await proof('a', 13, '2026-10-03T20:00:00Z');
    await proof('b', 14, '2026-11-03T20:00:00Z');
    await proof('c', null, '2026-11-10T20:00:00Z');
    expect((await status(core, ana.twitchUserId)).subscription).toMatchObject({
      months: 14,
      months_at: '2026-11-03T20:00:00.000Z',
    });
    // Another viewer's proofs never count.
    expect((await status(core, bob.twitchUserId)).subscription.months).toBe(
      null,
    );
  });
});
