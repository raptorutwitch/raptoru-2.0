import type {
  LoyaltyEvent,
  PresenceObservationRequest,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOYALTY_CONFIG } from '../src/loyalty/config.js';
import {
  LoyaltyIdempotencyError,
  type LoyaltyModes,
} from '../src/loyalty/engine.js';
import {
  count,
  goLive,
  HOUR,
  MINUTE,
  paris,
  setup,
  viewer,
  type TestCore,
} from './helpers.js';

const T0 = paris('2026-09-26', 20);
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);
const aouh = viewer('2001', 'Aouh');
const bea = viewer('2002', 'Bea');
const cid = viewer('2003', 'Cid');
const byId: Record<string, ReturnType<typeof viewer>> = {
  '2001': aouh,
  '2002': bea,
  '2003': cid,
};

let seq = 0;

/** One presence cycle (the bot's observation) at `minute`. */
async function cycle(
  core: TestCore,
  minute: number,
  ids: string[] | 'error',
  cycleId = `c-${++seq}`,
) {
  core.clock.set(at(minute));
  await core.presence.acquireLease({ workerId: 'w', streamId: 's1' });
  const req: PresenceObservationRequest = {
    cycleId,
    workerId: 'w',
    streamId: 's1',
    observedAt: at(minute).toISOString(),
    durationMs: 10,
    liveStateAgeSeconds: 5,
    snapshot:
      ids === 'error'
        ? {
            status: 'error',
            errorKind: 'timeout',
            httpStatus: null,
            message: 'x',
          }
        : {
            status: 'ok',
            chatters: ids.map((id) => byId[id]!),
            reportedTotal: ids.length,
            pages: 1,
          },
  };
  return core.presence.record(req);
}

/** Cycles every 2 minutes from `from` to `to` (inclusive) with the same viewers. */
async function watch(core: TestCore, from: number, to: number, ids: string[]) {
  for (let m = from; m <= to; m += 2) await cycle(core, m, ids);
}

async function live(loyalty: Partial<LoyaltyModes>) {
  const core = await setup({ loyalty });
  await goLive(core, 's1', T0);
  return core;
}

async function snapshot(
  core: TestCore,
  subs: { viewer: ReturnType<typeof viewer>; tier: 't1' | 't2' | 't3' }[],
) {
  await core.loyalty.applySubscriptionSnapshot({
    fetchedAt: core.clock.now().toISOString(),
    subscribers: subs.map((s) => ({ ...s, isGift: false })),
  });
}

const rewards = (core: TestCore) =>
  core.db.query<{
    twitch_user_id: string;
    source: string;
    status: string;
    amount: number | null;
    breakdown: Record<string, unknown>;
  }>(
    'select twitch_user_id, source, status, amount, breakdown from loyalty_rewards order by id',
  );

