// Roue du Sub V2, lot R1 (docs/SUB_WHEEL_V2_PLAN.md § 12) on a real Postgres with two Cores on two pools (PGlite
// serializes every transaction and cannot prove the locks). Every scenario runs 3 times; every protection has its
// counter-proof: the same scenario with the protection removed (query rewritten / constraint dropped) must break.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import { type AlertEventInput } from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertWordGameSteps } from '../src/commands/steps.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import {
  MIGRATION_SCOPES,
  PROD_MIGRATIONS,
} from '../src/db/migration-scopes.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import type { SwEvidence } from '../src/sub-wheel/rights.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock } from './helpers.js';
import { barrier, tampered } from './sw-race.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const T0 = new Date('2026-10-21T20:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms).toISOString();
const ROUNDS = [1, 2, 3];
const R1 = '20261109130000_sub_wheel_v2.sql';
const R2 = '20261109140000_sub_wheel_v2_review.sql';
const R8 = '20261109150000_sub_wheel_v2_viewers.sql';
const RV21 = '20261109170000_sub_wheel_v2_announce_delivery.sql';
const RV22 = '20261109190000_sub_wheel_v2_redraw.sql';
const RV24 = '20261109210000_sub_wheel_v2_replay.sql';
const RV25 = '20261109230000_sub_wheel_v2_recovery.sql';

const STUDIO = { id: 'studio', role: 'broadcaster', via: 'studio' } as const;
const notice = (
  viewer: string,
  over: Partial<AlertEventInput> = {},
): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: viewer, login: `v${viewer}`, display_name: `V${viewer}` },
  tier: '1000',
  months: 7,
  occurred_at: at(0),
  ...over,
});
const proof = (viewer: string, over: Partial<SwEvidence> = {}): SwEvidence => ({
  channelId: CH,
  source: 'subscribe',
  sourceEventId: randomUUID(),
  occurredAt: at(0),
  viewer: { id: viewer, login: null, name: `V${viewer}` },
  type: 'sub',
  tier: 1,
  months: null,
  isGift: false,
  ...over,
});

