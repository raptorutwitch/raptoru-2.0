import { randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  type LoyaltyEvent,
  subWheelAmount,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { loyaltyRoutes } from '../src/http/loyalty-routes.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { count, setup, viewer } from './helpers.js';

// Roue du Sub V2, lot R2 (docs/SUB_WHEEL_V2_PLAN.md): channel.subscribe and channel.subscription.message, as the bot
// forwards them to the loyalty route, are proofs of rights — after the loyalty transaction, in their own; and the
// rights « À vérifier » (decision of 21/10/2026). PGlite; the concurrency is in sub-wheel-r2.integration.test.ts.

const CH = '83603689';
const V = viewer('9401', 'Renewer');
const SEGMENT = 3;
const T0 = new Date('2026-10-21T20:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms).toISOString();
const DAY = 86_400_000;

const sub = (ms: number, over: Partial<LoyaltyEvent> = {}): LoyaltyEvent =>
  ({
    type: 'sub',
    eventId: randomUUID(),
    occurredAt: at(ms),
    viewer: V,
    tier: 't1',
    isGift: false,
    ...over,
  }) as LoyaltyEvent;
const resub = (
  ms: number,
  cumulativeMonths?: number,
  over: Partial<LoyaltyEvent> = {},
): LoyaltyEvent =>
  ({
    type: 'resub',
    eventId: randomUUID(),
    occurredAt: at(ms),
    viewer: V,
    tier: 't1',
    ...(cumulativeMonths ? { cumulativeMonths } : {}),
    ...over,
  }) as LoyaltyEvent;
const notice = (
  ms: number,
  over: Partial<AlertEventInput> = {},
): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: V.twitchUserId, login: V.login, display_name: V.displayName },
  tier: '1000',
  months: 7,
  occurred_at: at(ms),
  ...over,
});

async function fixture(opts: { wired?: boolean } = {}) {
  const core = await setup({ loyalty: { eventCredits: true } });
  core.clock.set(T0);
  const port = coreWalletEconomy(core.wallet.wallet);
  let draws = 0;
  const wheelOn = (db: Db = core.db) =>
    new SubWheelService(
      db,
      core.clock,
      () => {
        draws++;
        return SEGMENT;
      },
      port,
    );
  const wheel = wheelOn();
  const route = (w: SubWheelService | null = wheel) =>
    loyaltyRoutes(
      core.loyalty,
      w ? { service: w, channelId: CH } : undefined,
    ).find((r) => r.pattern.test('/v1/bot/loyalty/events'))!;
  const url = new URL('http://core');
  const post = (e: LoyaltyEvent, w: SubWheelService | null = wheel) =>
    route(opts.wired === false ? null : w).handle({
      params: [],
      body: e,
      url,
    }) as Promise<{ replayed: boolean; status: string; amount: number }>;
  const tokens = async () =>
    (await core.wallet.wallet.getWallet(V.twitchUserId))?.balance ?? 0;
  const wheelCredits = () =>
    count(core.db, "wallet_transactions where source = 'sub_wheel'");
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: Error & { code?: string }) => e.code ?? e.message,
    );
  const rights = () =>
    core.db.query<Record<string, unknown>>(
      // In Twitch order (the test clock is frozen: created_at ties).
      `select s.* from sw_spins s order by (select min(occurred_at) from sw_spin_sources p where p.spin_id = s.spin_id), s.created_at`,
    );
  const reviews = () =>
    core.db.query<Record<string, unknown>>(
      'select * from sw_spin_reviews order by id',
    );
  return {
    core,
    wheel,
    wheelOn,
    post,
    tokens,
    wheelCredits,
    code,
    rights,
    reviews,
    draws: () => draws,
    receive: (e: AlertEventInput, w = wheel) => w.fromAlert(e, null),
  };
}

