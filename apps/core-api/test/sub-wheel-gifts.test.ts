import { randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  type LoyaltyEvent,
  subWheelAmount,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { loyaltyRoutes } from '../src/http/loyalty-routes.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { count, goLive, setup } from './helpers.js';

// Roue du Sub — gifts never spin (decision of 16/11/2026, docs/SUB_WHEEL_V3.md § 8): a subgift, the share of a gifted
// sub (`resub.is_gift`), never a wheel; paying a later month is a normal renewal. PGlite (the viewer lock that
// serializes a renewal's proofs is the one sub-wheel-v2.integration.test.ts proves on real Postgres).

const CH = '83603689';
const V = '9601';
const SEGMENT = 3;
const T0 = new Date('2026-11-16T20:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

const notice = (
  ms: number,
  over: Partial<AlertEventInput> = {},
): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: V, login: 'gifted', display_name: 'Gifted' },
  tier: '1000',
  months: 3,
  occurred_at: at(ms).toISOString(),
  ...over,
});
const gifted = (ms: number, over: Partial<AlertEventInput> = {}) =>
  notice(ms, { is_gift: true, ...over });
const message = (ms: number, cumulativeMonths = 3): LoyaltyEvent =>
  ({
    type: 'resub',
    eventId: randomUUID(),
    occurredAt: at(ms).toISOString(),
    viewer: { twitchUserId: V, login: 'gifted', displayName: 'Gifted' },
    tier: 't1',
    cumulativeMonths,
  }) as LoyaltyEvent;

