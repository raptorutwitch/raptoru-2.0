import type { AlertEventInput } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { alertsRoutes } from '../src/http/alerts-routes.js';
import {
  ALERT_RULES,
  AlertsService,
  playLeaseMs,
} from '../src/alerts/service.js';
import { ALERT_VARIANTS } from '../src/alerts/variants.js';
import type { Db } from '../src/db/db.js';
import { createTestDb, FakeClock } from './helpers.js';

// Twitch alerts V1 (A1) — the durable queue with the real test database: deduplication, variant drawn once, priority,
// one alert in flight per channel, atomic claim, lease / ACK, restart, no economy.

const CH = '900800';
const T0 = new Date('2026-10-16T23:30:00Z');

let db: Db;
let clock: FakeClock;
let rolls: number[];
let alerts: AlertsService;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  rolls = [];
  alerts = new AlertsService(db, clock, () => rolls.shift() ?? 0);
});

let n = 0;
const ev = (over: Partial<AlertEventInput> = {}): AlertEventInput => ({
  channel_id: CH,
  source: 'simulation',
  source_event_id: `e-${++n}`,
  type: 'follow',
  actor: { id: '1', login: 'alice', display_name: 'Alice' },
  ...over,
});
const count = async (table: string) =>
  Number(
    (await db.query<{ n: string }>(`select count(*) as n from ${table}`))[0]!.n,
  );
const ack = (
  id: string,
  attempt: string,
  event: 'started' | 'completed' | 'failed',
  consumer = 'studio-A',
) => alerts.ack(id, { consumer_id: consumer, attempt_id: attempt, event });

describe('reception', () => {
  it('a redelivered event (same source + id) creates nothing more', async () => {
    const first = await alerts.receive(ev({ source_event_id: 'tw-1' }));
    const again = await alerts.receive(ev({ source_event_id: 'tw-1' }));
    expect(first.outcome).toBe('queued');
    expect(again).toMatchObject({
      outcome: 'duplicate',
      alert: { alert_id: first.alert!.alert_id },
    });
    expect(await count('alert_items')).toBe(1);
    // Same id from another source is another event.
    expect(
      (await alerts.receive(ev({ source_event_id: 'tw-1', source: 'twitch' })))
        .outcome,
    ).toBe('queued');
  });

  it('absorbed community recipients and small bits make no alert but are recorded', async () => {
    expect(
      (
        await alerts.receive(
          ev({ type: 'gift_recipient', community_gift_id: 'c1' }),
        )
      ).outcome,
    ).toBe('absorbed');
    expect((await alerts.receive(ev({ type: 'bits', bits: 5 }))).outcome).toBe(
      'below_threshold',
    );
    expect(await count('alert_items')).toBe(0);
    expect(await count('alert_events')).toBe(2);
  });

  it('a community gift and its recipients: one alert only', async () => {
    await alerts.receive(
      ev({ type: 'gift_community', count: 5, community_gift_id: 'c9' }),
    );
    for (let i = 0; i < 5; i++)
      await alerts.receive(
        ev({
          type: 'gift_recipient',
          community_gift_id: 'c9',
          recipient: { display_name: `r${i}` },
        }),
      );
    const state = await alerts.state(CH);
    expect(state.queued.map((a) => a.variant_id)).toEqual(['subgift_5']);
  });

  it('the variant is drawn once and frozen with the alert (restart: same variant, no new draw)', async () => {
    rolls = [80.5 / 81]; // Discord
    const { alert } = await alerts.receive(ev());
    expect(alert!.variant_id).toBe('follow_discord');
    const restarted = new AlertsService(db, clock, () => 0); // would pick Dofus Ébène
    expect((await restarted.get(alert!.alert_id)).variant_id).toBe(
      'follow_discord',
    );
    expect((await restarted.claim(CH, 'studio-B'))!.variant).toMatchObject({
      video: 'Alerte follow Discord monsieur.webm',
    });
  });

  it('raid and simulated donation are queued (hors live: no session needed)', async () => {
    const raid = await alerts.receive(ev({ type: 'raid', viewers: 30 }));
    expect(raid.alert).toMatchObject({
      variant_id: 'raid_default',
      data: { viewers: 30 },
    });
    const don = await alerts.receive(
      ev({
        type: 'donation',
        amount: { value: 500, decimal_place: 2, currency: 'EUR' },
        message: 'merci',
      }),
    );
    expect(don.alert).toMatchObject({
      variant_id: 'don_moneytest',
      data: { amount: '5.00', currency: 'EUR', message: 'merci' },
    });
  });
});