describe('Roue du Sub V2 — R2: subscribe and resub message', () => {
  it('v1: the same economy with or without R2 (loyalty and the V1 wheel), the proofs kept', async () => {
    const run = async (wired: boolean) => {
      const f = await fixture({ wired });
      await f.wheel.setEnabled(CH, true);
      await f.post(sub(0));
      await f.receive(notice(2_000, { type: 'sub', months: undefined }));
      await f.post(resub(30 * DAY, 2));
      await f.receive(notice(30 * DAY + 1_000, { months: 2 }));
      // An unshared resub (message only) and a gifted sub: no V1 spin, nothing more.
      await f.post(resub(60 * DAY, 3));
      await f.post(sub(61 * DAY, { isGift: true }));
      return {
        tokens: await f.tokens(),
        draws: f.draws(),
        wheel: await f.wheelCredits(),
        spins: await count(f.core.db, 'sw_spins'),
        loyalty: await count(f.core.db, 'loyalty_rewards'),
        proofs: await count(f.core.db, 'sw_spin_sources'),
        orphans: await count(
          f.core.db,
          'sw_spin_sources where spin_id is null',
        ),
      };
    };
    const without = await run(false);
    const withR2 = await run(true);
    expect(withR2).toMatchObject({
      tokens: without.tokens,
      draws: without.draws,
      wheel: without.wheel,
      spins: without.spins,
      loyalty: without.loyalty,
    });
    expect(withR2.spins).toBe(2);
    // 2 notices + subscribe and message joined to them + the unshared message (orphan); the gift: nothing.
    expect(withR2.proofs).toBe(5);
    expect(withR2.orphans).toBe(1);
  });

  it('the EventSub message id is the proof, the Twitch time its time, cumulative months its certain month', async () => {
    const f = await fixture();
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    const m = resub(0, 9);
    await f.post(m);
    const proof = (
      await f.core.db.query<Record<string, unknown>>(
        'select * from sw_spin_sources',
      )
    )[0]!;
    expect(proof).toMatchObject({
      source: 'message',
      source_event_id: m.eventId,
      months: 9,
      viewer_id: V.twitchUserId,
    });
    expect(new Date(proof.occurred_at as Date).toISOString()).toBe(at(0));
    expect((await f.rights())[0]).toMatchObject({
      status: 'owed',
      sub_month: 9,
      month_source: 'twitch',
      event_key: `message:twitch:${m.eventId}`,
    });
    // Without months (a bot before R2): an estimate, never invented.
    const g = await fixture();
    await g.wheel.setMode(CH, 'v2_acquire', 'studio');
    await g.post(resub(0));
    expect((await g.rights())[0]).toMatchObject({
      sub_month: 1,
      month_source: 'estimated_no_history',
    });
  });

  it('redelivery: loyalty replays, the proof is the same, no new right', async () => {
    const f = await fixture();
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    const s = sub(0);
    expect((await f.post(s)).replayed).toBe(false);
    expect((await f.post(s)).replayed).toBe(true);
    await f.post(s);
    expect(await count(f.core.db, 'sw_spins')).toBe(1);
    expect(await count(f.core.db, 'sw_spin_sources')).toBe(1);
    expect(await count(f.core.db, 'loyalty_rewards')).toBe(1);
  });

  it('loyalty succeeds, the acquisition fails, then the redelivery: one loyalty reward, the right finally acquired', async () => {
    for (const mode of ['v1', 'v2_acquire'] as const) {
      const f = await fixture();
      await f.wheel.setMode(CH, mode, 'studio');
      const failing: Db = {
        ...f.core.db,
        tx: (fn) =>
          f.core.db.tx((q) =>
            fn({
              query: (sql, params) => {
                if (
                  /insert into sw_spin_sources|insert into sw_spins/.test(sql)
                )
                  throw new Error('connection lost');
                return q.query(sql, params);
              },
            }),
          ),
      };
      const s = sub(0);
      await expect(f.post(s, f.wheelOn(failing))).rejects.toThrow(
        'connection lost',
      );
      const paid = await f.tokens();
      expect(paid).toBeGreaterThan(0);
      expect(await count(f.core.db, 'sw_spin_sources')).toBe(0);
      // The bot sends it again: loyalty answers from its stored reward, the acquisition completes.
      expect((await f.post(s)).replayed).toBe(true);
      expect(await f.tokens()).toBe(paid);
      expect(await count(f.core.db, 'loyalty_rewards')).toBe(1);
      expect(await count(f.core.db, 'sw_spin_sources')).toBe(1);
      expect(await count(f.core.db, 'sw_spins')).toBe(mode === 'v1' ? 0 : 1);
    }
  });

  it('every order of subscribe, message (with / without months) and notice of one renewal, both modes: one right, one wheel credit, no review', async () => {
    const orders = ['smn', 'snm', 'msn', 'mns', 'nsm', 'nms'] as const;
    for (const mode of ['v1', 'v2_acquire'] as const)
      for (const months of [7, undefined])
        for (const order of orders) {
          const f = await fixture();
          await f.wheel.setEnabled(CH, true);
          await f.wheel.setMode(CH, mode, 'studio');
          const s = sub(0);
          const m = resub(3_000, months);
          const n = notice(1_500);
          for (const k of order)
            if (k === 's') await f.post(s);
            else if (k === 'm') await f.post(m);
            else await f.receive(n);
          const tag = `${mode} ${months ?? '-'} ${order}`;
          expect(await count(f.core.db, 'sw_spins'), tag).toBe(1);
          expect(
            await count(f.core.db, 'sw_spin_sources where spin_id is not null'),
            tag,
          ).toBe(3);
          expect(await f.wheelCredits(), tag).toBe(1);
          expect(f.draws(), tag).toBe(1);
          expect(await count(f.core.db, 'sw_spin_reviews'), tag).toBe(0);
          expect((await f.rights())[0], tag).toMatchObject({
            status: 'queued',
            months: 7,
            sub_month: 7,
            month_source: 'twitch',
          });
        }
  });
});

