import { randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  type LoyaltyEvent,
  SUB_WHEEL,
  subWheelAmount,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { loyaltyRoutes } from '../src/http/loyalty-routes.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { count, endLive, goLive, setup } from './helpers.js';

// Roue du Sub V2, lot R3 (docs/SUB_WHEEL_V2_PLAN.md § 8–10): mode v2 draws at display time — manual requests first,
// then the automatic queue (live, wheel on, viewer present, alert ended); one wheel at a time; a right under review
// never drawn and never in the way; permissions « Tirer » / « Accorder un tour »; player incidents and restarts keep
// every right and never decide a gain twice. PGlite; the races are in sub-wheel-r3.integration.test.ts.

const CH = '83603689';
const SEGMENT = 3;
const T0 = new Date('2026-10-21T20:00:00Z');
const MIN = 60_000;
const DAY = 86_400_000;
const at = (ms: number) => new Date(T0.getTime() + ms);
const iso = (ms: number) => at(ms).toISOString();
const studio: Actor = { id: 'studio', role: 'broadcaster', via: 'studio' };
const mod = (id: string): Actor => ({
  id,
  login: `mod${id}`,
  role: 'moderator',
  via: 'extension',
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
  months: 7,
  occurred_at: iso(ms),
  ...over,
});

async function fixture() {
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
  let cycle = 0;
  let stream = '';
  /** A chatters reading (status ok) of the current live that sees these viewers. */
  const reading = async (viewers: string[], ms: number) => {
    const id = (
      await core.db.query<{ id: number }>(
        `insert into presence_cycles (cycle_id, stream_id, worker_id, observed_at, received_at, duration_ms, status,
           chatter_count)
         values ($1, $2, 'w', $3, $3, 1, 'ok', $4) returning id`,
        [`c${++cycle}`, stream, at(ms), viewers.length],
      )
    )[0]!.id;
    for (const v of viewers) {
      await core.db.query(
        `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2) on conflict do nothing`,
        [v, `v${v}`],
      );
      await core.db.query(
        `insert into presence_viewer_streams (stream_id, twitch_user_id, first_seen_at, last_seen_at, last_seen_cycle)
         values ($1, $2, $3, $3, $4)
         on conflict (stream_id, twitch_user_id) do update set last_seen_at = $3, last_seen_cycle = $4`,
        [stream, v, at(ms), id],
      );
    }
  };
  const live = async (id: string, ms: number) => {
    stream = id;
    await goLive(core, id, at(ms));
  };
  const v2 = async (enabled = true) => {
    await wheel.setEnabled(CH, enabled);
    await wheel.setMode(CH, 'v2', 'studio');
  };
  const claim = (w = wheel) => w.claimAnimation(CH, 'obs');
  const done = (spinId: string, event: 'completed' | 'failed' = 'completed') =>
    wheel.reportAnimation(spinId, { consumer_id: 'obs', event });
  const credits = () =>
    count(core.db, "wallet_transactions where source = 'sub_wheel'");
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: Error & { code?: string }) => e.code ?? e.message,
    );
  const route = loyaltyRoutes(core.loyalty, {
    service: wheel,
    channelId: CH,
  }).find((r) => r.pattern.test('/v1/bot/loyalty/events'))!;
  const post = (e: LoyaltyEvent) =>
    route.handle({ params: [], body: e, url: new URL('http://core') });
  const staff = (id: string, grants: string[]) =>
    core.db.query(
      `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, grants)
       values ($1, $2, 'moderator', 'test', $3, $4)`,
      [CH, id, T0, grants],
    );
  const status = async (spinId: string) =>
    (
      await core.db.query<{ status: string }>(
        'select status from sw_spins where spin_id = $1',
        [spinId],
      )
    )[0]!.status;
  const at0 = (ms: number) => core.clock.set(at(ms));
  return {
    core,
    wheel,
    wheelOn,
    reading,
    live,
    v2,
    claim,
    done,
    credits,
    code,
    post,
    staff,
    status,
    at0,
    draws: () => draws,
    receive: (e: AlertEventInput) => wheel.fromAlert(e, null),
  };
}

