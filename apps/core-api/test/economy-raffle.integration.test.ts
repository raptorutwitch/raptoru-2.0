// Phase 2 lot 3 on a real Postgres with real parallel connections (PGlite serializes every transaction and cannot
// prove the locks): two Core instances taking the same due Tombola draw, a winner paid while spending on Bonk, the same
// payout retried from both instances — always one credit per winner and round.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import {
  RaffleCommand,
  type LabActor,
  type RaffleConfig,
} from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BONK_LAB_RULES,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { DEFAULT_RAFFLE_CONFIG } from '../src/raffle-lab/rules.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '901300';
const PRICE = BONK_LAB_RULES.simulatedCost;
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const QUIET: Partial<RaffleConfig> = {
  amount_mode: 'fixed',
  fixed_amount: 20_000,
  winners_mode: 'custom',
  winners_custom: 2,
  full: { enabled: false, chance_pct: 1 },
  super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
};

describe.skipIf(!isLocal)('canonical Tombola, real Postgres', () => {
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
    clock = new FakeClock(new Date('2026-10-19T19:00:00Z'));
  });
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  let seq = 0;
  const raffle = (db: Db) =>
    new RaffleLabService(
      db,
      clock,
      () => 0.42,
      undefined,
      coreWalletEconomy(new WalletService(db)),
    );
  const act = (r: RaffleLabService, command: Record<string, unknown>) =>
    r.act(CH, { actor: studio, command: RaffleCommand.parse(command) });
  const open = async (
    r: RaffleLabService,
    viewers: string[],
    patch: Partial<RaffleConfig> = {},
  ) => {
    await act(r, {
      action: 'config',
      config: { ...DEFAULT_RAFFLE_CONFIG, ...QUIET, ...patch },
    });
    await act(r, { action: 'launch' });
    let id = '';
    for (const v of viewers)
      id = (
        (await r.join({
          channel_id: CH,
          viewer: { id: v, display_name: `V${v}` },
          idempotency_key: `ext-${v}-${++seq}`,
        })) as { raffle_id: string }
      ).raffle_id;
    return id;
  };
  const n = async (sql: string) =>
    Number(
      (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
    );
  const tokens = async (v: string) =>
    Number(
      (
        await a.query<{ balance: string }>(
          "select balance from wallets where twitch_user_id = $1 and currency_id = 'main'",
          [v],
        )
      )[0]?.balance ?? 0,
    );
  const ledgerAgrees = async () =>
    expect(
      await n(`wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
               where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`),
    ).toBe(0);

  it('the same due draw taken by two Core instances at once: one draw, one credit per winner', async () => {
    const [r1, r2] = [raffle(a), raffle(b)];
    await open(r1, ['901301', '901302', '901303', '901304']);
    clock.advance(62_000);
    await Promise.all([r1.tick(), r2.tick(), r1.tick(), r2.tick()]);
    expect(await n('lab_raffle_winners')).toBe(2);
    expect(await n("wallet_transactions where source = 'raffle'")).toBe(2);
    expect(await n('lab_raffles where drawn_at is not null')).toBe(1);
    const paid = await a.query<{ viewer_id: string }>(
      "select viewer_id from lab_raffle_winners where payout_status = 'paid'",
    );
    for (const w of paid) expect(await tokens(w.viewer_id)).toBe(10_000);
    await ledgerAgrees();
  });

  it('a winner paid while spending on Bonk at the same moment: both applied, nothing lost', async () => {
    const [r1] = [raffle(a)];
    const port = coreWalletEconomy(new WalletService(b));
    const bonk = new BonkLabService(b, clock, null, null, port);
    const winner = '901311';
    await new WalletService(a).credit({
      key: 'fund-winner',
      viewer: { twitchUserId: winner, login: 'winner', displayName: 'Winner' },
      amount: PRICE * 3,
      source: 'test',
    });
    await open(r1, [winner], { winners_custom: 1 });
    clock.advance(62_000);
    await bonk.heartbeat({
      studio_instance_id: 'studio-A',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    await Promise.all([
      r1.tick(),
      ...[1, 2, 3].map((i) =>
        bonk.admit({
          idempotency_key: `bonk-${i}`,
          channel_id: CH,
          viewer: { id: winner, display_name: 'Winner' },
          lab_session_id: 'lab-1',
          emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
        }),
      ),
    ]);
    expect(await n("wallet_transactions where source = 'raffle'")).toBe(1);
    expect(await n("wallet_transactions where source = 'bonk'")).toBe(3);
    expect(await tokens(winner)).toBe(PRICE * 3 - PRICE * 3 + 20_000);
    await ledgerAgrees();
  });

  it('the same failed payout retried from two Core instances at once: paid exactly once', async () => {
    const [r1, r2] = [raffle(a), raffle(b)];
    const id = await open(r1, ['901321'], { winners_custom: 1 });
    await a.query("update currencies set active = false where id = 'main'");
    clock.advance(62_000);
    await r1.tick();
    expect(await n("lab_raffle_winners where payout_status = 'failed'")).toBe(
      1,
    );
    await a.query("update currencies set active = true where id = 'main'");
    const retry = (r: RaffleLabService) =>
      act(r, { action: 'retry_payout', raffle_id: id, viewer_id: '901321' });
    await Promise.allSettled([retry(r1), retry(r2), retry(r1)]);
    expect(await n("wallet_transactions where source = 'raffle'")).toBe(1);
    expect(await tokens('901321')).toBe(20_000);
    expect(await n("lab_raffle_winners where payout_status = 'paid'")).toBe(1);
    await ledgerAgrees();
  });
});
