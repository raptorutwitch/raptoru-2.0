import { randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  type LoyaltyEvent,
  SUB_WHEEL,
  SUB_WHEEL_V3,
  subWheelAmount,
  subWheelGrid,
  subWheelLayout,
  subWheelV3Amounts,
  subWheelV3Tier,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { loyaltyRoutes } from '../src/http/loyalty-routes.js';
import { SubWheelChat } from '../src/sub-wheel/chat.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { count, goLive, setup } from './helpers.js';

// Roue du Sub V3 (docs/SUB_WHEEL_V3.md § 13): the barème (4 amounts, one tier every 3 months), the barème of each draw
// (a right acquired before V3 keeps the legacy wheel), the seniority (never « 1 month » by default: an unknown month
// waits for a confirmation — badge, a later share, Studio), what the animation receives. PGlite; the races are in
// sub-wheel-r2.integration.test.ts (real Postgres).

const CH = '83603689';
const T0 = new Date('2026-11-16T20:00:00Z');
const MIN = 60_000;
const at = (ms: number) => new Date(T0.getTime() + ms);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const STUDIO = { id: 'studio', role: 'broadcaster', via: 'studio' } as const;

describe('Roue du Sub V3 — barème', () => {
  it('4 amounts (5 / 3 / 3 / 1 parts of equal chance), never two equal amounts side by side', () => {
    const pattern = [...SUB_WHEEL_V3.pattern];
    expect(pattern).toHaveLength(12);
    expect(
      [0, 1, 2, 3].map((l) => pattern.filter((x) => x === l).length),
    ).toEqual([5, 3, 3, 1]);
    pattern.forEach((l, i) => expect(l).not.toBe(pattern[(i + 1) % 12]));
    for (const m of [1, 7, 30, 60, 90]) {
      const layout = subWheelGrid(m, 3);
      expect(layout).toHaveLength(12);
      expect(layout.every((p) => p.mult === 1)).toBe(true);
      layout.forEach((p, i) =>
        expect(p.val).not.toBe(layout[(i + 1) % 12]!.val),
      );
    }
  });

  it('one tier every 3 months of seniority; the same amounts inside a tier, the next tier higher', () => {
    expect([1, 2, 3, 4, 6, 7, 30, 31, 58, 60, 61].map(subWheelV3Tier)).toEqual([
      1, 1, 1, 2, 2, 3, 10, 11, 20, 20, 21,
    ]);
    expect(subWheelV3Amounts(1)).toEqual(subWheelV3Amounts(3));
    expect(subWheelV3Amounts(4)).not.toEqual(subWheelV3Amounts(3));
    expect(subWheelV3Amounts(3)).toEqual([3000, 4000, 5000, 6000]);
    expect(subWheelV3Amounts(30)).toEqual([16500, 22000, 27500, 33000]);
    expect(subWheelV3Amounts(60)).toEqual([31500, 42000, 52500, 63000]);
  });

  it('every tier raises the minimum, the mean and the jackpot (to 180 months); much slower after 60 months', () => {
    const wheel = (t: number) => subWheelGrid(3 * t, 3).map((p) => p.val);
    for (let t = 2; t <= 60; t++) {
      const a = wheel(t - 1),
        b = wheel(t);
      expect(Math.min(...b), `tier ${t}`).toBeGreaterThan(Math.min(...a));
      expect(mean(b), `tier ${t}`).toBeGreaterThan(mean(a));
      expect(Math.max(...b), `tier ${t}`).toBeGreaterThan(Math.max(...a));
    }
    const step = (t: number) =>
      Math.max(...wheel(t)) - Math.max(...wheel(t - 1));
    expect(step(20)).toBe(3000);
    expect(step(21)).toBeLessThanOrEqual(800);
    expect(step(40)).toBeLessThanOrEqual(800);
  });

  it('the Twitch tier multiplies the part (Prime / T1 ×1, T2 ×2, T3 ×3); jackpot T3 at 60 months ≈ 200 000', () => {
    const jp = SUB_WHEEL_V3.pattern.indexOf(3);
    expect(subWheelAmount(60, 1, jp, 3)).toBe(63000);
    expect(subWheelAmount(60, 2, jp, 3)).toBe(126000);
    expect(subWheelAmount(60, 3, jp, 3)).toBe(189000);
    // Six figures in T3: the jackpot only from 31 months, the « good » parts from 37 months.
    expect(subWheelAmount(30, 3, jp, 3)).toBe(99000);
    expect(subWheelAmount(33, 3, jp, 3)).toBeGreaterThanOrEqual(100000);
    const good = SUB_WHEEL_V3.pattern.indexOf(2);
    expect(subWheelAmount(36, 3, good, 3)).toBeLessThan(100000);
    expect(subWheelAmount(39, 3, good, 3)).toBeGreaterThanOrEqual(100000);
  });

  it('the legacy barème (grid 1) is unchanged: every past draw keeps its amount', () => {
    expect(subWheelGrid(45)).toEqual(subWheelLayout(45));
    expect(subWheelAmount(45, 3, 2)).toBe(9000);
    expect(subWheelAmount(48, 3, 8)).toBe(90000);
    expect(subWheelAmount(4, 1, 1)).toBe(300);
  });
});

const notice = (
  viewer: string,
  ms: number,
  over: Partial<AlertEventInput> = {},
): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: viewer, login: `v${viewer}`, display_name: `V${viewer}` },
  tier: '1000',
  months: 30,
  occurred_at: at(ms).toISOString(),
  ...over,
});
/** A « sub » chat notice: Twitch gives no cumulative months (a new sub, or a Prime re-up of a long-time viewer). */
const subNotice = (
  viewer: string,
  ms: number,
  over: Partial<AlertEventInput> = {},
) => notice(viewer, ms, { type: 'sub', months: undefined, ...over });

