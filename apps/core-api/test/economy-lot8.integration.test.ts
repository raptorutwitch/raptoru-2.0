// Phase 2 lot 8 — the main Core hosts the chat games and receives the real Twitch alerts, on ONE canonical Wallet
// (docs/ECONOMY_MIGRATION.md § 16). Real, disposable Postgres; two main Core instances (two pools, two HTTP servers)
// plus one whose database fails mid-operation (a crash / lost connection). Only the real doors: /v1/bot/chat,
// /v1/bot/stream, /v1/bot/alerts/events, /v1/bot/loyalty/events (bot secret), the Extension (Twitch JWT), the Studio
// cockpit (installation credential). Nothing reaches Twitch: the Duel target lookup is injected.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { RaffleCommand, type LabActor } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { DEFAULT_RAFFLE_CONFIG } from '../src/raffle-lab/rules.js';
import {
  applyOpeningImport,
  type OpeningSnapshot,
  readOpeningSnapshot,
} from '../src/wallet/opening-import.js';
import { FakeClock } from './helpers.js';
import { bootMainCore, MAIN_CORE_CHANNEL, playersReady } from './main-core.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = MAIN_CORE_CHANNEL;
const SECRET = randomBytes(32);
const ALICE = { id: '6001', login: 'alice', name: 'Alice' };
const BOB = { id: '6002', login: 'bob', name: 'Bob' };
const studioActor: LabActor = {
  id: 'antoni',
  role: 'broadcaster',
  via: 'studio',
};