describe('passive: Presence → Loyalty', () => {
  it('shadow mode (no flag): nothing is computed', async () => {
    const core = await live({});
    await watch(core, 0, 12, ['2001']);
    expect(await count(core.db, 'loyalty_passive_progress')).toBe(0);
    expect(await count(core.db, 'loyalty_rewards')).toBe(0);
  });

  it('preview: 6 validated minutes = 1 tick with a frozen breakdown, and zero Wallet rows', async () => {
    const core = await live({ preview: true });
    await snapshot(core, [{ viewer: aouh, tier: 't2' }]);
    await watch(core, 0, 6, ['2001', '2002']); // 3 validated intervals of 2 min

    expect(await rewards(core)).toEqual([
      expect.objectContaining({
        twitch_user_id: '2001',
        status: 'preview',
        amount: 125,
        breakdown: expect.objectContaining({
          source: 'passive_watch',
          base: 50,
          tier: 't2',
          tierMultiplier: 2.5,
          personalOverride: null,
          final: 125,
          tick: 1,
          mode: 'preview',
        }),
      }),
      expect.objectContaining({
        twitch_user_id: '2002',
        status: 'preview',
        amount: 50,
        breakdown: expect.objectContaining({ tier: 'none', tierMultiplier: 1 }),
      }),
    ]);
    for (const t of ['wallets', 'wallet_transactions', 'wallet_operations'])
      expect(await count(core.db, t)).toBe(0);
  });

  it('only validated intervals count: gaps and failures never produce a tick', async () => {
    const core = await live({ preview: true });
    await snapshot(core, []);
    await watch(core, 0, 4, ['2001']); // 4 validated minutes
    await cycle(core, 6, 'error'); // breaks the chain
    await cycle(core, 8, ['2001']); // previous_failed: nothing
    await cycle(core, 30, ['2001']); // gap too long: nothing
    expect(await count(core.db, 'loyalty_rewards')).toBe(0);
    await cycle(core, 32, ['2001']); // +2 → 6 validated minutes in total
    expect((await rewards(core)).map((r) => r.amount)).toEqual([50]);
  });

  it('a replayed cycle or a restarted Core never pays a tick twice', async () => {
    const core = await live({ preview: true });
    await snapshot(core, []);
    await cycle(core, 0, ['2001'], 'a');
    await cycle(core, 2, ['2001'], 'b');
    await cycle(core, 4, ['2001'], 'c');
    await cycle(core, 6, ['2001'], 'd');
    await cycle(core, 6, ['2001'], 'd'); // bot retry of the same cycle
    const restarted = await setup({
      db: core.db,
      clock: core.clock,
      loyalty: { preview: true },
    });
    await cycle(restarted, 8, ['2001'], 'e');
    expect(await count(core.db, 'loyalty_rewards')).toBe(1);
    expect(
      (
        await core.db.query(
          'select validated_seconds, ticks from loyalty_passive_progress',
        )
      )[0],
    ).toEqual({ validated_seconds: 480, ticks: 1 });
  });

  it('unknown tier (no fresh snapshot) is flagged, never guessed; exclusion and override apply', async () => {
    const core = await live({ preview: true });
    await core.wallet.loyalty.setRate(bea, 3, 'studio', 'VIP');
    await core.loyalty.exclude(cid, 'bot account', 'studio');
    await watch(core, 0, 6, ['2001', '2002', '2003']);
    const rows = await rewards(core);
    expect(rows.map((r) => [r.twitch_user_id, r.status, r.amount])).toEqual([
      ['2001', 'tier_unknown', null],
      ['2002', 'preview', 150],
      // 2003 is excluded: no tick at all.
    ]);
    expect(rows[0]!.breakdown).toMatchObject({
      tier: 'unknown',
      candidates: { none: 50, t1: 100, t2: 125, t3: 200 },
    });

    // A stale snapshot is not a proof of non-subscription.
    core.clock.set(new Date(core.clock.now().getTime() + 40 * HOUR));
    await snapshot(core, []);
    core.clock.set(new Date(core.clock.now().getTime() + 37 * HOUR));
    expect((await core.loyalty.rewardsOf('2001')).tier).toBe('unknown');
  });

  it('config changes apply to the next ticks only; old breakdowns keep the old values', async () => {
    const core = await live({ preview: true });
    await snapshot(core, [{ viewer: aouh, tier: 't2' }]);
    await watch(core, 0, 6, ['2001']);
    await core.loyalty.setConfig(
      {
        ...DEFAULT_LOYALTY_CONFIG,
        passive: {
          ...DEFAULT_LOYALTY_CONFIG.passive,
          tierMultipliers: { none: 1, t1: 2, t2: 3, t3: 4 },
        },
      },
      'studio',
    );
    await watch(core, 8, 12, ['2001']);
    const rows = await rewards(core);
    expect(rows.map((r) => [r.amount, r.breakdown.tierMultiplier])).toEqual([
      [125, 2.5],
      [150, 3],
    ]);
  });

  it('credit flag OFF: preview only; credit flag ON (test DB): exactly one Wallet credit per tick', async () => {
    const preview = await live({ preview: true });
    await snapshot(preview, []);
    await watch(preview, 0, 12, ['2001']);
    expect(await count(preview.db, 'wallet_transactions')).toBe(0);

    const credit = await live({ passiveCredits: true });
    await snapshot(credit, [{ viewer: aouh, tier: 't3' }]);
    await watch(credit, 0, 12, ['2001']);
    expect((await rewards(credit)).map((r) => [r.status, r.amount])).toEqual([
      ['credited', 200],
      ['credited', 200],
    ]);
    expect((await credit.wallet.wallet.getWallet('2001'))!.balance).toBe(400);
    expect(await credit.loyalty.processPending()).toBe(0); // nothing left, nothing paid twice
    expect(await count(credit.db, 'wallet_transactions')).toBe(2);
  });
});