async function fixture(o: { grid?: 1 | 3; segment?: number } = {}) {
  const core = await setup({ loyalty: { eventCredits: true } });
  core.clock.set(T0);
  let segment = o.segment ?? 0;
  let draws = 0;
  const make = () =>
    new SubWheelService(
      core.db,
      core.clock,
      () => {
        draws++;
        return segment;
      },
      coreWalletEconomy(core.wallet.wallet),
    );
  const wheel = make();
  await wheel.setEnabled(CH, true);
  await wheel.setMode(CH, 'v2', 'studio');
  if (o.grid === 3) await wheel.setGrid(CH, 3, 'studio');
  await goLive(core, 's1', T0);
  /** A fresh chatters reading of the live that sees these viewers. */
  const seen = async (viewers: string[], ms: number) => {
    const id = (
      await core.db.query<{ id: number }>(
        `insert into presence_cycles (cycle_id, stream_id, worker_id, observed_at, received_at, duration_ms, status,
           chatter_count)
         values ($1, 's1', 'w', $2, $2, 1, 'ok', $3) returning id`,
        [randomUUID(), at(ms), viewers.length],
      )
    )[0]!.id;
    for (const v of viewers) {
      await core.db.query(
        `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2) on conflict do nothing`,
        [v, `v${v}`],
      );
      await core.db.query(
        `insert into presence_viewer_streams (stream_id, twitch_user_id, first_seen_at, last_seen_at, last_seen_cycle)
         values ('s1', $1, $2, $2, $3)
         on conflict (stream_id, twitch_user_id) do update set last_seen_at = $2, last_seen_cycle = $3`,
        [v, at(ms), id],
      );
    }
  };
  const route = loyaltyRoutes(core.loyalty, {
    service: wheel,
    channelId: CH,
  }).find((r) => r.pattern.test('/v1/bot/loyalty/events'))!;
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: Error & { code?: string }) => e.code ?? e.message,
    );
  return {
    core,
    wheel,
    make,
    seen,
    code,
    clock: (ms: number) => core.clock.set(at(ms)),
    receive: (e: AlertEventInput, w = wheel) => w.fromAlert(e, null),
    post: (e: LoyaltyEvent) =>
      route.handle({ params: [], body: e, url: new URL('http://core') }),
    claim: (w = wheel) => w.claimAnimation(CH, 'obs'),
    done: (spinId: string) =>
      wheel.reportAnimation(spinId, { consumer_id: 'obs', event: 'completed' }),
    credits: () =>
      count(core.db, "wallet_transactions where source = 'sub_wheel'"),
    row: async (spinId: string) =>
      (
        await core.db.query<Record<string, unknown>>(
          'select * from sw_spins where spin_id = $1',
          [spinId],
        )
      )[0]!,
    setSegment: (s: number) => (segment = s),
    draws: () => draws,
  };
}

