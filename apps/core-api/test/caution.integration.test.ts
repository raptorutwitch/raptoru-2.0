// Caution on a real Postgres with real pools (two Core instances): the same deliveries, answers and executor reports
// at once on both — one request, one confirmation, one debit, one refund; one open caution per channel even across
// Cores; the canonical Wallet (Jetons after the cutover) debited and refunded exactly once.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LabChatMessage } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CautionService } from '../src/caution/service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import {
  coreWalletEconomy,
  labEconomy,
  type EconomyPort,
} from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { createWalletModule } from '../src/wallet/index.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const EXEC = { executor_id: 'bot-1', login: 'lecroupier_' };
const TARGET = { id: '7002', login: 'cible', name: 'Cible' };
const payer = (id: string) => ({ id, login: `p${id}`, name: `P${id}` });

describe.skipIf(!isLocal)('Caution on a real Postgres (two Cores)', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-10-23T20:00:00Z'));
  let ch = 100;

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

  /** A fresh channel served by two Cores (each its own pool and service), the executor seen by both. */
  async function twoCores(
    economyOf: (db: Db) => EconomyPort = () => labEconomy,
  ) {
    const channel = String(++ch);
    const A = new CautionService(a, clock, economyOf(a), () => channel);
    const B = new CautionService(b, clock, economyOf(b), () => channel);
    for (const c of [A, B])
      await c.claim(channel, {
        ...EXEC,
        can_read: true,
        can_release: true,
        missing: [],
      });
    const msg = (
      u: { id: string; login: string; name: string },
      text: string,
      id: string,
    ): LabChatMessage => ({
      channel_id: channel,
      message_id: id,
      text,
      chatter: {
        id: u.id,
        login: u.login,
        display_name: u.name,
        role: 'viewer',
      },
      source: 'twitch',
    });
    const n = async (sql: string, params: unknown[] = []) =>
      Number((await a.query<{ n: string }>(sql, params))[0]!.n);
    /** Through the quote with Core A (the executor's reads), returning the request id. */
    const quote = async (p: ReturnType<typeof payer>) => {
      await A.chat(msg(p, '!caution cible', `q-${channel}-${p.id}`));
      const job = (
        await A.claim(channel, {
          ...EXEC,
          can_read: true,
          can_release: true,
          missing: [],
        })
      ).job!;
      await A.check(job.request_id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        target: TARGET,
        sanction: {
          kind: 'timeout',
          ends_at: new Date(clock.now().getTime() + 5 * 60_000).toISOString(),
        },
      });
      return job.request_id;
    };
    return { channel, A, B, msg, n, quote };
  }

  it('the same `!caution` delivered 4 times on 2 Cores, and 2 payers at once: one request, one open', async () => {
    const { channel, A, B, msg, n } = await twoCores();
    const m = msg(payer('1'), '!caution cible', 'dup-1');
    const out = await Promise.all([A.chat(m), B.chat(m), A.chat(m), B.chat(m)]);
    expect(out.filter((o) => o.outcome === 'checking')).toHaveLength(1);
    const rival = await Promise.all([
      A.chat(msg(payer('2'), '!caution cible', 'r-2')),
      B.chat(msg(payer('3'), '!caution cible', 'r-3')),
    ]);
    expect(rival.map((o) => o.outcome)).toEqual(['busy', 'busy']);
    expect(
      await n(
        'select count(*) as n from caution_requests where channel_id = $1',
        [channel],
      ),
    ).toBe(1);
  });

  it('two payers on two Cores at the very same time: exactly one caution opens', async () => {
    const { channel, A, B, msg, n } = await twoCores();
    const out = await Promise.all([
      A.chat(msg(payer('4'), '!caution cible', 's-4')),
      B.chat(msg(payer('5'), '!caution cible', 's-5')),
    ]);
    expect(out.map((o) => o.outcome).sort()).toEqual(['busy', 'checking']);
    expect(
      await n(
        `select count(*) as n from caution_requests where channel_id = $1 and status = 'checking'`,
        [channel],
      ),
    ).toBe(1);
  });

  it('`oui` ×4 on 2 Cores, the re-read reported twice at once, the failure reported twice at once: one debit, one refund', async () => {
    const { channel, A, B, msg, n, quote } = await twoCores();
    const p = payer('6');
    await editWallet(
      a,
      clock.now(),
      channel,
      p.id,
      'set',
      { tokens: 20_000 },
      'test',
    );
    const id = await quote(p);
    const answers = await Promise.all([
      A.chat(msg(p, 'oui', 'o-1')),
      B.chat(msg(p, 'oui', 'o-2')),
      A.chat(msg(p, 'oui', 'o-1')),
      B.chat(msg(p, 'oui', 'o-3')),
    ]);
    expect(answers.filter((o) => o.outcome === 'confirmed')).toHaveLength(1);
    const job = (
      await B.claim(channel, {
        ...EXEC,
        can_read: true,
        can_release: true,
        missing: [],
      })
    ).job!;
    const rep = {
      ...EXEC,
      attempt_id: job.attempt_id,
      sanction: {
        kind: 'timeout' as const,
        ends_at: new Date(clock.now().getTime() + 4 * 60_000).toISOString(),
      },
    };
    const [r1, r2] = await Promise.all([
      A.recheck(id, rep),
      B.recheck(id, rep),
    ]);
    expect(r1).toEqual({ proceed: true, target_id: TARGET.id });
    expect(r2).toEqual(r1);
    const fail = {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'not_applied' as const,
    };
    await Promise.all([
      A.result(id, fail),
      B.result(id, fail),
      A.result(id, fail),
    ]);
    expect(
      await n(
        `select count(*) as n from lab_wallet_ledger where interaction_id = $1 and kind = 'debit'`,
        [id],
      ),
    ).toBe(1);
    expect(
      await n(
        `select count(*) as n from lab_wallet_ledger where interaction_id = $1 and kind = 'refund'`,
        [id],
      ),
    ).toBe(1);
    expect(
      Number(
        (
          await a.query<{ tokens: number }>(
            'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
            [channel, p.id],
          )
        )[0]!.tokens,
      ),
    ).toBe(20_000);
    expect(
      await n(
        `select count(*) as n from cmd_steps where idempotency_key like $1`,
        [`caution:${id}:end%`],
      ),
    ).toBe(1);
  });

  it('canonical Wallet: debited once and refunded once under concurrent reports', async () => {
    const wallets = new Map<Db, ReturnType<typeof createWalletModule>>();
    const { channel, A, B, msg, quote } = await twoCores((db) => {
      const w = createWalletModule(db, clock);
      wallets.set(db, w);
      return coreWalletEconomy(w.wallet);
    });
    const p = payer('8');
    const wallet = wallets.get(a)!.wallet;
    await wallet.credit({
      key: `fund-${channel}`,
      viewer: { twitchUserId: p.id, login: p.login, displayName: p.name },
      amount: 9_000,
      source: 'test',
    });
    const id = await quote(p);
    await A.chat(msg(p, 'oui', 'c-1'));
    const job = (
      await A.claim(channel, {
        ...EXEC,
        can_read: true,
        can_release: true,
        missing: [],
      })
    ).job!;
    const rep = {
      ...EXEC,
      attempt_id: job.attempt_id,
      sanction: {
        kind: 'timeout' as const,
        ends_at: new Date(clock.now().getTime() + 4 * 60_000).toISOString(),
      },
    };
    await Promise.all([A.recheck(id, rep), B.recheck(id, rep)]);
    expect((await wallet.getWallet(p.id))?.balance).toBe(4_000);
    const fail = {
      ...EXEC,
      attempt_id: job.attempt_id,
      event: 'not_banned' as const,
    };
    await Promise.all([A.result(id, fail), B.result(id, fail)]);
    expect((await wallet.getWallet(p.id))?.balance).toBe(9_000);
  });
});
