// Phase 2 lot 9 — Studio drives the main Core: the Jeu des mots (panel + its OBS sound, through the cockpit and the
// wins stream) and the real Twitch alerts (reception, freshness), on ONE canonical Wallet
// (docs/ECONOMY_MIGRATION.md § 17). Real, disposable Postgres; two main Core instances; Studio's own Jeu des mots
// runtime (apps/studio/server) relaying the main Core's wins to a connected OBS source. Nothing reaches Twitch or OBS.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WordGameRuntime } from '../../studio/server/src/word-game/runtime.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import {
  applyOpeningImport,
  readOpeningSnapshot,
} from '../src/wallet/opening-import.js';
import { FakeClock } from './helpers.js';
import { bootMainCore, MAIN_CORE_CHANNEL } from './main-core.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = MAIN_CORE_CHANNEL;
const SECRET = randomBytes(32);
const ALICE = { id: '7101', login: 'alice', name: 'Alice' };
const BOB = { id: '7102', login: 'bob', name: 'Bob' };
const CAROL = { id: '7103', login: 'carol', name: 'Carol' };
const PLAYER_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'studio',
  'server',
  'word-game-player',
);

describe.skipIf(!isLocal)(
  'lot 9: Studio drives the main Core (Jeu des mots, alerts), real Postgres',
  () => {
    const pools: Db[] = [];
    const servers: Server[] = [];
    const cleanups: (() => Promise<unknown>)[] = [];
    let unlock: (() => Promise<void>) | undefined;
    let a: Db, b: Db;
    const clock = new FakeClock(new Date('2026-10-27T19:00:00Z'));
    const CUTOFF = '2026-10-27T18:00:00.000Z';
    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      b = createPgDb(url!);
      pools.push(a, b);
      await a.query('drop schema public cascade; create schema public;');
      await migrate(a, 'prod');
    }, LOCK_WAIT_MS);
    afterAll(async () => {
      for (const c of cleanups.reverse()) await c();
      for (const s of servers) {
        s.closeAllConnections();
        await new Promise((r) => s.close(() => r(null)));
      }
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
    let seq = 0;
    const msg = (who: typeof ALICE, text: string, id = `l9-${++seq}`) => ({
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

    it('panel and OBS sound through the main Core: one gain, one sound, reconnection; stale alerts keep their gains', async () => {
      // --- Canonical economy: synthetic opening, the two empty credits imports.
      for (const s of [
        {
          import_id: 'lot9-main',
          currency_id: 'main',
          source: 'streamelements',
          cutoff: CUTOFF,
          source_snapshot: {
            sha256: 'c'.repeat(64),
            accounts: 3,
            total: 30_000,
          },
          rows: [ALICE, BOB, CAROL].map((v) => ({
            twitch_user_id: v.id,
            login: v.login,
            balance: 10_000,
            sources: [{ source_ref: `se:${v.login}`, balance: 10_000 }],
          })),
          excluded: [],
        },
        ...['credits_tts', 'credits_soundboard'].map((currency) => ({
          import_id: `lot9-${currency}`,
          currency_id: currency,
          source: 'legacy-ext-redemptions',
          cutoff: CUTOFF,
          source_snapshot: { sha256: 'd'.repeat(64), accounts: 0, total: 0 },
          rows: [],
          excluded: [],
        })),
      ]) {
        const r = readOpeningSnapshot(JSON.stringify(s));
        await applyOpeningImport(a, r.snapshot, r.sha256);
      }
      // Freshness ON for this rehearsal (2 min): its value is not chosen for production (OFF by default).
      const boot = (db: Db) =>
        bootMainCore(db, clock, {
          extensionSecret: SECRET,
          servers,
          alertsMaxAgeMs: 120_000,
        });
      const A = await boot(a);
      const B = await boot(b);
      const chat = (X: typeof A, m: ReturnType<typeof msg>) =>
        X.bot('/v1/bot/chat', m);

      // --- Studio, Production profile: its Jeu des mots runtime on the main Core (cockpit + wins stream), as
      // prod-transport/production.ts wires it (cockpitClient / cockpitEvents), over plain HTTP here.
      const cockpit = async (path: string, body?: unknown) => {
        const r = await A.studio(
          path.replace(/^\/v1\/lab\//, '/v1/studio/cockpit/'),
          body,
        );
        if (r.status !== 200)
          throw Object.assign(new Error(String(r.body?.error)), {
            status: r.status,
            body: r.body,
          });
        return r.body;
      };
      const events = async (path: string, signal: AbortSignal) => {
        const res = await fetch(
          A.base + path.replace(/^\/v1\/lab\//, '/v1/studio/cockpit/'),
          { headers: A.studioHeaders, signal },
        );
        if (!res.ok || !res.body) throw new Error(`core_${res.status}`);
        return res;
      };
      const dir = await mkdtemp(join(tmpdir(), 'lot9-word-game-'));
      cleanups.push(() => rm(dir, { recursive: true, force: true }));
      const studioServer = createServer();
      await new Promise<void>((r) => studioServer.listen(0, '127.0.0.1', r));
      servers.push(studioServer);
      const origin = `http://127.0.0.1:${(studioServer.address() as AddressInfo).port}`;
      const rt = await WordGameRuntime.create({
        channelId: CH,
        core: cockpit as never,
        events,
        environment: 'production',
        origin,
        dir,
        playerDir: PLAYER_DIR,
      });
      cleanups.push(async () => rt.stop());
      studioServer.on('request', (req, res) => {
        void rt.handle(req, res, new URL(req.url!, origin)).then((done) => {
          if (!done) res.writeHead(404).end();
        });
      });
      const panel = async (path: string, body?: unknown) => {
        const res = await fetch(origin + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'x-raptoru-studio': '1',
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() };
      };

      // The panel reads the main Core's state, marked as such.
      const first = await panel('/api/word-game/state');
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        channel_id: CH,
        live: false,
        environment: 'production',
      });

      // --- The OBS sound source, connected to Studio (EventSource of player.js): every relayed win.
      const token = String(first.body.player_url).split('#')[1];
      const sounds: string[] = [];
      const obs = new AbortController();
      cleanups.push(async () => obs.abort());
      const source = await fetch(`${origin}/word-game/events?t=${token}`, {
        signal: obs.signal,
      });
      expect(source.status).toBe(200);
      void (async () => {
        const reader = source.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            buf += decoder.decode(value, { stream: true });
            for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const data = /^data: (.*)$/m.exec(block)?.[1];
              if (/^event: win$/m.test(block) && data)
                sounds.push(JSON.parse(data).message_id);
            }
          }
        } catch {
          /* aborted at the end */
        }
      })();
      const listeners = () =>
        (A.core.chat.wordGame as unknown as { winListeners: Set<unknown> })
          .winListeners.size;
      await vi.waitFor(() => expect(listeners()).toBe(1), { timeout: 5000 });

      // --- Live, then the panel drives the main Core's game: stop / start, a new word.
      expect(
        (
          await A.bot('/v1/bot/stream', {
            channel_id: CH,
            event: 'online',
            twitch_stream_id: '909',
          })
        ).status,
      ).toBe(200);
      expect(
        (await panel('/api/word-game/actions', { action: 'stop' })).body
          .stopped,
      ).toBe(true);
      expect(
        (await panel('/api/word-game/actions', { action: 'start' })).body
          .stopped,
      ).toBe(false);
      const newWord = async () => {
        const r = await panel('/api/word-game/actions', {
          action: 'new_word',
          request_id: randomUUID(),
        });
        expect(r.status).toBe(200);
        return (
          await a.query<{ word: string }>(
            "select word from word_game_words where status = 'active' order by created_at desc limit 1",
          )
        )[0]!.word;
      };

      // --- 3. A right answer, delivered three times at once (EventSub redelivery): one gain, one sound.
      const win1 = msg(ALICE, await newWord());
      await Promise.all([chat(A, win1), chat(A, win1), chat(A, win1)]);
      expect(await n("wallet_transactions where source = 'word_game'")).toBe(1);
      await vi.waitFor(() => expect(sounds).toEqual([win1.message_id]));
      // Replayed later, on either Core: nothing more.
      await chat(B, win1);
      await chat(A, win1);
      expect(await n("wallet_transactions where source = 'word_game'")).toBe(1);

      // --- 4. Studio loses the main Core's stream (network cut): a win meanwhile is paid, never replayed as a sound;
      // the stream comes back (Studio reconnects alone) and the next win sounds once.
      for (const s of servers.slice(0, 1)) s.closeAllConnections();
      await vi.waitFor(() => expect(listeners()).toBe(0));
      const during = msg(BOB, await newWord());
      expect((await chat(A, during)).status).toBe(200);
      await vi.waitFor(() => expect(listeners()).toBe(1), { timeout: 8000 });
      const win2 = msg(CAROL, await newWord());
      await chat(A, win2);
      await vi.waitFor(() =>
        expect(sounds).toEqual([win1.message_id, win2.message_id]),
      );
      expect(await n("wallet_transactions where source = 'word_game'")).toBe(3);
      await new Promise((r) => setTimeout(r, 300));
      expect(sounds).toHaveLength(2);

      // --- Alerts: the bot's reception is visible to Studio.
      expect(
        (await A.studio(`/v1/studio/alerts/${CH}/reception`)).body,
      ).toMatchObject({ bot: null, max_age_ms: 120_000 });
      expect(
        (
          await A.bot('/v1/bot/alerts/status', {
            channel_id: CH,
            mode: 'active',
            subscriptions: ['channel.chat.notification', 'channel.follow'],
            refused: [],
            pending: 0,
          })
        ).status,
      ).toBe(200);
      expect(
        (await A.studio(`/v1/studio/alerts/${CH}/reception`)).body.bot,
      ).toMatchObject({ mode: 'active', pending: 0 });

      // --- 8 / 9. A sub kept long in the bot's outbox (Core down 10 min) arrives with its Loyalty event, both twice,
      // on both Cores at once, with the wheel ON: recorded, not animated (alert « stale », wheel skipped), and every
      // gain paid exactly once (wheel and Loyalty).
      await A.studio(`/v1/studio/sub-wheel/${CH}/settings`, { enabled: true });
      const old = new Date(clock.now().getTime() - 10 * 60_000).toISOString();
      const sub = (who: typeof ALICE, at: string) => ({
        alert: {
          channel_id: CH,
          source: 'twitch',
          source_event_id: randomUUID(),
          type: 'sub',
          actor: { id: who.id, login: who.login, display_name: who.name },
          tier: '1000',
          occurred_at: at,
        },
        loyalty: {
          type: 'sub',
          eventId: randomUUID(),
          occurredAt: at,
          viewer: {
            twitchUserId: who.id,
            login: who.login,
            displayName: who.name,
          },
          tier: 't1',
          isGift: false,
        },
      });
      const late = sub(BOB, old);
      await Promise.all(
        [A, B, A, B].flatMap((X) => [
          X.bot('/v1/bot/alerts/events', late.alert),
          X.bot('/v1/bot/loyalty/events', late.loyalty),
        ]),
      );
      await Promise.all([
        A.core.loyalty.processPending(),
        B.core.loyalty.processPending(),
      ]);
      expect(await n('alert_events')).toBe(1);
      expect(
        await n(
          "alert_items where status = 'expired' and failure->>'code' = 'stale'",
        ),
      ).toBe(1);
      expect(
        await n("sw_spins where status = 'skipped' and reason = 'too_late'"),
      ).toBe(1);
      expect(await n("wallet_transactions where source = 'sub_wheel'")).toBe(1);
      expect(await n("loyalty_rewards where status = 'credited'")).toBe(1);
      // Never handed to the OBS source.
      expect(
        (
          await A.studio(`/v1/studio/alerts/${CH}/claim`, {
            consumer_id: 'obs-1',
          })
        ).body.alert,
      ).toBeNull();

      // A fresh sub is animated as before: queued alert, queued wheel, its gain once.
      const fresh = sub(CAROL, clock.now().toISOString());
      for (const X of [A, B, A]) {
        await X.bot('/v1/bot/alerts/events', fresh.alert);
        await X.bot('/v1/bot/loyalty/events', fresh.loyalty);
      }
      await A.core.loyalty.processPending();
      expect(await n("alert_items where status = 'queued'")).toBe(1);
      expect(await n("sw_spins where status = 'queued'")).toBe(1);
      expect(await n("wallet_transactions where source = 'sub_wheel'")).toBe(2);
      expect(await n("loyalty_rewards where status = 'credited'")).toBe(2);
      // Still waiting for the OBS source 3 minutes later (Studio closed): too old to play now, never replayed.
      clock.advance(3 * 60_000);
      expect(
        (
          await A.studio(`/v1/studio/alerts/${CH}/claim`, {
            consumer_id: 'obs-1',
          })
        ).body.alert,
      ).toBeNull();
      expect(
        await n(
          "alert_items where status = 'expired' and failure->>'code' = 'stale'",
        ),
      ).toBe(2);

      // --- 10 / 11. Doors: no credential, another channel, the bot secret on Studio's stream, the Lab chat.
      const raw = (path: string, headers: Record<string, string> = {}) =>
        fetch(A.base + path, { headers }).then(async (r) => {
          const status = r.status;
          await r.body?.cancel();
          return status;
        });
      expect(
        await raw(`/v1/studio/cockpit/word-game/${CH}/events`, {
          'x-raptoru-studio-protocol': '1',
        }),
      ).toBe(401);
      expect(
        await raw(`/v1/studio/cockpit/word-game/${CH}/events`, {
          'x-raptoru-studio-protocol': '1',
          authorization: `Bearer ${'b'.repeat(32)}`,
        }),
      ).toBe(401);
      expect(
        await raw(`/v1/studio/cockpit/word-game/1/events`, A.studioHeaders),
      ).toBe(403);
      expect((await A.studio('/v1/studio/cockpit/chat', {})).status).toBe(404);
      expect(
        (
          await A.bot('/v1/bot/alerts/status', {
            channel_id: '1',
            mode: 'active',
            subscriptions: [],
            refused: [],
            pending: 0,
          })
        ).status,
      ).toBe(409);

      // One Wallet: balances = ledger; the Lab wallet never touched.
      expect(
        await n(`wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
               where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`),
      ).toBe(0);
      expect(await n('lab_wallets')).toBe(0);
      expect(await n('lab_wallet_ledger')).toBe(0);
    }, 120_000);
  },
);
