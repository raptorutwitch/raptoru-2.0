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
  it('inside a family, arrival order only: a later gift 20 never overtakes an earlier sub', async () => {
    await alerts.receive(ev({ type: 'sub' }));
    await alerts.receive(ev({ type: 'gift_community', count: 25 }));
    await alerts.receive(ev({ type: 'gift_targeted' }));
    const order: string[] = [];
    for (;;) {
      const a = await alerts.claim(CH, 'studio-A');
      if (!a) break;
      expect(a.family).toBe('subscription');
      order.push(a.variant_id);
      await ack(a.alert_id, a.attempt_id!, 'started');
      await ack(a.alert_id, a.attempt_id!, 'completed');
    }
    expect(order).toEqual(['eren_sub', 'subgift_20', 'subgift_targeted']);
  });

  it('one alert in flight per family; two consumers at once: one gets it', async () => {
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

describe('families (one FIFO queue each, families side by side)', () => {
  const play = async (consumer = 'studio-A') => {
    const a = await alerts.claim(CH, consumer);
    if (a) await ack(a.alert_id, a.attempt_id!, 'started', consumer);
    return a;
  };
  const done = (a: { alert_id: string; attempt_id: string | null }) =>
    ack(a.alert_id, a.attempt_id!, 'completed');
  const donation = () =>
    ev({
      type: 'donation',
      amount: { value: 500, decimal_place: 2, currency: 'EUR' },
    });

  it('ten follows: strictly one after the other, in arrival order', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++)
      ids.push((await alerts.receive(ev())).alert!.alert_id);
    const played: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (await play())!;
      expect(await alerts.claim(CH, 'studio-A')).toBeNull(); // the next follow waits
      expect((await alerts.state(CH)).in_flight).toHaveLength(1);
      played.push(a.alert_id);
      await done(a);
    }
    expect(played).toEqual(ids);
  });

  it('sub and gifts share one queue (never together); follow and sub play together', async () => {
    await alerts.receive(ev({ type: 'sub' }));
    await alerts.receive(ev({ type: 'gift_targeted' }));
    await alerts.receive(ev({ type: 'follow' }));
    const sub = (await play())!;
    const follow = (await play())!;
    expect([sub.type, follow.type]).toEqual(['sub', 'follow']);
    expect(await alerts.claim(CH, 'studio-A')).toBeNull(); // the gift waits for the sub
    await done(follow);
    expect(await alerts.claim(CH, 'studio-A')).toBeNull(); // still the sub
    await done(sub);
    expect((await play())!.type).toBe('gift_targeted');
  });

  it('follow + sub + bits + raid + donation: five in flight at once, one per family', async () => {
    await alerts.receive(ev({ type: 'follow' }));
    await alerts.receive(ev({ type: 'follow' }));
    await alerts.receive(ev({ type: 'follow' }));
    await alerts.receive(ev({ type: 'sub' }));
    await alerts.receive(ev({ type: 'gift_community', count: 5 }));
    await alerts.receive(ev({ type: 'bits', bits: 100 }));
    await alerts.receive(ev({ type: 'raid', viewers: 3 }));
    await alerts.receive(donation());
    const got = [];
    for (let a = await play(); a; a = await play()) got.push(a);
    expect(got.map((a) => a.family)).toEqual([
      'follow',
      'subscription',
      'bits',
      'raid',
      'donation',
    ]);
    const state = await alerts.state(CH);
    expect(state.in_flight).toHaveLength(5);
    expect(state.queued.map((a) => a.type)).toEqual([
      'follow',
      'follow',
      'gift_community',
    ]);
  });

  it('a follow ending lets the next follow start while the raid keeps playing', async () => {
    await alerts.receive(ev({ type: 'raid', viewers: 3 }));
    await alerts.receive(ev({ type: 'follow' }));
    await alerts.receive(ev({ type: 'follow' }));
    const raid = (await play())!;
    const f1 = (await play())!;
    expect(await alerts.claim(CH, 'studio-A')).toBeNull();
    await done(f1);
    const f2 = (await play())!;
    expect(f2.type).toBe('follow');
    expect((await alerts.get(raid.alert_id)).status).toBe('playing');
  });

  it('a crash in one family neither blocks nor replays the others', async () => {
    await alerts.receive(ev({ type: 'sub' }));
    await alerts.receive(ev({ type: 'follow' }));
    const sub = (await play())!; // started: never replayed
    const follow = (await alerts.claim(CH, 'studio-A'))!; // claimed only: offered again
    clock.advance(playLeaseMs(ALERT_VARIANTS.eren_sub!) + 1);
    const again = (await alerts.claim(CH, 'studio-B'))!;
    expect(again.alert_id).toBe(follow.alert_id);
    expect(again.attempts).toBe(2);
    expect((await alerts.get(sub.alert_id)).status).toBe('expired');
    expect(await alerts.claim(CH, 'studio-B')).toBeNull();
  });

  it('a report naming another family, a stale attempt or a late report is refused', async () => {
    await alerts.receive(ev({ type: 'bits', bits: 100 }));
    const a = (await alerts.claim(CH, 'studio-A'))!;
    await expect(
      alerts.ack(a.alert_id, {
        consumer_id: 'studio-A',
        attempt_id: a.attempt_id!,
        event: 'started',
        family: 'follow',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'family_mismatch' });
    expect(
      await alerts.ack(a.alert_id, {
        consumer_id: 'studio-A',
        attempt_id: a.attempt_id!,
        event: 'started',
        family: 'bits',
      }),
    ).toMatchObject({ status: 'playing', family: 'bits' });
    await expect(
      ack(a.alert_id, '00000000-0000-4000-8000-000000000000', 'completed'),
    ).rejects.toMatchObject({ code: 'attempt_mismatch' });
  });

  it('a redelivered event in a burst is still one alert', async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => alerts.receive(ev({ source_event_id: 'burst-1' }))),
    );
    expect(results.filter((r) => r.outcome === 'queued')).toHaveLength(1);
    expect(await count('alert_items')).toBe(1);
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
    await alerts.receive(ev({ type: 'resub' }));
    const a = (await alerts.claim(CH, 'studio-A'))!;
    await ack(a.alert_id, a.attempt_id!, 'started');
    expect(await alerts.claim(CH, 'studio-A')).toBeNull(); // same family: waits
    clock.advance(playLeaseMs(ALERT_VARIANTS.eren_sub!) + 1);
    const next = (await alerts.claim(CH, 'studio-A'))!;
    expect(next.type).toBe('resub'); // the sub is not handed out again
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