describe('queue', () => {
  it('priority first (gift 20 > donation > sub > bits > follow), then arrival order', async () => {
    await alerts.receive(ev({ type: 'follow' }));
    await alerts.receive(ev({ type: 'bits', bits: 100 }));
    await alerts.receive(ev({ type: 'sub' }));
    await alerts.receive(
      ev({
        type: 'donation',
        amount: { value: 1, decimal_place: 0, currency: 'EUR' },
      }),
    );
    await alerts.receive(ev({ type: 'gift_community', count: 25 }));
    await alerts.receive(
      ev({ type: 'follow', source_event_id: 'late-follow' }),
    );
    const order: string[] = [];
    for (;;) {
      const a = await alerts.claim(CH, 'studio-A');
      if (!a) break;
      order.push(a.variant_id);
      await ack(a.alert_id, a.attempt_id!, 'started');
      await ack(a.alert_id, a.attempt_id!, 'completed');
    }
    expect(order).toEqual([
      'subgift_20',
      'don_moneytest',
      'eren_sub',
      'bits_default',
      'follow_dofus_ebene',
      'follow_dofus_ebene',
    ]);
  });

  it('one alert in flight per channel; two consumers at once: one gets it', async () => {
    await alerts.receive(ev());
    await alerts.receive(ev());
    const [a, b] = await Promise.all([
      alerts.claim(CH, 'studio-A'),
      alerts.claim(CH, 'studio-B'),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await alerts.claim(CH, 'studio-A')).toBeNull(); // still in flight
    const other = await alerts.claim('900801', 'studio-A');
    expect(other).toBeNull(); // another channel: its own queue (empty)
  });

  it('transmitted is not completed: completed only on the player’s report', async () => {
    await alerts.receive(ev());
    const a = (await alerts.claim(CH, 'studio-A'))!;
    expect(a.status).toBe('claimed');
    const playing = await ack(a.alert_id, a.attempt_id!, 'started');
    expect(playing.status).toBe('playing');
    const done = await ack(a.alert_id, a.attempt_id!, 'completed');
    expect(done.status).toBe('completed');
    expect(await ack(a.alert_id, a.attempt_id!, 'completed')).toMatchObject({
      status: 'completed',
    }); // idempotent
    await expect(
      ack(a.alert_id, a.attempt_id!, 'failed'),
    ).rejects.toMatchObject({
      code: 'alert_ended',
    });
  });

  it('another consumer or attempt cannot report on the alert', async () => {
    await alerts.receive(ev());
    const a = (await alerts.claim(CH, 'studio-A'))!;
    await expect(
      ack(a.alert_id, a.attempt_id!, 'started', 'studio-B'),
    ).rejects.toMatchObject({ status: 409, code: 'attempt_mismatch' });
  });

  it('player failure: failed, kept for diagnosis, not replayed', async () => {
    await alerts.receive(ev());
    const a = (await alerts.claim(CH, 'studio-A'))!;
    const f = await alerts.ack(a.alert_id, {
      consumer_id: 'studio-A',
      attempt_id: a.attempt_id!,
      event: 'failed',
      error: 'video-error',
    });
    expect(f).toMatchObject({
      status: 'failed',
      failure: { code: 'player_failed', message: 'video-error' },
    });
    expect(await alerts.claim(CH, 'studio-A')).toBeNull();
  });
});

describe('lease and recovery', () => {
  it('claimed but never started (Studio crashed): offered again, at most 3 attempts, then expired', async () => {
    await alerts.receive(ev());
    for (let i = 1; i <= ALERT_RULES.maxAttempts; i++) {
      const a = (await alerts.claim(CH, `studio-${i}`))!;
      expect(a.attempts).toBe(i);
      clock.advance(ALERT_RULES.claimLeaseMs + 1);
    }
    expect(await alerts.claim(CH, 'studio-X')).toBeNull();
    const state = await alerts.state(CH);
    expect(state.recent[0]).toMatchObject({
      status: 'expired',
      failure: { code: 'never_started' },
    });
  });

  it('started then silent past its lease: expired, never replayed; a late report is refused', async () => {
    await alerts.receive(ev({ type: 'sub' }));
    await alerts.receive(ev());
    const a = (await alerts.claim(CH, 'studio-A'))!;
    await ack(a.alert_id, a.attempt_id!, 'started');
    clock.advance(playLeaseMs(ALERT_VARIANTS.eren_sub!) + 1);
    const next = (await alerts.claim(CH, 'studio-A'))!;
    expect(next.type).toBe('follow'); // the sub is not handed out again
    expect((await alerts.get(a.alert_id)).status).toBe('expired');
    await expect(
      ack(a.alert_id, a.attempt_id!, 'completed'),
    ).rejects.toMatchObject({
      code: 'alert_ended',
    });
  });

  it('restart: waiting alerts are preserved, in flight ones keep their lease', async () => {
    await alerts.receive(ev());
    await alerts.receive(ev());
    const a = (await alerts.claim(CH, 'studio-A'))!;
    const restarted = new AlertsService(db, clock);
    const state = await restarted.state(CH);
    expect(state.in_flight.map((x) => x.alert_id)).toEqual([a.alert_id]);
    expect(state.queued).toHaveLength(1);
  });

  it('play lease: media length or last timing, plus the margin', () => {
    expect(playLeaseMs(ALERT_VARIANTS.subgift_1!)).toBe(6341 + 15_000);
    expect(playLeaseMs(ALERT_VARIANTS.don_moneytest!)).toBe(7600 + 15_000);
    expect(playLeaseMs(ALERT_VARIANTS.raid_default!)).toBe(19_916 + 15_000);
  });
});

describe('isolation', () => {
  it('alerts never touch the economy (no wallet, no ledger, no loyalty)', async () => {
    await alerts.receive(ev({ type: 'sub' }));
    await alerts.receive(ev({ type: 'bits', bits: 500 }));
    await alerts.receive(
      ev({
        type: 'donation',
        amount: { value: 1000, decimal_place: 2, currency: 'EUR' },
      }),
    );
    const a = (await alerts.claim(CH, 'studio-A'))!;
    await ack(a.alert_id, a.attempt_id!, 'started');
    await ack(a.alert_id, a.attempt_id!, 'completed');
    expect(await count('lab_wallets')).toBe(0);
    expect(await count('lab_wallet_ledger')).toBe(0);
    expect(await count('wallet_transactions')).toBe(0);
  });

  it('the catalogue route lists every variant (preview, no queue access)', async () => {
    const get = alertsRoutes(alerts).find((r) =>
      r.pattern.test('/v1/lab/alerts/catalog'),
    )!;
    const out = (await get.handle({
      params: [],
      body: undefined,
      url: new URL('http://x/v1/lab/alerts/catalog'),
    })) as { variants: { id: string }[] };
    expect(out.variants.map((v) => v.id)).toHaveLength(14);
    expect(await count('alert_items')).toBe(0);
  });

  it('routes validate the event contract', async () => {
    const post = alertsRoutes(alerts).find((r) =>
      r.pattern.test('/v1/lab/alerts/events'),
    )!;
    await expect(
      post.handle({
        params: [],
        body: { channel_id: CH, type: 'follow' },
        url: new URL('http://x/v1/lab/alerts/events'),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await post.handle({
        params: [],
        body: ev(),
        url: new URL('http://x/v1/lab/alerts/events'),
      }),
    ).toMatchObject({ outcome: 'queued' });
  });
});