async function fixture(mode: 'v1' | 'v2_acquire' | 'v2') {
  const core = await setup({ loyalty: { eventCredits: true } });
  core.clock.set(T0);
  let draws = 0;
  const wheel = new SubWheelService(
    core.db,
    core.clock,
    () => {
      draws++;
      return SEGMENT;
    },
    coreWalletEconomy(core.wallet.wallet),
  );
  await wheel.setEnabled(CH, true);
  await wheel.setMode(CH, mode, 'studio');
  // A live with the viewer present (a fresh chatters reading), so that a V2 right would be drawn if it were drawable.
  await goLive(core, 's1', T0);
  const seen = async (ms: number) => {
    const id = (
      await core.db.query<{ id: number }>(
        `insert into presence_cycles (cycle_id, stream_id, worker_id, observed_at, received_at, duration_ms, status,
           chatter_count)
         values ($1, 's1', 'w', $2, $2, 1, 'ok', 1) returning id`,
        [randomUUID(), at(ms)],
      )
    )[0]!.id;
    await core.db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ($1, 'gifted', 'Gifted') on conflict do nothing`,
      [V],
    );
    await core.db.query(
      `insert into presence_viewer_streams (stream_id, twitch_user_id, first_seen_at, last_seen_at, last_seen_cycle)
       values ('s1', $1, $2, $2, $3)
       on conflict (stream_id, twitch_user_id) do update set last_seen_at = $2, last_seen_cycle = $3`,
      [V, at(ms), id],
    );
  };
  const route = loyaltyRoutes(core.loyalty, {
    service: wheel,
    channelId: CH,
  }).find((r) => r.pattern.test('/v1/bot/loyalty/events'))!;
  return {
    core,
    wheel,
    seen,
    clock: (ms: number) => core.clock.set(at(ms)),
    receive: (e: AlertEventInput) => wheel.fromAlert(e, null),
    post: (e: LoyaltyEvent) =>
      route.handle({ params: [], body: e, url: new URL('http://core') }),
    claim: () => wheel.claimAnimation(CH, 'obs'),
    credits: () =>
      count(core.db, "wallet_transactions where source = 'sub_wheel'"),
    rows: () =>
      core.db.query<Record<string, unknown>>(
        'select * from sw_spins order by created_at, spin_id',
      ),
    draws: () => draws,
  };
}

describe('Roue du Sub — gifts never spin', () => {
  it('the share of a gifted sub, every mode: never drawn nor credited; a redelivery changes nothing', async () => {
    for (const mode of ['v1', 'v2_acquire', 'v2'] as const) {
      const f = await fixture(mode);
      const e = gifted(1_000);
      const first = await f.receive(e);
      const again = await f.receive(e);
      if (mode === 'v1') {
        expect(first, mode).toBeNull();
        expect(await count(f.core.db, 'sw_spins'), mode).toBe(0);
      } else {
        expect(first, mode).toMatchObject({
          status: 'ignored',
          reason: 'gift',
          segment: null,
          amount: null,
        });
        expect(again?.spin_id, mode).toBe(first?.spin_id);
        expect(await count(f.core.db, 'sw_spins'), mode).toBe(1);
        expect(await count(f.core.db, 'sw_spin_sources'), mode).toBe(1);
      }
      await f.seen(30_000);
      f.clock(60_000);
      expect((await f.claim()).spin, mode).toBeNull();
      expect(f.draws(), mode).toBe(0);
      expect(await f.credits(), mode).toBe(0);
    }
  });

  it('the resub message and the gifted share of one renewal, both orders: one row, never drawn, nothing credited', async () => {
    for (const mode of ['v2_acquire', 'v2'] as const)
      for (const order of ['message first', 'notice first'] as const) {
        const tag = `${mode} ${order}`;
        const f = await fixture(mode);
        if (order === 'message first') {
          await f.post(message(1_000));
          // The right acquired by the message alone is not drawn before its notice (it waits 20 s).
          await f.seen(2_000);
          f.clock(3_000);
          expect((await f.claim()).spin, tag).toBeNull();
          await f.receive(gifted(1_500));
        } else {
          await f.receive(gifted(1_500));
          await f.post(message(1_000));
        }
        const rows = await f.rows();
        expect(rows, tag).toHaveLength(1);
        expect(rows[0], tag).toMatchObject({
          status: 'ignored',
          reason: 'gift',
          sub_month: 3,
          month_source: 'twitch',
          segment: null,
        });
        expect(
          await count(f.core.db, 'sw_spin_sources where spin_id is not null'),
          tag,
        ).toBe(2);
        await f.seen(60_000);
        f.clock(90_000);
        expect((await f.claim()).spin, tag).toBeNull();
        expect(f.draws(), tag).toBe(0);
        expect(await f.credits(), tag).toBe(0);
      }
  });

  it('gifted last month, paid this month: the paid renewal spins (a gift = no wheel, paying = a wheel)', async () => {
    for (const mode of ['v2_acquire', 'v2'] as const) {
      const f = await fixture(mode);
      await f.receive(gifted(1_000, { months: 3 }));
      const paid = (await f.receive(notice(2_000, { months: 4 })))!;
      if (mode === 'v2') {
        expect(paid, mode).toMatchObject({ status: 'owed' });
        await f.seen(30_000);
        f.clock(40_000);
        expect((await f.claim()).spin, mode).toMatchObject({
          spin_id: paid.spin_id,
          amount: subWheelAmount(4, 1, SEGMENT),
        });
      } else
        expect(paid, mode).toMatchObject({
          status: 'queued',
          amount: subWheelAmount(4, 1, SEGMENT),
        });
      expect(f.draws(), mode).toBe(1);
      expect(await f.credits(), mode).toBe(1);
      expect(
        (await f.rows())
          .map((r) => [r.sub_month, r.status, r.reason])
          .sort((x, y) => Number(x[0]) - Number(y[0])),
        mode,
      ).toEqual([
        [3, 'ignored', 'gift'],
        [4, mode === 'v2' ? 'playing' : 'queued', null],
      ]);
    }
  });

  it('a right from the resub message alone (paid, its notice lost) is still drawn, 20 s after its acquisition', async () => {
    const f = await fixture('v2');
    f.clock(1_000);
    await f.post(message(1_000, 5));
    await f.seen(2_000);
    f.clock(15_000);
    expect((await f.claim()).spin).toBeNull();
    f.clock(21_001);
    expect((await f.claim()).spin).toMatchObject({
      amount: subWheelAmount(5, 1, SEGMENT),
    });
    expect(await f.credits()).toBe(1);
  });

  it('a gifted subscribe (channel.subscribe is_gift) is never a right — unchanged', async () => {
    const f = await fixture('v2');
    await f.post({
      type: 'sub',
      eventId: randomUUID(),
      occurredAt: at(1_000).toISOString(),
      viewer: { twitchUserId: V, login: 'gifted', displayName: 'Gifted' },
      tier: 't1',
      isGift: true,
    } as LoyaltyEvent);
    expect(await count(f.core.db, 'sw_spins')).toBe(0);
  });
});