describe('Roue du Sub V3 — the barème of each draw', () => {
  it('V3 on: a new right is drawn on V3, recorded grid 3, credited the V3 amount once', async () => {
    const f = await fixture({
      grid: 3,
      segment: SUB_WHEEL_V3.pattern.indexOf(2),
    });
    const r = (await f.receive(
      notice('9701', MIN, { tier: '3000', months: 30 }),
    ))!;
    await f.seen(['9701'], 2 * MIN);
    f.clock(2 * MIN);
    const { spin } = await f.claim();
    expect(spin).toMatchObject({
      spin_id: r.spin_id,
      grid: 3,
      segment: 4,
      lot: 27500,
      coef: 3,
      amount: 82500,
    });
    expect(spin!.layout).toEqual(subWheelGrid(30, 3));
    expect(await f.row(r.spin_id)).toMatchObject({ grid: 3, amount: 82500 });
    expect(await f.credits()).toBe(1);
  });

  it('a right acquired BEFORE V3 was switched on keeps the legacy wheel; history is never recomputed', async () => {
    const f = await fixture({ segment: 2 });
    f.clock(MIN);
    const before = (await f.receive(
      notice('9702', MIN, { tier: '3000', months: 45 }),
    ))!;
    f.clock(MIN + 1000);
    await f.wheel.setGrid(CH, 3, 'studio');
    await f.seen(['9702'], 2 * MIN);
    f.clock(2 * MIN);
    const { spin } = await f.claim();
    expect(spin).toMatchObject({
      spin_id: before.spin_id,
      grid: 1,
      amount: subWheelAmount(45, 3, 2),
    });
    expect(spin!.layout).toEqual(subWheelLayout(45));
    await f.done(before.spin_id);
    // The same viewer's next month, acquired after the switch: V3.
    const after = (await f.receive(
      notice('9702', 3 * MIN, { tier: '3000', months: 46 }),
    ))!;
    f.clock(4 * MIN);
    await f.seen(['9702'], 4 * MIN);
    expect((await f.claim()).spin).toMatchObject({
      spin_id: after.spin_id,
      grid: 3,
      amount: subWheelAmount(46, 3, 2, 3),
    });
    // Back to the legacy wheel: grid_since moves, nothing drawn changes.
    await f.wheel.setGrid(CH, 1, 'studio');
    expect(await f.row(before.spin_id)).toMatchObject({
      grid: 1,
      amount: subWheelAmount(45, 3, 2),
    });
    expect(await f.row(after.spin_id)).toMatchObject({ grid: 3 });
    expect((await f.wheel.settings(CH)).grid).toBe(1);
    expect(
      await count(f.core.db, "lab_moderation_audit where action = 'sw_grid'"),
    ).toBe(2);
  });

  it('the fallback mode v1 (no confirmed seniority: « sub » = month 1) keeps the legacy barème even with V3 on', async () => {
    const f = await fixture({ grid: 3, segment: 3 });
    await f.wheel.setMode(CH, 'v1', 'studio');
    const r = (await f.receive(subNotice('9703', MIN, { tier: '3000' })))!;
    expect(await f.row(r.spin_id)).toMatchObject({
      grid: 1,
      amount: subWheelAmount(1, 3, 3),
    });
    expect((await f.claim()).spin).toMatchObject({
      spin_id: r.spin_id,
      grid: 1,
      amount: subWheelAmount(1, 3, 3),
    });
  });

  it('the animation receives the viewer (id, Prime, picture, equipped title with its look) — never a gain to compute', async () => {
    const f = await fixture({
      grid: 3,
      segment: SUB_WHEEL_V3.pattern.indexOf(3),
    });
    await f.core.db.query(
      `insert into lab_viewer_avatars (viewer_id, url, status, fetched_at) values ('9703', 'https://static-cdn.jtvnw.net/p/9703.png', 'ok', $1)`,
      [T0],
    );
    await f.core.db.query(
      `insert into progression_rewards (channel_id, reward_id, kind, label, active, status, style, created_at, updated_at)
       values ($1, 'loup-garou', 'title', 'Loup-garou', true, 'published', $2, $3, $3)`,
      [
        CH,
        JSON.stringify({
          color: '#2ee6c1',
          gradient: { from: '#f02d2d', to: '#ad0505', angle: 225 },
          effect: 'glow',
          weight: 'bold',
        }),
        T0,
      ],
    );
    await f.core.db.query(
      `insert into progression_grants (channel_id, twitch_user_id, reward_id, source, granted_by, granted_at)
       values ($1, '9703', 'loup-garou', 'manual', 'test', $2)`,
      [CH, T0],
    );
    await f.core.db.query(
      `insert into progression_equipped (channel_id, twitch_user_id, title_id, updated_at) values ($1, '9703', 'loup-garou', $2)`,
      [CH, T0],
    );
    await f.receive(notice('9703', MIN, { tier: 'prime', months: 12 }));
    await f.seen(['9703'], 2 * MIN);
    f.clock(2 * MIN);
    const { spin } = await f.claim();
    expect(spin).toMatchObject({
      viewer_id: '9703',
      prime: true,
      tier: 1,
      coef: 1,
      months: 12,
      month_source: 'twitch',
      avatar: 'https://static-cdn.jtvnw.net/p/9703.png',
      title: {
        label: 'Loup-garou',
        style: { effect: 'glow', gradient: { from: '#f02d2d' } },
      },
      lot: subWheelV3Amounts(12)[3],
      amount: subWheelV3Amounts(12)[3],
    });
    // A title revoked, or none: no title (never a placeholder).
    await f.core.db.query(`update progression_grants set revoked_at = $1`, [
      T0,
    ]);
    await f.done(spin!.spin_id);
    await f.receive(notice('9703', 3 * MIN, { months: 13 }));
    f.clock(4 * MIN);
    await f.seen(['9703'], 4 * MIN);
    expect((await f.claim()).spin).toMatchObject({ title: null, prime: false });
  });
});