describe('Twitch events', () => {
  let e = 0;
  const id = () => `evt-${++e}`;

  it('shadow mode keeps the subscription state but computes nothing', async () => {
    const core = await live({});
    const res = await core.loyalty.handleEvent({
      type: 'sub',
      eventId: id(),
      viewer: aouh,
      tier: 't3',
      isGift: false,
    });
    expect(res).toMatchObject({ status: 'skipped', reason: 'shadow_mode' });
    expect((await core.loyalty.rewardsOf('2001')).tier).toBe('t3');
    await core.loyalty.handleEvent({
      type: 'subscription_end',
      eventId: id(),
      viewer: aouh,
    });
    expect((await core.loyalty.rewardsOf('2001')).tier).toBe('unknown');
  });

  it('preview: sub, resub, subgift, bits, follow and tip rewards with breakdowns', async () => {
    const core = await live({ preview: true });
    const events: LoyaltyEvent[] = [
      { type: 'sub', eventId: id(), viewer: aouh, tier: 't1', isGift: false },
      { type: 'resub', eventId: id(), viewer: bea, tier: 't3' },
      { type: 'subgift', eventId: id(), gifter: cid, tier: 't1', count: 10 },
      {
        type: 'sub',
        eventId: id(),
        viewer: viewer('2004', 'Gifted'),
        tier: 't1',
        isGift: true,
      },
      { type: 'bits', eventId: id(), viewer: aouh, bits: 1200 },
      { type: 'follow', eventId: id(), viewer: bea },
      {
        type: 'tip',
        eventId: id(),
        viewer: cid,
        amountCents: 1000,
        currency: 'EUR',
        provider: 'future',
      },
    ];
    const results = [];
    for (const ev of events) results.push(await core.loyalty.handleEvent(ev));
    expect(results.map((r) => [r.status, r.amount, r.reason])).toEqual([
      ['preview', 2000, null],
      ['preview', 10000, null],
      ['preview', 22000, null],
      ['skipped', null, 'gift_recipient'],
      ['preview', 10003, null],
      ['preview', 500, null],
      ['preview', 5502, null],
    ]);
    expect(await count(core.db, 'wallet_transactions')).toBe(0);
    // Sub rewards are never multiplied by a personal passive override.
    await core.wallet.loyalty.setRate(aouh, 4, 'studio');
    expect(
      (
        await core.loyalty.handleEvent({
          type: 'resub',
          eventId: id(),
          viewer: aouh,
          tier: 't1',
        })
      ).amount,
    ).toBe(2000);
  });

  it('anonymous gifts/bits reward nobody; follow is paid once per identity (refollow = replay)', async () => {
    const core = await live({ preview: true });
    expect(
      (
        await core.loyalty.handleEvent({
          type: 'subgift',
          eventId: id(),
          gifter: null,
          tier: 't1',
          count: 5,
        })
      ).reason,
    ).toBe('anonymous_gift');
    expect(
      (
        await core.loyalty.handleEvent({
          type: 'bits',
          eventId: id(),
          viewer: null,
          bits: 100,
        })
      ).reason,
    ).toBe('anonymous_bits');
    const first = await core.loyalty.handleEvent({
      type: 'follow',
      eventId: id(),
      viewer: aouh,
    });
    const refollow = await core.loyalty.handleEvent({
      type: 'follow',
      eventId: id(),
      viewer: aouh,
    });
    expect(refollow).toMatchObject({
      rewardId: first.rewardId,
      replayed: true,
    });
    expect(await count(core.db, 'loyalty_rewards')).toBe(1);
  });

  it('the same EventSub delivered twice pays once; same id with another payload is refused', async () => {
    const core = await live({ eventCredits: true });
    const ev: LoyaltyEvent = {
      type: 'bits',
      eventId: 'dup',
      viewer: aouh,
      bits: 100,
    };
    const [a, b] = await Promise.all([
      core.loyalty.handleEvent(ev),
      core.loyalty.handleEvent(ev),
    ]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect((await core.wallet.wallet.getWallet('2001'))!.balance).toBe(700);
    await expect(
      core.loyalty.handleEvent({ ...ev, bits: 5000 }),
    ).rejects.toBeInstanceOf(LoyaltyIdempotencyError);
  });

  it('parallel sub + bits + subgift + passive ticks: nothing lost, nothing doubled', async () => {
    const core = await live({ passiveCredits: true, eventCredits: true });
    await snapshot(core, []);
    await Promise.all([
      watch(core, 0, 6, ['2001', '2002']),
      core.loyalty.handleEvent({
        type: 'sub',
        eventId: id(),
        viewer: aouh,
        tier: 't1',
        isGift: false,
      }),
      core.loyalty.handleEvent({
        type: 'bits',
        eventId: id(),
        viewer: aouh,
        bits: 500,
      }),
      core.loyalty.handleEvent({
        type: 'subgift',
        eventId: id(),
        gifter: bea,
        tier: 't2',
        count: 5,
      }),
    ]);
    await core.loyalty.processPending();
    // aouh: passive (non-sub at snapshot time or t1 after the sub event) + 2000 + 3502; bea: 50 + 21000.
    const rows = await rewards(core);
    expect(rows.every((r) => r.status === 'credited')).toBe(true);
    const expected = new Map<string, number>();
    for (const r of rows)
      expected.set(
        r.twitch_user_id,
        (expected.get(r.twitch_user_id) ?? 0) + r.amount!,
      );
    for (const [viewerId, total] of expected)
      expect((await core.wallet.wallet.getWallet(viewerId))!.balance).toBe(
        total,
      );
    expect(await count(core.db, 'wallet_operations')).toBe(rows.length);
  });
});

describe('report', () => {
  it('lists each viewer with validated minutes, tier, multiplier and theoretical Jetons', async () => {
    const core = await live({ preview: true });
    await snapshot(core, [{ viewer: aouh, tier: 't2' }]);
    await watch(core, 0, 12, ['2001', '2002']);
    const report = (await core.loyalty.report('latest'))!;
    expect(report.totals).toMatchObject({
      viewers: 2,
      ticks: 4,
      passiveJetons: 350,
      tierUnknownTicks: 0,
    });
    expect(
      report.viewers.map((v) => [
        v.login,
        v.validatedMinutes,
        v.ticks,
        v.tier,
        v.tierMultiplier,
        v.jetons,
      ]),
    ).toEqual([
      ['aouh', 12, 2, 't2', 2.5, 250],
      ['bea', 12, 2, 'none', 1, 100],
    ]);
  });
});

describe('subgift pattern seen live (viewer gift + Twitch-sponsored matching gift)', () => {
  it('rewards each gifting action once, never the recipients, never a redelivery', async () => {
    const core = await live({ preview: true });
    const wenuyr = viewer('172305417', 'wenuyr');
    const minecraft = viewer('112568845', 'Minecraft'); // brand account doing its own gift action
    const events: LoyaltyEvent[] = [
      {
        type: 'subgift',
        eventId: 'g-user',
        gifter: wenuyr,
        tier: 't1',
        count: 5,
      },
      {
        type: 'subgift',
        eventId: 'g-sponsor',
        gifter: minecraft,
        tier: 't1',
        count: 1,
      },
      ...Array.from({ length: 6 }, (_, i): LoyaltyEvent => ({
        type: 'sub',
        eventId: `r-${i}`,
        viewer: viewer(String(900 + i), `Recipient${i}`),
        tier: 't1',
        isGift: true,
      })),
    ];
    for (const ev of [...events, events[0]!, events[1]!])
      await core.loyalty.handleEvent(ev); // + redeliveries
    const rows = await rewards(core);
    expect(rows.map((r) => [r.twitch_user_id, r.source, r.amount])).toEqual([
      ['172305417', 'subgift', 10500],
      ['112568845', 'subgift', 2000],
    ]);
  });
});

describe('system accounts excluded from passive gains', () => {
  it('bots get no progress and no tick but stay observed; the broadcaster keeps normal ticks', async () => {
    const core = await live({ preview: true });
    const raptoru = viewer('83603689', 'Raptoru_');
    const bots = [
      viewer('1239040922', 'LeCroupier_'),
      viewer('100135110', 'StreamElements'),
      viewer('52268235', 'WizeBot'),
    ];
    Object.assign(
      byId,
      Object.fromEntries([raptoru, ...bots].map((v) => [v.twitchUserId, v])),
    );
    for (const b of bots)
      await core.loyalty.exclude(b, 'system account', 'studio');
    await snapshot(core, [{ viewer: raptoru, tier: 't3' }]);

    await watch(
      core,
      0,
      12,
      [raptoru, ...bots].map((v) => v.twitchUserId),
    );

    expect(
      (await rewards(core)).map((r) => [r.twitch_user_id, r.status, r.amount]),
    ).toEqual([
      ['83603689', 'preview', 200],
      ['83603689', 'preview', 200],
    ]);
    const progress = await core.db.query<{ twitch_user_id: string }>(
      'select twitch_user_id from loyalty_passive_progress',
    );
    expect(progress.map((p) => p.twitch_user_id)).toEqual(['83603689']);
    // Presence still records the bots for diagnostics.
    const observed = await core.db.query<{
      twitch_user_id: string;
      estimated_watch_seconds: number;
    }>(
      'select twitch_user_id, estimated_watch_seconds from presence_viewer_streams order by twitch_user_id',
    );
    expect(observed).toHaveLength(4);
    expect(observed.every((o) => o.estimated_watch_seconds === 720)).toBe(true);
    // Excluded accounts keep their normal wallet and event rewards (sponsored/real subgifts unchanged).
    expect(
      (
        await core.loyalty.handleEvent({
          type: 'subgift',
          eventId: 'bot-gift',
          gifter: bots[0]!,
          tier: 't1',
          count: 5,
        })
      ).amount,
    ).toBe(10500);
  });
});
