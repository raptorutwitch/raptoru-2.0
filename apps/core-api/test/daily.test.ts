import { describe, expect, it } from 'vitest';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import {
  claimAt,
  count,
  endLive,
  goLive,
  paris,
  setup,
  viewer,
} from './helpers.js';

const alice = viewer('1001', 'Alice');
const bob = viewer('1002', 'Bob');

/** One live on stream-day `day`, 20:00 → 23:00 Paris. */
async function streamOn(
  core: Awaited<ReturnType<typeof setup>>,
  day: string,
  id = `live-${day}`,
) {
  await goLive(core, id, paris(day, 20));
  return { end: () => endLive(core, paris(day, 23)) };
}

describe('Daily claim', () => {
  it('first Daily: +500, streak 1, total 1, message decided by Core', async () => {
    const core = await setup();
    await streamOn(core, '2026-09-24');

    const res = await claimAt(core, alice, paris('2026-09-24', 20, 30));

    expect(res.outcome).toBe('claimed');
    expect(res.reward).toBe(500);
    expect(res.status).toMatchObject({
      currentStreak: 1,
      totalDaily: 1,
      bestStreak: 1,
      claimedCurrentStreamDay: true,
    });
    expect(res.message).toBe(
      '✅ @Alice — Daily validé ! +500 jetons · 🔥 1 stream de suite · 1 Daily au total',
    );
  });

  it('second !daily in the same session is refused without any effect', async () => {
    const core = await setup();
    await streamOn(core, '2026-09-24');
    await claimAt(core, alice, paris('2026-09-24', 20, 30));

    const res = await claimAt(core, alice, paris('2026-09-24', 21));

    expect(res.outcome).toBe('already_claimed');
    expect(res.reward).toBe(0);
    expect(res.message).toBe(
      '✅ @Alice — tu as déjà récupéré ton Daily pour ce stream !',
    );
    expect(res.status.totalDaily).toBe(1);
    expect(await count(core.db, 'daily_claims')).toBe(1);
    expect(await count(core.db, 'daily_credits')).toBe(1);
  });

  it('a second live in the same stream-day does not allow a second Daily', async () => {
    const core = await setup();
    await goLive(core, 'live-a', paris('2026-09-24', 18));
    await claimAt(core, alice, paris('2026-09-24', 18, 30));
    await endLive(core, paris('2026-09-24', 19));
    await goLive(core, 'live-b', paris('2026-09-24', 22));

    expect(
      (await claimAt(core, alice, paris('2026-09-24', 22, 30))).outcome,
    ).toBe('already_claimed');
    // Bob missed the first live: he can still claim this stream-day during the second one.
    const bobRes = await claimAt(core, bob, paris('2026-09-24', 22, 31));
    expect(bobRes.outcome).toBe('claimed');
    expect(bobRes.status.currentStreamDay).toBe('2026-09-24');
  });

  it('consecutive stream-days grow the streak and the reward', async () => {
    const core = await setup();
    for (const [i, day] of [
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ].entries()) {
      const live = await streamOn(core, day);
      const res = await claimAt(core, alice, paris(day, 21));
      expect(res.status.currentStreak).toBe(i + 1);
      expect(res.reward).toBe([500, 650, 800][i]);
      await live.end();
    }
    const res = await core.daily.streak(alice);
    expect(res.message).toBe(
      "🔥 @Alice est présent depuis 3 streams d'affilée — 3 Daily validés au total · record : 3",
    );
  });

  it('days without stream never break the streak', async () => {
    const core = await setup();
    const live = await streamOn(core, '2026-09-24');
    await claimAt(core, alice, paris('2026-09-24', 21));
    await live.end();
    // No stream on 25, 26, 27.
    core.clock.set(paris('2026-09-27', 12));
    expect((await core.daily.status(alice.twitchUserId)).currentStreak).toBe(1);

    await streamOn(core, '2026-09-28');
    const res = await claimAt(core, alice, paris('2026-09-28', 21));
    expect(res.status.currentStreak).toBe(2);
  });

  it('a missed aired stream-day resets the streak; total and best never go down', async () => {
    const core = await setup();
    const totals: number[] = [];
    for (const day of ['2026-09-20', '2026-09-21', '2026-09-22']) {
      const live = await streamOn(core, day);
      totals.push(
        (await claimAt(core, alice, paris(day, 21))).status.totalDaily,
      );
      await live.end();
    }
    // Stream on the 23rd, Alice does not claim; Bob does.
    const missed = await streamOn(core, '2026-09-23');
    await claimAt(core, bob, paris('2026-09-23', 21));
    core.clock.set(paris('2026-09-23', 22));
    expect((await core.daily.status(alice.twitchUserId)).currentStreak).toBe(3); // still claimable
    await missed.end();
    core.clock.set(paris('2026-09-24', 16, 1)); // stream-day 23 is over: too late
    expect((await core.daily.status(alice.twitchUserId)).currentStreak).toBe(0);

    await streamOn(core, '2026-09-24');
    const res = await claimAt(core, alice, paris('2026-09-24', 21));
    totals.push(res.status.totalDaily);

    expect(res.status).toMatchObject({
      currentStreak: 1,
      totalDaily: 4,
      bestStreak: 3,
    });
    expect(res.reward).toBe(500);
    expect(totals).toEqual([1, 2, 3, 4]);
  });

  it('coming back after months: streak 27 / total 59 → streak 1 / total 60, record kept', async () => {
    const core = await setup();
    await core.db.query(
      "insert into stream_days (day, opened_at) values ('2026-03-01', now())",
    );
    await core.db.query(
      "insert into viewers values ('1001', 'alice', 'Alice', now(), now())",
    );
    await core.db.query(
      "insert into daily_stats values ('1001', 59, 27, 34, '2026-03-01', now())",
    );
    // The channel kept streaming while Alice was away.
    for (const day of ['2026-04-10', '2026-06-15', '2026-09-01'])
      await (await streamOn(core, day)).end();

    await streamOn(core, '2026-09-24');
    const res = await claimAt(core, alice, paris('2026-09-24', 21));

    expect(res.status).toMatchObject({
      currentStreak: 1,
      totalDaily: 60,
      bestStreak: 34,
    });
    expect((await core.daily.streak(alice)).message).toBe(
      "🔥 @Alice est présent depuis 1 stream d'affilée — 60 Daily validés au total · record : 34",
    );
  });

  it('outside a live: refused, no stats, but the attempt is journaled', async () => {
    const core = await setup();
    const res = await claimAt(core, alice, paris('2026-09-24', 21));

    expect(res.outcome).toBe('no_active_stream');
    expect(res.message).toBe('💤 Aucun stream actif actuellement.');
    for (const table of [
      'viewers',
      'daily_stats',
      'daily_claims',
      'daily_credits',
      'stream_days',
    ]) {
      expect(await count(core.db, table)).toBe(0);
    }
    const [attempt] = await core.daily.attempts(alice.twitchUserId);
    expect(attempt).toMatchObject({
      outcome: 'no_active_stream',
      stream_id: null,
    });

    // Also refused after a live has ended, even inside the same stream-day window.
    await (await streamOn(core, '2026-09-24')).end();
    expect(
      (await claimAt(core, alice, paris('2026-09-24', 23, 30))).outcome,
    ).toBe('no_active_stream');
  });
});

