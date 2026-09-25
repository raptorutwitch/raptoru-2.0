import { describe, expect, it } from 'vitest';
import type { PresenceObservationRequest } from '@raptoru/schemas';
import {
  formatPresenceReport,
  presenceReportCsv,
  SHADOW_BANNER,
} from '../src/presence/presence-report.js';
import { LEASE_TTL_MS } from '../src/presence/presence-service.js';
import {
  count,
  endLive,
  goLive,
  MINUTE,
  paris,
  setup,
  type TestCore,
} from './helpers.js';

const T0 = paris('2026-09-26', 20);
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

let seq = 0;

async function observe(
  core: TestCore,
  when: Date,
  chatters: string[] | 'error',
  { worker = 'worker-a', stream = 's1', cycleId = `cycle-${++seq}` } = {},
) {
  core.clock.set(when);
  await core.presence.acquireLease({ workerId: worker, streamId: stream });
  const request: PresenceObservationRequest = {
    cycleId,
    workerId: worker,
    streamId: stream,
    observedAt: when.toISOString(),
    durationMs: 250,
    liveStateAgeSeconds: 30,
    snapshot:
      chatters === 'error'
        ? {
            status: 'error',
            errorKind: 'timeout',
            httpStatus: null,
            message: 'snapshot timeout',
          }
        : {
            status: 'ok',
            chatters: chatters.map((id) => ({
              twitchUserId: id,
              login: `user${id}`,
              displayName: `User${id}`,
            })),
            reportedTotal: chatters.length,
            pages: 1,
          },
  };
  return core.presence.record(request);
}

async function watch(core: TestCore, twitchUserId: string): Promise<number> {
  const rows = await core.db.query<{ s: number }>(
    'select estimated_watch_seconds as s from presence_viewer_streams where twitch_user_id = $1',
    [twitchUserId],
  );
  return rows[0]?.s ?? 0;
}

async function live() {
  const core = await setup();
  await goLive(core, 's1', T0);
  return core;
}

describe('presence rule: consecutive snapshots only', () => {
  it('present in two consecutive snapshots → the interval is counted', async () => {
    const core = await live();
    expect(await observe(core, at(0), ['1'])).toMatchObject({
      gapReason: 'first_snapshot',
      creditedSeconds: 0,
    });
    expect(await observe(core, at(2), ['1'])).toMatchObject({
      creditedSeconds: 120,
      creditedViewers: 1,
      gapReason: null,
    });
    expect(await watch(core, '1')).toBe(120);
  });

  it('only in the first snapshot → nothing; only in the second → nothing retroactive', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    await observe(core, at(2), ['2']);
    expect(await watch(core, '1')).toBe(0);
    expect(await watch(core, '2')).toBe(0);
    await observe(core, at(4), ['2']);
    expect(await watch(core, '2')).toBe(120);
  });

  it('accumulates successive intervals, and a viewer who leaves then returns', async () => {
    const core = await live();
    const present: Record<number, string[]> = {
      0: ['1', '2'],
      2: ['1', '2'],
      4: ['1'],
      6: ['1', '2'],
      8: ['1', '2'],
      10: ['1'],
    };
    for (const [minute, ids] of Object.entries(present))
      await observe(core, at(Number(minute)), ids);
    expect(await watch(core, '1')).toBe(600);
    expect(await watch(core, '2')).toBe(240); // 0→2 and 6→8; the absence at 4 breaks both sides
    const row = (
      await core.db.query(
        'select snapshots_present, intervals_credited from presence_viewer_streams where twitch_user_id = $1',
        ['2'],
      )
    )[0];
    expect(row).toEqual({ snapshots_present: 4, intervals_credited: 2 });
  });

  it('credits the real elapsed time, and duplicate chatters only once', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    await observe(core, new Date(at(0).getTime() + 150_000), ['1', '1']);
    expect(await watch(core, '1')).toBe(150);
  });
});

describe('failures are never turned into watch time', () => {
  it('a failed snapshot breaks the chain on both sides', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    expect(await observe(core, at(2), 'error')).toMatchObject({
      accepted: true,
      gapReason: 'snapshot_failed',
    });
    expect(await observe(core, at(4), ['1'])).toMatchObject({
      gapReason: 'previous_failed',
      creditedSeconds: 0,
    });
    await observe(core, at(6), ['1']);
    expect(await watch(core, '1')).toBe(120);
  });

  it('a long hole is not caught up blindly', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    expect(await observe(core, at(30), ['1'])).toMatchObject({
      gapReason: 'gap_too_long',
      creditedSeconds: 0,
    });
    expect(await watch(core, '1')).toBe(0);
  });

  it('a process restart (new worker) does not bridge the interval across the restart', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    // New process: waits for the old lease to expire.
    const afterExpiry = new Date(at(0).getTime() + LEASE_TTL_MS + 1000);
    expect(
      await observe(core, afterExpiry, ['1'], { worker: 'worker-b' }),
    ).toMatchObject({
      accepted: true,
      gapReason: 'worker_changed',
    });
    await observe(core, new Date(afterExpiry.getTime() + 2 * MINUTE), ['1'], {
      worker: 'worker-b',
    });
    expect(await watch(core, '1')).toBe(120);
  });
});

