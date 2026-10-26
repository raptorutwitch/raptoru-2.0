// `!rb` from the chat on a real Postgres with real pools (two Core instances): concurrent deliveries, concurrent
// purchases against one balance, concurrent refunds — one request and one debit per Twitch message, never more Jetons
// spent than held, one refund per failed request.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LabChatMessage } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultChatPrices } from '../src/chat-interactions/prices.js';
import { RandomBanChat } from '../src/chat-interactions/random-ban-chat.js';
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
const CH = '83603689';
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const msg = (id: string, viewer = '9001'): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text: '!rb',
  chatter: {
    id: viewer,
    login: `v${viewer}`,
    display_name: `V${viewer}`,
    role: 'viewer',
  },
  source: 'twitch',
});

describe.skipIf(!isLocal)('!rb from the chat on a real Postgres', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-10-22T20:00:00Z'));
  let rbA: RandomBanService;
  let rbB: RandomBanService;
  let chatA: RandomBanChat;
  let chatB: RandomBanChat;

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
    rbA = new RandomBanService(a, clock);
    rbB = new RandomBanService(b, clock);
    chatA = new RandomBanChat(a, clock, rbA, labEconomy, defaultChatPrices);
    chatB = new RandomBanChat(b, clock, rbB, labEconomy, defaultChatPrices);
    // Both Cores saw the executor poll.
    await rbA.claim(CH, EXEC);
    await rbB.claim(CH, EXEC);
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

  it('the same message delivered 4 times on 2 Cores: one request, one debit, one answer', async () => {
    await editWallet(
      a,
      clock.now(),
      CH,
      '9001',
      'set',
      { tokens: 100_000 },
      'test',
    );
    const m = msg('tw-dup-1');
    const out = await Promise.all([
      chatA.chat(m),
      chatB.chat(m),
      chatA.chat(m),
      chatB.chat(m),
    ]);
    expect(out.filter((o) => o.outcome === 'rb_queued')).toHaveLength(1);
    expect(
      await n(
        `select count(*) as n from rb_requests where source = 'chat' and source_ref = 'tw-dup-1'`,
      ),
    ).toBe(1);
    expect(await tokens('9001')).toBe(75_000);
    // No success message (the ban is the answer), and nothing written twice.
    expect(
      await n(
        `select count(*) as n from cmd_steps where idempotency_key = 'rb:msg:tw-dup-1'`,
      ),
    ).toBe(0);
  });

  it('two different messages with Jetons for one: one Random Ban, the other refused, never below 0', async () => {
    await editWallet(
      a,
      clock.now(),
      CH,
      '9002',
      'set',
      { tokens: 30_000 },
      'test',
    );
    const out = await Promise.all([
      chatA.chat(msg('tw-bal-1', '9002')),
      chatB.chat(msg('tw-bal-2', '9002')),
    ]);
    expect(out.map((o) => o.outcome).sort()).toEqual([
      'rb_queued',
      'rb_refused',
    ]);
    expect(await tokens('9002')).toBe(5_000);
    expect(
      await n(`select count(*) as n from rb_requests where buyer_id = '9002'`),
    ).toBe(1);
  });

  it('a failed request settled by both Cores at once: refunded exactly once', async () => {
    await editWallet(
      a,
      clock.now(),
      CH,
      '9003',
      'set',
      { tokens: 25_000 },
      'test',
    );
    await chatA.chat(msg('tw-ref-1', '9003'));
    const id = (
      await a.query<{ request_id: string }>(
        `select request_id from rb_requests where source_ref = 'tw-ref-1'`,
      )
    )[0]!.request_id;
    // The executor fails it with nothing done (refund needed), then both Cores settle concurrently.
    await a.query(
      `update rb_requests set status = 'failed', error = 'test', refund = 'needed', ended_at = now() where request_id = $1`,
      [id],
    );
    await Promise.all([chatA.settle(CH), chatB.settle(CH), chatA.settle(CH)]);
    expect(await tokens('9003')).toBe(25_000);
    expect(
      await n(
        `select count(*) as n from lab_wallet_ledger where interaction_id = $1 and kind = 'refund'`,
        [id],
      ),
    ).toBe(1);
    expect(
      await n(
        `select count(*) as n from cmd_steps where idempotency_key = $1`,
        [`rb:refund:${id}`],
      ),
    ).toBe(1);
  });
});