describe('stream-day boundaries', () => {
  it('a live started at 14:00 stays on the previous stream-day after 16:00', async () => {
    const core = await setup();
    await goLive(core, 'live-1', paris('2026-09-25', 14));

    const before = await claimAt(core, alice, paris('2026-09-25', 15));
    expect(before.status.currentStreamDay).toBe('2026-09-24');
    // Crossing 16:00 never reopens the Daily during the live.
    const after = await claimAt(core, alice, paris('2026-09-25', 16, 30));
    expect(after.outcome).toBe('already_claimed');
    expect(after.status.currentStreamDay).toBe('2026-09-24');
    // Bob claims after 16:00: still stream-day 24.
    await claimAt(core, bob, paris('2026-09-25', 17));
    expect((await core.daily.history(bob.twitchUserId))[0]!.streamDay).toBe(
      '2026-09-24',
    );
  });

  it('a live started before 16:00 and ended after it, then an evening live: two stream-days', async () => {
    const core = await setup();
    await goLive(core, 'afternoon', paris('2026-09-25', 15));
    await claimAt(core, alice, paris('2026-09-25', 16, 30));
    await endLive(core, paris('2026-09-25', 17));
    await goLive(core, 'evening', paris('2026-09-25', 20));

    const res = await claimAt(core, alice, paris('2026-09-25', 20, 30));
    expect(res.outcome).toBe('claimed');
    expect(res.status).toMatchObject({
      currentStreamDay: '2026-09-25',
      currentStreak: 2,
    });
  });

  it('a 24h stream is a single stream-day with a single Daily', async () => {
    const core = await setup();
    await goLive(core, 'marathon', paris('2026-09-24', 20));
    await claimAt(core, alice, paris('2026-09-24', 21));
    expect((await claimAt(core, alice, paris('2026-09-25', 17))).outcome).toBe(
      'already_claimed',
    );
    expect(
      (await claimAt(core, alice, paris('2026-09-25', 19, 50))).status
        .currentStreamDay,
    ).toBe('2026-09-24');
    await endLive(core, paris('2026-09-25', 20));

    // Next live after the marathon opens stream-day 25.
    await goLive(core, 'next', paris('2026-09-25', 21, 30));
    const res = await claimAt(core, alice, paris('2026-09-25', 22));
    expect(res.status).toMatchObject({
      currentStreamDay: '2026-09-25',
      currentStreak: 2,
    });
  });

  it('the stream-day only depends on each Twitch session start, never on the gap between lives', async () => {
    const core = await setup();
    await goLive(core, 'a', paris('2026-09-25', 15, 30));
    await endLive(core, paris('2026-09-25', 15, 50));
    // Same window, even right after the previous live: same stream-day.
    expect(
      (await goLive(core, 'b', paris('2026-09-25', 15, 55))).streamDay,
    ).toBe('2026-09-24');
    await endLive(core, paris('2026-09-25', 16, 5));
    // New Twitch session started after 16:00: new stream-day, whatever the gap.
    expect(
      (await goLive(core, 'c', paris('2026-09-25', 16, 6))).streamDay,
    ).toBe('2026-09-25');
    // Same Twitch id coming back (offline was wrong): the session keeps its stream-day.
    await endLive(core, paris('2026-09-25', 16, 10));
    expect(
      (await goLive(core, 'c', paris('2026-09-25', 16, 6))).streamDay,
    ).toBe('2026-09-25');
    expect(await count(core.db, 'stream_sessions')).toBe(3);
  });
});