describe('Roue du Sub V2 — R3: automatic draws', () => {
  it('a sub in live is a right (not drawn at reception); the next wheel draws it once the viewer is present: one gain, one credit', async () => {
    const f = await fixture();
    await f.v2();
    await f.live('s1', 0);
    const right = (await f.receive(notice('9501', 1_000)))!;
    expect(right).toMatchObject({
      status: 'owed',
      segment: null,
      right: { queue: 'auto' },
    });
    expect(f.draws()).toBe(0);
    await f.reading(['9501'], 30_000);
    f.at0(40_000);
    const { spin } = await f.claim();
    expect(spin).toMatchObject({
      spin_id: right.spin_id,
      segment: SEGMENT,
      amount: subWheelAmount(7, 1, SEGMENT),
    });
    expect(await f.status(right.spin_id)).toBe('playing');
    expect(await f.credits()).toBe(1);
    // One wheel at a time: nothing else while it plays.
    expect((await f.claim()).spin).toBeNull();
    await f.done(right.spin_id);
    expect(await f.status(right.spin_id)).toBe('shown');
    expect((await f.claim()).spin).toBeNull();
    expect(f.draws()).toBe(1);
    expect(await f.credits()).toBe(1);
  });

  it('never drawn without every condition: wheel off, no live, viewer absent or unknown, alert still playing (< 20 s)', async () => {
    const f = await fixture();
    await f.v2(false);
    await f.live('s1', 0);
    const r = (await f.receive(notice('9501', 1_000)))!;
    await f.reading(['9501'], 30_000);
    f.at0(40_000);
    // Wheel off: paused.
    expect((await f.claim()).spin).toBeNull();
    await f.wheel.setEnabled(CH, true);
    // Absent: a fresh reading without the viewer.
    await f.reading([], 7 * MIN);
    f.at0(7 * MIN + 1_000);
    expect((await f.wheel.rights(CH))[0]).toMatchObject({
      presence: 'absent',
    });
    expect((await f.claim()).spin).toBeNull();
    // Unknown: no ok reading for 5 min.
    f.at0(20 * MIN);
    expect((await f.wheel.rights(CH))[0]).toMatchObject({
      presence: 'unknown',
    });
    expect((await f.claim()).spin).toBeNull();
    // No live (the stream ended): kept, never drawn.
    await f.reading(['9501'], 21 * MIN);
    await endLive(f.core, at(22 * MIN));
    expect((await f.claim()).spin).toBeNull();
    expect(await f.status(r.spin_id)).toBe('owed');
    expect(f.draws()).toBe(0);
  });

  it('the alert first: a right linked to an alert still queued waits up to 20 s', async () => {
    const f = await fixture();
    await f.v2();
    await f.live('s1', 0);
    const alerts = (await import('../src/alerts/service.js')).AlertsService;
    const a = new alerts(f.core.db, f.core.clock, () => 0);
    const e = notice('9501', 1_000);
    const { alert } = await a.receive(e);
    const r = (await f.wheel.fromAlert(e, alert!.alert_id))!;
    await f.reading(['9501'], 2_000);
    f.at0(5_000);
    expect((await f.claim()).spin).toBeNull();
    f.at0(1_000 + SUB_WHEEL.afterAlertMaxMs + 1);
    expect((await f.claim()).spin?.spin_id).toBe(r.spin_id);
  });

  it('queue order (acquired first) and requests before the automatic queue', async () => {
    const f = await fixture();
    await f.v2();
    await f.live('s1', 0);
    const ids: string[] = [];
    for (const [i, v] of ['9501', '9502', '9503'].entries()) {
      f.at0(i * 1_000);
      ids.push((await f.receive(notice(v, i * 1_000)))!.spin_id);
    }
    await f.reading(['9501', '9502', '9503'], 30_000);
    f.at0(40_000);
    await f.wheel.requestDraw(ids[2]!, studio);
    const order: string[] = [];
    for (let k = 0; k < 3; k++) {
      const { spin } = await f.claim();
      order.push(spin!.spin_id);
      await f.done(spin!.spin_id);
    }
    expect(order).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('the automatic queue is kept from one live to the next (R-3); a right acquired off live is manual', async () => {
    const f = await fixture();
    await f.v2();
    await f.live('s1', 0);
    const r = (await f.receive(notice('9501', 1_000)))!;
    await endLive(f.core, at(60 * MIN));
    // Off live: a manual right, never drawn automatically.
    f.at0(2 * DAY);
    const m = (await f.receive(notice('9502', 2 * DAY)))!;
    expect(m.right.queue).toBe('manual');
    await f.live('s2', 3 * DAY);
    await f.reading(['9501', '9502'], 3 * DAY + MIN);
    f.at0(3 * DAY + 2 * MIN);
    expect((await f.claim()).spin?.spin_id).toBe(r.spin_id);
    await f.done(r.spin_id);
    expect((await f.claim()).spin).toBeNull();
    expect(await f.status(m.spin_id)).toBe('owed');
    // Asked: drawn even off live (a human decided; the player is there).
    await endLive(f.core, at(3 * DAY + 3 * MIN));
    await f.wheel.requestDraw(m.spin_id, studio);
    expect((await f.claim()).spin?.spin_id).toBe(m.spin_id);
  });
});

/** A viewer with month 5 certain; a subscribe (estimate 6) kept owed; its share 2 days later (certain 6). */
async function conflict(f: Awaited<ReturnType<typeof fixture>>, v: string) {
  await f.wheel.setEnabled(CH, true);
  await f.wheel.setMode(CH, 'v1', 'studio');
  await f.receive(notice(v, -40 * DAY, { months: 5 }));
  await f.wheel.setMode(CH, 'v2', 'studio');
  await f.post({
    type: 'sub',
    eventId: randomUUID(),
    occurredAt: iso(0),
    viewer: { twitchUserId: v, login: `v${v}`, displayName: `V${v}` },
    tier: 't1',
    isGift: false,
  });
  await f.post({
    type: 'resub',
    eventId: randomUUID(),
    occurredAt: iso(2 * DAY),
    viewer: { twitchUserId: v, login: `v${v}`, displayName: `V${v}` },
    tier: 't1',
    cumulativeMonths: 6,
  });
  const [suspect] = await f.core.db.query<{ spin_id: string }>(
    "select spin_id from sw_spin_reviews where status = 'open' order by id desc limit 1",
  );
  return suspect!.spin_id;
}

describe('Roue du Sub V2 — R3: rights under review', () => {
  it('a suspect right never heads the automatic queue nor blocks the next ones; no error', async () => {
    const f = await fixture();
    await f.live('s1', -1 * MIN);
    const suspect = await conflict(f, '9501');
    // Make the suspect auto, at the head of the queue.
    await f.core.db.query(
      "update sw_spins set queue = 'auto', acquired_at = $2 where spin_id = $1",
      [suspect, at(-DAY)],
    );
    f.at0(2 * DAY + MIN);
    const next = (await f.receive(notice('9502', 2 * DAY + MIN)))!;
    await f.reading(['9501', '9502'], 2 * DAY + 2 * MIN);
    f.at0(2 * DAY + 3 * MIN);
    const drawn: string[] = [];
    for (let k = 0; k < 4; k++) {
      const { spin } = await f.claim();
      if (!spin) break;
      drawn.push(spin.spin_id);
      await f.done(spin.spin_id);
    }
    expect(drawn).not.toContain(suspect);
    expect(drawn).toContain(next.spin_id);
    expect(await f.status(suspect)).toBe('owed');
  });

  it('filtered in the selection SQL itself: neither queue ever lists a right under review', async () => {
    const f = await fixture();
    await f.live('s1', -1 * MIN);
    const suspect = await conflict(f, '9501');
    await f.core.db.query(
      "update sw_spins set queue = 'auto', status = 'owed' where spin_id = $1",
      [suspect],
    );
    await f.reading(['9501'], 2 * DAY);
    const { autoRights, requestedRights } =
      await import('../src/sub-wheel/draws.js');
    const listed = async () =>
      f.core.db.tx(async (q) => [
        ...(await autoRights(q, CH, at(2 * DAY + MIN), 'tracked')),
        ...(await requestedRights(q, CH, at(2 * DAY + MIN), 'tracked')),
      ]);
    expect((await listed()).map((c) => c.spin_id)).not.toContain(suspect);
    await f.core.db.query(
      "update sw_spins set status = 'requested', requested_at = $2 where spin_id = $1",
      [suspect, at(0)],
    );
    expect((await listed()).map((c) => c.spin_id)).not.toContain(suspect);
    // Closed review (a human: two distinct months): listed again.
    await f.core.db.query(
      "update sw_spin_reviews set status = 'distinct' where spin_id = $1",
      [suspect],
    );
    expect((await listed()).map((c) => c.spin_id)).toContain(suspect);
  });

  it('no path draws it: « Tirer » refused, a request made before the review is skipped, draw() refused', async () => {
    const f = await fixture();
    const suspect = await conflict(f, '9501');
    expect(await f.code(f.wheel.requestDraw(suspect, studio))).toBe(
      'needs_review',
    );
    // Requested before the conflict appeared (a second viewer): stays requested, never drawn.
    const g = await fixture();
    await g.wheel.setEnabled(CH, true);
    await g.receive(notice('9601', -40 * DAY, { months: 5 }));
    await g.wheel.setMode(CH, 'v2', 'studio');
    const v = { twitchUserId: '9601', login: 'v9601', displayName: 'V9601' };
    await g.post({
      type: 'sub',
      eventId: randomUUID(),
      occurredAt: iso(0),
      viewer: v,
      tier: 't1',
      isGift: false,
    });
    const [sub] = await g.core.db.query<{ spin_id: string }>(
      "select spin_id from sw_spins where status = 'owed'",
    );
    await g.wheel.requestDraw(sub!.spin_id, studio);
    await g.post({
      type: 'resub',
      eventId: randomUUID(),
      occurredAt: iso(2 * DAY),
      viewer: v,
      tier: 't1',
      cumulativeMonths: 6,
    });
    expect(await g.status(sub!.spin_id)).toBe('requested');
    expect(
      await count(
        g.core.db,
        `sw_spin_reviews where spin_id = '${sub!.spin_id}'`,
      ),
    ).toBe(1);
    const { spin } = await g.claim();
    expect(spin?.spin_id).not.toBe(sub!.spin_id);
    expect(await g.status(sub!.spin_id)).toBe('requested');
    expect(await g.code(g.wheel.drawRight(sub!.spin_id))).toBe('needs_review');
  });
});

describe('Roue du Sub V2 — R3: permissions and grants', () => {
  it('« Tirer »: broadcaster, supermod, a moderator granted subWheelDraw; never another moderator or a viewer — audited', async () => {
    const f = await fixture();
    await f.v2();
    const ids: string[] = [];
    for (const v of ['9501', '9502', '9503', '9504'])
      ids.push((await f.receive(notice(v, 0)))!.spin_id);
    await f.staff('7001', ['subWheelDraw']);
    await f.staff('7002', ['subWheelGrant']);
    await f.core.db.query(
      `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at) values ($1, '7003', 'supermod', 'test', $2)`,
      [CH, T0],
    );
    expect(await f.code(f.wheel.requestDraw(ids[0]!, mod('7002')))).toBe(
      'forbidden',
    );
    expect(await f.code(f.wheel.requestDraw(ids[0]!, mod('7004')))).toBe(
      'forbidden',
    );
    expect(
      await f.code(
        f.wheel.requestDraw(ids[0]!, {
          id: '9999',
          role: 'viewer',
          via: 'extension',
        }),
      ),
    ).toBe('forbidden');
    expect((await f.wheel.requestDraw(ids[0]!, mod('7001'))).status).toBe(
      'requested',
    );
    expect((await f.wheel.requestDraw(ids[1]!, mod('7003'))).status).toBe(
      'requested',
    );
    expect((await f.wheel.requestDraw(ids[2]!, studio)).status).toBe(
      'requested',
    );
    // Idempotent: asked again, nothing more.
    await f.wheel.requestDraw(ids[2]!, studio);
    const audit = await f.core.db.query<{ actor: string; role: string }>(
      "select actor, role from lab_moderation_audit where action = 'sw_draw_request' order by id",
    );
    expect(audit).toEqual([
      { actor: 'mod7001', role: 'moderator' },
      { actor: 'mod7003', role: 'supermod' },
      { actor: 'studio:studio', role: 'broadcaster' },
    ]);
    expect(f.draws()).toBe(0);
  });

  it('« Accorder un tour »: subWheelGrant only; a manual right, real gain once asked and drawn; the same key is the same right', async () => {
    const f = await fixture();
    await f.v2();
    await f.staff('7001', ['subWheelDraw']);
    await f.staff('7002', ['subWheelGrant']);
    const g = {
      key: randomUUID(),
      viewer: { id: '9501', name: 'V9501' },
      tier: 2 as const,
      months: 12,
      note: 'tour perdu le 20/10',
    };
    expect(await f.code(f.wheel.grant(CH, mod('7001'), g))).toBe('forbidden');
    const right = await f.wheel.grant(CH, mod('7002'), g);
    expect(right).toMatchObject({
      source: 'manual',
      status: 'owed',
      months: 12,
      tier: 2,
      right: { queue: 'manual', sub_month: null, month_source: null },
    });
    expect((await f.wheel.grant(CH, mod('7002'), g)).spin_id).toBe(
      right.spin_id,
    );
    expect(
      await f.code(
        f.wheel.grant(CH, mod('7002'), {
          ...g,
          viewer: { id: '9502', name: 'X' },
        }),
      ),
    ).toBe('grant_key_reused');
    expect(await count(f.core.db, "sw_spins where source = 'manual'")).toBe(1);
    // Not drawn until asked (a grantor without « Tirer » cannot draw it).
    expect((await f.claim()).spin).toBeNull();
    expect(await f.code(f.wheel.requestDraw(right.spin_id, mod('7002')))).toBe(
      'forbidden',
    );
    await f.wheel.requestDraw(right.spin_id, mod('7001'));
    const { spin } = await f.claim();
    expect(spin).toMatchObject({
      spin_id: right.spin_id,
      amount: subWheelAmount(12, 2, SEGMENT),
    });
    expect(await f.credits()).toBe(1);
    expect((await f.core.wallet.wallet.getWallet('9501'))?.balance).toBe(
      subWheelAmount(12, 2, SEGMENT),
    );
    expect(
      await count(f.core.db, "lab_moderation_audit where action = 'sw_grant'"),
    ).toBe(1);
    // Shown: announced in chat like a sub's gain, once (a test or a simulation never is).
    f.core.clock.set(new Date(f.core.clock.now().getTime() + 12_000));
    await f.done(right.spin_id);
    await f.done(right.spin_id);
    const said = await f.core.db.query<{ params: { text: string } }>(
      "select params from cmd_steps where origin = 'sub_wheel'",
    );
    expect(said).toHaveLength(1);
    expect(said[0]!.params.text).toMatch(
      /^🎡 @V9501 remporte [\d \u00a0\u202f]+ jetons à la Roue du Sub !$/,
    );
  });
});

describe('Roue du Sub V2 — R3: player incidents and restarts', () => {
  async function oneRight() {
    const f = await fixture();
    await f.v2();
    await f.live('s1', 0);
    const r = (await f.receive(notice('9501', 1_000)))!;
    await f.reading(['9501'], 30_000);
    f.at0(40_000);
    return { f, r };
  }

  it('a failed animation keeps the gain decided; the right is never drawn again', async () => {
    const { f, r } = await oneRight();
    const { spin } = await f.claim();
    await f.done(spin!.spin_id, 'failed');
    expect(await f.status(r.spin_id)).toBe('failed');
    expect((await f.claim()).spin).toBeNull();
    expect(f.draws()).toBe(1);
    expect(await f.credits()).toBe(1);
  });

  it('the player vanishes (lease expired): failed, the gain kept, the queue moves on', async () => {
    const { f, r } = await oneRight();
    await f.claim();
    const other = (await f.receive(notice('9502', 45_000)))!;
    await f.reading(['9501', '9502'], 50_000);
    f.at0(40_000 + SUB_WHEEL.animationLeaseMs + 1);
    const { spin } = await f.claim();
    expect(await f.status(r.spin_id)).toBe('failed');
    expect(spin?.spin_id).toBe(other.spin_id);
    expect(await f.credits()).toBe(2);
  });

  it('a crash during the claim keeps the right owed, nothing credited; the next claim draws it once', async () => {
    const { f, r } = await oneRight();
    const crashing: Db = {
      ...f.core.db,
      tx: (fn) =>
        f.core.db.tx((q) =>
          fn({
            query: (sql, params) => {
              if (/insert into wallet_transactions/.test(sql))
                throw new Error('connection lost');
              return q.query(sql, params);
            },
          }),
        ),
    };
    await expect(f.claim(f.wheelOn(crashing))).rejects.toThrow(
      'connection lost',
    );
    expect(await f.status(r.spin_id)).toBe('owed');
    expect(await f.credits()).toBe(0);
    const { spin } = await f.claim();
    expect(spin?.spin_id).toBe(r.spin_id);
    expect(await f.credits()).toBe(1);
  });

  it('a claim committed but its answer lost: the gain stays decided, never a second draw', async () => {
    const { f, r } = await oneRight();
    const lost: Db = {
      ...f.core.db,
      tx: async (fn) => {
        await f.core.db.tx(fn);
        throw new Error('connection reset after COMMIT');
      },
    };
    await expect(f.claim(f.wheelOn(lost))).rejects.toThrow('after COMMIT');
    expect(await f.status(r.spin_id)).toBe('playing');
    f.at0(40_000 + SUB_WHEEL.animationLeaseMs + 1);
    expect((await f.claim()).spin).toBeNull();
    expect(await f.status(r.spin_id)).toBe('failed');
    expect(f.draws()).toBe(1);
    expect(await f.credits()).toBe(1);
  });
});

describe('Roue du Sub V2 — R3: v1 / v2_acquire unchanged', () => {
  it('outside v2 the wheel never draws a kept right (owed or requested): only V1 spins are shown', async () => {
    for (const mode of ['v1', 'v2_acquire'] as const) {
      const f = await fixture();
      await f.wheel.setEnabled(CH, false);
      await f.wheel.setMode(CH, 'v2_acquire', 'studio');
      await f.live('s1', 0);
      const kept = (await f.receive(notice('9501', 1_000)))!;
      await f.wheel.requestDraw(kept.spin_id, studio);
      await f.wheel.setMode(CH, mode, 'studio');
      await f.wheel.setEnabled(CH, true);
      await f.reading(['9501'], 30_000);
      f.at0(40_000);
      expect((await f.claim()).spin).toBeNull();
      // A V1 spin (new notice) is drawn and shown exactly as before.
      const v1 = (await f.receive(notice('9502', 41_000)))!;
      expect(v1.status).toBe('queued');
      f.at0(41_000 + SUB_WHEEL.afterAlertMaxMs + 1);
      expect((await f.claim()).spin?.spin_id).toBe(v1.spin_id);
      expect(await f.status(kept.spin_id)).toBe('requested');
    }
  });
});

describe('Roue du Sub V2 — R4: « À vérifier » decided, « Possible doublon »', () => {
  const reviewOf = async (
    f: Awaited<ReturnType<typeof fixture>>,
    spinId: string,
  ) =>
    (
      await f.core.db.query<{
        id: number;
        status: string;
        other_spin_id: string;
      }>(
        'select id, status, other_spin_id from sw_spin_reviews where spin_id = $1',
        [spinId],
      )
    )[0]!;

  it('distinct: the blocked right is drawable again, never reviewed again (either way round) — audited', async () => {
    const f = await fixture();
    const suspect = await conflict(f, '9501');
    const v = await reviewOf(f, suspect);
    expect(
      await f.wheel.resolveReview(v.id, studio, 'distinct', 'deux mois réels'),
    ).toEqual({ review_id: v.id, status: 'distinct' });
    expect((await f.wheel.requestDraw(suspect, studio)).status).toBe(
      'requested',
    );
    // A later proof of the pair (a recheck) never reopens it.
    await f.core.db.query(
      "update sw_spins set status = 'shown', segment = 0, amount = 200 where spin_id = $1",
      [suspect],
    );
    const { flagSameMonth } = await import('../src/sub-wheel/review.js');
    const other = (
      await f.core.db.query<Record<string, unknown>>(
        'select * from sw_spins where spin_id = $1',
        [v.other_spin_id],
      )
    )[0]!;
    await f.core.db.tx((q) => flagSameMonth(q, other as never, at(3 * DAY)));
    expect(await count(f.core.db, 'sw_spin_reviews')).toBe(1);
    expect(
      (
        await f.core.db.query<{
          actor: string;
          reason: string;
          after: unknown;
        }>(
          "select actor, reason, after from lab_moderation_audit where action = 'sw_review_distinct'",
        )
      )[0],
    ).toMatchObject({ actor: 'studio:studio', reason: 'deux mois réels' });
  });

  it('merge: the duplicate never drawn nor credited, its row and proofs kept; refused once drawn or credited', async () => {
    const f = await fixture();
    const suspect = await conflict(f, '9501');
    const v = await reviewOf(f, suspect);
    const proofs = await count(
      f.core.db,
      `sw_spin_sources where spin_id = '${suspect}'`,
    );
    await f.wheel.resolveReview(v.id, studio, 'merge', 'même renouvellement');
    const row = (
      await f.core.db.query<Record<string, unknown>>(
        'select status, merged_into, award_status, segment from sw_spins where spin_id = $1',
        [suspect],
      )
    )[0];
    expect(row).toEqual({
      status: 'merged',
      merged_into: v.other_spin_id,
      award_status: 'none',
      segment: null,
    });
    expect(
      await count(f.core.db, `sw_spin_sources where spin_id = '${suspect}'`),
    ).toBe(proofs);
    expect(await f.code(f.wheel.requestDraw(suspect, studio))).toBe('not_owed');
    expect(await f.code(f.wheel.drawRight(suspect))).toBe('not_owed');
    expect(
      await f.code(f.wheel.resolveReview(v.id, studio, 'distinct', 'x')),
    ).toBe('review_closed');
    expect(await f.credits()).toBe(1); // the V1 history only
    // A blocked right that already owes a gain (drawn by a path before the review): never merged.
    const g = await fixture();
    const s2 = await conflict(g, '9601');
    await g.core.db.query(
      "update sw_spins set award_status = 'pending', segment = 0, amount = 200 where spin_id = $1",
      [s2],
    );
    expect(
      await g.code(
        g.wheel.resolveReview((await reviewOf(g, s2)).id, studio, 'merge', 'x'),
      ),
    ).toBe('not_mergeable');
  });

  it('unresolved: stays blocked (idempotent), decided later; only subWheelGrant decides', async () => {
    const f = await fixture();
    const suspect = await conflict(f, '9501');
    const v = await reviewOf(f, suspect);
    await f.staff('7001', ['subWheelDraw']);
    await f.staff('7002', ['subWheelGrant']);
    expect(
      await f.code(f.wheel.resolveReview(v.id, mod('7001'), 'distinct', 'x')),
    ).toBe('forbidden');
    await f.wheel.resolveReview(v.id, mod('7002'), 'unresolved', 'à revoir');
    await f.wheel.resolveReview(v.id, mod('7002'), 'unresolved', 'à revoir');
    expect((await reviewOf(f, suspect)).status).toBe('unresolved');
    expect(await f.code(f.wheel.requestDraw(suspect, studio))).toBe(
      'needs_review',
    );
    expect((await f.wheel.state(CH)).reviews).toHaveLength(1);
    await f.wheel.resolveReview(v.id, mod('7002'), 'distinct', 'vérifié');
    expect((await f.wheel.state(CH)).reviews).toHaveLength(0);
    expect(
      await count(
        f.core.db,
        "lab_moderation_audit where action like 'sw_review_%'",
      ),
    ).toBe(2);
  });

  it('« Possible doublon »: an estimate and another right less than 28 days apart, no review — listed, never blocked', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    await f.receive(notice('9501', -40 * DAY, { months: 5 }));
    await f.wheel.setMode(CH, 'v2', 'studio');
    const v = { twitchUserId: '9501', login: 'v9501', displayName: 'V9501' };
    // A subscribe estimated 6, then its share 3 days later carrying month 8 (months 6–7 unseen): two months, no review.
    await f.post({
      type: 'sub',
      eventId: randomUUID(),
      occurredAt: iso(0),
      viewer: v,
      tier: 't1',
      isGift: false,
    });
    await f.post({
      type: 'resub',
      eventId: randomUUID(),
      occurredAt: iso(3 * DAY),
      viewer: v,
      tier: 't1',
      cumulativeMonths: 8,
    });
    expect(await count(f.core.db, 'sw_spin_reviews')).toBe(0);
    const [d] = await f.wheel.possibleDuplicates(CH);
    expect(d).toMatchObject({
      viewer_id: '9501',
      days_apart: 3,
      a: { sub_month: 6, month_source: 'estimated', status: 'owed' },
      b: { sub_month: 8, month_source: 'twitch', status: 'owed' },
    });
    // Nothing blocked: both drawable.
    const owed = await f.core.db.query<{ spin_id: string }>(
      "select spin_id from sw_spins where status = 'owed'",
    );
    for (const r of owed)
      expect((await f.wheel.requestDraw(r.spin_id, studio)).status).toBe(
        'requested',
      );
    // Two certain months, or 28 days apart and more: never listed.
    const g = await fixture();
    await g.wheel.setMode(CH, 'v2', 'studio');
    const w = { twitchUserId: '9601', login: 'v9601', displayName: 'V9601' };
    await g.post({
      type: 'resub',
      eventId: randomUUID(),
      occurredAt: iso(0),
      viewer: w,
      tier: 't1',
      cumulativeMonths: 6,
    });
    await g.post({
      type: 'resub',
      eventId: randomUUID(),
      occurredAt: iso(DAY),
      viewer: w,
      tier: 't1',
      cumulativeMonths: 7,
    });
    await g.post({
      type: 'sub',
      eventId: randomUUID(),
      occurredAt: iso(30 * DAY),
      viewer: w,
      tier: 't1',
      isGift: false,
    });
    expect(await g.wheel.possibleDuplicates(CH)).toEqual([]);
  });
});

describe('Roue du Sub V2 — RV2-1: the winner announcements', () => {
  it('a live sub, a caught-up tour (acquired wheel OFF and off live, drawn later) and a granted one: ONE short announcement each, after the channel delay; replays and tests: nothing more', async () => {
    const f = await fixture();
    await f.v2();
    await f.wheel.setAnnounceDelay(CH, 12, 'studio');
    // Caught up: the wheel OFF and no live when the sub came — kept, owed, manual.
    await f.wheel.setEnabled(CH, false);
    const caught = (await f.receive(notice('9601', 0)))!;
    expect(caught).toMatchObject({
      status: 'owed',
      right: { queue: 'manual' },
    });
    await f.wheel.setEnabled(CH, true);
    // A sub in live (automatic queue) and a tour granted from Studio.
    await f.live('s1', MIN);
    const sub = (await f.receive(notice('9602', MIN + 1_000)))!;
    await f.staff('7002', ['subWheelGrant']);
    const granted = await f.wheel.grant(CH, mod('7002'), {
      key: randomUUID(),
      viewer: { id: '9603', name: 'V9603' },
      tier: 1,
      months: 3,
      note: 'tour perdu (test)',
    });
    await f.wheel.requestDraw(caught.spin_id, studio);
    await f.wheel.requestDraw(granted.spin_id, studio);
    await f.reading(['9602'], MIN + 30_000);
    f.at0(MIN + 40_000);
    const ends: Record<string, number> = {};
    for (let i = 0; i < 3; i++) {
      const { spin } = await f.claim();
      expect(spin).not.toBeNull();
      f.at0(MIN + 60_000 + i * 20_000);
      ends[spin!.spin_id] = f.core.clock.now().getTime();
      await f.done(spin!.spin_id);
      await f.done(spin!.spin_id); // the same end reported again
    }
    expect(Object.keys(ends).sort()).toEqual(
      [caught.spin_id, sub.spin_id, granted.spin_id].sort(),
    );
    // A Studio test: never announced.
    await f.wheel.test(CH, { name: 'Antoni', months: 3 });
    const t = await f.claim();
    await f.done(t.spin!.spin_id);
    const said = await f.core.db.query<{
      idempotency_key: string;
      available_at: Date;
      params: { text: string };
    }>(
      "select idempotency_key, available_at, params from cmd_steps where origin = 'sub_wheel' order by idempotency_key",
    );
    expect(said).toHaveLength(3);
    for (const [spinId, end] of Object.entries(ends)) {
      const one = said.filter(
        (x) => x.idempotency_key === `sub_wheel:win:${spinId}`,
      );
      expect(one).toHaveLength(1);
      expect(new Date(one[0]!.available_at).getTime()).toBe(end + 12_000);
    }
    expect(said.map((x) => x.params.text).sort()).toEqual(
      ['9601', '9602', '9603'].map((v) =>
        expect.stringMatching(
          new RegExp(
            `^🎡 @V${v} remporte [\\d \\u00a0\\u202f]+ jetons? à la Roue du Sub !$`,
          ),
        ),
      ),
    );
  });
});
