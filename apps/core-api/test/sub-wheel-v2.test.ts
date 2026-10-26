import { randomUUID } from 'node:crypto';
import { type AlertEventInput, subWheelAmount } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import type { AlertsService } from '../src/alerts/service.js';
import type { Db } from '../src/db/db.js';
import { subWheelRoutes } from '../src/http/sub-wheel-routes.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import type { SwEvidence } from '../src/sub-wheel/rights.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { count, goLive, setup } from './helpers.js';

// Roue du Sub V2, lot R1 (docs/SUB_WHEEL_V2_PLAN.md § 12): rights, proofs, certain / estimated months, modes v1 and
// v2_acquire, draw() as the only V2 draw. PGlite (one connection: the concurrency is proven on real Postgres in
// sub-wheel-v2.integration.test.ts). Test DB only, canonical Wallet.

const CH = '83603689';
const V = '9301';
const SEGMENT = 3;
const T0 = new Date('2026-10-21T20:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms).toISOString();

const notice = (over: Partial<AlertEventInput> = {}): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: V, login: 'viewer', display_name: 'Viewer' },
  tier: '1000',
  months: 7,
  occurred_at: at(0),
  ...over,
});
const subscribe = (over: Partial<SwEvidence> = {}): SwEvidence => ({
  channelId: CH,
  source: 'subscribe',
  sourceEventId: randomUUID(),
  occurredAt: at(0),
  viewer: { id: V, login: 'viewer', name: 'Viewer' },
  type: 'sub',
  tier: 1,
  months: null,
  isGift: false,
  ...over,
});

async function fixture() {
  const core = await setup();
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
  const receive = (e: AlertEventInput, w = wheel) => w.fromAlert(e, null);
  const credits = () =>
    count(core.db, "wallet_transactions where source = 'sub_wheel'");
  const tokens = async (id = V) =>
    (await core.wallet.wallet.getWallet(id))?.balance ?? 0;
  const rows = () =>
    core.db.query<Record<string, unknown>>(
      'select * from sw_spins order by created_at, spin_id',
    );
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: Error & { code?: string }) => e.code ?? e.message,
    );
  return {
    core,
    wheel,
    wheelOn,
    receive,
    credits,
    tokens,
    rows,
    code,
    draws: () => draws,
  };
}