describe('stream detection robustness', () => {
  it('double online and online+sync for the same stream create one session', async () => {
    const core = await setup();
    const startedAt = paris('2026-09-24', 20);
    await core.streams.online({ streamId: 's1', startedAt });
    await core.streams.online({ streamId: 's1', startedAt });
    await core.streams.sync({ streamId: 's1', startedAt });

    expect(await count(core.db, 'stream_sessions')).toBe(1);
    expect(await count(core.db, 'stream_days')).toBe(1);
  });

  it('Core and bot restarts during a live keep the same session and claims', async () => {
    const first = await setup();
    await goLive(first, 's1', paris('2026-09-24', 20));
    await claimAt(first, alice, paris('2026-09-24', 20, 30));

    // New Core process on the same database; the restarted bot resyncs from Helix.
    const restarted = await setup({ db: first.db, clock: first.clock });
    await restarted.streams.sync({
      streamId: 's1',
      startedAt: paris('2026-09-24', 20),
    });

    expect(
      (await claimAt(restarted, alice, paris('2026-09-24', 22))).outcome,
    ).toBe('already_claimed');
    expect(
      (await claimAt(restarted, bob, paris('2026-09-24', 22))).outcome,
    ).toBe('claimed');
    expect(await count(first.db, 'stream_sessions')).toBe(1);
  });

  it('a missed offline is repaired by the next sync or the next live', async () => {
    const core = await setup();
    await goLive(core, 's1', paris('2026-09-24', 20));
    // Offline event lost. The next day a new live starts (bot was down in between).
    const next = await goLive(core, 's2', paris('2026-09-25', 20));
    expect(next.streamDay).toBe('2026-09-25');
    expect((await core.streams.current())?.streamId).toBe('s2');

    // Helix confirms offline.
    await core.streams.sync(null);
    expect(await core.streams.current()).toBeNull();
  });

  it('a late duplicate online of an old stream never reopens it', async () => {
    const core = await setup();
    await goLive(core, 's1', paris('2026-09-24', 20));
    await endLive(core, paris('2026-09-24', 22));
    await goLive(core, 's2', paris('2026-09-25', 20));
    await core.streams.online({
      streamId: 's1',
      startedAt: paris('2026-09-24', 20),
    });
    expect((await core.streams.current())?.streamId).toBe('s2');
  });
});

