// ASTRA-P1-001 lot 1 on a real Postgres with real parallel connections (PGlite serializes every
// transaction and cannot prove the locks): Core Wallet debit + Bonk admission in one transaction.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BONK_LAB_RULES,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CHANNEL = '900100';
const PRICE = BONK_LAB_RULES.simulatedCost;

describe.skipIf(!isLocal)('Core Wallet + admission on a real Postgres', () => {
  const pools: Db[] = [];
  let unlock: (() => Promise<void>) | undefined;
  const pool = () => {
    const db = createPgDb(url!);
    pools.push(db);
    return db;
  };
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    const db = pool();
    await db.query('drop schema public cascade; create schema public;');
    await migrate(db, 'all');
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  /** Two Core instances (two pools) on the same database, like a rolling restart. */
  async function twoCores(viewerId: string, funds: number) {
    const clock = new FakeClock(new Date());
    const services = [pool(), pool()].map(
      (db) =>
        new BonkLabService(
          db,
          clock,
          null,
          null,
          coreWalletEconomy(new WalletService(db)),
        ),
    );
    await services[0]!.heartbeat({
      studio_instance_id: 'studio-A',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    const wallet = new WalletService(pools[0]!);
    await wallet.credit({
      key: `fund-${viewerId}`,
      viewer: {
        twitchUserId: viewerId,
        login: `v${viewerId}`,
        displayName: `V${viewerId}`,
      },
      amount: funds,
      source: 'test',
    });
    const admit = (i: number, key: string) =>
      services[i % 2]!.admit({
        idempotency_key: key,
        channel_id: CHANNEL,
        viewer: { id: viewerId, display_name: `V${viewerId}` },
        lab_session_id: 'lab-1',
        emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
      });
    const balance = async () =>
      (await wallet.getWallet(viewerId))?.balance ?? 0;
    const debits = async () =>
      Number(
        (
          await pools[0]!.query<{ n: string }>(
            `select count(*) as n from wallet_transactions where twitch_user_id = $1 and kind = 'spend'`,
            [viewerId],
          )
        )[0]!.n,
      );
    return { admit, balance, debits };
  }

  it('8 parallel requests with the same key over 2 connections: one interaction, one debit, 7 replays', async () => {
    const c = await twoCores('910001', 10 * PRICE);
    const out = await Promise.all(
      Array.from({ length: 8 }, (_, i) => c.admit(i, 'same-click')),
    );
    expect(new Set(out.map((o) => o.interaction.interaction_id)).size).toBe(1);
    expect(out.filter((o) => o.replayed)).toHaveLength(7);
    expect(await c.debits()).toBe(1);
    expect(await c.balance()).toBe(9 * PRICE);
  });

  it('10 parallel distinct requests on a balance covering 3: exactly 3 admitted and paid, balance never negative', async () => {
    const c = await twoCores('910002', 3 * PRICE);
    const out = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => c.admit(i, `click-${i}`)),
    );
    const admitted = out.filter((o) => o.status === 'fulfilled');
    const refused = out.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );
    expect(admitted).toHaveLength(3);
    expect(
      refused.every(
        (r) => (r.reason as { code?: string }).code === 'insufficient_tokens',
      ),
    ).toBe(true);
    expect(await c.debits()).toBe(3);
    expect(await c.balance()).toBe(0);
  });
});