describe.skipIf(!isLocal)('Roue du Sub V2 — R1, real Postgres', () => {
  const pools: Db[] = [];
  let unlock: (() => Promise<void>) | undefined;
  let a: Db, b: Db;
  let clock: FakeClock;
  let draws = 0;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    b = createPgDb(url!);
    pools.push(a, b);
  }, LOCK_WAIT_MS);
  beforeEach(async () => {
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    clock = new FakeClock(T0);
    draws = 0;
  });
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  const wheel = (db: Db) =>
    new SubWheelService(
      db,
      clock,
      () => {
        draws++;
        return 2;
      },
      coreWalletEconomy(new WalletService(db)),
    );
  const n = async (sql: string) =>
    Number(
      (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
    );
  const credits = () => n("wallet_transactions where source = 'sub_wheel'");
  const configure = async (mode: 'v1' | 'v2_acquire', enabled: boolean) => {
    await wheel(a).setEnabled(CH, enabled);
    await wheel(a).setMode(CH, mode, 'test');
  };
  const viewers = (k: number) => Array.from({ length: k }, (_, i) => `95${i}`);

  for (const round of ROUNDS) {
    it(`P1 — v1, 30 notices each received by two Cores at once: the V1 spins, one credit each, one proof each (round ${round})`, async () => {
      await configure('v1', true);
      const [wa, wb] = [wheel(a), wheel(b)];
      await Promise.all(
        viewers(30).flatMap((v) => {
          const e = notice(v, { months: 3 + Number(v.slice(2)) });
          return [wa.fromAlert(e, null), wb.fromAlert(e, null)];
        }),
      );
      expect(await n('sw_spins')).toBe(30);
      expect(await n("sw_spins where status = 'queued' and segment = 2")).toBe(
        30,
      );
      expect(await credits()).toBe(30);
      expect(await n('sw_spin_sources')).toBe(30);
      expect(await n("sw_spins where month_source = 'twitch'")).toBe(30);
    });

    it(`P2 — v2_acquire: notice + message + subscribe of one renewal at once on two Cores, 30 viewers → one right, one draw, one credit each (round ${round})`, async () => {
      await configure('v2_acquire', true);
      const pause = barrier(3);
      const [wa, wb] = [
        wheel(tampered(a, { pause })),
        wheel(tampered(b, { pause })),
      ];
      await Promise.all(
        viewers(30).flatMap((v) => [
          wa.fromAlert(notice(v, { occurred_at: at(1_000) }), null),
          wb.acquire(proof(v)),
          wa.acquire(
            proof(v, {
              source: 'message',
              type: 'resub',
              months: 7,
              occurredAt: at(2_000),
            }),
          ),
        ]),
      );
      expect(await n('sw_spins')).toBe(30);
      expect(await n('sw_spin_sources')).toBe(90);
      expect(draws).toBe(30);
      expect(await credits()).toBe(30);
    });

    it(`P2 counter-proof — without the viewer lock the same race keeps two rights for one renewal (round ${round})`, async () => {
      await configure('v2_acquire', true);
      const pause = barrier(2);
      const o = { noViewerLock: true, pause };
      const [wa, wb] = [wheel(tampered(a, o)), wheel(tampered(b, o))];
      await Promise.all(
        viewers(10).flatMap((v) => [
          wa.fromAlert(notice(v, { occurred_at: at(1_000) }), null),
          wb.acquire(proof(v)),
        ]),
      );
      expect(await n('sw_spins')).toBeGreaterThan(10);
    });

    it(`defect A — a resub message WITHOUT months and its notice at once on two Cores, both modes, 20 viewers: one right, one credit each (round ${round})`, async () => {
      for (const mode of ['v1', 'v2_acquire'] as const) {
        await a.query(
          'truncate sw_spin_sources, sw_spins, wallet_transactions, wallet_operations cascade',
        );
        draws = 0;
        await configure(mode, true);
        const pause = barrier(2);
        const [wa, wb] = [
          wheel(tampered(a, { pause })),
          wheel(tampered(b, { pause })),
        ];
        await Promise.all(
          viewers(20).flatMap((v) => [
            wa.fromAlert(notice(v, { occurred_at: at(1_000) }), null),
            wb.acquire(
              proof(v, { source: 'message', type: 'resub', occurredAt: at(0) }),
            ),
          ]),
        );
        expect(await n('sw_spins')).toBe(20);
        // Every message ends on the notice's right: attached, or orphan then taken by the notice (v1).
        expect(await n('sw_spin_sources where spin_id is not null')).toBe(40);
        expect(draws).toBe(20);
        expect(await credits()).toBe(20);
      }
    });

    it(`v1 orphans — subscribe and notice of one renewal at once on two Cores: never a right outside V1, the proof always linked (round ${round})`, async () => {
      await configure('v1', true);
      // The same race as the counter-proof below (a slow subscribe, its notice right behind), with the viewer lock.
      const notices = wheel(a);
      const subscribes = wheel(tampered(b, { slowProof: 300 }));
      await Promise.all(
        viewers(20).flatMap((v) => [
          subscribes.acquire(proof(v)),
          (async () => {
            await new Promise((r) => setTimeout(r, 100));
            return notices.fromAlert(
              notice(v, { occurred_at: at(1_000) }),
              null,
            );
          })(),
        ]),
      );
      expect(await n('sw_spins')).toBe(20);
      expect(await n("sw_spins where event_key like 'alert:%'")).toBe(20);
      expect(await n('sw_spin_sources where spin_id is null')).toBe(0);
      expect(await credits()).toBe(20);
    });

    it(`v1 orphans counter-proof — without the viewer lock a racing subscribe can stay orphan beside its V1 right (round ${round})`, async () => {
      await configure('v1', true);
      // The subscribe finds no right, then waits before writing its orphan proof; meanwhile the notice creates the V1
      // right and adopts the orphans present (none yet): without the lock, the orphan written afterwards stays alone.
      // The order is imposed (a handshake per viewer), never left to timers.
      const gates = new Map<
        string,
        { reached: () => void; release: Promise<void> }
      >();
      const notices = wheel(tampered(a, { noViewerLock: true }));
      const subscribes = wheel(
        tampered(b, {
          noViewerLock: true,
          beforeProof: async (params) => {
            const g = gates.get(String(params?.[4]));
            if (!g) return;
            g.reached();
            await g.release;
          },
        }),
      );
      await Promise.all(
        viewers(10).map(async (v) => {
          let reached!: () => void;
          let release!: () => void;
          const looked = new Promise<void>((r) => (reached = r));
          gates.set(v, {
            reached,
            release: new Promise<void>((r) => (release = r)),
          });
          const sub = subscribes.acquire(proof(v));
          await Promise.race([looked, sub]); // it looked and found no right
          await notices.fromAlert(notice(v, { occurred_at: at(1_000) }), null);
          release(); // only now its orphan proof is written
          await sub;
        }),
      );
      expect(await n('sw_spin_sources where spin_id is null')).toBeGreaterThan(
        0,
      );
    });

    it(`P3 — draw() of one owed right on two Cores at once: one draw, the other refused (round ${round})`, async () => {
      await configure('v2_acquire', false);
      const ids: string[] = [];
      for (const v of viewers(10))
        ids.push((await wheel(a).fromAlert(notice(v), null))!.spin_id);
      const pause = barrier(2);
      const [wa, wb] = [
        wheel(tampered(a, { pause })),
        wheel(tampered(b, { pause })),
      ];
      const results = await Promise.allSettled(
        ids.flatMap((id) => [wa.drawRight(id), wb.drawRight(id)]),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
      expect(
        results.filter(
          (r) =>
            r.status === 'rejected' &&
            (r.reason as { code?: string }).code === 'not_owed',
        ),
      ).toHaveLength(10);
      expect(draws).toBe(10);
      expect(await credits()).toBe(10);
    });

    it(`P3 counter-proof — without the row lock both Cores decide a segment; the wallet key still pays once (round ${round})`, async () => {
      await configure('v2_acquire', false);
      const ids: string[] = [];
      for (const v of viewers(5))
        ids.push((await wheel(a).fromAlert(notice(v), null))!.spin_id);
      const pause = barrier(2);
      const o = { noRowLock: true, pause };
      const [wa, wb] = [wheel(tampered(a, o)), wheel(tampered(b, o))];
      await Promise.allSettled(
        ids.flatMap((id) => [wa.drawRight(id), wb.drawRight(id)]),
      );
      expect(draws).toBeGreaterThan(5);
      expect(await credits()).toBe(5);
    });

    it(`P4 — modes v1 ↔ v2_acquire switched in a loop during 60 notices on two Cores: each right drawn once, one credit each (round ${round})`, async () => {
      await configure('v1', true);
      const [wa, wb] = [wheel(a), wheel(b)];
      let flipping = true;
      let flipped = 0;
      const flips = (async () => {
        let mode: 'v1' | 'v2_acquire' = 'v2_acquire';
        while (flipping) {
          await wheel(a).setMode(CH, mode, 'test');
          flipped++;
          mode = mode === 'v1' ? 'v2_acquire' : 'v1';
        }
      })();
      // Three waves (months 4, 5, 6), each one started once a NEW switch is done, the switches going on meanwhile:
      // the modes really change during the notices, whatever the machine's speed.
      for (const months of [4, 5, 6]) {
        const next = flipped + 1;
        while (flipped < next) await new Promise((r) => setTimeout(r, 1));
        await Promise.all(
          viewers(20).flatMap((v) => {
            const e = notice(v, {
              months,
              occurred_at: at(months * 3_600_000),
            });
            return [wa.fromAlert(e, null), wb.fromAlert(e, null)];
          }),
        );
      }
      flipping = false;
      await flips;
      expect(await n('sw_spins')).toBe(60);
      expect(await n("sw_spins where status = 'queued'")).toBe(60);
      expect(await n('sw_spin_sources')).toBe(60);
      expect(await credits()).toBe(60);
      expect(
        await n("lab_moderation_audit where action = 'sw_mode'"),
      ).toBeGreaterThan(2);
    });

    it(`P6 — every source redelivered 3× on two Cores, in mixed orders, 3 h late: no new right, no new credit (round ${round})`, async () => {
      await configure('v2_acquire', true);
      const [wa, wb] = [wheel(a), wheel(b)];
      const sources = viewers(10).map((v) => ({
        n: notice(v, { occurred_at: at(1_000) }),
        s: proof(v),
        m: proof(v, {
          source: 'message',
          type: 'resub',
          months: 7,
          occurredAt: at(2_000),
        }),
      }));
      for (const x of sources) {
        await wa.fromAlert(x.n, null);
        await wa.acquire(x.s);
        await wa.acquire(x.m);
      }
      clock.set(new Date(T0.getTime() + 3 * 3_600_000));
      await Promise.all(
        sources.flatMap((x) =>
          [1, 2, 3].flatMap((k) =>
            (k % 2
              ? [
                  () => wb.acquire(x.m),
                  () => wa.fromAlert(x.n, null),
                  () => wb.acquire(x.s),
                ]
              : [
                  () => wa.acquire(x.s),
                  () => wb.fromAlert(x.n, null),
                  () => wa.acquire(x.m),
                ]
            ).map((f) => f()),
          ),
        ),
      );
      expect(await n('sw_spins')).toBe(10);
      expect(await n('sw_spin_sources')).toBe(30);
      expect(draws).toBe(10);
      expect(await credits()).toBe(10);
    });

    it(`P6 counter-proof — without the viewer lock and the rights' unique keys, the same redelivery makes two rights (round ${round})`, async () => {
      await configure('v2_acquire', false);
      await a.query(
        `alter table sw_spins drop constraint sw_spins_channel_id_event_key_key;
         drop index sw_spins_certain_month;`,
      );
      const pause = barrier(2);
      const o = { noViewerLock: true, pause };
      const [wa, wb] = [wheel(tampered(a, o)), wheel(tampered(b, o))];
      await Promise.allSettled(
        viewers(10).flatMap((v) => {
          const e = notice(v);
          return [wa.fromAlert(e, null), wb.fromAlert(e, null)];
        }),
      );
      expect(await n('sw_spins')).toBeGreaterThan(10);
    });

    it(`P11 — a Core crashing during draw() while the other receives the same notice: nothing of the crash kept, one credit (round ${round})`, async () => {
      await configure('v2_acquire', true);
      const crashing = wheel(tampered(a, { crashOnCredit: true }));
      const wb = wheel(b);
      // Alone first: the crash rolls everything back (no right, no proof).
      const first = notice('9599');
      await expect(crashing.fromAlert(first, null)).rejects.toThrow(
        'connection lost',
      );
      expect(await n('sw_spins')).toBe(0);
      await wb.fromAlert(first, null);
      // Then racing the other Core on 9 more notices.
      await Promise.allSettled(
        viewers(9).flatMap((v) => {
          const e = notice(v);
          return [crashing.fromAlert(e, null), wb.fromAlert(e, null)];
        }),
      );
      expect(await n('sw_spins')).toBe(10);
      expect(await n('sw_spin_sources')).toBe(10);
      expect(await credits()).toBe(10);
      expect(await n("sw_spins where award_status = 'awarded'")).toBe(10);
    });

    it(`P12 — V1 rows from before R1 are never rewritten by a concurrent workload in both modes (round ${round})`, async () => {
      for (const [i, v] of viewers(10).entries())
        await a.query(
          `insert into sw_spins (spin_id, channel_id, source, event_key, type, viewer_id, viewer_name, tier, months,
             status, segment, amount, award_status, created_at, updated_at)
           values ($1, $2, 'twitch', $3, $4, $5, 'V', 1, $6, $7, 0, 200, $8, $9, $9)`,
          [
            randomUUID(),
            CH,
            `alert:twitch:legacy-${i}`,
            i % 2 ? 'resub' : 'sub',
            v,
            i % 2 ? 7 : 1,
            i % 3 ? 'shown' : 'skipped',
            i % 3 ? 'awarded' : 'pending',
            new Date(T0.getTime() - 86_400_000),
          ],
        );
      const snapshot = () =>
        a.query(
          'select * from sw_spins where event_key like $1 order by event_key',
          ['alert:twitch:legacy-%'],
        );
      const before = await snapshot();
      await configure('v1', true);
      const [wa, wb] = [wheel(a), wheel(b)];
      const work = (mode: string) =>
        Promise.all(
          viewers(10).flatMap((v, i) => {
            const legacy = notice(v, {
              source_event_id: `legacy-${i}`,
              type: i % 2 ? 'resub' : 'sub',
              months: i % 2 ? 7 : undefined,
            });
            const next = notice(v, {
              months: mode === 'v1' ? 7 : 8,
              occurred_at: at(mode === 'v1' ? 1_000 : 3_600_000),
            });
            return [
              wa.fromAlert(legacy, null),
              wb.fromAlert(legacy, null),
              wa.fromAlert(next, null),
              wb.acquire(proof(v, { occurredAt: at(2_000) })),
            ];
          }),
        );
      await work('v1');
      await wheel(a).setMode(CH, 'v2_acquire', 'test');
      await work('v2_acquire');
      expect(await snapshot()).toEqual(before);
    });
  }

  /** RV2-2: a real draw shown (v2, granted then asked by Studio): the one to re-draw. */
  const drawn = async (viewer: string) => {
    const w = wheel(a);
    await w.setEnabled(CH, true);
    await w.setMode(CH, 'v2', 'test');
    const g = await w.grant(CH, STUDIO, {
      key: randomUUID(),
      viewer: { id: viewer, name: `V${viewer}` },
      tier: 1,
      months: 3,
      note: 'test',
    });
    await w.requestDraw(g.spin_id, STUDIO);
    const c = await w.claimAnimation(CH, 'obs');
    await w.reportAnimation(c.spin!.spin_id, {
      consumer_id: 'obs',
      event: 'completed',
    });
    return c.spin!.spin_id;
  };
  const failure = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected'
      ? ((r.reason as { code?: string }).code ?? String(r.reason))
      : 'ok';

  for (const round of ROUNDS) {
    it(`RV2-2 — « Relancer un tirage » on two Cores at once: the same click → ONE new draw; two clicks → ONE, the other waits (round ${round})`, async () => {
      const o = await drawn('9801');
      const k = randomUUID();
      const same = await Promise.all(
        [a, b].map((db) =>
          wheel(db).redraw(CH, STUDIO, { key: k, spin_id: o, note: 'x' }),
        ),
      );
      expect(same[0]!.spin_id).toBe(same[1]!.spin_id);
      expect(await n('sw_spins where redraw_of is not null')).toBe(1);
      // A second original draw, two different clicks at once: one new draw, the other refused (one pending per draw).
      const o2 = await drawn('9802');
      const two = await Promise.allSettled(
        [a, b].map((db) =>
          wheel(db).redraw(CH, STUDIO, {
            key: randomUUID(),
            spin_id: o2,
            note: 'x',
          }),
        ),
      );
      expect(two.map(failure).sort()).toEqual(['ok', 'redraw_pending']);
      expect(await n(`sw_spins where redraw_of = '${o2}'`)).toBe(1);
    });

    it(`RV2-4 — « Rejouer l’animation » clicked on two Cores at once: ONE replay, nothing credited again (round ${round})`, async () => {
      const w = wheel(a);
      await w.setEnabled(CH, true);
      await w.setMode(CH, 'v2', 'test');
      const g = await w.grant(CH, STUDIO, {
        key: randomUUID(),
        viewer: { id: '9804', name: 'V9804' },
        tier: 1,
        months: 3,
        note: 'x',
      });
      await w.requestDraw(g.spin_id, STUDIO);
      const c = await w.claimAnimation(CH, 'obs');
      await w.reportAnimation(c.spin!.spin_id, {
        consumer_id: 'obs',
        event: 'failed',
        error: 'effects_player_muted',
      });
      const paid = await credits();
      const both = await Promise.all(
        [a, b].map((db) => wheel(db).replayAnimation(c.spin!.spin_id, STUDIO)),
      );
      expect(both.map((r) => r.status)).toEqual(['queued', 'queued']);
      expect(
        await n(
          `sw_spins where spin_id = '${c.spin!.spin_id}' and replay_count = 1`,
        ),
      ).toBe(1);
      expect(await n("lab_moderation_audit where action = 'sw_replay'")).toBe(
        1,
      );
      expect(await credits()).toBe(paid);
    });

    it(`RV2-2 — « Accorder une roue » twice at once on two Cores (two clicks) for a viewer with no tour: ONE right (round ${round})`, async () => {
      await wheel(a).setEnabled(CH, true);
      const both = await Promise.allSettled(
        [a, b].map((db) =>
          wheel(db).grant(CH, STUDIO, {
            key: randomUUID(),
            viewer: { id: '9803', name: 'V9803' },
            tier: 1,
            months: 2,
            note: 'x',
          }),
        ),
      );
      expect(both.map(failure).sort()).toEqual(['ok', 'rights_available']);
      expect(await n("sw_spins where viewer_id = '9803'")).toBe(1);
    });
  }

  for (const round of ROUNDS) {
    it(`RV2-1 — the end of one wheel reported by two Cores at once: ONE announcement, after the channel delay (round ${round})`, async () => {
      await configure('v1', true);
      await wheel(a).setAnnounceDelay(CH, 10, 'test');
      await wheel(a).fromAlert(notice('9701'), null);
      const c = await wheel(a).claimAnimation(CH, 'obs');
      clock.set(new Date(T0.getTime() + 12_000));
      const end = clock.now().getTime();
      const report = { consumer_id: 'obs', event: 'completed' as const };
      const out = await Promise.all([
        wheel(a).reportAnimation(c.spin!.spin_id, report),
        wheel(b).reportAnimation(c.spin!.spin_id, report),
      ]);
      expect(out.map((o) => o.status)).toEqual(['shown', 'shown']);
      const said = await a.query<{ available_at: Date; text: string }>(
        "select available_at, params->>'text' as text from cmd_steps where origin = 'sub_wheel'",
      );
      expect(said).toHaveLength(1);
      expect(new Date(said[0]!.available_at).getTime()).toBe(end + 10_000);
      expect(said[0]!.text).toMatch(
        /^🎡 @V9701 remporte .+ jetons à la Roue du Sub !$/,
      );
    });
  }

  it('the migrations on a database at the production migrations of 25/10 (46): only R1, R2, R8 and RV2-1 applied, V1 rows, balances and chat origins unchanged, again: nothing', async () => {
    await a.query('drop schema public cascade; create schema public;');
    const at46 = {
      ...MIGRATION_SCOPES,
      // The R1 / R2 files not shipped yet: classified away from the production selection.
      prod: PROD_MIGRATIONS.filter(
        (f) =>
          f !== R1 &&
          f !== R2 &&
          f !== R8 &&
          f !== RV21 &&
          f !== RV22 &&
          f !== RV24 &&
          f !== RV25,
      ),
      lab: [...MIGRATION_SCOPES.lab, R1, R2, R8, RV21, RV22, RV24, RV25],
    };
    expect(await migrate(a, 'prod', undefined, at46)).toHaveLength(46);
    // What production really holds in its chat queue: Tombola announcements and Spotify answers.
    const say = (origin: 'raffle' | 'music' | 'sub_wheel', key: string) =>
      a.tx((q) =>
        insertWordGameSteps(q, {
          channelId: CH,
          now: T0,
          origin,
          drafts: [{ idempotencyKey: key, mode: 'normal', text: origin }],
        }),
      );
    await say('raffle', 'before:raffle');
    await say('music', 'before:music');
    const w = new WalletService(a);
    await coreWalletEconomy(w).move(a, T0, {
      channelId: CH,
      viewerId: '9601',
      currency: 'tokens',
      amount: 1234,
      kind: 'sub_wheel',
      key: randomUUID(),
      moduleId: 'sub_wheel',
    });
    await a.query(
      `insert into sw_spins (spin_id, channel_id, source, event_key, type, viewer_id, viewer_name, tier, months,
         status, segment, amount, award_status, created_at, updated_at)
       values ($1, $2, 'twitch', 'alert:twitch:x', 'resub', '9601', 'V', 1, 7, 'shown', 0, 1234, 'awarded', $3, $3)`,
      [randomUUID(), CH, T0],
    );
    const spins = await a.query('select * from sw_spins');
    const balances = await a.query('select * from wallets order by 1');
    expect(await migrate(a, 'prod')).toEqual([
      R1,
      R2,
      R8,
      RV21,
      RV22,
      RV24,
      RV25,
    ]);
    // BLOCKING (RV2-0): the existing rows survived and every origin is still accepted after the Roue V2 files.
    expect(
      (
        await a.query<{ origin: string }>(
          'select origin from cmd_steps order by seq_global',
        )
      ).map((r) => r.origin),
    ).toEqual(['raffle', 'music']);
    await say('raffle', 'after:raffle');
    await say('music', 'after:music');
    await say('sub_wheel', 'after:sub_wheel');
    const after = (
      await a.query<Record<string, unknown>>('select * from sw_spins')
    )[0]!;
    expect(after).toMatchObject(spins[0] as object);
    expect(after).toMatchObject({
      queue: null,
      sub_month: null,
      month_source: null,
      merged_into: null,
    });
    expect(await a.query('select * from wallets order by 1')).toEqual(balances);
    expect(
      await a.query('select mode, recovery_enabled from sw_settings'),
    ).toEqual([]);
    expect(await migrate(a, 'prod')).toEqual([]);
  });
});