describe('Roue du Sub V2 — R1', () => {
  it('mode v1 by default; every mode change is audited (v2 available since R3)', async () => {
    const f = await fixture();
    expect(await f.wheel.settings(CH)).toMatchObject({
      enabled: false,
      mode: 'v1',
      recovery_enabled: false,
    });
    await f.wheel.setEnabled(CH, true);
    expect(await f.wheel.setMode(CH, 'v2_acquire', 'studio')).toMatchObject({
      enabled: true,
      mode: 'v2_acquire',
    });
    expect(await f.wheel.setMode(CH, 'v2', 'studio')).toMatchObject({
      mode: 'v2',
    });
    const audit = await f.core.db.query<{
      before: unknown;
      after: unknown;
    }>(
      "select before, after from lab_moderation_audit where module_id = 'sub_wheel' and action = 'sw_mode'",
    );
    expect(audit).toEqual([
      { before: { mode: 'v1' }, after: { mode: 'v2_acquire' } },
      { before: { mode: 'v2_acquire' }, after: { mode: 'v2' } },
    ]);
  });

  it('production route: the audit names the Studio installation that switched the mode', async () => {
    const f = await fixture();
    const route = subWheelRoutes(f.wheel, {} as AlertsService, {
      channelId: CH,
    }).find((r) => r.pattern.test(`/v1/studio/sub-wheel/${CH}/mode`))!;
    expect(route.auth).toBe('studio_installation');
    const installation = randomUUID();
    await route.handle({
      params: [CH],
      body: { mode: 'v2_acquire' },
      installation,
      url: new URL('http://core'),
    });
    expect(
      await f.core.db.query(
        "select actor, role from lab_moderation_audit where action = 'sw_mode'",
      ),
    ).toEqual([{ actor: `installation:${installation}`, role: 'broadcaster' }]);
  });

  it('P1 — v1: the V1 spin unchanged (same draw, same gain, one credit, same key), plus its proof and its month', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    const viewers = Array.from({ length: 30 }, (_, i) => `93${i}`);
    for (const [i, id] of viewers.entries()) {
      const e = notice({
        actor: { id, login: `v${i}`, display_name: `V${i}` },
        type: i % 3 ? 'resub' : 'sub',
        months: i % 3 ? 2 + i : undefined,
        tier: i % 5 === 0 ? '3000' : '1000',
      });
      const spin = (await f.receive(e))!;
      const months = i % 3 ? 2 + i : 1;
      const tier = i % 5 === 0 ? 3 : 1;
      expect(spin).toMatchObject({
        status: 'queued',
        months,
        tier,
        segment: SEGMENT,
        amount: subWheelAmount(months, tier, SEGMENT),
        award: { status: 'awarded' },
      });
      expect(spin.right).toMatchObject(
        i % 3
          ? { sub_month: months, month_source: 'twitch', queue: null }
          : { sub_month: 1, month_source: 'estimated_no_history' },
      );
      // The same event again: the same spin, no draw, no credit.
      expect((await f.receive(e))!.spin_id).toBe(spin.spin_id);
    }
    // V1 draws its segment before the insert, a redelivery included (thrown away, as today): 2 × 30.
    expect(f.draws()).toBe(60);
    expect(await f.credits()).toBe(30);
    expect(await count(f.core.db, 'sw_spin_sources')).toBe(30);
    const keys = await f.core.db.query<{ key: string; event_key: string }>(
      `select o.idempotency_key as key, s.event_key from wallet_transactions t
       join wallet_operations o on o.id = t.operation_id join sw_spins s on s.spin_id::text = t.reference`,
    );
    for (const k of keys) {
      expect(k.key).toMatch(/^move:sub_wheel:/);
      expect(k.event_key).toMatch(/^alert:twitch:/);
    }
  });

  it('P1 — v1, wheel OFF: ignored as today (nothing drawn, nothing owed), its month kept as history', async () => {
    const f = await fixture();
    const spin = (await f.receive(notice()))!;
    expect(spin).toMatchObject({
      status: 'ignored',
      reason: 'disabled',
      segment: null,
      amount: null,
      award: { status: 'none' },
      right: { sub_month: 7, month_source: 'twitch' },
    });
    expect(f.draws()).toBe(0);
    // A later sub (Twitch time after it) estimates from that history.
    const next = (await f.receive(
      notice({
        type: 'sub',
        months: undefined,
        occurred_at: at(30 * 86_400_000),
      }),
    ))!;
    expect(next.right).toMatchObject({
      sub_month: 8,
      month_source: 'estimated',
    });
  });

  it('v2_acquire, wheel OFF: the right is kept owed (manual off live, auto in live), never drawn', async () => {
    const f = await fixture();
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    const off = (await f.receive(notice()))!;
    expect(off).toMatchObject({
      status: 'owed',
      segment: null,
      amount: null,
      award: { status: 'none' },
      right: { queue: 'manual', sub_month: 7, month_source: 'twitch' },
    });
    await goLive(f.core, 'live-1', T0);
    const live = (await f.receive(
      notice({ actor: { id: '9302', display_name: 'B' } }),
    ))!;
    expect(live.right.queue).toBe('auto');
    expect(f.draws()).toBe(0);
    expect(await f.credits()).toBe(0);
    expect((await f.wheel.state(CH)).rights).toEqual({ auto: 1, manual: 1 });
  });

  it('v2_acquire, wheel ON: a new notice is drawn at once like V1, through draw() (same gain, same key)', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    const spin = (await f.receive(notice({ type: 'sub', months: undefined })))!;
    expect(spin).toMatchObject({
      status: 'queued',
      months: 1, // the V1 layout of a sub
      segment: SEGMENT,
      amount: subWheelAmount(1, 1, SEGMENT),
      award: { status: 'awarded' },
      right: { sub_month: 1, month_source: 'estimated_no_history' },
    });
    expect(spin.right.drawn_at).not.toBeNull();
    expect(await f.tokens()).toBe(subWheelAmount(1, 1, SEGMENT));
  });

  it('P2 — v2_acquire: subscribe + notice of the same renewal, both orders → one right, one draw, one credit', async () => {
    for (const subscribeFirst of [true, false]) {
      const f = await fixture();
      await f.wheel.setEnabled(CH, true);
      await f.wheel.setMode(CH, 'v2_acquire', 'studio');
      const n = notice({ occurred_at: at(2_000) });
      const s = subscribe({ occurredAt: at(0) });
      if (subscribeFirst) {
        expect((await f.wheel.acquire(s))!.status).toBe('owed');
        await f.receive(n);
      } else {
        await f.receive(n);
        await f.wheel.acquire(s);
      }
      expect(await count(f.core.db, 'sw_spins')).toBe(1);
      expect(await count(f.core.db, 'sw_spin_sources')).toBe(2);
      expect(f.draws()).toBe(1);
      expect(await f.credits()).toBe(1);
      expect((await f.rows())[0]).toMatchObject({
        sub_month: 7,
        month_source: 'twitch',
        status: 'queued',
      });
    }
  });

  it('P3 — a right V1 (or v2_acquire) already drew is refused by draw() (not_owed): one credit', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    const v1 = (await f.receive(notice()))!;
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    const v2 = (await f.receive(
      notice({ actor: { id: '9302', display_name: 'B' } }),
    ))!;
    for (const id of [v1.spin_id, v2.spin_id])
      expect(await f.code(f.wheel.drawRight(id))).toBe('not_owed');
    expect(f.draws()).toBe(2);
    expect(await f.credits()).toBe(2);
    // An owed right is drawn once; a second draw() is refused.
    await f.wheel.setEnabled(CH, false);
    const owed = (await f.receive(
      notice({ actor: { id: '9303', display_name: 'C' } }),
    ))!;
    expect(owed.status).toBe('owed');
    expect((await f.wheel.drawRight(owed.spin_id)).status).toBe('queued');
    expect(await f.code(f.wheel.drawRight(owed.spin_id))).toBe('not_owed');
    expect(await f.credits()).toBe(3);
  });

  it('P4 — v2_acquire → v1: a kept right is drawn by its notice, never a second right; a redelivery draws nothing', async () => {
    const f = await fixture();
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    // Wheel off in v2_acquire: the notice keeps an owed right.
    const n = notice();
    const owed = (await f.receive(n))!;
    expect(owed.status).toBe('owed');
    await f.wheel.setMode(CH, 'v1', 'studio');
    await f.wheel.setEnabled(CH, true);
    // The same notice redelivered in v1: its right, no draw (a redelivery never draws).
    expect((await f.receive(n))!).toMatchObject({
      spin_id: owed.spin_id,
      status: 'owed',
      award: { status: 'none' },
    });
    expect(await f.credits()).toBe(0);
    // A subscribe kept in v2_acquire, then its notice arrives in v1: the notice draws THAT right.
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    await f.wheel.setEnabled(CH, false);
    const s = (await f.wheel.acquire(
      subscribe({
        viewer: { id: '9302', login: 'b', name: 'B' },
        occurredAt: at(0),
      }),
    ))!;
    await f.wheel.setEnabled(CH, true);
    await f.wheel.setMode(CH, 'v1', 'studio');
    const drawn = (await f.receive(
      notice({
        actor: { id: '9302', display_name: 'B' },
        occurred_at: at(5_000),
      }),
    ))!;
    expect(drawn).toMatchObject({ spin_id: s.spin_id, status: 'queued' });
    expect(await count(f.core.db, "sw_spins where viewer_id = '9302'")).toBe(1);
    expect(await f.credits()).toBe(1);
    // In v1 a subscribe makes no right (V1 alone decides): it joins the right of its renewal, else stays orphan.
    expect((await f.wheel.acquire(subscribe()))!.spin_id).toBe(owed.spin_id);
    const alone = subscribe({ viewer: { id: '9309', login: 'z', name: 'Z' } });
    expect(await f.wheel.acquire(alone)).toBeNull();
    expect(
      await count(
        f.core.db,
        "sw_spin_sources where spin_id is null and viewer_id = '9309'",
      ),
    ).toBe(1);
    expect(await count(f.core.db, "sw_spins where viewer_id = '9309'")).toBe(0);
  });

  it('defect A — a resub message WITHOUT months and its chat notice, both orders, both modes: one right', async () => {
    for (const mode of ['v1', 'v2_acquire'] as const)
      for (const messageFirst of [true, false]) {
        const f = await fixture();
        await f.wheel.setEnabled(CH, true);
        await f.wheel.setMode(CH, mode, 'studio');
        const n = notice({ occurred_at: at(1_000) });
        const m = subscribe({
          source: 'message',
          type: 'resub',
          months: null,
          occurredAt: at(0),
        });
        if (messageFirst) {
          await f.wheel.acquire(m);
          await f.receive(n);
        } else {
          await f.receive(n);
          await f.wheel.acquire(m);
        }
        expect(await count(f.core.db, 'sw_spins')).toBe(1);
        expect(
          await count(f.core.db, 'sw_spin_sources where spin_id is not null'),
        ).toBe(2);
        expect(f.draws()).toBe(1);
        expect(await f.credits()).toBe(1);
        expect((await f.rows())[0]).toMatchObject({
          months: 7,
          sub_month: 7,
          month_source: 'twitch',
        });
        // Redelivered: still one right, one credit.
        await f.wheel.acquire(m);
        await f.receive(n);
        expect(await count(f.core.db, 'sw_spins')).toBe(1);
        expect(await f.credits()).toBe(1);
      }
  });

  it('defect A — subscribe + message + notice of one renewal, every order: one right (v2_acquire)', async () => {
    const orders = [
      ['s', 'm', 'n'],
      ['s', 'n', 'm'],
      ['m', 's', 'n'],
      ['m', 'n', 's'],
      ['n', 's', 'm'],
      ['n', 'm', 's'],
    ];
    for (const order of orders) {
      const f = await fixture();
      await f.wheel.setEnabled(CH, true);
      await f.wheel.setMode(CH, 'v2_acquire', 'studio');
      const steps = {
        s: () => f.wheel.acquire(subscribe({ occurredAt: at(0) })),
        m: () =>
          f.wheel.acquire(
            subscribe({
              source: 'message',
              type: 'resub',
              months: null,
              occurredAt: at(2_000),
            }),
          ),
        n: () => f.receive(notice({ occurred_at: at(1_000) })),
      };
      for (const k of order) await steps[k as 's' | 'm' | 'n']();
      expect(await count(f.core.db, 'sw_spins')).toBe(1);
      expect(await count(f.core.db, 'sw_spin_sources')).toBe(3);
      expect(await f.credits()).toBe(1);
    }
  });

  it('defect B — a notice drawing an estimated right uses the V1 wheel (sub: 1 month), never the estimate', async () => {
    const f = await fixture();
    // History: a certain month 5, so a later subscribe is estimated month 6 (wheel 4–11).
    await f.wheel.setEnabled(CH, true);
    await f.receive(notice({ months: 5, occurred_at: at(-40 * 86_400_000) }));
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    await f.wheel.setEnabled(CH, false);
    const kept = (await f.wheel.acquire(subscribe({ occurredAt: at(0) })))!;
    expect(kept).toMatchObject({
      status: 'owed',
      months: 6,
      right: { sub_month: 6, month_source: 'estimated' },
    });
    await f.wheel.setEnabled(CH, true);
    for (const mode of ['v2_acquire', 'v1'] as const) {
      await f.wheel.setMode(CH, mode, 'studio');
      const viewer = mode === 'v1' ? '9310' : V;
      if (mode === 'v1') {
        // The same story in v1 (a right kept in v2_acquire, its Prime « sub » notice arriving in v1).
        await f.wheel.setMode(CH, 'v2_acquire', 'studio');
        await f.wheel.setEnabled(CH, false);
        await f.receive(
          notice({
            actor: { id: viewer, display_name: 'W' },
            months: 5,
            occurred_at: at(-40 * 86_400_000),
          }),
        );
        await f.wheel.acquire(
          subscribe({ viewer: { id: viewer, login: 'w', name: 'W' } }),
        );
        await f.wheel.setEnabled(CH, true);
        await f.wheel.setMode(CH, 'v1', 'studio');
      }
      const spin = (await f.receive(
        notice({
          actor: { id: viewer, display_name: 'W' },
          type: 'sub',
          months: undefined,
          occurred_at: at(3_000),
        }),
      ))!;
      expect(spin).toMatchObject({
        status: 'queued',
        months: 1,
        segment: SEGMENT,
        amount: subWheelAmount(1, 1, SEGMENT),
        right: { sub_month: 6, month_source: 'estimated' },
      });
    }
  });

  it('orphan proofs (v1): taken by the chat notice of their renewal, never a right after a switch to v2_acquire', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    // v1: subscribe and message arrive before their notice: orphans, no right.
    const s = subscribe({ occurredAt: at(0) });
    const m = subscribe({
      source: 'message',
      type: 'resub',
      months: 7,
      occurredAt: at(500),
    });
    expect(await f.wheel.acquire(s)).toBeNull();
    expect(await f.wheel.acquire(m)).toBeNull();
    expect(await count(f.core.db, 'sw_spins')).toBe(0);
    const spin = (await f.receive(notice({ occurred_at: at(1_000) })))!;
    expect(
      await count(
        f.core.db,
        `sw_spin_sources where spin_id = '${spin.spin_id}'`,
      ),
    ).toBe(3);
    expect(f.draws()).toBe(1);
    // An orphan whose notice never came: after a switch to v2_acquire, its redelivery makes no right.
    const lost = subscribe({
      viewer: { id: '9320', login: 'l', name: 'L' },
      occurredAt: at(0),
    });
    expect(await f.wheel.acquire(lost)).toBeNull();
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    expect(await f.wheel.acquire(lost)).toBeNull();
    expect(await count(f.core.db, "sw_spins where viewer_id = '9320'")).toBe(0);
    // A different certain month is never adopted; a far-away proof neither.
    const other = subscribe({
      viewer: { id: '9321', login: 'o', name: 'O' },
      source: 'message',
      type: 'resub',
      months: 3,
      occurredAt: at(0),
    });
    await f.wheel.setMode(CH, 'v1', 'studio');
    await f.wheel.acquire(other);
    await f.wheel.acquire(
      subscribe({
        viewer: { id: '9321', login: 'o', name: 'O' },
        occurredAt: at(-20 * 60_000),
      }),
    );
    await f.receive(
      notice({
        actor: { id: '9321', display_name: 'O' },
        months: 4,
        occurred_at: at(1_000),
      }),
    );
    expect(
      await count(
        f.core.db,
        "sw_spin_sources where viewer_id = '9321' and spin_id is null",
      ),
    ).toBe(2);
    expect(await f.credits()).toBe(2);
  });

  it('P6 — every source redelivered 3× in every order, 3 h late: no new right, no new credit', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    const n = notice({ occurred_at: at(1_000) });
    const s = subscribe({ occurredAt: at(0) });
    const m = subscribe({
      source: 'message',
      type: 'resub',
      months: 7,
      occurredAt: at(3_000),
    });
    await f.receive(n);
    await f.wheel.acquire(s);
    await f.wheel.acquire(m);
    f.core.clock.set(new Date(T0.getTime() + 3 * 3_600_000));
    for (let k = 0; k < 3; k++)
      for (const step of [
        () => f.wheel.acquire(m),
        () => f.receive(n),
        () => f.wheel.acquire(s),
        () => f.receive(n, f.wheelOn()),
      ])
        await step();
    expect(await count(f.core.db, 'sw_spins')).toBe(1);
    expect(await count(f.core.db, 'sw_spin_sources')).toBe(3);
    expect(f.draws()).toBe(1);
    expect(await f.credits()).toBe(1);
  });

  it('P7 — subscribe alone (estimated) then its notice: 8 s → one right confirmed; 15 min → two rights', async () => {
    for (const [delay, rights] of [
      [8_000, 1],
      [15 * 60_000, 2],
    ] as const) {
      const f = await fixture();
      await f.wheel.setMode(CH, 'v2_acquire', 'studio');
      const kept = (await f.wheel.acquire(subscribe()))!;
      expect(kept.right).toMatchObject({
        sub_month: 1,
        month_source: 'estimated_no_history',
      });
      f.core.clock.set(new Date(T0.getTime() + delay));
      await f.receive(notice({ occurred_at: at(delay) }));
      expect(await count(f.core.db, 'sw_spins')).toBe(rights);
      const first = (await f.rows())[0]!;
      if (rights === 1) {
        expect(first).toMatchObject({
          status: 'owed',
          sub_month: 7,
          month_source: 'twitch',
          months: 7,
        });
        expect(first.confirmed_at).not.toBeNull();
      } else
        expect(first).toMatchObject({
          sub_month: 1,
          month_source: 'estimated_no_history',
          confirmed_at: null,
        });
      expect(await f.credits()).toBe(0);
    }
  });

  it('confirmation of a DRAWN estimated right corrects its month only, never its gain', async () => {
    const f = await fixture();
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    const kept = (await f.wheel.acquire(subscribe()))!;
    const drawn = await f.wheel.drawRight(kept.spin_id);
    await f.receive(
      notice({ occurred_at: at(4_000), months: 12, tier: '1000' }),
    );
    const r = (await f.rows())[0]!;
    expect(r).toMatchObject({
      spin_id: kept.spin_id,
      sub_month: 12,
      month_source: 'twitch',
      months: 1,
      segment: drawn.segment,
    });
    expect(Number(r.amount)).toBe(drawn.amount);
    expect(await f.credits()).toBe(1);
  });

  it('P8 — the detector lists a certain month credited twice (read-only)', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    const a = (await f.receive(notice()))!;
    // A historical V1 duplicate (two notices announcing month 7): only possible on rows from before the unique index.
    const b = (await f.receive(
      notice({ source_event_id: randomUUID(), months: 7 }),
    ))!;
    expect(b.right.month_source).not.toBe('twitch');
    const dup = await f.wheel.certainDuplicates(CH);
    expect(dup).toEqual([]); // b's month is not certain: it is not listed as a certain duplicate
    await f.core.db.query(
      "insert into sw_spins (spin_id, channel_id, source, event_key, type, viewer_id, viewer_name, tier, months, status, segment, amount, award_status, created_at, updated_at) values ($1, $2, 'twitch', 'alert:twitch:legacy-dup', 'resub', $3, 'Viewer', 1, 7, 'shown', 0, 200, 'awarded', $4, $4)",
      [randomUUID(), CH, V, new Date(T0.getTime() + 1)],
    );
    const before = await f.rows();
    const found = await f.wheel.certainDuplicates(CH);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      duplicate_of: a.spin_id,
      viewer_id: V,
      month: 7,
      amount: 200,
    });
    expect(await f.rows()).toEqual(before);
    expect(await count(f.core.db, 'sw_recoveries')).toBe(0);
  });

  it('P11 — a crash during draw() keeps nothing (no right, no proof, no credit); the redelivery decides once', async () => {
    const f = await fixture();
    await f.wheel.setEnabled(CH, true);
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
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
    const n = notice();
    await expect(f.receive(n, f.wheelOn(crashing))).rejects.toThrow(
      'connection lost',
    );
    expect(await count(f.core.db, 'sw_spins')).toBe(0);
    expect(await count(f.core.db, 'sw_spin_sources')).toBe(0);
    await f.receive(n);
    expect(await f.credits()).toBe(1);
    expect(await count(f.core.db, 'sw_spins')).toBe(1);
  });

  it('P12 — V1 rows from before R1 are never rewritten (a proof may only be attached)', async () => {
    const f = await fixture();
    const legacy = [
      ['resub', 7, 'shown', 'awarded'],
      ['sub', 1, 'skipped', 'pending'],
      ['resub', 3, 'ignored', 'none'],
    ] as const;
    for (const [i, [type, months, status, award]] of legacy.entries())
      await f.core.db.query(
        `insert into sw_spins (spin_id, channel_id, source, event_key, type, viewer_id, viewer_name, tier, months,
           status, segment, amount, award_status, created_at, updated_at)
         values ($1, $2, 'twitch', $3, $4, $5, 'Viewer', 1, $6, $7, $8, $9, $10, $11, $11)`,
        [
          randomUUID(),
          CH,
          `alert:twitch:legacy-${i}`,
          type,
          V,
          months,
          status,
          status === 'ignored' ? null : 0,
          status === 'ignored' ? null : 200,
          award,
          new Date(T0.getTime() - 86_400_000 * (i + 1)),
        ],
      );
    const before = await f.rows();
    await f.wheel.setEnabled(CH, true);
    // Its redelivery, the same certain month, a subscribe, in both modes.
    await f.receive(
      notice({ source_event_id: 'legacy-0', type: 'resub', months: 7 }),
    );
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    await f.receive(notice({ months: 7 }));
    await f.wheel.acquire(subscribe({ occurredAt: at(1_000) }));
    await f.receive(notice({ months: 8, occurred_at: at(2_000) }));
    const after = await f.rows();
    for (const b of before)
      expect(after.find((a) => a.spin_id === b.spin_id)).toEqual(b);
    // The V1 month 7 kept its right: its redelivery, the second notice of month 7 and the subscribe 1 s later (same
    // renewal) attached to it — no new right, no draw.
    expect(
      await count(
        f.core.db,
        "sw_spin_sources where spin_id = (select spin_id from sw_spins where event_key = 'alert:twitch:legacy-0')",
      ),
    ).toBe(3);
    expect(await f.credits()).toBe(1); // month 8 only
  });

  it('the 10-min sweep counts from the draw, not from the acquisition', async () => {
    const f = await fixture();
    await f.wheel.setMode(CH, 'v2_acquire', 'studio');
    const kept = (await f.receive(notice()))!;
    f.core.clock.set(new Date(T0.getTime() + 3_600_000));
    await f.wheel.drawRight(kept.spin_id);
    await f.wheel.state(CH);
    expect((await f.rows())[0]!.status).toBe('queued');
  });
});