describe('idempotency and payment', () => {
  it('concurrent !daily from the same viewer: exactly one claim and one payment', async () => {
    const provider = new DevFakeCreditProvider();
    const core = await setup({ provider });
    await streamOn(core, '2026-09-24');
    core.clock.set(paris('2026-09-24', 21));

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        core.daily.claim({ viewer: alice, requestId: `m${i}` }),
      ),
    );

    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'already_claimed')).toHaveLength(
      9,
    );
    expect(provider.credited).toEqual([
      {
        twitchUserId: '1001',
        login: 'alice',
        amount: 500,
        reference: expect.stringMatching(/^daily-claim:\d+$/),
      },
    ]);
  });

  it('a retry of the same request replays the original success without paying again', async () => {
    const provider = new DevFakeCreditProvider();
    const core = await setup({ provider });
    await streamOn(core, '2026-09-24');
    const original = await claimAt(
      core,
      alice,
      paris('2026-09-24', 21),
      'twitch-msg-1',
    );
    const retry = await claimAt(
      core,
      alice,
      paris('2026-09-24', 21, 1),
      'twitch-msg-1',
    );

    expect(retry).toMatchObject({
      outcome: 'claimed',
      replayed: true,
      reward: 500,
      message: original.message,
    });
    expect(provider.credited).toHaveLength(1);
    const outcomes = (await core.daily.attempts(alice.twitchUserId)).map(
      (a) => a.outcome,
    );
    expect(outcomes).toEqual(['replayed', 'claimed']);
  });

  it('an ambiguous provider error is flagged unknown and never retried automatically', async () => {
    let calls = 0;
    const flaky = {
      name: 'dev-fake',
      credit: async () => {
        calls++;
        throw new Error('timeout');
      },
    };
    const core = await setup({ provider: flaky });
    await streamOn(core, '2026-09-24');
    const res = await claimAt(core, alice, paris('2026-09-24', 21));

    expect(res.outcome).toBe('claimed'); // the Daily itself is valid
    await core.credits.processPending();
    expect(calls).toBe(1);
    expect(
      (await core.daily.history(alice.twitchUserId))[0]!.creditStatus,
    ).toBe('unknown');
    const [attempt] = await core.daily.attempts(alice.twitchUserId);
    expect(attempt).toMatchObject({
      credit_status: 'unknown',
      credit_error: 'timeout',
    });
  });

  it('a certain failure is recorded as failed and not retried', async () => {
    const core = await setup({
      provider: {
        name: 'dev-fake',
        credit: async () => ({
          status: 'failed' as const,
          error: 'user not found',
        }),
      },
    });
    await streamOn(core, '2026-09-24');
    await claimAt(core, alice, paris('2026-09-24', 21));
    expect(
      (await core.daily.history(alice.twitchUserId))[0]!.creditStatus,
    ).toBe('failed');
  });

  it('crash recovery: pending credits are sent once, interrupted ones become unknown', async () => {
    const core = await setup();
    await streamOn(core, '2026-09-24');
    // Simulate a crash right after the claim commit (credit still pending) and one mid-send.
    const hang = {
      name: 'dev-fake',
      credit: () => new Promise<never>(() => {}),
    };
    const crashed = await setup({
      db: core.db,
      clock: core.clock,
      provider: hang,
    });
    core.clock.set(paris('2026-09-24', 21));
    void crashed.daily.claim({ viewer: alice, requestId: 'a' }); // stuck in 'sending'
    await new Promise((r) => setTimeout(r, 50));
    await core.db.query(
      "insert into viewers values ('1002', 'bob', 'Bob', now(), now())",
    );
    await core.db.query(
      `insert into daily_claims (twitch_user_id, stream_day, stream_id, request_id, source, claimed_at,
         streak_before, streak_after, total_before, total_after, best_after, reward)
       select '1002', '2026-09-24', 'live-2026-09-24', 'b', 'chat', now(), 0, 1, 0, 1, 1, 500`,
    );
    await core.db.query(
      "insert into daily_credits (claim_id, twitch_user_id, login, amount, provider, status) select id, '1002', 'bob', 500, 'dev-fake', 'pending' from daily_claims where request_id = 'b'",
    );

    // Restart with a working provider.
    const provider = new DevFakeCreditProvider();
    const restarted = await setup({ db: core.db, clock: core.clock, provider });
    expect(await restarted.credits.recoverInterrupted()).toBe(1);
    await restarted.credits.processPending();
    await restarted.credits.processPending();

    expect(provider.credited.map((c) => c.login)).toEqual(['bob']);
    const statuses = await core.db.query<{ login: string; status: string }>(
      'select login, status from daily_credits order by login',
    );
    expect(statuses).toEqual([
      { login: 'alice', status: 'unknown' },
      { login: 'bob', status: 'credited' },
    ]);
  });

  it('credits created for another provider are never sent by this one', async () => {
    const core = await setup({
      provider: {
        name: 'other',
        credit: async () => ({ status: 'credited' as const }),
      },
    });
    await streamOn(core, '2026-09-24');
    await claimAt(core, alice, paris('2026-09-24', 21));
    const provider = new DevFakeCreditProvider();
    const devCore = await setup({ db: core.db, clock: core.clock, provider });
    await devCore.credits.processPending();
    expect(provider.credited).toHaveLength(0);
  });
});

