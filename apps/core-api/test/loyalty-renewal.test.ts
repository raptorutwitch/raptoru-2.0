import type { LoyaltyEvent, SubTier } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { RENEWAL_WINDOW_MS } from '../src/loyalty/engine.js';
import { setup, viewer, type TestCore } from './helpers.js';

// One loyalty reward per renewal (post-live audit § 14.2, decision A2): a manual re-subscription (Prime, lapsed sub)
// arrives as channel.subscribe AND channel.subscription.message. Same viewer, opposite kinds, Twitch times ≤ 10 min
// apart → one renewal: the second is recorded « excluded: same_renewal » (or pays only the higher tier's complement).
// Anything else — distinct renewals, gifts, other viewers, rows without a Twitch time — is never merged.

const silver = viewer('9101', 'Renewer');
const other = viewer('2002', 'Bea');
const T = Date.parse('2026-10-20T17:05:34.000Z');
const at = (ms: number) => new Date(T + ms).toISOString();
let n = 0;
const sub = (
  ms: number,
  tier: SubTier = 't1',
  v = silver,
  over: Partial<Extract<LoyaltyEvent, { type: 'sub' }>> = {},
): LoyaltyEvent => ({
  type: 'sub',
  eventId: `sub-${++n}`,
  occurredAt: at(ms),
  viewer: v,
  tier,
  isGift: false,
  ...over,
});
const resub = (ms: number, tier: SubTier = 't1', v = silver): LoyaltyEvent => ({
  type: 'resub',
  eventId: `resub-${++n}`,
  occurredAt: at(ms),
  viewer: v,
  tier,
});

async function credit() {
  const core = await setup({ loyalty: { eventCredits: true } });
  return core;
}
const balance = async (core: TestCore, v = silver) =>
  (await core.wallet.wallet.getWallet(v.twitchUserId))?.balance ?? 0;
const rows = (core: TestCore, v = silver) =>
  core.db.query<{
    id: number;
    source: string;
    status: string;
    amount: number;
    breakdown: Record<string, unknown>;
  }>(
    "select id, source, status, amount, breakdown from loyalty_rewards where twitch_user_id = $1 and source in ('sub', 'resub') order by id",
    [v.twitchUserId],
  );
const txCount = async (core: TestCore) =>
  (
    await core.db.query<{ n: number }>(
      'select count(*)::int as n from wallet_transactions',
    )
  )[0]!.n;

