import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import {
  type AlertEventInput,
  SUB_WHEEL,
  subWheelAmount,
  subWheelLayout,
} from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { AlertsService } from '../src/alerts/service.js';
import { createLabCore } from '../src/bonk-lab/lab-core.js';
import { systemClock } from '../src/clock.js';
import { migrate } from '../src/db/migrate.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { createPgliteDb, setup } from './helpers.js';

// Roue du Sub (docs/SUB_WHEEL.md) — Core: the legacy layouts and gains, one wheel per sub / resub / Prime (never a
// gift), the dedup on the logical event (the alert event, redeliveries included), the switch OFF (recorded « ignored »),
// the result decided before any animation, the wheels after their sub alert, one at a time, never redrawn, the gains
// recorded pending and only settled explicitly (manual / cancelled / an economy adapter, once).

const CH = '83603689';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

const event = (over: Partial<AlertEventInput> = {}): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: '9001', login: 'viewer', display_name: 'Viewer' },
  tier: '1000',
  months: 7,
  ...over,
});

async function fixture(draw?: (n: number) => number) {
  const core = await setup();
  core.clock.set(new Date('2026-10-18T20:00:00Z'));
  const alerts = new AlertsService(core.db, core.clock, () => 0);
  const wheel = new SubWheelService(core.db, core.clock, draw);
  /** As the alerts route does: the alert, then the wheel (also on a duplicate). */
  const receive = async (e: AlertEventInput) => {
    const r = await alerts.receive(e);
    return { ...r, spin: await wheel.fromAlert(e, r.alert?.alert_id ?? null) };
  };
  return { core, alerts, wheel, receive };
}

describe('Roue du Sub — legacy rules', () => {
  it('layouts by months (1–3, 4–11, 12–19, 20+) and gain = value × multiplier × tier (exactly the legacy page)', () => {
    expect(subWheelLayout(1).map((s) => s.val)).toEqual([
      200, 300, 500, 750, 1000, 1500, 2000, 5000,
    ]);
    expect(subWheelLayout(3)).toEqual(subWheelLayout(0));
    expect(subWheelLayout(4)).toHaveLength(10);
    expect(subWheelLayout(4)[9]).toEqual({ val: 1500, mult: 2 });
    expect(subWheelLayout(11)).toEqual(subWheelLayout(4));
    expect(subWheelLayout(12)).toHaveLength(12);
    expect(subWheelLayout(12)[11]).toEqual({ val: 2000, mult: 3 });
    expect(subWheelLayout(20)[10]).toEqual({ val: 50000, mult: 1 });
    expect(subWheelLayout(20)[11]).toEqual({ val: 5000, mult: 5 });
    expect(subWheelAmount(25, 3, 10)).toBe(150_000); // the biggest gain: 50 000 × T3
    expect(subWheelAmount(12, 2, 3)).toBe(6000); // 1500 ×2 × T2
    expect(subWheelAmount(1, 1, 0)).toBe(200);
    expect(() => subWheelAmount(1, 1, 8)).toThrow('segment_out_of_range');
  });
});

describe('Roue du Sub — admission (one wheel per logical event)', () => {
  it('switch OFF by default: a real sub is recorded « ignored », nothing drawn, nothing owed', async () => {
    const { receive, wheel } = await fixture();
    const r = await receive(event());
    expect(r.outcome).toBe('queued');
    expect(r.spin).toMatchObject({
      status: 'ignored',
      reason: 'disabled',
      segment: null,
      amount: null,
      award: { status: 'none' },
    });
    expect((await wheel.state(CH)).pending_awards).toEqual({
      count: 0,
      total: 0,
    });
  });

  it('switch ON: sub, resub, Prime spin once, drawn and recorded before any animation; gifts never; tier and months', async () => {
    const draws: number[] = [];
    const { receive, wheel } = await fixture((n) => {
      draws.push(n);
      return n - 1;
    });
    await wheel.setEnabled(CH, true);
    // A new sub: its first month (Twitch duration_months is a bundle length, not the loyalty).
    const sub = await receive(event({ type: 'sub', tier: '2000', months: 3 }));
    expect(sub.spin).toMatchObject({
      type: 'sub',
      tier: 2,
      months: 1,
      status: 'queued',
      segment: 7,
      amount: 10_000,
      award: { status: 'pending' },
    });
    const resub = await receive(event({ months: 12, tier: '3000' }));
    expect(resub.spin).toMatchObject({
      months: 12,
      tier: 3,
      segment: 11,
      amount: 18_000,
    });
    const prime = await receive(event({ tier: 'prime', months: 25 }));
    expect(prime.spin).toMatchObject({ tier: 1, months: 25, amount: 25_000 });
    expect(draws).toEqual([8, 12, 12]);
    for (const type of [
      'gift_targeted',
      'gift_community',
      'gift_recipient',
    ] as const)
      expect((await receive(event({ type, count: 5 }))).spin).toBeNull();
    // An alerts-tab simulation never spins the wheel.
    expect((await receive(event({ source: 'simulation' }))).spin).toBeNull();
    expect((await wheel.state(CH)).pending_awards).toEqual({
      count: 3,
      total: 53_000,
    });
  });

  it('EventSub redelivery (same message id): the same alert, the same spin — never a second draw nor a second gain', async () => {
    let calls = 0;
    const { alerts, receive, wheel } = await fixture(() => {
      calls += 1;
      return 0;
    });
    await wheel.setEnabled(CH, true);
    const e = event();
    const first = await receive(e);
    const again = await receive(e);
    expect(again.outcome).toBe('duplicate');
    expect(again.spin!.spin_id).toBe(first.spin!.spin_id);
    expect((await wheel.state(CH)).recent).toHaveLength(1);
    expect(calls).toBe(2); // drawn twice in memory, kept once: the insert of the redelivery does nothing
    // The first reception lost its wheel (failure after the alert committed): the redelivery makes it.
    const lost = event();
    await alerts.receive(lost); // the alert committed, the wheel never asked
    const r1 = await receive(lost);
    expect(r1.outcome).toBe('duplicate');
    expect(r1.spin).toMatchObject({ status: 'queued' });
  });
});

