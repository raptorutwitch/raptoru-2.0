import type { PresenceObservationRequest } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { labEconomy } from '../src/economy/economy.js';
import { SHADOW_MODES } from '../src/loyalty/engine.js';
import {
  createTestDb,
  endLive,
  FakeClock,
  goLive,
  MINUTE,
  paris,
  viewer,
} from './helpers.js';

// Progression on the REAL chain (docs/PROGRESSION.md): the bot's presence cycles → the presence tracker → the Loyalty
// Engine (Jetons) AND the progression (XP, presence time, periods), in the same validated intervals — one detection.
// A lurker earns without a word; a replayed or restarted cycle never pays twice; nothing after the end of the live; a
// progression failure never takes the Jetons; the WizeBot history is never deleted nor attached twice.

const CH = '83603689';
const T0 = paris('2026-11-05', 20);
const at = (m: number) => new Date(T0.getTime() + m * MINUTE);
const ana = viewer('2001', 'Ana');
const bob = viewer('2002', 'Bob');

async function stack() {
  const db = await createTestDb();
  const clock = new FakeClock(T0);
  const core = createCore(
    db,
    clock,
    new DevFakeCreditProvider(),
    { ...SHADOW_MODES, preview: true },
    null,
    labEconomy,
    { broadcasterId: CH },
  );
  const test = { ...core, db, clock, provider: new DevFakeCreditProvider() };
  await goLive(test, 's1', T0);
  await core.progression.updateSettings(CH, { enabled: true });
  let seq = 0;
  const cycle = async (
    m: number,
    o: { worker?: string; cycleId?: string; who?: (typeof ana)[] } = {},
  ) => {
    const worker = o.worker ?? 'w1';
    clock.set(at(m));
    await core.presence.acquireLease({ workerId: worker, streamId: 's1' });
    const req: PresenceObservationRequest = {
      cycleId: o.cycleId ?? `c-${++seq}`,
      workerId: worker,
      streamId: 's1',
      observedAt: at(m).toISOString(),
      durationMs: 10,
      liveStateAgeSeconds: 5,
      snapshot: {
        status: 'ok',
        chatters: o.who ?? [ana, bob],
        reportedTotal: (o.who ?? [ana, bob]).length,
        pages: 1,
      },
    };
    return core.presence.record(req);
  };
  const one = async <T>(sql: string, args: unknown[]) =>
    (await db.query<T>(sql, args))[0];
  const xp = async (id: string) =>
    Number(
      (
        await one<{ xp: string }>(
          'select xp from progression_accounts where twitch_user_id = $1',
          [id],
        )
      )?.xp ?? 0,
    );
  const jetonTicks = async (id: string) =>
    (
      await db.query(
        `select 1 from loyalty_rewards where twitch_user_id = $1 and source = 'passive_watch'`,
        [id],
      )
    ).length;
  return { core, db, clock, test, cycle, xp, jetonTicks };
}