describe('Roue du Sub V3 — seniority (never « 1 month » by default)', () => {
  it('an unknown month (no history) is never drawn, nor by hand; its right is kept, the queue goes on', async () => {
    const f = await fixture({ grid: 3 });
    const unknown = (await f.receive(subNotice('9711', MIN)))!;
    expect(unknown.right).toMatchObject({
      month_source: 'estimated_no_history',
      month_status: 'unknown',
    });
    const other = (await f.receive(notice('9712', MIN + 1000, { months: 8 })))!;
    await f.seen(['9711', '9712'], 2 * MIN);
    f.clock(40 * MIN);
    // The other viewer's certain right is drawn; the unknown one waits (owed, listed, never drawn).
    expect((await f.claim()).spin?.spin_id).toBe(other.spin_id);
    await f.done(other.spin_id);
    expect((await f.claim()).spin).toBeNull();
    expect(await f.code(f.wheel.drawRight(unknown.spin_id))).toBe(
      'month_unconfirmed',
    );
    expect(
      (await f.wheel.rights(CH)).map((r) => [r.spin_id, r.right.month_status]),
    ).toEqual([[unknown.spin_id, 'unknown']]);
    expect(f.draws()).toBe(1);
  });

  it('the chat badge confirms it (cumulative months): drawn on the right tier; a redelivered message changes nothing', async () => {
    const f = await fixture({ grid: 3, segment: 1 });
    const r = (await f.receive(subNotice('9713', MIN, { tier: '3000' })))!;
    const chat = new SubWheelChat(f.core.db, f.core.clock, f.wheel);
    const msg = {
      channel_id: CH,
      message_id: 'chat-9713',
      text: 'merci pour la roue !',
      chatter: {
        id: '9713',
        login: 'v9713',
        display_name: 'V9713',
        role: 'viewer' as const,
        badges: ['subscriber'],
        sub_months: 40,
      },
      source: 'twitch' as const,
    };
    await chat.chat(msg);
    await chat.chat(msg);
    expect(await f.row(r.spin_id)).toMatchObject({
      sub_month: 40,
      months: 40,
      month_source: 'badge',
    });
    expect(
      await count(f.core.db, "sw_spin_sources where source = 'badge'"),
    ).toBe(1);
    await f.seen(['9713'], 2 * MIN);
    f.clock(3 * MIN);
    expect((await f.claim()).spin).toMatchObject({
      spin_id: r.spin_id,
      months: 40,
      amount: subWheelAmount(40, 3, 1, 3),
    });
  });

  it('a later share with the cumulative months confirms it (both orders, one right) — the share first is certain at once', async () => {
    for (const order of ['sub first', 'share first'] as const) {
      const f = await fixture({ grid: 3 });
      const sub = subNotice('9714', MIN);
      const share: LoyaltyEvent = {
        type: 'resub',
        eventId: randomUUID(),
        occurredAt: at(MIN + 30_000).toISOString(),
        viewer: { twitchUserId: '9714', login: 'v9714', displayName: 'V9714' },
        tier: 't1',
        cumulativeMonths: 25,
      } as LoyaltyEvent;
      if (order === 'sub first') {
        await f.receive(sub);
        await f.post(share);
      } else {
        await f.post(share);
        await f.receive(sub);
      }
      expect(await count(f.core.db, 'sw_spins'), order).toBe(1);
      const row = (
        await f.core.db.query<Record<string, unknown>>('select * from sw_spins')
      )[0]!;
      expect(row, order).toMatchObject({
        sub_month: 25,
        months: 25,
        month_source: 'twitch',
      });
      await f.seen(['9714'], 2 * MIN);
      f.clock(3 * MIN);
      expect((await f.claim()).spin, order).toMatchObject({
        months: 25,
        amount: subWheelAmount(25, 1, 0, 3),
      });
    }
  });

  it('an ESTIMATED month (history known) waits for a confirmation, then is drawn on its estimate', async () => {
    const f = await fixture({ grid: 3 });
    // History: month 10 certain, a month before (drawn by a Studio request).
    const old = (await f.receive(
      notice('9715', -35 * 24 * 60 * MIN, { months: 10 }),
    ))!;
    await f.wheel.requestDraw(old.spin_id, STUDIO);
    expect((await f.claim()).spin?.spin_id).toBe(old.spin_id);
    await f.done(old.spin_id);
    f.clock(MIN);
    const r = (await f.receive(subNotice('9715', MIN)))!;
    expect(r.right).toMatchObject({
      sub_month: 11,
      month_source: 'estimated',
      month_status: 'estimated',
    });
    await f.seen(['9715'], 2 * MIN);
    f.clock(5 * MIN);
    expect((await f.claim()).spin).toBeNull();
    f.clock(MIN + SUB_WHEEL.monthConfirmMs + 1);
    await f.seen(['9715'], MIN + SUB_WHEEL.monthConfirmMs);
    expect((await f.claim()).spin).toMatchObject({
      spin_id: r.spin_id,
      months: 11,
    });
  });

  it('a badge at or below a month already certain is not trusted; Studio confirms by hand (journaled), never a certain month', async () => {
    const f = await fixture({ grid: 3 });
    const old = (await f.receive(
      notice('9716', -40 * 24 * 60 * MIN, { months: 20 }),
    ))!;
    await f.wheel.requestDraw(old.spin_id, STUDIO);
    await f.claim();
    await f.done(old.spin_id);
    const r = (await f.receive(subNotice('9716', MIN)))!;
    expect(
      await f.wheel.confirmFromBadge(
        CH,
        { id: '9716', login: 'v9716', name: 'V9716' },
        3,
        'chat-low',
      ),
    ).toBeNull();
    // Equal to the month already certain: a stale badge (it lags behind the renewal), not trusted either.
    expect(
      await f.wheel.confirmFromBadge(
        CH,
        { id: '9716', login: 'v9716', name: 'V9716' },
        20,
        'chat-stale',
      ),
    ).toBeNull();
    expect(await f.row(r.spin_id)).toMatchObject({
      month_source: 'estimated',
      sub_month: 21,
    });
    const done = await f.wheel.confirmMonthByHand(
      r.spin_id,
      22,
      'installation:abc',
      'badge vu sur Twitch',
    );
    expect(done.right).toMatchObject({
      sub_month: 22,
      month_source: 'manual',
      month_status: 'confirmed',
      confirmed_by: 'installation:abc',
    });
    expect(
      await count(
        f.core.db,
        "lab_moderation_audit where action = 'sw_month_confirm'",
      ),
    ).toBe(1);
    expect(
      await f.code(f.wheel.confirmMonthByHand(old.spin_id, 5, 'studio')),
    ).toBe('not_owed');
    const certain = (await f.receive(notice('9716', 2 * MIN, { months: 23 })))!;
    expect(
      await f.code(f.wheel.confirmMonthByHand(certain.spin_id, 5, 'studio')),
    ).toBe('month_certain');
  });

  it('a restart (new Core instance) keeps everything: the unknown right still waits, its confirmation is drawn once', async () => {
    const f = await fixture({ grid: 3, segment: 0 });
    const r = (await f.receive(subNotice('9717', MIN)))!;
    const again = f.make();
    await f.seen(['9717'], 2 * MIN);
    f.clock(30 * MIN);
    expect((await f.claim(again)).spin).toBeNull();
    await again.confirmFromBadge(
      CH,
      { id: '9717', login: 'v9717', name: 'V9717' },
      6,
      'chat-9717',
    );
    const { spin } = await f.claim(again);
    expect(spin).toMatchObject({
      spin_id: r.spin_id,
      months: 6,
      amount: subWheelV3Amounts(6)[SUB_WHEEL_V3.pattern[0]],
    });
    expect((await f.claim()).spin).toBeNull();
    expect(await f.credits()).toBe(1);
  });
});