describe('read contract', () => {
  it('!streak is strictly read-only', async () => {
    const core = await setup();
    await streamOn(core, '2026-09-24');
    await claimAt(core, alice, paris('2026-09-24', 21));
    const tables = [
      'viewers',
      'daily_stats',
      'daily_claims',
      'daily_credits',
      'daily_attempts',
      'stream_days',
      'stream_sessions',
    ];
    const snapshot = async () =>
      Promise.all(tables.map((t) => count(core.db, t)));
    const before = await snapshot();

    await core.daily.streak(alice);
    const unknown = await core.daily.streak(viewer('9999', 'Newbie'));

    expect(await snapshot()).toEqual(before);
    expect(unknown.message).toBe(
      "@Newbie n'a encore validé aucun Daily — tape !daily pendant un stream !",
    );
  });

  it('status exposes claim state, last claim and next reward', async () => {
    const core = await setup();
    await streamOn(core, '2026-09-24');
    core.clock.set(paris('2026-09-24', 20, 10));
    expect(await core.daily.status(alice.twitchUserId)).toMatchObject({
      live: true,
      currentStreamDay: '2026-09-24',
      claimedCurrentStreamDay: false,
      nextReward: 500,
      lastClaim: null,
    });
    await claimAt(core, alice, paris('2026-09-24', 21));
    expect(await core.daily.status(alice.twitchUserId)).toMatchObject({
      claimedCurrentStreamDay: true,
      nextReward: 650,
      lastClaim: {
        streamDay: '2026-09-24',
        reward: 500,
        claimedAt: paris('2026-09-24', 21).toISOString(),
      },
    });
  });

  it('leaderboards rank total, effective streak and best', async () => {
    const core = await setup();
    for (const day of ['2026-09-21', '2026-09-22']) {
      const live = await streamOn(core, day);
      await claimAt(core, alice, paris(day, 21));
      await live.end();
    }
    const live = await streamOn(core, '2026-09-23');
    await claimAt(core, bob, paris('2026-09-23', 21));
    await live.end();
    core.clock.set(paris('2026-09-24', 17)); // stream-day 23 over: Alice missed it

    const board = await core.daily.leaderboard();
    expect(board.total.map((e) => [e.displayName, e.value])).toEqual([
      ['Alice', 2],
      ['Bob', 1],
    ]);
    expect(board.streak.map((e) => [e.displayName, e.value])).toEqual([
      ['Bob', 1],
    ]);
    expect(board.best.map((e) => [e.rank, e.displayName, e.value])).toEqual([
      [1, 'Alice', 2],
      [2, 'Bob', 1],
    ]);
  });
});
