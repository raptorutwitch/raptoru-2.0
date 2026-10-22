// `!fxcam` from the chat on a real Postgres with real pools (two Core instances): concurrent deliveries, concurrent
// purchases against one balance, a failure settled by both Cores, an unknown outcome never refunded.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LabChatMessage } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ChannelPointsService,
  CP_RULES,
} from '../src/channel-points/service.js';
import { FxCamChat } from '../src/chat-interactions/fx-cam-chat.js';
import { defaultChatPrices } from '../src/chat-interactions/prices.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { labEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const STUDIO = 'studio-1';
const msg = (id: string, viewer: string, effect = 'drunk'): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text: `!fxcam ${effect}`,
  chatter: {
    id: viewer,
    login: `v${viewer}`,
    display_name: `V${viewer}`,
    role: 'viewer',
  },
  source: 'twitch',
});

describe.skipIf(!isLocal)('!fxcam from the chat on a real Postgres', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-10-22T20:00:00Z'));
  let cpA: ChannelPointsService;
  let cpB: ChannelPointsService;
  let chatA: FxCamChat;
  let chatB: FxCamChat;

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
    cpA = new ChannelPointsService(a, clock, undefined, undefined, labEconomy);
    cpB = new ChannelPointsService(b, clock, undefined, undefined, labEconomy);
    chatA = new FxCamChat(a, clock, cpA, labEconomy, defaultChatPrices);
    chatB = new FxCamChat(b, clock, cpB, labEconomy, defaultChatPrices);
    await cpA.syncRewards({
      channel_id: CH,
      rewards: [
        { id: 'reward-fx', title: 'FX cam', cost: 2000, is_enabled: true },
      ],
    });
    await cpA.setEnabled(CH, true, 'test');
    await cpA.saveRule(CH, 'reward-fx', {
      enabled: true,
      actions: [{ type: 'interaction', interaction: 'fx_cam' }],
    });
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await unlock?.();
  });

  const tokens = async (viewer: string) =>
    Number(
      (
        await a.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, viewer],
        )
      )[0]?.tokens,
    );
  const n = async (sql: string, params: unknown[] = []) =>
    Number((await a.query<{ n: string }>(sql, params))[0]!.n);
  /** Studio fails every job (those it already holds, then the queue): each one ends « failed », nothing played. */
  const drain = async () => {
    const held = await a.query<{ job_id: string; attempt_id: string }>(
      `select job_id, attempt_id from cp_jobs where status in ('claimed', 'running')`,
    );
    for (const h of held)
      await cpA.ack(h.job_id, {
        consumer_id: STUDIO,
        attempt_id: h.attempt_id,
        event: 'failed',
        error: 'test_drain',
      });
    for (;;) {
      const job = await cpA.claim(CH, STUDIO);
      if (!job) return;
      await cpA.ack(job.job_id, {
        consumer_id: STUDIO,
        attempt_id: job.attempt_id,
        event: 'failed',
        error: 'test_drain',
      });
    }
  };

  it('the same message delivered 4 times on 2 Cores: one redemption, one job, one debit, one answer', async () => {
    await cpA.claim(CH, STUDIO);
    await cpB.claim(CH, STUDIO);
    await editWallet(
      a,
      clock.now(),
      CH,
      '9001',
      'set',
      { tokens: 10_000 },
      'test',
    );
    const m = msg('tw-dup-1', '9001');
    const out = await Promise.all([
      chatA.chat(m),
      chatB.chat(m),
      chatA.chat(m),
      chatB.chat(m),
    ]);
    expect(out.filter((o) => o.outcome === 'fx_queued')).toHaveLength(1);
    expect(
      await n(
        `select count(*) as n from cp_redemptions where source = 'chat' and redemption_id = 'tw-dup-1'`,
      ),
    ).toBe(1);
    expect(
      await n(
        `select count(*) as n from cp_jobs where source = 'chat' and redemption_id = 'tw-dup-1'`,
      ),
    ).toBe(1);
    expect(await tokens('9001')).toBe(8_500);
    expect(
      await n(
        `select count(*) as n from cmd_steps where idempotency_key = 'fx:msg:tw-dup-1'`,
      ),
    ).toBe(1);
  });

  it('two different messages with Jetons for one: one FX Cam, the other refused, never below 0', async () => {
    await cpA.claim(CH, STUDIO);
    await cpB.claim(CH, STUDIO);
    await editWallet(
      a,
      clock.now(),
      CH,
      '9002',
      'set',
      { tokens: 2_000 },
      'test',
    );
    const out = await Promise.all([
      chatA.chat(msg('tw-bal-1', '9002', 'pixel')),
      chatB.chat(msg('tw-bal-2', '9002', 'rage')),
    ]);
    expect(out.map((o) => o.outcome).sort()).toEqual([
      'fx_queued',
      'fx_refused',
    ]);
    expect(await tokens('9002')).toBe(500);
    expect(
      await n(
        `select count(*) as n from cp_redemptions where source = 'chat' and user_id = '9002'`,
      ),
    ).toBe(1);
  });

  it('a failed job settled by both Cores at once: every chat purchase refunded exactly once', async () => {
    await drain();
    await Promise.all([chatA.settle(CH), chatB.settle(CH), chatA.settle(CH)]);
    expect(await tokens('9001')).toBe(10_000);
    expect(await tokens('9002')).toBe(2_000);
    expect(
      await n(
        `select count(*) as n from lab_wallet_ledger where kind = 'refund'`,
      ),
    ).toBe(2);
    expect(
      await n(
        `select count(*) as n from cmd_steps where idempotency_key like 'fx:refund:%'`,
      ),
    ).toBe(2);
  });

  it('started but never reported (unknown): not refunded, even settled twice', async () => {
    await drain(); // empty queue, Studio seen by both Cores
    await cpB.claim(CH, STUDIO);
    await editWallet(
      a,
      clock.now(),
      CH,
      '9003',
      'set',
      { tokens: 1_500 },
      'test',
    );
    await chatA.chat(msg('tw-unk-1', '9003', 'glitch'));
    const job = (await cpA.claim(CH, STUDIO))!;
    await cpA.ack(job.job_id, {
      consumer_id: STUDIO,
      attempt_id: job.attempt_id,
      event: 'started',
    });
    clock.advance(CP_RULES.runMarginMs + 1000);
    await Promise.all([cpA.claim(CH, STUDIO), cpB.claim(CH, STUDIO)]);
    await Promise.all([chatA.settle(CH), chatB.settle(CH)]);
    expect(await tokens('9003')).toBe(0);
    expect(
      (
        await a.query<{ reason: string }>(
          `select reason from cp_redemptions where source = 'chat' and redemption_id = 'tw-unk-1'`,
        )
      )[0]!.reason,
    ).toBe('jetons_to_verify');
  });
});