describe('single worker per channel', () => {
  it('a second concurrent worker gets no lease and its observations are refused', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    core.clock.set(at(1));
    expect(
      await core.presence.acquireLease({
        workerId: 'worker-b',
        streamId: 's1',
      }),
    ).toMatchObject({
      granted: false,
      holder: 'worker-a',
    });
    const res = await core.presence.record({
      cycleId: 'intruder',
      workerId: 'worker-b',
      streamId: 's1',
      observedAt: at(1).toISOString(),
      durationMs: 1,
      liveStateAgeSeconds: 0,
      snapshot: { status: 'ok', chatters: [], reportedTotal: 0, pages: 1 },
    });
    expect(res).toMatchObject({ accepted: false, rejection: 'lease_held' });
    expect(await count(core.db, 'presence_cycles')).toBe(1);
  });

  it('parallel observations from two workers never double count', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    core.clock.set(at(2));
    const snapshot = {
      status: 'ok' as const,
      chatters: [{ twitchUserId: '1', login: 'u1', displayName: 'U1' }],
      reportedTotal: 1,
      pages: 1,
    };
    const results = await Promise.all(
      ['worker-a', 'worker-b'].map((workerId) =>
        core.presence.record({
          cycleId: `p-${workerId}`,
          workerId,
          streamId: 's1',
          observedAt: at(2).toISOString(),
          durationMs: 1,
          liveStateAgeSeconds: 0,
          snapshot,
        }),
      ),
    );
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
    expect(await watch(core, '1')).toBe(120);
  });

  it('a retried observation (same cycleId) is replayed, not counted twice', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    const first = await observe(core, at(2), ['1'], { cycleId: 'retry-me' });
    const again = await observe(core, at(2), ['1'], { cycleId: 'retry-me' });
    expect(again).toEqual(first);
    expect(await watch(core, '1')).toBe(120);
  });

  it('out-of-order observations are refused', async () => {
    const core = await live();
    await observe(core, at(4), ['1']);
    expect(await observe(core, at(2), ['1'])).toMatchObject({
      accepted: false,
      rejection: 'out_of_order',
    });
  });
});

describe('stream lifecycle', () => {
  it('after stream.offline, observations are refused', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    await endLive(core, at(3));
    expect(await observe(core, at(4), ['1'])).toMatchObject({
      accepted: false,
      rejection: 'stream_not_live',
    });
    expect(await watch(core, '1')).toBe(0);
  });

  it('double stream.online keeps one session and one chain', async () => {
    const core = await live();
    await observe(core, at(0), ['1']);
    await core.streams.online({ streamId: 's1', startedAt: T0 });
    await observe(core, at(2), ['1']);
    expect(await watch(core, '1')).toBe(120);
  });
});

describe('shadow mode', () => {
  it('never creates a Daily claim, credit or wallet row', async () => {
    const core = await live();
    for (let m = 0; m <= 20; m += 2)
      await observe(core, at(m), ['1', '2', '3']);
    for (const table of [
      'daily_claims',
      'daily_credits',
      'daily_stats',
      'daily_attempts',
    ]) {
      expect(await count(core.db, table)).toBe(0);
    }
    const tables = await core.db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and (tablename like '%wallet%' or tablename like '%ledger%')",
    );
    expect(tables).toEqual([]);
  });

  it('reports coverage, gaps, errors and per-viewer watch time', async () => {
    const core = await live();
    await observe(core, at(0), ['1', '2']);
    await observe(core, at(2), ['1', '2']);
    await observe(core, at(4), 'error');
    await observe(core, at(6), ['1']);
    await observe(core, at(8), ['1']);
    await endLive(core, at(10));

    const report = (await core.presence.report('latest'))!;
    expect(report).toMatchObject({
      mode: SHADOW_BANNER,
      streamId: 's1',
      durationSeconds: 600,
      uniqueViewers: 2,
      cycles: {
        expected: 6,
        total: 5,
        ok: 4,
        failed: 1,
        coveredSeconds: 240,
        unobservedSeconds: 360,
        coveragePercent: 40,
      },
    });
    expect(report.errors).toEqual([
      {
        observedAt: at(4).toISOString(),
        errorKind: 'timeout',
        httpStatus: null,
        message: 'snapshot timeout',
      },
    ]);
    expect(report.gaps.map((g) => g.reason)).toEqual([
      'first_snapshot',
      'snapshot_failed',
      'previous_failed',
    ]);
    expect(
      report.viewers.map((v) => [
        v.twitchUserId,
        v.estimatedWatchSeconds,
        v.snapshotsPresent,
      ]),
    ).toEqual([
      ['1', 240, 4],
      ['2', 120, 2],
    ]);
    expect(formatPresenceReport(report)).toContain(SHADOW_BANNER);
    expect(presenceReportCsv(report).split('\n')[1]).toBe(
      `1,user1,User1,4,,,4,${at(0).toISOString()},${at(8).toISOString()}`,
    );
  });
});