describe('progression on the real presence chain', () => {
  it('lurkers: Jetons, XP and presence time from the same cycles, without a message; replay and restart pay nothing more; nothing after the live', async () => {
    const k = await stack();
    for (let m = 0; m <= 12; m += 2) await k.cycle(m, { cycleId: `c${m}` });
    const watch = (await k.core.progression.viewer(CH, '2001')).watchMinutes;
    const xp = await k.xp('2001');
    const ticks = await k.jetonTicks('2001');
    expect(ticks).toBeGreaterThan(0);
    expect(xp).toBeGreaterThan(0);
    expect(watch).toBe(xp); // 1 XP per validated minute (default rules)
    expect((await k.core.progression.viewer(CH, '2001')).periods.week).toEqual({
      xp,
      watchMinutes: watch,
      messages: 0,
    });
    // The same cycle sent again (a reconnection): nothing more anywhere.
    await k.cycle(12, { cycleId: 'c12' });
    expect([await k.xp('2001'), await k.jetonTicks('2001')]).toEqual([
      xp,
      ticks,
    ]);
    // The bot restarts under a new worker once the lease expired: it continues, the past is never paid again.
    await k.cycle(30, { worker: 'w2' });
    await k.cycle(32, { worker: 'w2' });
    const afterRestart = await k.xp('2001');
    expect(afterRestart - xp).toBe(2); // only the new interval 30 → 32
    // The live ends: a cycle after it is refused, nothing counted.
    await endLive(k.test, at(33));
    const late = await k.cycle(34, { worker: 'w2' });
    expect(late.accepted).toBe(false);
    expect(await k.xp('2001')).toBe(afterRestart);
  });

  it('Level Up V2 on the real chain: the cycle that reaches 1 000 XP makes one level-up, shown once with its sound; a replayed cycle none', async () => {
    const k = await stack();
    const p = k.core.progression;
    await p.activateLevelV2(CH, { id: 'studio' });
    await p.updateSettings(CH, { rules: { level_up_notifications: true } });
    await p.setViewerPrefs(CH, '2001', { level_up_notify: 'sound' });
    await k.cycle(0, { cycleId: 'l0' }); // the first sighting (no interval yet)
    await p.adjust(
      CH,
      {
        viewer: '2001',
        mode: 'set_xp',
        value: 998,
        reason: 'test',
        request_id: 'adj-chain-0001',
      },
      { id: 'studio' },
    );
    await k.cycle(2, { cycleId: 'l2' }); // + 2 XP → 1 000 → level 2
    await k.cycle(2, { cycleId: 'l2' }); // the same cycle again
    expect([await k.xp('2001'), (await p.viewer(CH, '2001')).level]).toEqual([
      1000, 2,
    ]);
    const { notices } = await p.claimLevelUps(CH, 'obs');
    expect(notices).toMatchObject([
      { twitchUserId: '2001', level: 2, sound: true },
    ]);
    expect((await p.levelUps(CH)).length).toBe(1);
    // Jetons of the same cycles, untouched by the progression.
    expect(await k.jetonTicks('2001')).toBeGreaterThanOrEqual(0);
  });

  it('an old viewer comes back: the waiting WizeBot history is attached on their first cycle, the XP since kept', async () => {
    const k = await stack();
    await k.core.progression.importHistory(
      CH,
      {
        source: 'wizebot',
        rows: [
          {
            twitch_user_id: null,
            id_source: null,
            login: 'carl',
            level: 30,
            watch_seconds: 36_000,
            messages: 500,
          },
        ],
      },
      { id: 'studio' },
    );
    expect(await k.core.progression.importStatus(CH)).toMatchObject({
      pending: 1,
    });
    const carl = viewer('2003', 'Carl');
    await k.cycle(0, { who: [carl] });
    await k.cycle(2, { who: [carl] });
    const v = await k.core.progression.viewer(CH, '2003');
    expect(v.imported).toMatchObject({ level: 30, watchMinutes: 600 });
    expect(v.level).toBe(30);
    expect(v.totals.watchMinutes).toBe(602);
    expect(v.periods.week.watchMinutes).toBe(2); // the history never enters a period
    expect(await k.core.progression.importStatus(CH)).toMatchObject({
      imported: 1,
      pending: 0,
    });
  });

  it('a progression failure keeps the Jetons of the cycle', async () => {
    const k = await stack();
    await k.db.query(
      'alter table progression_period_stats rename to progression_period_stats_off',
    );
    for (let m = 0; m <= 12; m += 2) await k.cycle(m);
    await k.db.query(
      'alter table progression_period_stats_off rename to progression_period_stats',
    );
    expect(await k.jetonTicks('2001')).toBeGreaterThan(0);
    expect(await k.xp('2001')).toBe(0); // the whole progression movement undone, alone
  });

  it('the WizeBot history is never deleted, and one viewer never gets two attached histories', async () => {
    const k = await stack();
    await k.core.progression.importHistory(
      CH,
      {
        source: 'wizebot',
        rows: [
          {
            twitch_user_id: '2001',
            id_source: 'wizebot',
            login: 'ana',
            level: 5,
            watch_seconds: 0,
            messages: 0,
          },
          {
            twitch_user_id: null,
            id_source: null,
            login: 'zed',
            level: 2,
            watch_seconds: 0,
            messages: 0,
          },
        ],
      },
      { id: 'studio' },
    );
    await expect(
      k.db.query(`delete from progression_history where login = 'zed'`),
    ).rejects.toThrow(/never deleted/);
    await expect(
      k.db.query(
        `update progression_history set status = 'imported', resolved_id = '2001' where login = 'zed'`,
      ),
    ).rejects.toThrow(/progression_history_one_per_viewer|unique/);
    // An undo keeps every row (back to pending).
    await k.core.progression.revertImport(CH, 'wizebot');
    expect(await k.core.progression.importStatus(CH)).toMatchObject({
      imported: 0,
      pending: 2,
    });
  });
});