describe('Roue du Sub — animations (after the sub alert, one at a time, never redrawn)', () => {
  it('waits for its alert; one at a time, in order; the result travels with it; reported shown', async () => {
    const { core, alerts, receive, wheel } = await fixture(() => 2);
    await wheel.setEnabled(CH, true);
    const a = await receive(event({ actor: { display_name: 'A' } }));
    const b = await receive(
      event({ actor: { display_name: 'B' }, months: 13 }),
    );
    // The sub alert of A is still waiting: no wheel yet.
    expect(await wheel.claimAnimation(CH, 'studio-1')).toEqual({ spin: null });
    const claimed = await alerts.claim(CH, 'player-1');
    const ack = { consumer_id: 'player-1', attempt_id: claimed!.attempt_id! };
    await alerts.ack(claimed!.alert_id, { ...ack, event: 'started' });
    await alerts.ack(claimed!.alert_id, { ...ack, event: 'completed' });
    const first = await wheel.claimAnimation(CH, 'studio-1');
    expect(first.spin).toMatchObject({
      spin_id: a.spin!.spin_id,
      name: 'A',
      layout: subWheelLayout(7),
      segment: 2,
      amount: 500,
    });
    expect(await wheel.claimAnimation(CH, 'studio-1')).toEqual({ spin: null });
    await expect(
      wheel.reportAnimation(a.spin!.spin_id, {
        consumer_id: 'other',
        event: 'completed',
      }),
    ).rejects.toMatchObject({ code: 'not_current_consumer' });
    expect(
      await wheel.reportAnimation(a.spin!.spin_id, {
        consumer_id: 'studio-1',
        event: 'completed',
      }),
    ).toEqual({ status: 'shown' });
    // B's alert never ended (alerts source absent): its wheel goes after SUB_WHEEL.afterAlertMaxMs.
    expect(await wheel.claimAnimation(CH, 'studio-1')).toEqual({ spin: null });
    core.clock.advance(SUB_WHEEL.afterAlertMaxMs + 1);
    expect((await wheel.claimAnimation(CH, 'studio-1')).spin).toMatchObject({
      spin_id: b.spin!.spin_id,
      amount: subWheelAmount(13, 1, 2),
    });
  });

  it('Studio lost during the wheel: failed, the gain unchanged, never redrawn; too late: skipped; a failed animation keeps its gain', async () => {
    const { core, receive, wheel } = await fixture(() => 1);
    await wheel.setEnabled(CH, true);
    const s = await receive(event());
    core.clock.advance(SUB_WHEEL.afterAlertMaxMs + 1);
    await wheel.claimAnimation(CH, 'studio-1');
    core.clock.advance(SUB_WHEEL.animationLeaseMs + 1);
    const st = await wheel.state(CH);
    expect(st.recent[0]).toMatchObject({
      spin_id: s.spin!.spin_id,
      status: 'failed',
      reason: 'animation_not_confirmed',
      segment: 1,
      amount: 300,
      award: { status: 'pending' },
    });
    expect(await wheel.claimAnimation(CH, 'studio-1')).toEqual({ spin: null });
    const late = await receive(event());
    core.clock.advance(SUB_WHEEL.animationMaxAgeMs + 1);
    expect(await wheel.claimAnimation(CH, 'studio-1')).toEqual({ spin: null });
    expect(
      (await wheel.state(CH)).recent.find(
        (r) => r.spin_id === late.spin!.spin_id,
      ),
    ).toMatchObject({
      status: 'skipped',
      award: { status: 'pending' },
    });
  });
});

