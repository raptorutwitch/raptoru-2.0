// Winner announcements on a real Postgres with real parallel connections: the migration (cmd_steps origins raffle /
// sub_wheel, nothing else accepted), the end of a Roue du Sub animation reported at once by two Cores → one message,
// and a Tombola drawn by two Cores ticking at once → one message per paid winner.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  type LabActor,
  RaffleCommand,
} from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };

describe.skipIf(!isLocal)('winner announcements, real Postgres', () => {
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
    clock = new FakeClock(new Date('2026-10-22T20:00:00Z'));
  });
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });
  const count = async (sql: string, p: unknown[] = []) =>
    Number(
      (await a.query<{ n: string }>(`select count(*) as n from ${sql}`, p))[0]!
        .n,
    );

  it('the migration accepts the origins raffle / sub_wheel only', async () => {
    const insert = (origin: string) =>
      a.query(
        `insert into cmd_steps (step_id, origin, invocation_id, channel_id, seq, idempotency_key, executor, kind, type,
           params, on_error, status, available_at, expires_at, created_at, updated_at)
         values ($1, $2, null, $3, 1, $4, 'twitch_chat', 'action', 'chat', '{}', 'continue', 'queued', now(), now(), now(), now())`,
        [randomUUID(), origin, CH, `test:${origin}`],
      );
    await a.query(
      'insert into cmd_channels (channel_id) values ($1) on conflict do nothing',
      [CH],
    );
    await insert('raffle');
    await insert('sub_wheel');
    await expect(insert('other')).rejects.toThrow(/cmd_steps_origin_check/);
    expect(await count('cmd_steps')).toBe(2);
  });

  it('the new Core before its migration: the wheel and the Tombola work, only the announcements are skipped', async () => {
    // The production constraint of 22/10 (before 20261031140000).
    const narrow = async (origins: string[]) => {
      await a.query(
        'alter table cmd_steps drop constraint cmd_steps_origin_check',
      );
      await a.query(
        `alter table cmd_steps add constraint cmd_steps_origin_check check (origin in (${origins.map((o) => `'${o}'`).join(', ')}))`,
      );
    };
    await narrow(['commands', 'word_game', 'mini_game']);
    const wheel = new SubWheelService(
      a,
      clock,
      () => 4,
      coreWalletEconomy(new WalletService(a)),
    );
    await wheel.setEnabled(CH, true);
    await wheel.fromAlert(
      {
        channel_id: CH,
        source: 'twitch',
        source_event_id: randomUUID(),
        type: 'resub',
        actor: { id: '9201', login: 'viewer', display_name: 'Viewer' },
        tier: '1000',
        months: 7,
      },
      null,
    );
    const c = await wheel.claimAnimation(CH, 'studio-1');
    expect(
      await wheel.reportAnimation(c.spin!.spin_id, {
        consumer_id: 'studio-1',
        event: 'completed',
      }),
    ).toEqual({ status: 'shown' });
    const r = new RaffleLabService(
      a,
      clock,
      () => 0.42,
      undefined,
      coreWalletEconomy(new WalletService(a)),
    );
    await r.act(CH, {
      actor: studio,
      command: RaffleCommand.parse({
        action: 'config',
        config: {
          ...DEFAULT_RAFFLE_CONFIG,
          amount_mode: 'fixed',
          fixed_amount: 30_000,
          winners_mode: 'custom',
          winners_custom: 1,
          full: { enabled: false, chance_pct: 1 },
          super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
        },
      }),
    });
    await r.act(CH, {
      actor: studio,
      command: RaffleCommand.parse({ action: 'launch' }),
    });
    await r.join({
      channel_id: CH,
      viewer: { id: '9301', display_name: 'V9301' },
      idempotency_key: 'ext-9301',
    });
    clock.advance(62_000);
    await r.tick();
    // Spin shown and paid, Tombola drawn and paid: only the chat messages are missing.
    expect(
      await count(
        "sw_spins where status = 'shown' and award_status = 'awarded'",
      ),
    ).toBe(1);
    expect(await count("lab_raffle_winners where payout_status = 'paid'")).toBe(
      1,
    );
    expect(await count('wallet_transactions')).toBe(2);
    expect(await count('cmd_steps')).toBe(0);
  });

  it('the end of the animation reported at once by two Cores: one announcement', async () => {
    const wheel = (db: Db) =>
      new SubWheelService(
        db,
        clock,
        () => 4,
        coreWalletEconomy(new WalletService(db)),
      );
    const w1 = wheel(a);
    const w2 = wheel(b);
    await w1.setEnabled(CH, true);
    const e: AlertEventInput = {
      channel_id: CH,
      source: 'twitch',
      source_event_id: randomUUID(),
      type: 'resub',
      actor: { id: '9201', login: 'viewer', display_name: 'Viewer' },
      tier: '1000',
      months: 7,
    };
    await w1.fromAlert(e, null);
    const c = await w1.claimAnimation(CH, 'studio-1');
    const report = { consumer_id: 'studio-1', event: 'completed' as const };
    await Promise.all([
      w1.reportAnimation(c.spin!.spin_id, report),
      w2.reportAnimation(c.spin!.spin_id, report),
      w1.reportAnimation(c.spin!.spin_id, report),
    ]);
    expect(await count("cmd_steps where origin = 'sub_wheel'")).toBe(1);
    expect(await count("wallet_transactions where source = 'sub_wheel'")).toBe(
      1,
    );
  });

  it('a Tombola drawn by two Cores ticking at once: one grouped announcement of the paid winners', async () => {
    const raffle = (db: Db) =>
      new RaffleLabService(
        db,
        clock,
        () => 0.42,
        undefined,
        coreWalletEconomy(new WalletService(db)),
      );
    const r1 = raffle(a);
    const r2 = raffle(b);
    await r1.act(CH, {
      actor: studio,
      command: RaffleCommand.parse({
        action: 'config',
        config: {
          ...DEFAULT_RAFFLE_CONFIG,
          amount_mode: 'fixed',
          fixed_amount: 30_000,
          winners_mode: 'custom',
          winners_custom: 3,
          full: { enabled: false, chance_pct: 1 },
          super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
        },
      }),
    });
    await r1.act(CH, {
      actor: studio,
      command: RaffleCommand.parse({ action: 'launch' }),
    });
    for (const v of ['9301', '9302', '9303', '9304', '9305'])
      await r1.join({
        channel_id: CH,
        viewer: { id: v, display_name: `V${v}` },
        idempotency_key: `ext-${v}`,
      });
    clock.advance(62_000);
    await Promise.all([r1.tick(), r2.tick(), r1.tick(), r2.tick()]);
    expect(await count("lab_raffle_winners where payout_status = 'paid'")).toBe(
      3,
    );
    expect(await count("wallet_transactions where source = 'raffle'")).toBe(3);
    expect(await count("cmd_steps where origin = 'raffle'")).toBe(1);
    const texts = (
      await a.query<{ text: string }>(
        "select params->>'text' as text from cmd_steps where origin = 'raffle'",
      )
    ).map((x) => x.text);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(
      /^🎉 Félicitations aux gagnants : @V93\d\d - 10 000 jetons · @V93\d\d - 10 000 jetons · @V93\d\d - 10 000 jetons$/,
    );
  });
});
