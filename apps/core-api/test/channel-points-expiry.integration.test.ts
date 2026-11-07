// Refonte H2 on a real Postgres with two Core instances (two pools): at the expiry instant, claims and history reads of
// both Cores at once → the job is claimed or expired, never both; Twitch is asked for ONE refund.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted. Fictional data.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ChannelPointsService,
  CP_RULES,
} from '../src/channel-points/service.js';
import { CpTwitchActions } from '../src/channel-points/twitch-actions.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '900778';
const REWARD = '11111111-2222-4333-8444-666666666666';

describe.skipIf(!isLocal)(
  'Points de chaîne H2 expiry on a real Postgres',
  () => {
    let a: Db;
    let b: Db;
    let unlock: (() => Promise<void>) | undefined;
    const clock = new FakeClock(new Date('2026-11-05T20:00:00Z'));
    let cpA: ChannelPointsService;
    let cpB: ChannelPointsService;

    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      await a.query('drop schema public cascade; create schema public;');
      await migrate(a, 'all');
      b = createPgDb(url!);
      const mk = (db: Db) =>
        new ChannelPointsService(
          db,
          clock,
          undefined,
          undefined,
          undefined,
          undefined,
          new CpTwitchActions(db, clock),
        );
      cpA = mk(a);
      cpB = mk(b);
      await cpA.syncRewards({
        channel_id: CH,
        rewards: [
          { id: REWARD, title: 'Fictive', cost: 100, is_enabled: true },
        ],
      });
      await a.query(
        'update cp_rewards set managed_by_raptoru = true where channel_id = $1',
        [CH],
      );
      await cpA.saveRule(CH, REWARD, {
        enabled: true,
        actions: [{ type: 'obs_scene', scene: 'Fictive' }],
      });
      await cpA.setEnabled(CH, true, 'test');
    }, LOCK_WAIT_MS);
    afterAll(async () => {
      await b?.close();
      await a?.close();
      await unlock?.();
    });

    it('20 concurrent claims and reads at the expiry instant: no job handed out, one refund per redemption', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of ids)
        await cpA.receive({
          channel_id: CH,
          source: 'twitch',
          redemption_id: id,
          reward: { id: REWARD, title: 'Fictive', cost: 100 },
          user: { id: '9001', login: 'fictif', display_name: 'Fictif' },
          user_input: '',
          twitch_status: 'unfulfilled',
          redeemed_at: clock.now().toISOString(),
        });
      clock.advance(CP_RULES.queuedMaxMs + 1);
      const out = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          i % 3 === 0
            ? (i % 2 ? cpA : cpB).state(CH).then(() => null)
            : (i % 2 ? cpA : cpB).claim(CH, `studio-${i}`),
        ),
      );
      expect(out.filter(Boolean)).toEqual([]);
      const refunds = await a.query<{ redemption_id: string }>(
        "select payload->>'redemption_id' as redemption_id from cp_twitch_actions where kind = 'redemption_status'",
      );
      expect(refunds.map((r) => r.redemption_id).sort()).toEqual(
        [...ids].sort(),
      );
      const jobs = await a.query<{ status: string }>(
        'select status from cp_jobs where channel_id = $1',
        [CH],
      );
      expect(jobs.map((j) => j.status)).toEqual([
        'expired',
        'expired',
        'expired',
      ]);
    });
  },
);
