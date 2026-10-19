// Phase 2 lot 4 on a real Postgres with real parallel connections (PGlite serializes every transaction and cannot
// prove the locks): the same redemption delivered to two Core instances, a Twitch cancellation racing a TTS paid in
// those credits — credited once, taken back at most once, never below 0, ledger = balances.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import type { CpRedemptionInput } from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChannelPointsService } from '../src/channel-points/service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { TtsLabService } from '../src/tts-lab/tts-lab-service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const REWARD = 'reward-credits-tts';
const V = { id: '9401', login: 'viewer_pg', display_name: 'Viewer PG' };

describe.skipIf(!isLocal)('canonical credits, real Postgres', () => {
  const pools: Db[] = [];
  let unlock: (() => Promise<void>) | undefined;
  let a: Db, b: Db;
  let clock: FakeClock;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    b = createPgDb(url!);
    pools.push(a, b);
  }, LOCK_WAIT_MS);
  beforeEach(async () => {
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    clock = new FakeClock(new Date('2026-10-19T21:30:00Z'));
    const cp = points(a);
    await cp.syncRewards({
      channel_id: CH,
      rewards: [
        { id: REWARD, title: 'Crédits TTS', cost: 1000, is_enabled: true },
      ],
    });
    await cp.setEnabled(CH, true, 'test');
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'credits', currency: 'credits_tts', amount: 3 }],
    });
  });
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  const points = (db: Db) =>
    new ChannelPointsService(
      db,
      clock,
      undefined,
      undefined,
      coreWalletEconomy(new WalletService(db)),
    );
  const credits = async () =>
    Number(
      (
        await a.query<{ balance: string }>(
          "select balance from wallets where twitch_user_id = $1 and currency_id = 'credits_tts'",
          [V.id],
        )
      )[0]?.balance ?? 0,
    );
  const ledgerMatches = async () =>
    Number(
      (
        await a.query<{ n: string }>(
          `select count(*) as n from wallets w where balance <> (select coalesce(sum(amount), 0)
             from wallet_transactions t where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`,
        )
      )[0]!.n,
    );
  const redemption = (): CpRedemptionInput => ({
    channel_id: CH,
    source: 'twitch',
    redemption_id: randomUUID(),
    reward: { id: REWARD, title: 'Crédits TTS', cost: 1000 },
    user: V,
    twitch_status: 'unfulfilled',
    redeemed_at: clock.now().toISOString(),
  });

  it('the same redemption on two Cores at once: one credit', async () => {
    for (let i = 0; i < 5; i++) {
      const e = redemption();
      const outs = await Promise.all([
        points(a).receive(e),
        points(b).receive(e),
      ]);
      expect(outs.map((o) => o.outcome).sort()).toEqual(['done', 'duplicate']);
    }
    expect(await credits()).toBe(15);
    expect(await ledgerMatches()).toBe(0);
  });

  it('a cancellation racing a TTS paid in those credits: never below 0, each credit counted once', async () => {
    const tts = new TtsLabService(
      b,
      clock,
      Math.random,
      undefined,
      coreWalletEconomy(new WalletService(b)),
    );
    await tts.heartbeat({ studio_instance_id: 'S', player_ready: true });
    const e = redemption();
    await points(a).receive(e);
    const cancel = () =>
      points(a).update({
        channel_id: CH,
        source: 'twitch',
        redemption_id: e.redemption_id,
        reward_id: REWARD,
        user_id: V.id,
        twitch_status: 'canceled',
      });
    const [, spent] = await Promise.allSettled([
      cancel(),
      tts.admit({
        channel_id: CH,
        viewer: { id: V.id, display_name: V.display_name },
        lab_session_id: 'lab-1',
        idempotency_key: 'tts-race',
        text: 'Course',
        payment_method: 'credits',
      }),
      cancel(),
    ]);
    const cost =
      spent.status === 'fulfilled' ? spent.value.interaction.simulated_cost : 0;
    const row = (
      await a.query<{ results: { granted: number; reversed: number }[] }>(
        'select results from cp_redemptions where redemption_id = $1',
        [e.redemption_id],
      )
    )[0]!;
    // Either the TTS paid first (the reversal takes the rest) or the reversal took all (the TTS is refused).
    expect(row.results[0]!.reversed + cost).toBe(3);
    expect(await credits()).toBe(0);
    expect(await ledgerMatches()).toBe(0);
    expect(
      Number(
        (
          await a.query<{ n: string }>(
            "select count(*) as n from wallet_operations where idempotency_key like '%:reversal'",
          )
        )[0]!.n,
      ),
    ).toBe(row.results[0]!.reversed > 0 ? 1 : 0);
  });
});
