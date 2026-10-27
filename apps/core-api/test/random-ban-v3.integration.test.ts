// Random Ban V3 on a real Postgres with real pools (two Core instances): the streamer's mute handed to Studio once,
// reported once (one chat line), and a caution on it paid once and ended once — whatever the races between Cores.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration

import { randomUUID } from 'node:crypto';
import type { LabChatMessage } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CautionService } from '../src/caution/service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { labEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { RandomBanService } from '../src/random-ban/service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const PAYER = { id: '7003', login: 'payeur', display_name: 'Payeur' };

describe.skipIf(!isLocal)(
  'Random Ban V3 on a real Postgres (two Cores)',
  () => {
    let a: Db;
    let b: Db;
    let unlock: (() => Promise<void>) | undefined;
    const clock = new FakeClock(new Date('2026-10-27T20:00:00Z'));
    let ch = 300;

    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      await a.query('drop schema public cascade; create schema public;');
      await migrate(a, 'all');
      b = createPgDb(url!);
    }, LOCK_WAIT_MS);
    afterAll(async () => {
      await a?.close();
      await b?.close();
      await unlock?.();
    });

    /** A fresh channel served by two Cores; the streamer drawn for sure; Studio ready on both. */
    async function twoCores() {
      const channel = String(++ch);
      const make = (db: Db) => {
        const rb = new RandomBanService(
          db,
          clock,
          (n) => (n === 1000 ? 0 : 0),
          {
            streamer: () => ({ id: channel, login: 'raptoru_' }),
          },
        );
        const caution = new CautionService(
          db,
          clock,
          labEconomy,
          () => channel,
          [{ kind: 'random_ban', label: 'Random Ban', source: rb.mutes }],
        );
        return { rb, caution };
      };
      const A = make(a);
      const B = make(b);
      for (const x of [A, B])
        await x.rb.claimMute(channel, {
          consumer_id: 'studio-1',
          obs_ready: true,
          mic_held: false,
        });
      return { channel, A, B };
    }

    it('the streamer drawn: handed to Studio once across Cores, reported once (one chat line)', async () => {
      const { channel, A, B } = await twoCores();
      const r = await A.rb.request({
        channel_id: channel,
        source: 'channel_points',
        source_ref: randomUUID(),
        mode: 'real',
        buyer: { id: '7001', login: 'acheteur', name: 'Acheteur' },
      });
      expect((await A.rb.claim(channel, EXEC)).request).toBeNull();
      const claims = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          (i % 2 ? B : A).rb.claimMute(channel, {
            consumer_id: 'studio-1',
            obs_ready: true,
            mic_held: false,
          }),
        ),
      );
      const handed = claims.filter((c) => c.mute);
      expect(handed).toHaveLength(1);
      const m = handed[0]!.mute!;
      const reports = await Promise.all(
        [A, B, A, B].map((x) =>
          x.rb.reportMute(r.request_id, {
            consumer_id: 'studio-1',
            attempt_id: m.attempt_id,
            event: 'muted',
          }),
        ),
      );
      for (const v of reports) expect(v.status).toBe('confirmed');
      const lines = await a.query(
        `select 1 from cmd_steps where idempotency_key = $1`,
        [`rb:streamer:${r.request_id}`],
      );
      expect(lines).toHaveLength(1);
    });

    it('a caution on it: `oui` delivered to both Cores at once → one debit, one end', async () => {
      const { channel, A, B } = await twoCores();
      const r = await A.rb.request({
        channel_id: channel,
        source: 'channel_points',
        source_ref: randomUUID(),
        mode: 'real',
        buyer: { id: '7001', login: 'acheteur', name: 'Acheteur' },
      });
      await A.rb.claim(channel, EXEC);
      const { mute } = await A.rb.claimMute(channel, {
        consumer_id: 'studio-1',
        obs_ready: true,
        mic_held: false,
      });
      await A.rb.reportMute(r.request_id, {
        consumer_id: 'studio-1',
        attempt_id: mute!.attempt_id,
        event: 'muted',
      });
      await editWallet(
        a,
        clock.now(),
        channel,
        PAYER.id,
        'set',
        { tokens: 10_000 },
        'test',
      );
      const msg = (
        text: string,
        id: string = randomUUID(),
      ): LabChatMessage => ({
        channel_id: channel,
        message_id: id,
        text,
        chatter: { ...PAYER, role: 'viewer' },
        source: 'twitch',
      });
      const exec = {
        executor_id: 'bot-1',
        login: 'lecroupier_',
        can_read: true,
        can_release: true,
        missing: [],
      };
      for (const x of [A, B]) await x.caution.claim(channel, exec);
      expect((await A.caution.chat(msg('!caution raptoru_'))).outcome).toBe(
        'checking',
      );
      const job = (await A.caution.claim(channel, exec)).job!;
      expect(
        await A.caution.check(job.request_id, {
          executor_id: 'bot-1',
          attempt_id: job.attempt_id,
          target: { id: channel, login: 'raptoru_', name: 'Raptoru_' },
          sanction: { kind: 'none' },
        }),
      ).toMatchObject({ status: 'quoted', price: 1_800 });
      const outs = await Promise.all([
        A.caution.chat(msg('oui', 'oui-a')),
        B.caution.chat(msg('oui', 'oui-b')),
        A.caution.chat(msg('oui', 'oui-b')),
      ]);
      expect(outs.filter((o) => o.outcome === 'released')).toHaveLength(1);
      const debits = await a.query(
        `select 1 from lab_wallet_ledger where module_id = 'caution' and kind = 'debit' and channel_id = $1`,
        [channel],
      );
      expect(debits).toHaveLength(1);
      const left = await a.query<{ tokens: number }>(
        'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
        [channel, PAYER.id],
      );
      expect(Number(left[0]!.tokens)).toBe(8_200);
      expect(
        (
          await B.rb.claimMute(channel, {
            consumer_id: 'studio-1',
            obs_ready: true,
            mic_held: true,
          })
        ).active,
      ).toEqual([]);
    });
  },
);
