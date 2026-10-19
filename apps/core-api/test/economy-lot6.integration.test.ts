// Phase 2 lot 6 on a real Postgres with real parallel connections (PGlite serializes every transaction and cannot
// prove the locks): moderation adjustments racing each other and Bonk spending, the same moderation action from two
// Cores, a chat !give racing Bonk spending, deferred Daily credits paid by two Cores at once.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LabActor, LabModerationCommand } from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import {
  BONK_LAB_RULES,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import {
  DeferredWalletCreditProvider,
  WalletCreditProvider,
} from '../src/daily/credits.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock, paris } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '901500';
const V = '901501';
const PRICE = BONK_LAB_RULES.simulatedCost;
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const who = (id: string) => ({
  twitchUserId: id,
  login: `v${id}`,
  displayName: `V${id}`,
});

describe.skipIf(!isLocal)(
  'canonical moderation, chat and Daily, real Postgres',
  () => {
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
      clock = new FakeClock(paris('2026-09-24', 20));
    });
    afterAll(async () => {
      for (const db of pools) await db.close();
      await unlock?.();
    });

    const instance = (db: Db) => {
      const core = createCore(db, clock, new DeferredWalletCreditProvider());
      const port = coreWalletEconomy(core.wallet.wallet);
      const bonk = new BonkLabService(db, clock, null, null, port);
      const mod = new LabModerationService(
        db,
        clock,
        core.ttsLab,
        core.soundLab,
        bonk,
        core.raffleLab,
        port,
      );
      const adjust = (delta: number, key: string) =>
        mod.act(CH, {
          actor: studio,
          idempotency_key: key,
          command: {
            action: 'wallet_adjust',
            viewer_id: V,
            currency: 'tokens',
            delta,
            reason: 'test',
          } as LabModerationCommand,
        });
      const shoot = (key: string) =>
        bonk.admit({
          idempotency_key: key,
          channel_id: CH,
          viewer: { id: V, display_name: 'Viewer' },
          lab_session_id: 'lab-1',
          emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
        });
      return { core, bonk, adjust, shoot };
    };
    const n = async (sql: string) =>
      Number(
        (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!
          .n,
      );
    const balance = async (id = V) =>
      Number(
        (
          await a.query<{ balance: string }>(
            "select balance from wallets where twitch_user_id = $1 and currency_id = 'main'",
            [id],
          )
        )[0]?.balance ?? 0,
      );
    const ledgerAgrees = async () =>
      expect(
        await n(`wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
               where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`),
      ).toBe(0);
    const fund = (amount: number, id = V) =>
      new WalletService(a).credit({
        key: `fund-${id}-${amount}`,
        viewer: who(id),
        amount,
        source: 'test',
      });

    it('moderation credit + oversized debit + Bonk shots at once: never below 0, every movement accounted', async () => {
      const [x, y] = [instance(a), instance(b)];
      await x.bonk.heartbeat({
        studio_instance_id: 'studio-A',
        obs: 'connected',
        source_ready: true,
        overlay_ready: true,
      });
      await fund(PRICE * 2);
      await Promise.allSettled([
        x.adjust(500, 'adjust-credit-1'),
        y.adjust(-1_000_000, 'adjust-debit-1'),
        x.shoot('bonk-1'),
        y.shoot('bonk-2'),
      ]);
      expect(await balance()).toBeGreaterThanOrEqual(0);
      await ledgerAgrees();
      expect(
        await n(
          "wallet_transactions where source = 'admin' and kind = 'admin_add'",
        ),
      ).toBe(1);
      expect(await n('bonk_lab_interactions')).toBe(
        await n("wallet_transactions where source = 'bonk'"),
      );
    });

    it('the same moderation action from two Cores at once: one adjustment', async () => {
      const [x, y] = [instance(a), instance(b)];
      await Promise.allSettled([
        x.adjust(300, 'adjust-same-key'),
        y.adjust(300, 'adjust-same-key'),
        x.adjust(300, 'adjust-same-key'),
      ]);
      expect(await balance()).toBe(300);
      expect(await n("wallet_transactions where source = 'admin'")).toBe(1);
    });

    it('a chat !give while the sender spends on Bonk: never below 0, sum kept', async () => {
      const [x, y] = [instance(a), instance(b)];
      await x.bonk.heartbeat({
        studio_instance_id: 'studio-A',
        obs: 'connected',
        source_ready: true,
        overlay_ready: true,
      });
      await fund(PRICE * 2);
      await Promise.allSettled([
        x.core.wallet.chat.transfer({
          requestId: 'twitch-msg-give',
          from: who(V),
          to: who('901502'),
          amount: PRICE * 2,
        }),
        y.core.wallet.chat.transfer({
          requestId: 'twitch-msg-give',
          from: who(V),
          to: who('901502'),
          amount: PRICE * 2,
        }),
        x.shoot('bonk-g1'),
        y.shoot('bonk-g2'),
      ]);
      expect(await balance()).toBeGreaterThanOrEqual(0);
      const spent =
        (await n("wallet_transactions where source = 'bonk'")) * PRICE;
      expect((await balance()) + (await balance('901502')) + spent).toBe(
        PRICE * 2,
      );
      expect(
        await n("wallet_transactions where kind = 'transfer_in'"),
      ).toBeLessThanOrEqual(1);
      await ledgerAgrees();
    });

    it('Daily credits kept pending while off, then sent by two Cores at once: each paid once', async () => {
      const off = instance(a).core;
      await off.streams.online({
        streamId: 'live-1',
        startedAt: paris('2026-09-24', 20),
      });
      clock.set(paris('2026-09-24', 21));
      for (const id of ['1001', '1002', '1003'])
        await off.daily.claim({ viewer: who(id), requestId: `msg-${id}` });
      expect(
        await n(
          "daily_credits where status = 'pending' and provider = 'core-wallet'",
        ),
      ).toBe(3);
      expect(await n('wallet_operations')).toBe(0);
      const on = [a, b].map((db) =>
        createCore(db, clock, new WalletCreditProvider(db)),
      );
      await Promise.all([
        on[0]!.credits.processPending(),
        on[1]!.credits.processPending(),
        on[0]!.credits.retryTick(),
      ]);
      expect(await n('wallet_operations')).toBe(3);
      for (const id of ['1001', '1002', '1003'])
        expect(await balance(id)).toBeGreaterThan(0);
      expect(await n("daily_credits where status = 'credited'")).toBe(3);
    });
  },
);
