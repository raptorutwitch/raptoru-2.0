// Phase 2 lot 7 — integration rehearsal of the ONE canonical economy (docs/ECONOMY_MIGRATION.md § 15), on a real,
// disposable Postgres with two Core instances (two pools, two HTTP servers: a restart and real concurrency). The main
// Core as src/index.ts assembles it (createCore + viewer frontier + createApp), reached through its real doors: the
// bot routes (Daily, Loyalty, chat transfer, channel points), the Extension (Twitch JWT: balances, Bonk, TTS,
// Soundboard in Jetons and in credits, Tombola, moderation), the paired Studio (channel points rules). Opening balances
// (Jetons + historical credits) come from synthetic files through the real importers — never the Lab's 12 000.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RaffleCommand, type LabActor } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../src/app.js';
import type { CoreConfig } from '../src/config.js';
import { WalletCreditProvider } from '../src/daily/credits.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import {
  CORE_ECONOMY_MODULES,
  EconomyActivationError,
  selectEconomy,
} from '../src/economy/activation.js';
import { createPublicFrontier } from '../src/ext/public-frontier.js';
import { signExtensionJwt } from '../src/ext/twitch-jwt.js';
import { createApp } from '../src/http/server.js';
import { DEFAULT_RAFFLE_CONFIG } from '../src/raffle-lab/rules.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { convertLegacyCredits } from '../src/wallet/legacy-credits-to-opening.js';
import {
  applyOpeningImport,
  type OpeningSnapshot,
  readOpeningSnapshot,
  verifyOpeningImport,
} from '../src/wallet/opening-import.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const SECRET = randomBytes(32);
const BOT = 'bot-rehearsal-secret-0123456789';
const ALICE = { twitchUserId: '5001', login: 'alice', displayName: 'Alice' };
const BOB = { twitchUserId: '5002', login: 'bob', displayName: 'Bob' };
const CAROL = '5003'; // never in any source: a blank wallet
const REWARD = 'reward-credits-tts';
const studioActor: LabActor = {
  id: 'antoni',
  role: 'broadcaster',
  via: 'studio',
};

