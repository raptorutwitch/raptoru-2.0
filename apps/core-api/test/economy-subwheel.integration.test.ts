// Phase 2 lot 5 on a real Postgres with real parallel connections (PGlite serializes every transaction and cannot
// prove the locks): the same sub received by two Core instances, award() from both Cores racing a cancellation, a
// wheel gain landing while the viewer spends on Bonk and wins a Tombola — one credit per gain, nothing lost.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  type LabActor,
  RaffleCommand,
  subWheelAmount,
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
import { SubWheelService } from '../src/sub-wheel/service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const V = '9201';
const SEGMENT = 4;
const GAIN = subWheelAmount(7, 1, SEGMENT);
const PRICE = BONK_LAB_RULES.simulatedCost;
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const event = (): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: V, login: 'viewer', display_name: 'Viewer' },
  tier: '1000',
  months: 7,
});

describe.skipIf(!isLocal)('canonical Roue du Sub, real Postgres', () => {
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
  });
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  const wheel = (db: Db) =>
    new SubWheelService(
      db,
      clock,
      () => SEGMENT,
      coreWalletEconomy(new WalletService(db)),
    );
  const n = async (sql: string) =>
    Number(
      (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
    );
  const tokens = async () =>
    Number(
      (
        await a.query<{ balance: string }>(
          "select balance from wallets where twitch_user_id = $1 and currency_id = 'main'",
          [V],
        )
      )[0]?.balance ?? 0,
    );
  const ledgerAgrees = async () =>
    expect(
      await n(`wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
               where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`),
    ).toBe(0);

  it('the same sub received by two Core instances at once: one spin, one credit', async () => {
    const [w1, w2] = [wheel(a), wheel(b)];
    await w1.setEnabled(CH, true);
    const e = event();
    await Promise.all([
      w1.fromAlert(e, null),
      w2.fromAlert(e, null),
      w1.fromAlert(e, null),
      w2.fromAlert(e, null),
    ]);
    expect(await n('sw_spins')).toBe(1);
    expect(await n("wallet_transactions where source = 'sub_wheel'")).toBe(1);
    expect(await tokens()).toBe(GAIN);
    await ledgerAgrees();
  });

  it('award() from two Cores racing a cancellation: either paid once or cancelled, never both', async () => {
    const [w1, w2] = [wheel(a), wheel(b)];
    await w1.setEnabled(CH, true);
    await a.query("update currencies set active = false where id = 'main'");
    const spin = (await w1.fromAlert(event(), null))!;
    expect(spin.award.status).toBe('pending');
    await a.query("update currencies set active = true where id = 'main'");
    await Promise.allSettled([
      w1.award(spin.spin_id),
      w2.award(spin.spin_id),
      w2.settleByHand(spin.spin_id, { status: 'cancelled', note: 'course' }),
    ]);
    const status = (
      await a.query<{ award_status: string }>(
        'select award_status from sw_spins',
      )
    )[0]!.award_status;
    const credited = await n("wallet_transactions where source = 'sub_wheel'");
    // Exactly one outcome: paid once, or cancelled with nothing paid.
    expect([
      status === 'awarded' && credited === 1,
      status === 'cancelled' && credited === 0,
    ]).toContain(true);
    expect(await tokens()).toBe(credited * GAIN);
    await ledgerAgrees();
  });

  it('a wheel gain while the same viewer spends on Bonk and wins a Tombola: every movement once, nothing lost', async () => {
    const w2 = wheel(b);
    await w2.setEnabled(CH, true);
    const portA = coreWalletEconomy(new WalletService(a));
    const bonk = new BonkLabService(a, clock, null, null, portA);
    const raffle = new RaffleLabService(a, clock, () => 0.42, undefined, portA);
    await new WalletService(a).credit({
      key: 'fund',
      viewer: { twitchUserId: V, login: 'viewer', displayName: 'Viewer' },
      amount: PRICE * 3,
      source: 'test',
    });
    await raffle.act(CH, {
      actor: studio,
      command: RaffleCommand.parse({
        action: 'config',
        config: {
          ...DEFAULT_RAFFLE_CONFIG,
          amount_mode: 'fixed',
          fixed_amount: 5_000,
          winners_mode: 'custom',
          winners_custom: 1,
          full: { enabled: false, chance_pct: 1 },
          super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
        },
      }),
    });
    await raffle.act(CH, {
      actor: studio,
      command: RaffleCommand.parse({ action: 'launch' }),
    });
    await raffle.join({
      channel_id: CH,
      viewer: { id: V, display_name: 'Viewer' },
      idempotency_key: 'join-viewer',
    });
    clock.advance(62_000);
    await bonk.heartbeat({
      studio_instance_id: 'studio-A',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    await Promise.all([
      w2.fromAlert(event(), null),
      raffle.tick(),
      ...[1, 2, 3].map((i) =>
        bonk.admit({
          idempotency_key: `bonk-${i}`,
          channel_id: CH,
          viewer: { id: V, display_name: 'Viewer' },
          lab_session_id: 'lab-1',
          emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
        }),
      ),
    ]);
    expect(await n("wallet_transactions where source = 'sub_wheel'")).toBe(1);
    expect(await n("wallet_transactions where source = 'raffle'")).toBe(1);
    expect(await n("wallet_transactions where source = 'bonk'")).toBe(3);
    expect(await tokens()).toBe(PRICE * 3 + GAIN + 5_000 - PRICE * 3);
    await ledgerAgrees();
  });
});