describe('one loyalty reward per renewal (sub ↔ resub, 10 min, Twitch times)', () => {
  it('the audited case (manual re-sub): sub then resub 8 s later → 2 000 once; the resub kept, excluded, linked', async () => {
    const core = await credit();
    const a = await core.loyalty.handleEvent(sub(0));
    const b = await core.loyalty.handleEvent(resub(8_000));
    expect(a).toMatchObject({ status: 'pending', amount: 2000, reason: null });
    expect(b).toMatchObject({
      status: 'excluded',
      amount: 2000,
      reason: 'same_renewal',
    });
    expect(await balance(core)).toBe(2000);
    expect(await txCount(core)).toBe(1);
    const [first, second] = await rows(core);
    expect(second!.breakdown).toMatchObject({
      excluded: 'same_renewal',
      pairedWith: first!.id,
      occurredAt: at(8_000),
    });
  });

  it('reverse order (resub reaches Core first) → one reward', async () => {
    const core = await credit();
    await core.loyalty.handleEvent(resub(0));
    expect(await core.loyalty.handleEvent(sub(30_000))).toMatchObject({
      status: 'excluded',
      reason: 'same_renewal',
    });
    expect(await balance(core)).toBe(2000);
  });

  it('window edges: 9 min 59 s → one renewal; 10 min 01 s → two rewards', async () => {
    const inside = await credit();
    await inside.loyalty.handleEvent(sub(0));
    await inside.loyalty.handleEvent(resub(RENEWAL_WINDOW_MS - 1_000));
    expect(await balance(inside)).toBe(2000);

    const outside = await credit();
    await outside.loyalty.handleEvent(sub(0));
    await outside.loyalty.handleEvent(resub(RENEWAL_WINDOW_MS + 1_000));
    expect(await balance(outside)).toBe(4000);
  });

  it('late delivery (bot outbox resumed 3 h later): paired on Twitch times, not processing times', async () => {
    const core = await credit();
    await core.loyalty.handleEvent(sub(0));
    core.clock.advance(3 * 3600_000);
    await core.loyalty.handleEvent(resub(8_000)); // happened 8 s after the sub, processed 3 h later
    expect(await balance(core)).toBe(2000);
  });

  it('redelivery of either event: a replay, never a new reward nor a new pairing', async () => {
    const core = await credit();
    const s = sub(0);
    const r = resub(8_000);
    await core.loyalty.handleEvent(s);
    await core.loyalty.handleEvent(r);
    expect(await core.loyalty.handleEvent(s)).toMatchObject({
      replayed: true,
      status: 'credited',
    });
    expect(await core.loyalty.handleEvent(r)).toMatchObject({
      replayed: true,
      status: 'excluded',
      reason: 'same_renewal',
    });
    expect(await balance(core)).toBe(2000);
    expect(await rows(core)).toHaveLength(2);
  });

  it('one to one: a third event in the window is never absorbed by an already paired renewal', async () => {
    const core = await credit();
    await core.loyalty.handleEvent(sub(0));
    await core.loyalty.handleEvent(resub(5_000)); // paired with the sub
    await core.loyalty.handleEvent(resub(9_000)); // a second resub: the sub is taken → paid
    await core.loyalty.handleEvent(sub(12_000)); // pairs with the free resub(9 s), never with the paired one
    expect(await balance(core)).toBe(4000);
    const r = await rows(core);
    expect(r.map((x) => [x.source, x.status])).toEqual([
      ['sub', 'credited'],
      ['resub', 'excluded'],
      ['resub', 'credited'],
      ['sub', 'excluded'],
    ]);
    expect(r[3]!.breakdown.pairedWith).toBe(r[2]!.id);
  });

  it('the closest candidate is chosen when several are free', async () => {
    const core = await credit();
    await core.loyalty.handleEvent(resub(0));
    await core.loyalty.handleEvent(resub(120_000)); // two resubs (never paired together)
    await core.loyalty.handleEvent(sub(110_000));
    const r = await rows(core);
    expect(r[2]!.breakdown.pairedWith).toBe(r[1]!.id);
  });

  it('never merged: two subs, two resubs, two viewers, gifts', async () => {
    const core = await credit();
    await core.loyalty.handleEvent(sub(0));
    await core.loyalty.handleEvent(sub(60_000)); // sub + sub: distinct kinds required
    await core.loyalty.handleEvent(resub(0, 't1', other));
    await core.loyalty.handleEvent(resub(60_000, 't1', other)); // resub + resub
    expect(await balance(core)).toBe(4000);
    expect(await balance(core, other)).toBe(4000);

    const g = await credit();
    // A gift recipient's sub is never rewarded nor a candidate: their own resub minutes later pays.
    expect(
      await g.loyalty.handleEvent(sub(0, 't1', silver, { isGift: true })),
    ).toMatchObject({ status: 'skipped', reason: 'gift_recipient' });
    await g.loyalty.handleEvent(resub(60_000));
    expect(await balance(g)).toBe(2000);
    // The gifter re-subscribing: subgift and sub are different rewards.
    await g.loyalty.handleEvent({
      type: 'subgift',
      eventId: 'gift-1',
      occurredAt: at(0),
      gifter: other,
      tier: 't1',
      count: 1,
    });
    await g.loyalty.handleEvent(sub(30_000, 't1', other));
    expect(await balance(g, other)).toBeGreaterThan(2000);
  });

  it('distinct renewals stay distinct: month N then N+1, and a late share then a manual re-sub days later', async () => {
    const core = await credit();
    await core.loyalty.handleEvent(resub(0)); // month N
    await core.loyalty.handleEvent(resub(30 * 86400_000)); // month N+1
    expect(await balance(core)).toBe(4000);

    const late = await credit();
    await late.loyalty.handleEvent(resub(0)); // month N shared late (day 25)
    await late.loyalty.handleEvent(sub(6 * 86400_000)); // expired, manual re-sub (day 31)
    expect(await balance(late)).toBe(4000);
  });

  it('higher tier second (A2): only the complement is paid, once, traced', async () => {
    const core = await credit();
    await core.loyalty.handleEvent(sub(0, 't1')); // Prime / T1 2 000
    const up = await core.loyalty.handleEvent(resub(20_000, 't3')); // T3 10 000
    expect(up).toMatchObject({
      status: 'pending',
      amount: 8000,
      reason: 'same_renewal_complement',
    });
    expect(await balance(core)).toBe(10_000);
    expect((await rows(core))[1]!.breakdown).toMatchObject({
      complement: { full: 10_000, alreadyPaid: 2000, paid: 8000 },
    });

    const down = await credit();
    await down.loyalty.handleEvent(sub(0, 't3'));
    expect(await down.loyalty.handleEvent(resub(20_000, 't1'))).toMatchObject({
      status: 'excluded',
      reason: 'same_renewal',
    });
    expect(await balance(down)).toBe(10_000);
  });

  it('no Twitch time: never paired (no fallback on processing time)', async () => {
    const core = await credit();
    // An old row without occurredAt (before this fix) and a new event a few seconds later: both kept.
    await core.loyalty.handleEvent({ ...sub(0), occurredAt: undefined });
    await core.loyalty.handleEvent(resub(1_000));
    // And an event without a Twitch time never looks for a partner.
    await core.loyalty.handleEvent({ ...resub(2_000), occurredAt: undefined });
    expect(await balance(core)).toBe(6000);
  });

  it('a rejected candidate paid nothing: it never absorbs the other event', async () => {
    const core = await credit();
    await core.loyalty.handleEvent(sub(0));
    await core.db.query(
      "update loyalty_rewards set status = 'rejected' where source = 'sub'",
    );
    await core.loyalty.handleEvent(resub(5_000));
    expect((await rows(core))[1]!.status).toBe('credited');
  });

  it('parallel processing of the two events of one renewal → one reward', async () => {
    const core = await credit();
    await Promise.all([
      core.loyalty.handleEvent(sub(0)),
      core.loyalty.handleEvent(resub(8_000)),
    ]);
    await core.loyalty.processPending();
    expect(await balance(core)).toBe(2000);
    expect(
      (await rows(core)).filter((r) => r.status === 'excluded'),
    ).toHaveLength(1);
  });

  it('preview mode: same pairing, nothing credited', async () => {
    const core = await setup({ loyalty: { preview: true } });
    await core.loyalty.handleEvent(sub(0));
    expect(await core.loyalty.handleEvent(resub(8_000))).toMatchObject({
      status: 'excluded',
      reason: 'same_renewal',
    });
    expect(await txCount(core)).toBe(0);
  });

  it('existing transactions and balances are never touched by a pairing', async () => {
    const core = await credit();
    await core.loyalty.handleEvent(sub(0));
    const before = await core.db.query(
      'select id, amount, balance_after from wallet_transactions order by id',
    );
    await core.loyalty.handleEvent(resub(8_000));
    expect(
      await core.db.query(
        'select id, amount, balance_after from wallet_transactions order by id',
      ),
    ).toEqual(before);
  });
});
