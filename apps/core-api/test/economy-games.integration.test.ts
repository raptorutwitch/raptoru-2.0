// Phase 2 lot 1 on a real Postgres with real parallel connections (PGlite serializes every transaction and cannot
// prove the locks): Roulette / Duel / Bonk on the SAME canonical wallet from two Core instances at once.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LabChatMessage } from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BONK_LAB_RULES,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { MiniGamesService } from '../src/mini-games/service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '900900';
const PRICE = BONK_LAB_RULES.simulatedCost;
const ALICE = { id: '6001', login: 'alice', name: 'Alice' };
const BOB = { id: '6002', login: 'bob', name: 'Bob' };

describe.skipIf(!isLocal)(
  'canonical economy, several modules, real Postgres',
  () => {
    const pools: Db[] = [];
    let unlock: (() => Promise<void>) | undefined;
    let a: Db, b: Db;
    const clock = new FakeClock(new Date('2026-10-19T21:00:00Z'));
    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      b = createPgDb(url!);
      pools.push(a, b);
    }, LOCK_WAIT_MS);
    beforeEach(async () => {
      await a.query('drop schema public cascade; create schema public;');
      await migrate(a, 'all');
      // The mini-games play only in live (the chat games' session).
      await a.query(
        `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
         values (gen_random_uuid(), $1, now(), 'simulated', 'test')`,
        [CH],
      );
    });
    afterAll(async () => {
      for (const db of pools) await db.close();
      await unlock?.();
    });

    /** One Core instance per pool: games and Bonk on the canonical Wallet. */
    const core = (db: Db, rng = () => 0.9) => {
      const wallet = new WalletService(db);
      const port = coreWalletEconomy(wallet);
      return {
        games: new MiniGamesService(
          db,
          clock,
          rng,
          async (l) =>
            [ALICE, BOB]
              .map((v) => ({ id: v.id, login: v.login, display_name: v.name }))
              .find((v) => v.login === l) ?? null,
          port,
        ),
        bonk: new BonkLabService(db, clock, null, null, port),
        wallet,
      };
    };
    const msg = (
      text: string,
      v: typeof ALICE,
      id: string,
    ): LabChatMessage => ({
      channel_id: CH,
      message_id: id,
      text,
      chatter: {
        id: v.id,
        login: v.login,
        display_name: v.name,
        role: 'viewer',
      },
      source: 'twitch',
    });
    const fund = (v: typeof ALICE, amount: number) =>
      new WalletService(a).credit({
        key: `fund-${v.id}-${amount}`,
        viewer: { twitchUserId: v.id, login: v.login, displayName: v.name },
        amount,
        source: 'test',
      });
    const n = async (sql: string, p: unknown[] = []) =>
      Number(
        (
          await a.query<{ n: string }>(`select count(*) as n from ${sql}`, p)
        )[0]!.n,
      );
    const balance = async (v: typeof ALICE) =>
      Number(
        (
          await a.query<{ balance: string }>(
            "select balance from wallets where twitch_user_id = $1 and currency_id = 'main'",
            [v.id],
          )
        )[0]?.balance ?? 0,
      );
    const ledgerAgrees = async () =>
      expect(
        await n(`wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
               where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`),
      ).toBe(0);
    const bonkReady = async (c: ReturnType<typeof core>) =>
      c.bonk.heartbeat({
        studio_instance_id: 'studio-A',
        obs: 'connected',
        source_ready: true,
        overlay_ready: true,
      });
    const admitBonk = (c: ReturnType<typeof core>, key: string) =>
      c.bonk.admit({
        idempotency_key: key,
        channel_id: CH,
        viewer: { id: ALICE.id, display_name: ALICE.name },
        lab_session_id: 'lab-1',
        emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
      });

    it('the same roulette message 8× over 2 connections: one play, one Core movement', async () => {
      await fund(ALICE, 1_000);
      const [c1, c2] = [core(a), core(b)];
      await c1.games.setEnabled(CH, true);
      const m = msg('!roulette 100', ALICE, 'tw-same');
      const r = await Promise.all(
        Array.from({ length: 8 }, (_, i) => (i % 2 ? c2 : c1).games.chat(m)),
      );
      expect(
        r.filter((x) => !x.replayed && x.outcome === 'mini_game_played'),
      ).toHaveLength(1);
      expect(await n('mini_game_plays')).toBe(1);
      expect(await n("wallet_transactions where source = 'mini_game'")).toBe(1);
      expect(await balance(ALICE)).toBe(900);
      await ledgerAgrees();
    });

    it('Bonk shots and a roulette at once on one wallet that cannot pay everything: never below 0, nothing lost', async () => {
      const budget = PRICE * 3 + 50;
      await fund(ALICE, budget);
      const [c1, c2] = [core(a), core(b)];
      await c1.games.setEnabled(CH, true);
      await bonkReady(c1);
      const settled = await Promise.allSettled([
        ...Array.from({ length: 6 }, (_, i) =>
          admitBonk(i % 2 ? c2 : c1, `bonk-${i}`),
        ),
        c2.games.chat(msg('!roulette 100', ALICE, 'tw-r')),
      ]);
      const bonks = settled
        .slice(0, 6)
        .filter((s) => s.status === 'fulfilled').length;
      const played = await n('mini_game_plays');
      expect(await balance(ALICE)).toBeGreaterThanOrEqual(0);
      expect(await balance(ALICE)).toBe(budget - bonks * PRICE - played * 100);
      expect(await n("wallet_transactions where source = 'bonk'")).toBe(bonks);
      expect(await n('bonk_lab_interactions')).toBe(bonks);
      await ledgerAgrees();
    });

    it('a Duel accepted while the loser spends on Bonk: either the duel or the shots are refused, the total is kept', async () => {
      await fund(ALICE, 300);
      await fund(BOB, 300);
      const [c1, c2] = [core(a, () => 0.9), core(b, () => 0.9)]; // 0.9 → the target (Bob) wins: Alice pays
      await c1.games.setEnabled(CH, true);
      await bonkReady(c1);
      await c1.games.chat(msg('!duel @bob 250', ALICE, 'tw-d1'));
      await Promise.allSettled([
        c2.games.chat(msg('!accept', BOB, 'tw-d2')),
        admitBonk(c1, 'bonk-a'),
        admitBonk(c2, 'bonk-b'),
      ]);
      const bonks = await n('bonk_lab_interactions');
      const transferred = await n(
        "wallet_transactions where kind = 'transfer_in'",
      );
      expect(await balance(ALICE)).toBeGreaterThanOrEqual(0);
      expect(await balance(ALICE)).toBe(
        300 - bonks * PRICE - transferred * 250,
      );
      expect(await balance(BOB)).toBe(300 + transferred * 250);
      expect(
        (await balance(ALICE)) + (await balance(BOB)) + bonks * PRICE,
      ).toBe(600);
      await ledgerAgrees();
    });
  },
);
