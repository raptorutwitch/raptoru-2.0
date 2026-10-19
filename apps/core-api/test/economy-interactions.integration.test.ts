// Phase 2 lot 2 on a real Postgres with real parallel connections (PGlite serializes every transaction and cannot
// prove the locks): Bonk salves, Soundboard and TTS spending at once on ONE canonical wallet from two Core instances;
// the same moderation refund and the same expiry sweep from both instances — never paid twice.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LabActor, LabModerationCommand } from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BONK_LAB_RULES,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { SoundLabService } from '../src/sound-lab/sound-lab-service.js';
import { TtsLabService } from '../src/tts-lab/tts-lab-service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '901100';
const STUDIO = 'studio-A';
const V = { id: '901101', display_name: 'Viewer Concurrent' };
const PRICE = BONK_LAB_RULES.simulatedCost;
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };

describe.skipIf(!isLocal)(
  'canonical Bonk / Soundboard / TTS, real Postgres',
  () => {
    const pools: Db[] = [];
    let unlock: (() => Promise<void>) | undefined;
    let a: Db, b: Db;
    const clock = new FakeClock(new Date('2026-10-19T22:00:00Z'));
    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      b = createPgDb(url!);
      pools.push(a, b);
    }, LOCK_WAIT_MS);
    beforeEach(async () => {
      await a.query('drop schema public cascade; create schema public;');
      await migrate(a, 'all');
    });
    afterAll(async () => {
      for (const db of pools) await db.close();
      await unlock?.();
    });

    let seq = 0;
    /** One Core instance per pool, every module on the canonical Wallet. */
    const core = (db: Db) => {
      const port = coreWalletEconomy(new WalletService(db));
      const bonk = new BonkLabService(db, clock, null, null, port);
      const sound = new SoundLabService(db, clock, Math.random, port);
      const tts = new TtsLabService(db, clock, Math.random, undefined, port);
      const mod = new LabModerationService(
        db,
        clock,
        tts,
        sound,
        bonk,
        new RaffleLabService(db, clock),
        port,
      );
      return { bonk, sound, tts, mod };
    };
    const ready = async (c: ReturnType<typeof core>) => {
      await c.bonk.heartbeat({
        studio_instance_id: STUDIO,
        obs: 'connected',
        source_ready: true,
        overlay_ready: true,
      });
      await c.sound.heartbeat({
        studio_instance_id: STUDIO,
        player_ready: true,
      });
      await c.tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    };
    const fund = (amount: number) =>
      new WalletService(a).credit({
        key: `fund-${++seq}`,
        viewer: {
          twitchUserId: V.id,
          login: 'viewer_concurrent',
          displayName: V.display_name,
        },
        amount,
        source: 'test',
      });
    const n = async (sql: string) =>
      Number(
        (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!
          .n,
      );
    const balance = async () =>
      Number(
        (
          await a.query<{ balance: string }>(
            "select balance from wallets where twitch_user_id = $1 and currency_id = 'main'",
            [V.id],
          )
        )[0]?.balance ?? 0,
      );
    const debited = async () =>
      -Number(
        (
          await a.query<{ s: string }>(
            "select coalesce(sum(amount), 0) as s from wallet_transactions where kind = 'spend'",
          )
        )[0]!.s,
      );
    const ledgerAgrees = async () =>
      expect(
        await n(`wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
               where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`),
      ).toBe(0);
    const base = { channel_id: CH, viewer: V, lab_session_id: 'lab-1' };
    const emote = {
      provider: 'unicode' as const,
      id: 'unicode:1f600',
      glyph: '😀',
    };

    it('salves, sounds and TTS at once on a wallet that cannot pay everything: never below 0, every admission paid', async () => {
      const [c1, c2] = [core(a), core(b)];
      await ready(c1);
      await fund(PRICE * 4 + 300);
      await Promise.allSettled([
        c1.bonk.admitVolley({
          ...base,
          idempotency_key: 'v-1',
          emotes: [emote, emote, emote],
          cadence_ms: 200,
        }),
        c2.bonk.admitVolley({
          ...base,
          idempotency_key: 'v-2',
          emotes: [emote, emote],
          cadence_ms: 200,
        }),
        c1.sound.admit({
          ...base,
          idempotency_key: 's-1',
          sound_id: 'boop',
          payment_method: 'tokens',
        }),
        c2.sound.admit({
          ...base,
          idempotency_key: 's-2',
          sound_id: 'boop',
          payment_method: 'tokens',
        }),
        c1.tts.admit({
          ...base,
          idempotency_key: 't-1',
          text: 'Bonjour',
          payment_method: 'tokens',
        }),
      ]);
      expect(await balance()).toBeGreaterThanOrEqual(0);
      expect(await balance()).toBe(PRICE * 4 + 300 - (await debited()));
      // Every admitted interaction has exactly one debit, every debit an admitted interaction.
      const admitted =
        (await n('bonk_lab_interactions')) +
        (await n('sound_lab_interactions')) +
        (await n('tts_lab_interactions'));
      expect(await n("wallet_transactions where kind = 'spend'")).toBe(
        admitted,
      );
      expect(await n('lab_wallet_ledger')).toBe(0);
      await ledgerAgrees();
    });

    it('the same cancel-with-refund from two Core instances at once: refunded once', async () => {
      const [c1, c2] = [core(a), core(b)];
      await ready(c1);
      await fund(10_000);
      const { interaction } = await c1.sound.admit({
        ...base,
        idempotency_key: 's-r',
        sound_id: 'boop',
        payment_method: 'tokens',
      });
      const command = {
        action: 'cancel',
        module: 'soundboard',
        interaction_id: interaction.interaction_id,
        refund: true,
      } as LabModerationCommand;
      await Promise.allSettled([
        c1.mod.act(CH, {
          actor: studio,
          command,
          idempotency_key: 'cancel-instance-1',
        }),
        c2.mod.act(CH, {
          actor: studio,
          command,
          idempotency_key: 'cancel-instance-2',
        }),
      ]);
      expect(await n("wallet_transactions where kind = 'refund'")).toBe(1);
      expect(await balance()).toBe(10_000);
      await ledgerAgrees();
    });

    it('expired Bonks swept by two Core instances at once: each refunded exactly once', async () => {
      const [c1, c2] = [core(a), core(b)];
      await ready(c1);
      await fund(PRICE * 3);
      await c1.bonk.admitVolley({
        ...base,
        idempotency_key: 'v-exp',
        emotes: [emote, emote, emote],
        cadence_ms: 200,
      });
      clock.advance(BONK_LAB_RULES.expiresAfterMs + 1);
      await Promise.all([
        c1.bonk.sweepExpired(),
        c2.bonk.sweepExpired(),
        c1.bonk.sweepExpired(),
      ]);
      expect(await n("wallet_transactions where kind = 'refund'")).toBe(3);
      expect(await balance()).toBe(PRICE * 3);
      await ledgerAgrees();
    });
  },
);