describe('Roue du Sub — tests and gains', () => {
  it('Studio tests never owe a gain (switch OFF too); a test gain cannot be settled', async () => {
    const { wheel } = await fixture(() => 0);
    const t = await wheel.test(CH, { name: 'Raptoru_', tier: 3, months: 20 });
    expect(t).toMatchObject({
      source: 'test',
      status: 'queued',
      tier: 3,
      months: 20,
      amount: 3000,
      award: { status: 'test' },
    });
    await expect(
      wheel.settleByHand(t.spin_id, { status: 'manual', note: 'x' }),
    ).rejects.toMatchObject({ code: 'award_not_pending' });
  });

  it('a pending gain: marked credited by hand or cancelled (noted), or credited ONCE by an economy adapter', async () => {
    const { receive, wheel } = await fixture(() => 4);
    await wheel.setEnabled(CH, true);
    const a = await receive(event());
    const b = await receive(event());
    const c = await receive(event());
    expect(
      await wheel.settleByHand(a.spin!.spin_id, {
        status: 'manual',
        note: 'crédité sur StreamElements à 21:10',
      }),
    ).toMatchObject({
      award: { status: 'manual', note: 'crédité sur StreamElements à 21:10' },
    });
    await wheel.settleByHand(b.spin!.spin_id, {
      status: 'cancelled',
      note: 'doublon',
    });
    const keys: string[] = [];
    let fail = true;
    const port = {
      award: async (x: { key: string; amount: number }) => {
        keys.push(`${x.key}=${x.amount}`);
        if (fail) throw new Error('adapter down');
        return { ref: 'wallet-op-1' };
      },
    };
    await expect(wheel.attribute(c.spin!.spin_id, port)).rejects.toThrow(
      'adapter down',
    );
    expect((await wheel.state(CH)).pending_awards.count).toBe(1);
    fail = false;
    expect(await wheel.attribute(c.spin!.spin_id, port)).toMatchObject({
      award: { status: 'awarded', ref: 'wallet-op-1' },
    });
    await expect(wheel.attribute(c.spin!.spin_id, port)).rejects.toMatchObject({
      code: 'award_not_pending',
    });
    await expect(wheel.attribute(a.spin!.spin_id, port)).rejects.toMatchObject({
      code: 'award_not_pending',
    });
    // The same idempotency key both times: an adapter that saw the first call never credits twice.
    expect(keys).toEqual([
      `sub_wheel:${c.spin!.spin_id}=1000`,
      `sub_wheel:${c.spin!.spin_id}=1000`,
    ]);
  });
});

describe('Roue du Sub — through the Lab Core routes', () => {
  it('a Twitch sub posted to the alerts route makes its alert and its wheel; a full Studio test goes through the alerts queue', async () => {
    const db = createPgliteDb(
      new PGlite({
        parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
      }),
    );
    await migrate(db, 'lab');
    const secret = randomBytes(32).toString('hex');
    const server = createLabCore({ db, clock: systemClock, secret }).server;
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    closers.push(async () => {
      server.close();
      await db.close();
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (path: string, body?: unknown) => {
      const res = await fetch(url + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    await call(`/v1/lab/sub-wheel/${CH}/settings`, { enabled: true });
    const e = event();
    await call('/v1/lab/alerts/events', e);
    await call('/v1/lab/alerts/events', e);
    const t = await call(`/v1/lab/sub-wheel/${CH}/test`, {
      full: true,
      name: 'Test',
      months: 4,
    });
    expect(t).toMatchObject({
      source: 'simulation',
      type: 'resub',
      months: 4,
      award: { status: 'test' },
    });
    const s = await call(`/v1/lab/sub-wheel/${CH}/state`);
    expect(s.recent).toHaveLength(2);
    expect(s.pending_awards).toMatchObject({ count: 1 });
    const al = await call(`/v1/lab/alerts/${CH}/state`);
    expect(al.queued.length).toBe(2);
  });

  it('migrations: production = Lab for the wheel tables', async () => {
    const fresh = () =>
      createPgliteDb(
        new PGlite({
          parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
        }),
      );
    const shape = async (d: ReturnType<typeof fresh>) => ({
      cols: await d.query(
        `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
         where table_name in ('sw_settings', 'sw_spins') order by 1, 2`,
      ),
      checks: await d.query(
        `select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
         where conrelid::regclass::text in ('sw_settings', 'sw_spins') order by 1, 2`,
      ),
      idx: await d.query(
        `select indexname, indexdef from pg_indexes where tablename in ('sw_settings', 'sw_spins') order by 1`,
      ),
    });
    const prod = fresh();
    const lab = fresh();
    closers.push(
      () => prod.close(),
      () => lab.close(),
    );
    await migrate(prod, 'prod');
    await migrate(lab, 'lab');
    const p = await shape(prod);
    expect(p.cols.length).toBe(28);
    expect(p).toEqual(await shape(lab));
  });
});