describe.skipIf(!isLocal)(
  'lot 8: chat games and real alerts on the main Core, real Postgres',
  () => {
    const pools: Db[] = [];
    const servers: Server[] = [];
    let unlock: (() => Promise<void>) | undefined;
    let a: Db, b: Db, c: Db;
    const clock = new FakeClock(new Date('2026-10-26T19:00:00Z'));
    const CUTOFF = '2026-10-26T18:00:00.000Z';
    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      b = createPgDb(url!);
      c = createPgDb(url!);
      pools.push(a, b, c);
      await a.query('drop schema public cascade; create schema public;');
      // The production selection only (lot 8: it now holds the chat games' tables).
      await migrate(a, 'prod');
    }, LOCK_WAIT_MS);
    afterAll(async () => {
      for (const s of servers) await new Promise((r) => s.close(() => r(null)));
      for (const db of pools) await db.close();
      await unlock?.();
    });

    const n = async (sql: string, params: unknown[] = []) =>
      Number(
        (
          await a.query<{ n: string }>(
            `select count(*) as n from ${sql}`,
            params,
          )
        )[0]!.n,
      );
    const tokens = async (id: string) =>
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
    const lookup = async (login: string) =>
      login === BOB.login
        ? { id: BOB.id, login: BOB.login, display_name: BOB.name }
        : login === ALICE.login
          ? { id: ALICE.id, login: ALICE.login, display_name: ALICE.name }
          : null;
    const boot = (db: Db) =>
      bootMainCore(db, clock, {
        extensionSecret: SECRET,
        servers,
        loginLookup: lookup,
      });
    let seq = 0;
    const msg = (who: typeof ALICE, text: string, id = `msg-${++seq}`) => ({
      channel_id: CH,
      message_id: id,
      text,
      chatter: {
        id: who.id,
        login: who.login,
        display_name: who.name,
        role: 'viewer',
      },
      source: 'twitch',
    });

    it('games, Bonk, Tombola, sub → alert + wheel + Loyalty, replays, crash, two Cores: one Wallet, ledger = balances', async () => {
      // --- Opening (synthetic) and the two empty credits imports: the canonical economy may start.
      const opening: OpeningSnapshot = {
        import_id: 'lot8-main',
        currency_id: 'main',
        source: 'streamelements',
        cutoff: CUTOFF,
        source_snapshot: { sha256: 'c'.repeat(64), accounts: 2, total: 60_000 },
        rows: [ALICE, BOB].map((v) => ({
          twitch_user_id: v.id,
          login: v.login,
          balance: 30_000,
          sources: [{ source_ref: `se:${v.login}`, balance: 30_000 }],
        })),
        excluded: [],
      };
      const empty = (currency: string) => ({
        import_id: `lot8-${currency}`,
        currency_id: currency,
        source: 'legacy-ext-redemptions',
        cutoff: CUTOFF,
        source_snapshot: { sha256: 'd'.repeat(64), accounts: 0, total: 0 },
        rows: [],
        excluded: [],
      });
      for (const s of [
        opening,
        empty('credits_tts'),
        empty('credits_soundboard'),
      ]) {
        const r = readOpeningSnapshot(JSON.stringify(s));
        await applyOpeningImport(a, r.snapshot, r.sha256);
      }
      const A = await boot(a);
      const B = await boot(b);
      await playersReady(A.core);
      const chat = (X: typeof A, m: ReturnType<typeof msg>) =>
        X.bot('/v1/bot/chat', m);

      // --- Doors: Twitch source and the Core's channel only; Studio cannot reach the chat or the answers' executor.
      expect(
        (await chat(A, { ...msg(ALICE, '!roulette 100'), source: 'simulator' }))
          .body.error,
      ).toBe('twitch_source_required');
      expect(
        (await chat(A, { ...msg(ALICE, '!roulette 100'), channel_id: '1' }))
          .body.error,
      ).toBe('wrong_channel');
      expect((await A.studio('/v1/studio/cockpit/chat', {})).status).toBe(404);
      expect(
        (
          await A.studio(`/v1/studio/cockpit/commands/${CH}/steps/claim`, {
            executor_id: 'studio',
          })
        ).status,
      ).toBe(404);

      // --- Studio configures the games through the cockpit (switches only, rules unchanged).
      expect(
        (
          await A.studio(`/v1/studio/cockpit/mini-games/${CH}/settings`, {
            enabled: true,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await A.bot('/v1/bot/stream', {
            channel_id: CH,
            event: 'online',
            twitch_stream_id: '777',
          })
        ).status,
      ).toBe(200);

      // --- 1. A viewer plays several games and uses Bonk.
      const rouletteMsg = msg(ALICE, '!roulette 100');
      const roulette = await chat(A, rouletteMsg);
      expect(roulette.status).toBe(200);
      expect(roulette.body.handled).toEqual([
        expect.objectContaining({ module: 'mini_games' }),
      ]);
      clock.advance(11_000);
      expect((await chat(A, msg(ALICE, '!slot 20'))).status).toBe(200);
      await playersReady(A.core); // Studio's heartbeat, after the clock moved
      const bonk = await A.ext(ALICE.id, '/actions/tokens', {
        module_id: 'bonk',
        payload: {
          emote_source: 'unicode',
          emotes: ['unicode:1f600'],
          emote_glyph: '😀',
        },
      });
      expect(bonk.status).toBe(200);
      expect(await n('mini_game_plays')).toBe(2);
      expect(
        await n("wallet_transactions where source = 'mini_game'"),
      ).toBeGreaterThan(0);
      // Answers for the chat wait as steps, for the bot's executor (Sortie chat réelle OFF: nothing claimed).
      expect(await n('cmd_steps')).toBeGreaterThan(0);
      expect(
        (
          await A.bot(`/v1/bot/commands/${CH}/steps/claim`, {
            executor_id: 'bot-test',
          })
        ).status,
      ).toBe(200);

      // --- 2. A Duel transfer at the same moment as a Soundboard spend of the target.
      expect(
        (await chat(A, msg(ALICE, '!duel @bob 500'))).body.handled,
      ).toEqual([expect.objectContaining({ module: 'mini_games' })]);
      await playersReady(A.core);
      const [accept, sound] = await Promise.all([
        chat(B, msg(BOB, '!accept')),
        A.ext(BOB.id, '/actions/tokens', {
          module_id: 'soundboard',
          payload: { sound_id: 'boop' },
        }),
      ]);
      expect(accept.status).toBe(200);
      expect(sound.status).toBe(200);
      expect(await n("mini_game_duels where status <> 'pending'")).toBe(1);

      // --- 3. A Jeu des mots win at the same moment as a Tombola gain.
      await A.studio(`/v1/studio/cockpit/word-game/${CH}/actions`, {
        action: 'new_word',
        request_id: randomUUID(),
      });
      const word = (
        await a.query<{ word: string }>(
          "select word from word_game_words where status = 'active' limit 1",
        )
      )[0]!.word;
      const act = (command: Record<string, unknown>) =>
        A.core.raffleLab.act(CH, {
          actor: studioActor,
          command: RaffleCommand.parse(command),
        });
      await act({
        action: 'config',
        config: {
          ...DEFAULT_RAFFLE_CONFIG,
          amount_mode: 'fixed',
          fixed_amount: 1_000,
          winners_mode: 'custom',
          winners_custom: 1,
          full: { enabled: false, chance_pct: 1 },
          super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
        },
      });
      await act({ action: 'launch' });
      expect((await A.ext(BOB.id, '/actions/raffle', {})).status).toBe(200);
      clock.advance(62_000);
      const wordMsg = msg(ALICE, word);
      const [won] = await Promise.all([
        chat(B, wordMsg),
        A.core.raffleLab.tick(),
      ]);
      expect(won.body.handled).toEqual([
        expect.objectContaining({
          module: 'word_game',
          outcome: 'word_game_win',
        }),
      ]);
      expect(await n("lab_raffle_winners where payout_status = 'paid'")).toBe(
        1,
      );
      expect(await n("wallet_transactions where source = 'word_game'")).toBe(1);

      // --- 4. A sub: the alert (chat notice id) and Loyalty (EventSub id) are two events, each paid at most once.
      await A.studio(`/v1/studio/sub-wheel/${CH}/settings`, { enabled: true });
      const alert = {
        channel_id: CH,
        source: 'twitch',
        source_event_id: randomUUID(),
        type: 'sub',
        actor: { id: BOB.id, login: BOB.login, display_name: BOB.name },
        tier: '1000',
        occurred_at: clock.now().toISOString(),
      };
      const loyalty = {
        type: 'sub',
        eventId: randomUUID(),
        occurredAt: clock.now().toISOString(),
        viewer: {
          twitchUserId: BOB.id,
          login: BOB.login,
          displayName: BOB.name,
        },
        tier: 't1',
        isGift: false,
      };
      expect((await A.bot('/v1/bot/alerts/events', alert)).status).toBe(200);
      expect((await A.bot('/v1/bot/loyalty/events', loyalty)).status).toBe(200);
      await A.core.loyalty.processPending();
      expect(await n('alert_events')).toBe(1);
      expect(await n("wallet_transactions where source = 'sub_wheel'")).toBe(1);
      const loyaltyCredits = await n(
        "loyalty_rewards where status = 'credited'",
      );
      expect(loyaltyCredits).toBe(1);
      // An alert sent by a Studio as « twitch », or by the bot for another channel: refused.
      expect(
        (
          await A.studio('/v1/studio/alerts/events', {
            ...alert,
            source_event_id: randomUUID(),
          })
        ).status,
      ).toBe(403);
      expect(
        (await A.bot('/v1/bot/alerts/events', { ...alert, channel_id: '1' }))
          .body.error,
      ).toBe('wrong_channel');

      // --- 5. Every Twitch event received several times, on both Cores (outbox replays, reconnections).
      const operations = await n('wallet_operations');
      for (const X of [A, B, A, B]) {
        await X.bot('/v1/bot/alerts/events', alert);
        await X.bot('/v1/bot/loyalty/events', loyalty);
        await chat(X, rouletteMsg);
        await chat(X, wordMsg);
        await X.core.loyalty.processPending();
      }
      expect(await n('wallet_operations')).toBe(operations);
      expect(await n('alert_events')).toBe(1);

      // --- 6/7. The bot loses the Core / a Core dies during the operation: nothing kept; the resent message pays once.
      const failing: Db = {
        ...c,
        tx: (fn) =>
          c.tx((q) =>
            fn({
              query: (sql: string, params?: unknown[]) => {
                if (/insert into wallet_transactions/.test(sql))
                  throw new Error('connection lost');
                return q.query(sql, params);
              },
            } as typeof q),
          ),
      };
      const C = await boot(failing);
      clock.advance(11_000);
      const crashed = msg(BOB, '!roulette 200');
      const lost = await chat(C, crashed);
      expect(lost.status).toBeGreaterThanOrEqual(500);
      expect(
        await n('mini_game_plays where message_id = $1', [crashed.message_id]),
      ).toBe(0);
      expect((await chat(A, crashed)).status).toBe(200);
      expect((await chat(B, crashed)).status).toBe(200);
      expect(
        await n('mini_game_plays where message_id = $1', [crashed.message_id]),
      ).toBe(1);

      // --- 8. Two Cores take the same request at once: one effect.
      clock.advance(11_000);
      const twice = msg(ALICE, '!roulette 150');
      await Promise.all([chat(A, twice), chat(B, twice), chat(A, twice)]);
      expect(
        await n('mini_game_plays where message_id = $1', [twice.message_id]),
      ).toBe(1);

      // --- 9. One Wallet: balances = ledger, nothing negative, never the Lab wallet, no 12 000.
      await ledgerAgrees();
      expect(await n('wallets where balance < 0')).toBe(0);
      expect(await n('lab_wallets')).toBe(0);
      expect(await n('lab_wallet_ledger')).toBe(0);
      expect(await n('wallet_transactions where amount = 12000')).toBe(0);
      // Every Jetons movement of the games, Bonk, Soundboard, Tombola, wheel and Loyalty on the same ledger.
      const sources = (
        await a.query<{ source: string }>(
          "select distinct source from wallet_transactions where currency_id = 'main' order by source",
        )
      ).map((r) => r.source);
      for (const s of [
        'bonk',
        'mini_game',
        'raffle',
        'soundboard',
        'sub_wheel',
        'word_game',
      ])
        expect(sources).toContain(s);
      // The Extension reads exactly that Wallet.
      for (const v of [ALICE, BOB])
        expect((await B.ext(v.id, '/session')).body.wallet.available).toBe(
          await tokens(v.id),
        );
    }, 120_000);
  },
);
