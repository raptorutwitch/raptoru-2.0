// Phase 2 lot 10 — the historical Crédits TTS / Soundboard of the legacy extension (docs/ECONOMY_MIGRATION.md § 18),
// rehearsed end to end on a real, disposable Postgres: a copy of the legacy table ext_channel_point_redemptions
// (SYNTHETIC rows following the legacy rules — they prove the tools, never the real historical amounts), the real
// read-only export query (src/wallet/legacy-credits-export.sql), the inventory, the converter, the secure opening import
// (interrupted, replayed, concurrent), then two main Cores on the canonical Wallet: the Extension shows the balances,
// a spend, an internal refund after a failed sound, ledger = balances, the Lab never touched.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import {
  convertLegacyCredits,
  inventoryLegacyCredits,
  LegacyCreditsError,
} from '../src/wallet/legacy-credits-to-opening.js';
import {
  applyOpeningImport,
  readOpeningSnapshot,
  verifyOpeningImport,
} from '../src/wallet/opening-import.js';
import { FakeClock } from './helpers.js';
import { bootMainCore, MAIN_CORE_CHANNEL, playersReady } from './main-core.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = MAIN_CORE_CHANNEL;
const CUTOFF = '2026-10-19T18:00:00.000Z';
const H = 3_600_000;
const at = (ms: number) => new Date(Date.parse(CUTOFF) + ms).toISOString();

/** The legacy table as its migrations 001 + 006 + 008 leave it (columns read by the export). */
const LEGACY_TABLE = `create table ext_channel_point_redemptions (
  redemption_id text primary key, reward_id text not null, reward_key text not null, twitch_user_id text not null,
  login text not null, cost integer not null check (cost >= 0), status text not null default 'available'
    check (status in ('available', 'claimed', 'fulfilled', 'expired', 'cancel_pending', 'canceled')),
  redeemed_at timestamptz not null, expires_at timestamptz not null, attempts integer not null default 0,
  payload jsonb, claimed_at timestamptz, settled_at timestamptz, created_at timestamptz not null default now(),
  credit_units integer not null default 1, credit_remaining integer not null default 1,
  credit_in_flight integer not null default 0, credit_claim_cost integer not null default 0,
  source text not null default 'eventsub', stream_session_id text)`;

const ALICE = '6101';
const BOB = '6102';
const CAROL = '6103';