describe.skipIf(!isLocal)(
  'rehearsal: one canonical economy, real Postgres',
  () => {
    const pools: Db[] = [];
    const servers: Server[] = [];
    let unlock: (() => Promise<void>) | undefined;
    let a: Db, b: Db;
    const clock = new FakeClock(new Date('2026-10-25T19:00:00Z'));
    const CUTOFF = '2026-10-25T18:00:00.000Z';
    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      b = createPgDb(url!);
      pools.push(a, b);
      await a.query('drop schema public cascade; create schema public;');
      // The main Core's schema: production + the Lab files its viewer frontier needs (the staging selection).
      await migrate(a, 'staging');
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
    const balance = async (id: string, currency = 'main') =>
      Number(
        (
          await a.query<{ balance: string }>(
            'select balance from wallets where twitch_user_id = $1 and currency_id = $2',
            [id, currency],
          )
        )[0]?.balance ?? 0,
      );
    const ledgerAgrees = async () =>
      expect(
        await n(`wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
               where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`),
      ).toBe(0);

    /** One main Core process as src/index.ts assembles it, on its own pool. */
    async function boot(db: Db) {
      const economy = await selectEconomy({
        mode: 'canonical',
        q: db,
        wallet: new WalletService(db),
        modules: CORE_ECONOMY_MODULES,
      });
      const core = createCore(
        db,
        clock,
        new WalletCreditProvider(db),
        { preview: false, passiveCredits: true, eventCredits: true },
        null,
        economy,
      );
      const frontier = createPublicFrontier(core, db, clock, {
        TWITCH_CHANNEL_ID: CH,
        TWITCH_CHANNEL_LOGIN: 'raptoru_',
        TWITCH_EXTENSION_SECRET: SECRET.toString('base64'),
        CORE_ENVIRONMENT: 'staging',
      } as CoreConfig)!;
      const server = createApp({
        labRoutes: false,
        ...frontier.deps,
        daily: core.daily,
        streams: core.streams,
        presence: core.presence,
        wallet: core.wallet,
        loyalty: core.loyalty,
        bonkLab: core.bonkLab,
        soundLab: core.soundLab,
        ttsLab: core.ttsLab,
        studioInstallations: core.studioInstallations,
        alerts: core.alerts,
        channelPoints: core.channelPoints,
        randomBan: core.randomBan,
        subWheel: core.subWheel,
        botSecret: BOT,
        studioSecret: 'studio-rehearsal-secret-0123456789',
        db,
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      servers.push(server);
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const send = async (
        path: string,
        body: unknown,
        headers: Record<string, string>,
      ) => {
        const res = await fetch(base + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        return {
          status: res.status,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
          body: (text ? JSON.parse(text) : null) as any,
        };
      };
      const bot = (path: string, body: unknown) =>
        send(path, body, { authorization: `Bearer ${BOT}` });
      const jwt = (userId: string, role = 'viewer') =>
        signExtensionJwt(
          {
            exp: Math.floor(Date.now() / 1000) + 600,
            opaque_user_id: `U${userId}`,
            channel_id: CH,
            role,
            user_id: userId,
          },
          SECRET,
        );
      const ext = (
        userId: string,
        path: string,
        body?: unknown,
        key: string = randomUUID(),
        role = 'viewer',
      ) =>
        send(`/v1/ext${path}`, body, {
          authorization: `Bearer ${jwt(userId, role)}`,
          origin: 'https://abcdef123.ext-twitch.tv',
          ...(body === undefined ? {} : { 'idempotency-key': key }),
        });
      // A paired Studio (installation credential).
      const id = randomUUID();
      const secret = randomBytes(32).toString('base64url');
      await core.studioInstallations.register(
        `${id}.${sha256(secret)}`,
        'PC répétition',
      );
      const studio = (path: string, body?: unknown) =>
        send(path, body, {
          authorization: `Bearer rsi_${id}.${secret}`,
          [STUDIO_PROTOCOL_HEADER]: '1',
        });
      return { core, bot, ext, studio };
    }
    const ready = async (core: Core) => {
      await core.bonkLab.heartbeat({
        studio_instance_id: 'studio-1',
        obs: 'connected',
        source_ready: true,
        overlay_ready: true,
      });
      await core.soundLab.heartbeat({
        studio_instance_id: 'studio-1',
        player_ready: true,
      });
      await core.ttsLab.heartbeat({
        studio_instance_id: 'studio-1',
        player_ready: true,
      });
    };

    it('opening → activation → every module on one Wallet → replays, restart, concurrency → ledger = balances', async () => {
      // --- 0. Before any import, the canonical economy refuses to start.
      const refused = await selectEconomy({
        mode: 'canonical',
        q: a,
        wallet: new WalletService(a),
        modules: CORE_ECONOMY_MODULES,
      }).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(EconomyActivationError);
      expect((refused as EconomyActivationError).reasons).toHaveLength(3);

      // --- 1. Opening of the Jetons (an approved snapshot, synthetic here).
      const jetons: OpeningSnapshot = {
        import_id: 'rehearsal-main',
        currency_id: 'main',
        source: 'streamelements',
        cutoff: CUTOFF,
        source_snapshot: { sha256: 'a'.repeat(64), accounts: 3, total: 25_777 },
        rows: [
          {
            twitch_user_id: ALICE.twitchUserId,
            login: 'alice',
            balance: 20_000,
            sources: [{ source_ref: 'se:alice', balance: 20_000 }],
          },
          {
            twitch_user_id: BOB.twitchUserId,
            login: 'bob',
            balance: 5_000,
            sources: [{ source_ref: 'se:bob', balance: 5_000 }],
          },
        ],
        excluded: [{ source_ref: 'se:ghost', balance: 777, reason: 'test' }],
      };
      const files = [JSON.stringify(jetons)];
      // --- 2. Historical credits (legacy export → one snapshot per currency).
      const legacyRows = [
        { id: 'h1', key: 'tts', user: ALICE, units: 1, left: 1 },
        { id: 'h2', key: 'tts', user: ALICE, units: 1, left: 1 },
        { id: 'h3', key: 'sound', user: ALICE, units: 3, left: 3 },
        { id: 'h4', key: 'tts', user: BOB, units: 1, left: 1 },
      ].map((r) => ({
        redemption_id: r.id,
        reward_key: r.key,
        twitch_user_id: r.user.twitchUserId,
        login: r.user.login,
        status: 'available',
        expires_at: '2027-06-01T00:00:00.000Z',
        credit_units: r.units,
        credit_remaining: r.left,
        credit_in_flight: 0,
      }));
      const legacy = convertLegacyCredits({
        exportText: JSON.stringify({
          source: 'legacy-ext-redemptions',
          exported_at: CUTOFF,
          cutoff: CUTOFF,
          declared: { rows: 4, remaining: { tts: 3, sound: 3 } },
          rows: legacyRows,
        }),
        importPrefix: 'rehearsal-credits',
      });
      files.push(...legacy.snapshots.map((s) => s.text));
      for (const text of files) {
        const { snapshot, sha256: fp } = readOpeningSnapshot(text);
        expect((await applyOpeningImport(a, snapshot, fp)).status).toBe(
          'ready',
        );
      }

      // --- 3. Activation (simulated: this process only), then the extension reads the three balances.
      const A = await boot(a);
      await ready(A.core);
      const session = async (id: string, X = A) =>
        (await X.ext(id, '/session')).body;
      const s0 = await session(ALICE.twitchUserId);
      expect(s0).toMatchObject({
        payment_mode: 'wallet',
        test_mode: false,
        wallet: { available: 20_000 },
        credits: { tts: 2, soundboard: 3 },
      });
      expect((await session(BOB.twitchUserId)).credits).toEqual({
        tts: 1,
        soundboard: 0,
      });
      // A viewer of no source: real zeros, never the Lab's 12 000.
      expect(await session(CAROL)).toMatchObject({
        wallet: { available: 0 },
        credits: { tts: 0, soundboard: 0 },
      });

      // --- 4/5. Bonk, TTS and Soundboard in Jetons; TTS and Soundboard in credits.
      const bonk = {
        module_id: 'bonk',
        payload: {
          emote_source: 'unicode',
          emotes: ['unicode:1f600'],
          emote_glyph: '😀',
        },
      };
      const spent = (r: { status: number; body: { cost: number } }) => {
        expect(r.status).toBe(200);
        return Number(r.body.cost);
      };
      let alice = 20_000;
      alice -= spent(await A.ext(ALICE.twitchUserId, '/actions/tokens', bonk));
      alice -= spent(
        await A.ext(ALICE.twitchUserId, '/actions/tokens', {
          module_id: 'soundboard',
          payload: { sound_id: 'boop' },
        }),
      );
      alice -= spent(
        await A.ext(ALICE.twitchUserId, '/actions/tokens', {
          module_id: 'tts',
          payload: { text: 'Bonsoir' },
        }),
      );
      const sbCredits = spent(
        await A.ext(ALICE.twitchUserId, '/actions/redemption', {
          module_id: 'soundboard',
          redemption_id: 'credit-soundboard',
          payload: { sound_id: 'ohlala' },
        }),
      );
      const ttsCredits = spent(
        await A.ext(BOB.twitchUserId, '/actions/redemption', {
          module_id: 'tts',
          redemption_id: 'credit-tts-1',
          payload: { text: 'Merci' },
        }),
      );
      expect(await balance(ALICE.twitchUserId)).toBe(alice);
      expect(await balance(ALICE.twitchUserId, 'credits_soundboard')).toBe(
        3 - sbCredits,
      );
      expect(await balance(ALICE.twitchUserId, 'credits_tts')).toBe(2);
      expect(await balance(BOB.twitchUserId, 'credits_tts')).toBe(
        1 - ttsCredits,
      );
      expect(await balance(BOB.twitchUserId)).toBe(5_000);
      // The Bonk cannot be paid in credits; a viewer without credits is refused, never paid in Jetons instead.
      expect(
        (await A.ext(ALICE.twitchUserId, '/actions/redemption', bonk)).body
          .error,
      ).toBe('unsupported_payment');
      expect(
        (
          await A.ext(CAROL, '/actions/redemption', {
            module_id: 'soundboard',
            payload: { sound_id: 'hello' },
          })
        ).body.error,
      ).toBe('insufficient_credits');

      // --- 6. Tombola (joined from the extension) and Roue du Sub (a real resub).
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
          fixed_amount: 1_500,
          winners_mode: 'custom',
          winners_custom: 1,
          full: { enabled: false, chance_pct: 1 },
          super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
        },
      });
      await act({ action: 'launch' });
      for (const id of [ALICE.twitchUserId, BOB.twitchUserId])
        expect((await A.ext(id, '/actions/raffle', {})).status).toBe(200);
      clock.advance(62_000);
      await A.core.raffleLab.tick();
      const winner = (
        await a.query<{ viewer_id: string; payout_status: string }>(
          'select viewer_id, payout_status from lab_raffle_winners',
        )
      )[0]!;
      expect(winner.payout_status).toBe('paid');
      if (winner.viewer_id === ALICE.twitchUserId) alice += 1_500;
      let bob = 5_000 + (winner.viewer_id === BOB.twitchUserId ? 1_500 : 0);
      await A.core.subWheel.setEnabled(CH, true);
      const resub = {
        channel_id: CH,
        source: 'twitch' as const,
        source_event_id: randomUUID(),
        type: 'resub' as const,
        actor: { id: BOB.twitchUserId, login: 'bob', display_name: 'Bob' },
        tier: '1000' as const,
        months: 7,
      };
      const received = await A.core.alerts.receive(resub);
      const spin = (await A.core.subWheel.fromAlert(
        resub,
        received.alert?.alert_id ?? null,
      ))!;
      expect(spin.award.status).toBe('awarded');
      bob += spin.amount!;
      expect(await balance(BOB.twitchUserId)).toBe(bob);

      // --- 7. Chat transfer (bot) and moderation adjustments (extension, broadcaster).
      const give = {
        requestId: 'msg-give-1',
        from: ALICE,
        to: BOB,
        amount: 250,
      };
      expect(
        (await A.bot('/v1/bot/wallet/transfer', give)).body.result.status,
      ).toBe('applied');
      alice -= 250;
      bob += 250;
      const adjustKey = randomUUID();
      const adjust = () =>
        A.ext(
          CH,
          '/moderation/v2/actions',
          {
            command: {
              action: 'wallet_adjust',
              viewer_id: BOB.twitchUserId,
              currency: 'credits_soundboard',
              delta: 2,
              reason: 'geste commercial',
            },
          },
          adjustKey,
          'broadcaster',
        );
      expect((await adjust()).status).toBe(200);
      expect(await balance(BOB.twitchUserId, 'credits_soundboard')).toBe(2);

      // --- 8. Daily and Loyalty (bot routes, credit flags on).
      clock.set(new Date('2026-10-25T20:00:00Z'));
      await A.bot('/v1/bot/stream/online', {
        streamId: 'live-rehearsal',
        startedAt: clock.now().toISOString(),
      });
      const daily = { viewer: ALICE, requestId: 'msg-daily-1' };
      const claim = (await A.bot('/v1/bot/daily/claim', daily)).body;
      expect(claim.outcome).toBe('claimed');
      await A.core.credits.processPending();
      alice += claim.reward;
      const bits = {
        type: 'bits',
        eventId: 'evt-bits-1',
        occurredAt: clock.now().toISOString(),
        viewer: BOB,
        bits: 500,
      };
      const loyalty = (await A.bot('/v1/bot/loyalty/events', bits)).body;
      // Recorded, then paid once by the pending sweep (as the Core's retry loop does).
      expect(['pending', 'credited']).toContain(loyalty.status);
      await A.core.loyalty.processPending();
      expect(await balance(BOB.twitchUserId)).toBeGreaterThan(bob);
      bob = await balance(BOB.twitchUserId);
      // Paid by StreamElements before the cutoff: never paid again.
      expect(
        (
          await A.bot('/v1/bot/loyalty/events', {
            ...bits,
            eventId: 'evt-bits-old',
            occurredAt: '2026-10-25T17:00:00.000Z',
          })
        ).body.status,
      ).toBe('excluded');
      expect(await balance(ALICE.twitchUserId)).toBe(alice);

      // --- 9. Channel points: the rule « credits » (Studio), a real redemption (bot).
      await A.bot('/v1/bot/channel-points/rewards', {
        channel_id: CH,
        rewards: [
          { id: REWARD, title: 'Crédits TTS', cost: 1000, is_enabled: true },
        ],
      });
      await A.studio(`/v1/studio/channel-points/${CH}/settings`, {
        enabled: true,
      });
      await A.studio(`/v1/studio/channel-points/${CH}/rules/${REWARD}`, {
        enabled: true,
        actions: [{ type: 'credits', currency: 'credits_tts', amount: 2 }],
      });
      const redemption = {
        channel_id: CH,
        source: 'twitch',
        redemption_id: randomUUID(),
        reward: { id: REWARD, title: 'Crédits TTS', cost: 1000 },
        user: { id: CAROL, login: 'carol', display_name: 'Carol' },
        twitch_status: 'unfulfilled',
        redeemed_at: clock.now().toISOString(),
      };
      expect(
        (await A.bot('/v1/bot/channel-points/redemptions', redemption)).body
          .outcome,
      ).toBe('done');
      expect(await balance(CAROL, 'credits_tts')).toBe(2);

      // --- 10/11. Every Twitch / chat event again, then a restart: a second Core on another pool, the same replays.
      const operations = await n('wallet_operations');
      const B = await boot(b);
      await ready(B.core);
      for (const X of [A, B]) {
        // The same answer again (idempotent replay), never a second credit (operations counted below).
        expect((await X.bot('/v1/bot/daily/claim', daily)).body.outcome).toBe(
          'claimed',
        );
        expect((await X.bot('/v1/bot/loyalty/events', bits)).status).toBe(200);
        expect(
          (await X.bot('/v1/bot/wallet/transfer', give)).body.result.replayed,
        ).toBe(true);
        expect(
          (await X.bot('/v1/bot/channel-points/redemptions', redemption)).body
            .outcome,
        ).toBe('duplicate');
        await X.core.alerts.receive(resub);
        await X.core.subWheel.fromAlert(resub, null);
        await X.core.credits.processPending();
        await X.core.loyalty.processPending();
      }
      expect((await adjust()).status).toBe(200);
      expect(await n('wallet_operations')).toBe(operations);
      expect(await session(BOB.twitchUserId, B)).toMatchObject({
        wallet: { available: bob },
        credits: { soundboard: 2 },
      });

      // --- 12. Concurrency: both Cores at once on Alice's wallet (Bonk, transfers, Soundboard), and the same Bonk
      // intention sent to both (one debit).
      const same = randomUUID();
      const results = await Promise.allSettled([
        ...[A, B, A, B].map((X, i) =>
          X.ext(ALICE.twitchUserId, '/actions/tokens', bonk, `bonk-race-${i}`),
        ),
        A.ext(ALICE.twitchUserId, '/actions/tokens', bonk, same),
        B.ext(ALICE.twitchUserId, '/actions/tokens', bonk, same),
        ...[1, 2, 3].map((i) =>
          (i % 2 ? A : B).bot('/v1/bot/wallet/transfer', {
            ...give,
            requestId: `msg-race-${i}`,
            amount: 100,
          }),
        ),
        B.ext(ALICE.twitchUserId, '/actions/tokens', {
          module_id: 'soundboard',
          payload: { sound_id: 'hello' },
        }),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      // The same intention on both Cores: one interaction, one debit; every Bonk admitted is debited exactly once.
      expect(
        await n('bonk_lab_interactions where idempotency_key = $1', [same]),
      ).toBe(1);
      expect(
        await n("wallet_transactions where source = 'bonk' and amount < 0"),
      ).toBe(await n('bonk_lab_interactions'));

      // --- 13. Final: every wallet equals its ledger, no Lab wallet ever touched, the openings untouched.
      await ledgerAgrees();
      expect(await n('wallets where balance < 0')).toBe(0);
      expect(await n('lab_wallets')).toBe(0);
      expect(await n('lab_wallet_ledger')).toBe(0);
      expect(
        await n(
          "wallet_transactions where kind = 'opening_balance' and amount = 12000",
        ),
      ).toBe(0);
      for (const text of files) {
        const { snapshot, sha256: fp } = readOpeningSnapshot(text);
        expect((await verifyOpeningImport(a, snapshot, fp)).ok).toBe(true);
      }
      // The extension shows exactly the Wallet, in each currency.
      for (const id of [ALICE.twitchUserId, BOB.twitchUserId, CAROL]) {
        const s = await session(id, B);
        expect(s.wallet.available).toBe(await balance(id));
        expect(s.credits).toEqual({
          tts: await balance(id, 'credits_tts'),
          soundboard: await balance(id, 'credits_soundboard'),
        });
      }
    }, 120_000);
  },
);