describe('Roue du Sub V2 — R2: rights « À vérifier »', () => {
  /** History: month 5 certain (a V1 resub 40 days before). */
  async function withHistory() {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    await f.receive(notice(-40 * DAY, { months: 5 }));
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    return f;
  }

  it('a subscribe kept owed (estimated 6), then its share 2 days later (certain 6, drawn like V1): the subscribe right is blocked', async () => {
    const f = await withHistory();
    await f.wheel.setEnabled(CH, false);
    const s = sub(0);
    await f.post(s);
    await f.wheel.setEnabled(CH, true);
    const n = (await f.receive(notice(2 * DAY, { months: 6 })))!;
    expect(n).toMatchObject({ status: 'queued', months: 6 });
    const [r] = await f.reviews();
    const suspect = (await f.rights()).find(
      (x) => x.event_key === `subscribe:twitch:${s.eventId}`,
    )!;
    expect(r).toMatchObject({
      spin_id: suspect.spin_id,
      other_spin_id: n.spin_id,
      month: 6,
      status: 'open',
      reason: 'same_month',
    });
    // No path draws it; the right and its proof are kept.
    expect(await f.code(f.wheel.drawRight(suspect.spin_id as string))).toBe(
      'needs_review',
    );
    expect(suspect.status).toBe('owed');
    expect(
      await count(
        f.core.db,
        `sw_spin_sources where spin_id = '${suspect.spin_id}'`,
      ),
    ).toBe(1);
    // Studio's view: both rights, their months, their proofs.
    const [view] = (await f.wheel.state(CH)).reviews;
    expect(view).toMatchObject({
      month: 6,
      suspect: {
        spin_id: suspect.spin_id,
        month_source: 'estimated',
        sources: [{ source: 'subscribe' }],
      },
      other: {
        spin_id: n.spin_id,
        month_source: 'twitch',
        sources: [{ source: 'chat_notification' }],
      },
    });
    expect(await f.wheelCredits()).toBe(2); // the V1 history + the notice; never the blocked right
  });

  it('two owed rights of one month (an estimate and a certain month): the estimated one is blocked, the certain one stays drawable', async () => {
    const f = await withHistory();
    await f.wheel.setEnabled(CH, false);
    await f.post(sub(0));
    await f.post(resub(2 * DAY, 6));
    const [est, cert] = await f.rights().then((r) => r.slice(1));
    expect(est).toMatchObject({ month_source: 'estimated', sub_month: 6 });
    expect(cert).toMatchObject({ month_source: 'twitch', sub_month: 6 });
    expect(await f.reviews()).toMatchObject([
      { spin_id: est!.spin_id, other_spin_id: cert!.spin_id, status: 'open' },
    ]);
    expect((await f.wheel.drawRight(cert!.spin_id as string)).status).toBe(
      'queued',
    );
    expect(await f.code(f.wheel.drawRight(est!.spin_id as string))).toBe(
      'needs_review',
    );
  });

  it('the estimate is the Twitch order, never the processing order: the share processed BEFORE the subscribe still conflicts', async () => {
    const f = await withHistory();
    await f.wheel.setEnabled(CH, false);
    await f.post(resub(2 * DAY, 6)); // processed first
    const s = sub(0);
    await f.post(s);
    const est = (await f.rights()).find(
      (r) => r.event_key === `subscribe:twitch:${s.eventId}`,
    )!;
    // Estimated from the months known before its Twitch time (5) — not from the share processed earlier (6).
    expect(est).toMatchObject({ sub_month: 6, month_source: 'estimated' });
    expect(await f.reviews()).toMatchObject([{ spin_id: est.spin_id }]);
  });

  it('a notice joining a right under review (10 min): kept as proof, the right stays blocked, nothing thrown', async () => {
    const f = await withHistory();
    await f.wheel.setEnabled(CH, false);
    await f.post(sub(0));
    await f.post(resub(2 * DAY, 6));
    await f.wheel.setEnabled(CH, true);
    // The subscribe's own notice (Prime re-up seen as « sub »), processed late.
    const spin = (await f.receive(
      notice(5_000, { type: 'sub', months: undefined }),
    ))!;
    expect(spin.status).toBe('owed');
    expect(await f.wheelCredits()).toBe(1);
  });

  it('never on time proximity alone: distinct months close in time, an estimate past a certain month — no review', async () => {
    const f = await withHistory();
    await f.wheel.setEnabled(CH, false);
    // A certain month 6, then a subscribe 20 min later (estimate 7), then a certain month 7 an hour later.
    await f.post(resub(0, 6));
    await f.post(sub(20 * 60_000));
    await f.post(resub(60 * 60_000 + 15 * 60_000, 8));
    // Two certain months one minute apart (a catch-up): distinct.
    await f.post(resub(3 * DAY, 9));
    await f.post(resub(3 * DAY + 60_000, 10));
    expect(await f.reviews()).toEqual([]);
    expect(
      (await f.rights()).map((r) => [r.sub_month, r.month_source]),
    ).toEqual([
      [5, 'twitch'],
      [6, 'twitch'],
      [7, 'estimated'],
      [8, 'twitch'],
      [9, 'twitch'],
      [10, 'twitch'],
    ]);
  });

  it('a Twitch proof giving the suspect a different month closes its review (auto_distinct): drawable again', async () => {
    const f = await withHistory();
    await f.wheel.setEnabled(CH, false);
    const s = sub(0);
    await f.post(s);
    await f.post(resub(2 * DAY, 6));
    const suspect = (await f.rights())[1]!;
    expect((await f.reviews())[0]).toMatchObject({ status: 'open' });
    // The subscribe's own resub message, delivered late, carries month 8: two distinct months.
    await f.post(resub(4_000, 8));
    expect((await f.reviews())[0]).toMatchObject({
      status: 'auto_distinct',
      resolved_by: 'twitch_proof',
    });
    expect((await f.rights())[1]).toMatchObject({
      spin_id: suspect.spin_id,
      sub_month: 8,
      month_source: 'twitch',
    });
    expect((await f.wheel.drawRight(suspect.spin_id as string)).status).toBe(
      'queued',
    );
  });

  it('two estimates of one month (no certain month between): the later one is blocked', async () => {
    const f = await withHistory();
    await f.wheel.setEnabled(CH, false);
    await f.post(sub(0));
    await f.post(sub(40 * DAY));
    const [, first, second] = await f.rights();
    expect([first!.sub_month, second!.sub_month]).toEqual([6, 6]);
    expect(await f.reviews()).toMatchObject([
      { spin_id: second!.spin_id, other_spin_id: first!.spin_id },
    ]);
  });

  it('the later right is the later in Twitch time, not in processing order (an outbox delivering late)', async () => {
    const f = await withHistory();
    await f.wheel.setEnabled(CH, false);
    const late = sub(40 * DAY);
    await f.post(late); // processed first
    await f.post(sub(0));
    const suspect = (await f.rights()).find(
      (r) => r.event_key === `subscribe:twitch:${late.eventId}`,
    )!;
    expect(await f.reviews()).toMatchObject([{ spin_id: suspect.spin_id }]);
  });

  it('V1 is never blocked: v1 mode, two « sub » notices of one estimated month are both drawn as today', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    await f.receive(notice(-40 * DAY, { months: 5 }));
    await f.receive(notice(0, { type: 'sub', months: undefined }));
    await f.receive(notice(40 * DAY, { type: 'sub', months: undefined }));
    expect(await f.wheelCredits()).toBe(3);
    expect(await f.reviews()).toEqual([]);
    expect(await f.tokens()).toBe(
      subWheelAmount(5, 1, SEGMENT) + 2 * subWheelAmount(1, 1, SEGMENT),
    );
  });
});
