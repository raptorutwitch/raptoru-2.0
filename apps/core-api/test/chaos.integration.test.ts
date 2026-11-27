// Chaos V2 lot 2 on a real Postgres with two Cores (two pools), the channel row lock deciding: one intent sent 10 times
// → one debit; two viewers at once against the queue cap; a refund racing the expiry sweep, moderation and Studio →
// refunded once; a double manual refund → refused; ACKs replayed / out of order from both Cores → one consistent end;
// a lease over without start → refunded; a credit and charges spent concurrently → never twice; a Core restarted on
// the same database → its first sweep settles what was left.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted. Fictional data.
import type { LabActor } from '@raptoru/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../src/app.js';
import { EFFECTS } from '../src/chaos/catalog.js';
import { CHAOS_RULES, ChaosError } from '../src/chaos/service.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '900700';
const STUDIO = 'studio-chaos-it';
const ALL = Object.fromEntries(EFFECTS.map((e) => [e.id, { enabled: true }]));
const v = (n: number) => ({
  id: String(900700 + n),
  display_name: `Viewer${n}`,
});
const studioActor: LabActor = {
  id: 'antoni',
  role: 'broadcaster',
  via: 'studio',
};
const START = 1_000_000;

describe.skipIf(!isLocal)('chaos, real Postgres, two Cores', () => {
  let a: Db;
  let b: Db;
  let A: Core;
  let B: Core;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-11-26T20:00:00Z'));
  const core = (db: Db) => createCore(db, clock, new DevFakeCreditProvider());
  const moderation = (c: Core, db: Db) =>
    new LabModerationService(
      db,
      clock,
      c.ttsLab,
      c.soundLab,
      c.bonkLab,
      c.raffleLab,
      c.economy,
      null,
      c.chaos,
    );
  const hb = (c: Core = A) =>
    c.chaos.heartbeat(CH, {
      studio_instance_id: STUDIO,
      engine_ready: true,
      safety_max_ms: 60_000,
      safe_mode: false,
      effects: ALL,
      inflight: [],
    });
  const fund = async (...viewers: { id: string }[]) => {
    for (const x of viewers)
      await editWallet(
        a,
        clock.now(),
        CH,
        x.id,
        'set',
        { tokens: START },
        'test',
      );
  };
  const tokens = async (viewer: { id: string }) =>
    Number(
      (
        await a.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, viewer.id],
        )
      )[0]!.tokens,
    );
  const refunds = async (id: string) =>
    (
      await a.query(
        "select 1 from lab_wallet_ledger where interaction_id = $1 and kind = 'refund'",
        [id],
      )
    ).length;
  const priceOf = async (
    effect: string,
    choice: Record<string, unknown> = {},
    viewer = v(1),
  ) => (await A.chaos.quote(CH, viewer, { effect, choice })).price;
  const buy = async (
    c: Core,
    effect: string,
    viewer: { id: string; display_name: string },
    o: {
      key?: string;
      choice?: Record<string, unknown>;
      price?: number;
      credit_id?: string;
    } = {},
  ) =>
    c.chaos.buy(CH, {
      viewer,
      idempotency_key: o.key ?? randomUUID(),
      effect,
      choice: o.choice ?? {},
      expected_price:
        o.price ??
        (o.credit_id ? 0 : await priceOf(effect, o.choice ?? {}, viewer)),
      ...(o.credit_id ? { credit_id: o.credit_id } : {}),
    });
  const codeOf = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected'
      ? r.reason instanceof ChaosError
        ? r.reason.code
        : String(r.reason)
      : 'ok';
  /** Ends everything open (the next test starts from an idle channel). */
  const settle = async () => {
    clock.advance(10 * 60_000);
    await A.chaos.sweepExpired();
    await hb();
  };

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
    A = core(a);
    B = core(b);
    await A.moduleSettings.set(CH, 'chaos.enabled', 1, 'test');
    await hb();
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await b?.close();
    await a?.close();
    await unlock?.();
  });

  it('10 concurrent sends of ONE intent from two Cores: one request, one debit, the others replayed', async () => {
    const V = v(1);
    await fund(V);
    const price = await priceOf('color', { style: 'sepia' }, V);
    const out = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        buy(i % 2 ? A : B, 'color', V, {
          key: 'intent-once-0001',
          choice: { style: 'sepia' },
          price,
        }),
      ),
    );
    expect(out.every((r) => r.status === 'fulfilled')).toBe(true);
    const ids = new Set(
      out.map(
        (r) =>
          (r as PromiseFulfilledResult<{ request: { id: string } }>).value
            .request.id,
      ),
    );
    expect(ids.size).toBe(1);
    expect(
      out.filter(
        (r) =>
          (r as PromiseFulfilledResult<{ duplicate: boolean }>).value.duplicate,
      ),
    ).toHaveLength(9);
    expect(await tokens(V)).toBe(START - price);
    expect(
      await a.query(
        "select 1 from lab_wallet_ledger where kind = 'debit' and viewer_id = $1",
        [V.id],
      ),
    ).toHaveLength(1);
    await settle();
  });

  it('two viewers at once against the queue cap: exactly one gets the last place', async () => {
    const [V1, V2, V3, V4, V5] = [v(11), v(12), v(13), v(14), v(15)];
    await fund(V1, V2, V3, V4, V5);
    await buy(A, 'flip', V1);
    const { item } = await A.chaos.claim(CH, STUDIO, ['flip']);
    await A.chaos.ack(CH, item!.id, {
      studio_instance_id: STUDIO,
      attempt_id: item!.attempt_id,
      event: 'started',
    });
    await buy(A, 'mirror', V2);
    await buy(B, 'mirror', V3);
    const out = await Promise.allSettled([
      buy(A, 'mirror', V4),
      buy(B, 'mirror', V5),
    ]);
    expect(out.map(codeOf).sort()).toEqual(['ok', 'queue_full']);
    const loser = out.findIndex((r) => r.status === 'rejected');
    expect(await tokens([V4, V5][loser]!)).toBe(START);
    await settle();
  });

  it('a refund racing the expiry sweep, moderation and Studio on two Cores: refunded exactly once', async () => {
    const V = v(21);
    await fund(V);
    const { request } = await buy(A, 'vhs', V);
    clock.advance(CHAOS_RULES.queueTtlMs + 1);
    const [mA, mB] = [moderation(A, a), moderation(B, b)];
    const cancel = (m: LabModerationService) =>
      m.act(CH, {
        actor: studioActor,
        command: {
          action: 'chaos',
          command: { action: 'cancel', id: request.id, refund: true },
        },
      });
    await Promise.allSettled([
      A.chaos.sweepExpired(),
      B.chaos.sweepExpired(),
      cancel(mA),
      cancel(mB),
      hb(A),
      hb(B),
      A.chaos.stopAll(CH, STUDIO),
    ]);
    expect(await refunds(request.id)).toBe(1);
    expect(await tokens(V)).toBe(START);
    await settle();
  });

  it('a double manual refund at once: one applied, the other refused (already_refunded)', async () => {
    const V = v(31);
    await fund(V);
    const { request } = await buy(A, 'zoom', V);
    const price = request.price;
    const { item } = await A.chaos.claim(CH, STUDIO, ['zoom']);
    await A.chaos.ack(CH, item!.id, {
      studio_instance_id: STUDIO,
      attempt_id: item!.attempt_id,
      event: 'started',
    });
    clock.advance(item!.duration_ms);
    await B.chaos.ack(CH, item!.id, {
      studio_instance_id: STUDIO,
      attempt_id: item!.attempt_id,
      event: 'ended',
      played_ms: item!.duration_ms,
    });
    const refund = (m: LabModerationService) =>
      m.act(CH, {
        actor: studioActor,
        command: {
          action: 'chaos',
          command: { action: 'refund', id: request.id, reason: 'bug du jeu' },
        },
      });
    const out = await Promise.allSettled([
      refund(moderation(A, a)),
      refund(moderation(B, b)),
    ]);
    expect(
      out
        .map((r) =>
          r.status === 'rejected' ? (r.reason as { code: string }).code : 'ok',
        )
        .sort(),
    ).toEqual(['already_refunded', 'ok']);
    expect(await refunds(request.id)).toBe(1);
    expect(await tokens(V)).toBe(START);
    expect(price).toBeGreaterThan(0);
    await settle();
  });

  it('ACKs replayed and out of order from both Cores: one final state, refunded at most once, the balance consistent', async () => {
    for (let round = 0; round < 4; round++) {
      const V = v(40 + round);
      await fund(V);
      const { request } = await buy(A, 'blur', V, { choice: { duration: 20 } });
      const { item } = await B.chaos.claim(CH, STUDIO, ['blur']);
      const ack = (
        c: Core,
        event: 'started' | 'ended' | 'failed',
        extra = {},
      ) =>
        c.chaos.ack(CH, item!.id, {
          studio_instance_id: STUDIO,
          attempt_id: item!.attempt_id,
          event,
          ...extra,
        });
      clock.advance(5000);
      const out = await Promise.allSettled([
        ack(A, 'started'),
        ack(B, 'ended', { played_ms: 5000 }),
        ack(A, 'ended', { played_ms: 5000 }),
        ack(B, round % 2 ? 'failed' : 'started', { code: 'no_frame' }),
        ack(A, 'started'),
      ]);
      expect(out.every((r) => r.status === 'fulfilled')).toBe(true);
      const row = (
        await a.query<{ status: string; refund_status: string }>(
          'select status, refund_status from chaos_requests where id = $1',
          [request.id],
        )
      )[0]!;
      expect(['ended', 'failed']).toContain(row.status);
      const n = await refunds(request.id);
      expect(n).toBe(row.refund_status === 'refunded' ? 1 : 0);
      expect(await tokens(V)).toBe(START - (n ? 0 : request.price));
      await settle();
    }
  });

  it('a lease over without `started`: failed no_ack, refunded once, by either Core', async () => {
    const V = v(51);
    await fund(V);
    const { request } = await buy(A, 'drunk', V);
    await A.chaos.claim(CH, STUDIO, ['drunk']);
    clock.advance(CHAOS_RULES.leaseMs + 1);
    await Promise.all([A.chaos.sweepExpired(), B.chaos.sweepExpired()]);
    const row = (
      await a.query<{ status: string; code: string }>(
        'select status, code from chaos_requests where id = $1',
        [request.id],
      )
    )[0]!;
    expect(row).toEqual({ status: 'failed', code: 'no_ack' });
    expect(await refunds(request.id)).toBe(1);
    expect(await tokens(V)).toBe(START);
    await settle();
  });

  it('one credit spent twice at once: one purchase; 15 blinks at once with 10 charges: 10 accepted', async () => {
    const V = v(61);
    await fund(V);
    const granted = (await moderation(A, a).act(CH, {
      actor: studioActor,
      command: {
        action: 'chaos',
        command: {
          action: 'credit_grant',
          viewer_id: V.id,
          effect: 'color',
          constraints: {},
          reason: 'Tombola du 24/11',
        },
      },
    })) as { credit_id: string };
    const out = await Promise.allSettled([
      buy(A, 'color', V, { credit_id: granted.credit_id }),
      buy(B, 'color', V, { credit_id: granted.credit_id }),
    ]);
    expect(out.map(codeOf).filter((c) => c === 'ok')).toHaveLength(1);
    expect(await tokens(V)).toBe(START);
    await settle();

    const W = v(62);
    await fund(W);
    const blinks = await Promise.allSettled(
      Array.from({ length: 15 }, (_, i) =>
        buy(i % 2 ? A : B, 'blink', W, { choice: { style: 'ponctuel' } }),
      ),
    );
    expect(blinks.map(codeOf).filter((c) => c === 'ok')).toHaveLength(10);
    expect(
      blinks
        .map(codeOf)
        .filter((c) => c !== 'ok')
        .every((c) => c === 'no_charge'),
    ).toBe(true);
    const price = await priceOf('blink', { style: 'ponctuel' }, W);
    expect(await tokens(W)).toBe(START - 10 * price);
    await settle();
    expect(await tokens(W)).toBe(START);
  });

  it('Tarifs: purchases racing a price change from the other Core are debited exactly the quoted price or refused (price_changed, nothing debited); concurrent edits never mix two ranges', async () => {
    const viewers = Array.from({ length: 8 }, (_, i) => v(81 + i));
    await fund(...viewers);
    const choice = { style: 'ponctuel' };
    const old = await priceOf('blink', choice, viewers[0]);
    const out = await Promise.allSettled([
      ...viewers
        .slice(0, 4)
        .map((V) => buy(A, 'blink', V, { choice, price: old })),
      B.chaos.setPrices(
        CH,
        { effect: 'blink', min: 20_000, max: 120_000 },
        'Studio',
      ),
      ...viewers
        .slice(4)
        .map((V) => buy(B, 'blink', V, { choice, price: old })),
    ]);
    expect(out[4]!.status).toBe('fulfilled');
    const buys = out.filter((_, i) => i !== 4);
    expect(
      buys.map(codeOf).every((c) => c === 'ok' || c === 'price_changed'),
    ).toBe(true);
    for (const [i, V] of viewers.entries()) {
      const ok = buys[i]!.status === 'fulfilled';
      expect(await tokens(V), V.id).toBe(ok ? START - old : START);
    }
    const sold = await a.query<{ price: number; debited: number }>(
      `select r.price, -l.amount as debited from chaos_requests r
         join lab_wallet_ledger l on l.interaction_id = r.id and l.kind = 'debit'
       where r.effect = 'blink' and r.viewer_id = any($1::text[])`,
      [viewers.map((x) => x.id)],
    );
    expect(sold.length).toBe(
      buys.filter((r) => r.status === 'fulfilled').length,
    );
    for (const s of sold) expect([s.price, s.debited]).toEqual([old, old]);
    // Bought after the change: at the new price.
    const now = await priceOf('blink', choice, viewers[0]);
    expect(now).toBeGreaterThanOrEqual(20_000);
    await buy(B, 'blink', viewers[0]!, { choice, price: now });
    // Six edits at once from both Cores: the stored range is one of them, whole (min and max of the same edit).
    const pairs = [
      [5_000, 90_000],
      [6_000, 60_000],
      [7_000, 70_000],
      [8_000, 80_000],
      [9_000, 99_000],
      [10_000, 100_000],
    ];
    await Promise.all(
      pairs.map(([min, max], i) =>
        (i % 2 ? A : B).chaos.setPrices(
          CH,
          { effect: 'blink', min: min!, max: max! },
          'Studio',
        ),
      ),
    );
    const got = (await A.chaos.prices(CH)).effects.find(
      (e) => e.id === 'blink',
    )!;
    expect(pairs).toContainEqual([got.min, got.max]);
    await A.chaos.setPrices(CH, { effect: 'blink', reset: true }, 'Studio');
    await settle();
  });

  it('a Core restarted on the same database: its first sweep settles what the previous one left', async () => {
    const [V1, V2] = [v(71), v(72)];
    await fund(V1, V2);
    const playing = await buy(B, 'tunnel', V1);
    const { item } = await B.chaos.claim(CH, STUDIO, ['tunnel']);
    await B.chaos.ack(CH, item!.id, {
      studio_instance_id: STUDIO,
      attempt_id: item!.attempt_id,
      event: 'started',
    });
    const waiting = await buy(B, 'fog', V2);
    // Core B stops (its pool closed); a new Core starts on the same database much later.
    await b.close();
    clock.advance(CHAOS_RULES.queueTtlMs + 60_000);
    b = createPgDb(url!);
    B = core(b);
    expect(await B.chaos.sweepExpired()).toBe(1);
    const rows = await a.query<{
      id: string;
      status: string;
      code: string;
      refund_status: string;
    }>(
      'select id, status, code, refund_status from chaos_requests where id = any($1::uuid[])',
      [[playing.request.id, waiting.request.id]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // No sign of life from Studio after the start: a breakdown at 0 % (Antoni, 27/11) → refunded, once.
    expect(byId[playing.request.id]).toMatchObject({
      status: 'ended',
      code: 'unknown_end',
      refund_status: 'refunded',
    });
    expect(await tokens(V1)).toBe(START);
    expect(byId[waiting.request.id]).toMatchObject({
      status: 'expired',
      refund_status: 'refunded',
    });
    expect(await tokens(V2)).toBe(START);
    expect(await B.chaos.sweepExpired()).toBe(0);
  });
});