describe.skipIf(!isLocal)(
  'lot 10: historical credits → canonical Wallet, real Postgres (synthetic legacy rows)',
  () => {
    const pools: Db[] = [];
    const servers: Server[] = [];
    let unlock: (() => Promise<void>) | undefined;
    let a: Db, b: Db;
    const clock = new FakeClock(new Date('2026-10-19T19:00:00Z'));
    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      b = createPgDb(url!);
      pools.push(a, b);
      await a.query('drop schema public cascade; create schema public;');
      await migrate(a, 'prod');
      await a.query(LEGACY_TABLE);
    }, LOCK_WAIT_MS);
    afterAll(async () => {
      for (const s of servers) await new Promise((r) => s.close(() => r(null)));
      for (const db of pools) await db.close();
      await unlock?.();
    });
    const n = async (sql: string) =>
      Number(
        (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!
          .n,
      );
    const balance = async (id: string, currency: string) =>
      Number(
        (
          await a.query<{ balance: string }>(
            'select balance from wallets where twitch_user_id = $1 and currency_id = $2',
            [id, currency],
          )
        )[0]?.balance ?? 0,
      );

    /** The real export query, the cutoff set, inside a read-only transaction (a write would fail). */
    const exportNow = async () => {
      const sql = await readFile(
        join(
          import.meta.dirname,
          '..',
          'src',
          'wallet',
          'legacy-credits-export.sql',
        ),
        'utf8',
      );
      const select = sql
        .slice(sql.indexOf('with params'), sql.indexOf('commit;'))
        .replace(
          "timestamptz '2026-10-20T00:00:00Z'",
          `timestamptz '${CUTOFF}'`,
        )
        .trim()
        .replace(/;$/, '');
      return a.tx(async (q) => {
        await q.query(
          'set transaction isolation level repeatable read read only',
        );
        const r = await q.query<{ legacy_credits_export: unknown }>(select);
        return JSON.stringify(r[0]!.legacy_credits_export);
      });
    };

    it('inventory, drain, decision, import (interrupted, replayed, concurrent), Extension, spend, refund, ledger', async () => {
      // --- The legacy rows (synthetic), following the legacy rules.
      const ins = (
        id: string,
        user: string,
        login: string,
        key: string,
        o: {
          status?: string;
          units?: number;
          left?: number;
          inFlight?: number;
          claim?: number;
          expires: string;
          redeemed?: string;
          source?: string;
          rewardId?: string;
        },
      ) =>
        a.query(
          `insert into ext_channel_point_redemptions (redemption_id, reward_id, reward_key, twitch_user_id, login, cost,
             status, redeemed_at, expires_at, credit_units, credit_remaining, credit_in_flight, credit_claim_cost, source)
           values ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            id,
            o.rewardId ?? `reward-${key}`,
            key,
            user,
            login,
            o.status ?? 'available',
            o.redeemed ?? at(-24 * H),
            o.expires,
            o.units ?? 1,
            o.left ?? o.units ?? 1,
            o.inFlight ?? 0,
            o.claim ?? 0,
            o.source ?? 'eventsub',
          ],
        );
      // Alice: a managed TTS (6 h), a dashboard TTS (365 days), a pack of 3 with 1 left, a used-up pack, a grant.
      await ins('tw-a1', ALICE, 'alice', 'tts', { expires: at(5 * H) });
      await ins('tw-a2', ALICE, 'alice', 'tts', { expires: at(300 * 24 * H) });
      await ins('tw-a3', ALICE, 'alice', 'sound', {
        units: 3,
        left: 1,
        expires: at(300 * 24 * H),
      });
      await ins('tw-a4', ALICE, 'alice', 'sound', {
        units: 3,
        left: 0,
        status: 'fulfilled',
        expires: at(300 * 24 * H),
      });
      await ins(
        `moderation-credit:${CH}:${ALICE}:op-1`,
        ALICE,
        ALICE,
        'sound',
        {
          units: 4,
          expires: '9999-12-31T00:00:00Z',
          source: 'moderation',
          rewardId: 'moderation-credit',
        },
      );
      // Bob renamed (same Twitch ID), and a Soundboard pack being played right now (1 credit reserved).
      await ins('tw-b1', BOB, 'bob_old', 'tts', {
        expires: at(200 * 24 * H),
        redeemed: at(-90 * 24 * H),
      });
      await ins('tw-b2', BOB, 'bob', 'tts', { expires: at(300 * 24 * H) });
      await ins('tw-b3', BOB, 'bob', 'sound', {
        units: 3,
        left: 1,
        inFlight: 1,
        claim: 1,
        status: 'claimed',
        expires: at(300 * 24 * H),
      });
      // Carol: canceled (points refunded on Twitch), expired pack, a TTS expired before the cutoff.
      await ins('tw-c1', CAROL, 'carol', 'tts', {
        status: 'canceled',
        expires: at(300 * 24 * H),
      });
      await ins('tw-c2', CAROL, 'carol', 'sound', {
        units: 3,
        status: 'expired',
        expires: at(-2 * H),
      });
      await ins('tw-c3', CAROL, 'carol', 'tts', { expires: at(-1 * H) });
      // The old extension's Lab test (cost 0) and an expired Bonk credit.
      await ins(`lab-${CH}-${ALICE}-k1`, ALICE, 'alice', 'tts', {
        expires: at(3 * H),
        rewardId: 'lab:tts',
      });
      await ins('tw-d1', '6104', 'dan', 'bonk', { expires: at(-3 * H) });

      // --- 1. First export: the inventory sees everything; the converter refuses the credit in flight.
      const first = await exportNow();
      const inv = inventoryLegacyCredits(first).public;
      expect(inv.integrity).toEqual([]);
      expect(inv.rows).toBe(13);
      expect(inv.by_reward_key.sound!.in_flight).toEqual({
        rows: 1,
        credits: 2,
      });
      expect(inv.usable).toEqual({
        tts: { viewers: 2, credits: 4 },
        sound: { viewers: 1, credits: 5 },
      });
      expect(inv.by_reward_key.tts).toMatchObject({
        lab: { rows: 1, credits: 1 },
        canceled: { rows: 1, credits: 1 },
        expired: { rows: 1, credits: 1 },
      });
      expect(inv.identity).toEqual({
        invalid_twitch_ids: 0,
        ids_with_several_logins: 1,
        logins_on_several_ids: 0,
      });
      const refusal = (text: string, expiry?: 'permanent') => {
        try {
          convertLegacyCredits({
            exportText: text,
            importPrefix: 'l10',
            expiry,
          });
          return [];
        } catch (e) {
          return (e as LegacyCreditsError).blocking;
        }
      };
      expect(refusal(first, 'permanent')).toEqual([
        expect.stringContaining('crédit en vol (claimed) : tw-b3'),
      ]);

      // --- 2. The legacy extension finishes that sound (its own rule: 1 left → available again), export again.
      await a.query(
        `update ext_channel_point_redemptions set status = 'available', credit_in_flight = 0, credit_claim_cost = 0,
           settled_at = $2 where redemption_id = $1`,
        ['tw-b3', at(10_000)],
      );
      const final = await exportNow();
      // Without the decision on the legacy expiry: refused, the amounts never guessed.
      expect(refusal(final)).toEqual([
        expect.stringContaining('décision requise : 4 crédit(s) tts'),
        expect.stringContaining('décision requise : 2 crédit(s) sound'),
      ]);
      const { snapshots, summary } = convertLegacyCredits({
        exportText: final,
        importPrefix: 'l10',
        expiry: 'permanent',
      });
      expect(summary.currencies.credits_tts).toMatchObject({
        viewers: 2,
        imported: 4,
      });
      expect(summary.currencies.credits_soundboard).toMatchObject({
        viewers: 2,
        imported: 6,
      });
      const [tts, sound] = snapshots.map((s) => readOpeningSnapshot(s.text));

      // --- 3. Jetons opening (synthetic) + the two credits openings. TTS first interrupted (connection lost).
      const jetons = readOpeningSnapshot(
        JSON.stringify({
          import_id: 'l10-main',
          currency_id: 'main',
          source: 'streamelements',
          cutoff: CUTOFF,
          source_snapshot: {
            sha256: 'c'.repeat(64),
            accounts: 2,
            total: 2_000,
          },
          rows: [ALICE, BOB].map((id) => ({
            twitch_user_id: id,
            login: id === ALICE ? 'alice' : 'bob',
            balance: 1_000,
            sources: [{ source_ref: `se:${id}`, balance: 1_000 }],
          })),
          excluded: [],
        }),
      );
      expect(
        (await applyOpeningImport(a, jetons.snapshot, jetons.sha256)).status,
      ).toBe('ready');
      let inserts = 0;
      const failing: Db = {
        ...a,
        tx: (fn) =>
          a.tx((q) =>
            fn({
              query: (sql: string, params?: unknown[]) => {
                if (
                  /insert into wallet_transactions/.test(sql) &&
                  ++inserts === 2
                )
                  throw new Error('connection lost');
                return q.query(sql, params);
              },
            } as typeof q),
          ),
      };
      await expect(
        applyOpeningImport(failing, tts!.snapshot, tts!.sha256),
      ).rejects.toThrow('connection lost');
      expect(await n("wallets where currency_id = 'credits_tts'")).toBe(0);
      expect(await n("wallet_imports where currency_id = 'credits_tts'")).toBe(
        0,
      );
      // Resumed: the whole import once; the Soundboard one on two connections at once: once.
      expect(
        (await applyOpeningImport(a, tts!.snapshot, tts!.sha256)).status,
      ).toBe('ready');
      const both = await Promise.allSettled([
        applyOpeningImport(a, sound!.snapshot, sound!.sha256),
        applyOpeningImport(b, sound!.snapshot, sound!.sha256),
      ]);
      expect(
        both.filter(
          (r) => r.status === 'fulfilled' && r.value.status === 'ready',
        ),
      ).toHaveLength(1);
      for (const s of [jetons, tts!, sound!]) {
        expect((await applyOpeningImport(b, s.snapshot, s.sha256)).status).toBe(
          'already_applied',
        );
        expect((await verifyOpeningImport(a, s.snapshot, s.sha256)).ok).toBe(
          true,
        );
      }
      // Exact balances by Twitch ID; Bob's two logins are one wallet.
      expect(await balance(ALICE, 'credits_tts')).toBe(2);
      expect(await balance(ALICE, 'credits_soundboard')).toBe(5);
      expect(await balance(BOB, 'credits_tts')).toBe(2);
      expect(await balance(BOB, 'credits_soundboard')).toBe(1);
      expect(await balance(CAROL, 'credits_tts')).toBe(0);
      expect(await n(`wallets where twitch_user_id = '${BOB}'`)).toBe(3);
      // Every legacy row accounted for (imported or excluded with its reason), the Lab test never imported.
      expect(
        await n(
          "wallet_import_sources where status = 'excluded' and reason = 'Lab de test (fictif)'",
        ),
      ).toBe(1);
      expect(
        await n(
          "wallet_import_sources where source_ref like 'ext-redemption:lab-%' and status <> 'excluded'",
        ),
      ).toBe(0);

      // --- 4. Two main Cores on the canonical Wallet: the Extension reads the historical balances.
      const boot = (db: Db) =>
        bootMainCore(db, clock, { extensionSecret: randomBytes(32), servers });
      const A = await boot(a);
      const B = await boot(b);
      await playersReady(A.core);
      const session = async (id: string) => (await B.ext(id, '/session')).body;
      expect(await session(ALICE)).toMatchObject({
        payment_mode: 'wallet',
        credits: { tts: 2, soundboard: 5 },
        wallet: { available: 1_000 },
      });
      expect((await session(CAROL)).credits).toEqual({ tts: 0, soundboard: 0 });

      // --- 5. A sound paid in the migrated credits, then the player fails before any audio: refunded once.
      const paid = await A.ext(ALICE, '/actions/redemption', {
        module_id: 'soundboard',
        redemption_id: 'credit-soundboard',
        payload: { sound_id: 'boop' },
      });
      expect(paid.status).toBe(200);
      const cost = Number(paid.body.cost);
      expect(cost).toBeGreaterThan(0);
      expect(await balance(ALICE, 'credits_soundboard')).toBe(5 - cost);
      expect(await balance(ALICE, 'main')).toBe(1_000);
      const played = (await A.core.soundLab.claim('studio-1', CH))!;
      const fail = () =>
        A.core.soundLab.ack(played.interaction_id, {
          studio_instance_id: 'studio-1',
          attempt_id: played.delivery.attempt_id!,
          event: 'failed',
          error: {
            code: 'audio_error',
            message: 'decode failed',
            retryable: false,
          },
        } as never);
      await fail();
      await fail().catch(() => undefined); // reported twice
      expect(await balance(ALICE, 'credits_soundboard')).toBe(5);
      // A TTS paid in migrated credits by Bob, kept.
      const said = await B.ext(BOB, '/actions/redemption', {
        module_id: 'tts',
        redemption_id: 'credit-tts-1',
        payload: { text: 'Merci' },
      });
      expect(said.status).toBe(200);
      expect(await balance(BOB, 'credits_tts')).toBe(
        2 - Number(said.body.cost),
      );

      // --- 6. One ledger: balances = sum of their transactions; nothing negative; the Lab never involved.
      expect(
        await n(`wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
               where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`),
      ).toBe(0);
      expect(await n('wallets where balance < 0')).toBe(0);
      expect(await n('lab_wallets')).toBe(0);
      expect(await n('lab_wallet_ledger')).toBe(0);
      expect(await n('wallet_transactions where amount = 12000')).toBe(0);
      // The legacy table was only read.
      expect(await n('ext_channel_point_redemptions')).toBe(13);
    }, 120_000);
  },
);
