import type { AlertEventInput } from '@raptoru/schemas';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlertsService } from '../src/alerts/service.js';
import type { Db } from '../src/db/db.js';
import { labEconomy } from '../src/economy/economy.js';
import {
  EVENT_SHOP,
  EventShopError,
  EventShopService,
} from '../src/event-shop/service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Boutique d'événement (docs/HALLOWEEN.md), on the test database with the Lab wallet as the Jetons side: the event
// closed / open, the overlay's readiness, one play at a time, every limit, the debit and the admission together,
// idempotent purchases, the execution's fate (never replayed; refunded once when it never played), the capped
// conversion, Bonbons for subs / gifts once per event, Studio's grants and STOP ALL.

const CH = '900700';
const STUDIO = 'studio-A';
const T0 = new Date('2026-10-31T18:00:00Z');
const ANA = { id: '91001', display_name: 'Ana' };
const BOB = { id: '91002', display_name: 'Bob' };

let db: Db;
let clock: FakeClock;
let shop: EventShopService;
let alerts: AlertsService;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  shop = new EventShopService(db, clock, labEconomy);
  alerts = new AlertsService(db, clock, () => 0);
  alerts.attachListener('event_shop', (q, e) => shop.onAlert(q, e));
});

const ALL_MEDIA = ['golden-freddy', 'foxy', 'chauves-souris', 'araignee'];
const ready = (media = ALL_MEDIA) =>
  shop.heartbeat({
    studio_instance_id: STUDIO,
    channel_id: CH,
    engine_ready: true,
    media,
  });
const open = async (rules: Record<string, number> = {}) => {
  await shop.updateSettings(CH, { enabled: true, rules });
  await ready();
};
const give = (viewer: { id: string; display_name: string }, amount: number) =>
  shop.grant(
    {
      idempotency_key: randomUUID(),
      channel_id: CH,
      viewer: viewer.id,
      amount,
      reason: 'grant',
    },
    'test',
  );
const buy = (
  viewer: { id: string; display_name: string },
  item_id: string,
  key = randomUUID(),
) => shop.purchase({ idempotency_key: key, channel_id: CH, viewer, item_id });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof EventShopError) return e.code;
    throw e;
  }
};
const balance = async (viewerId: string) =>
  (await shop.viewerState(CH, viewerId)).balance;
const tokens = async (viewerId: string) =>
  Number(
    (
      await db.query<{ tokens: string }>(
        'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
        [CH, viewerId],
      )
    )[0]?.tokens ?? NaN,
  );
const setTokens = (viewerId: string, value: number) =>
  db.query(
    `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
     values ($1, $2, $3, 0, 0, now()) on conflict (channel_id, viewer_id) do update set tokens = excluded.tokens`,
    [CH, viewerId, value],
  );
/** Plays the next claimed purchase to its end, as the overlay would. */
const play = async (end: 'completed' | 'failed' = 'completed') => {
  const c = (await shop.claim(STUDIO, CH))!;
  await shop.ack(c.purchase.purchase_id, {
    studio_instance_id: STUDIO,
    attempt_id: c.attempt_id,
    event: 'started',
  });
  await shop.ack(c.purchase.purchase_id, {
    studio_instance_id: STUDIO,
    attempt_id: c.attempt_id,
    event: end,
    ...(end === 'failed' ? { started: true, error: 'decode' } : {}),
  });
  return c;
};

describe('event, overlay and catalogue', () => {
  it('created closed with its catalogue; nothing is sold while closed or while the overlay is not ready', async () => {
    const admin = await shop.admin(CH);
    expect(admin.settings).toMatchObject({
      season: 'halloween-2026',
      enabled: false,
    });
    expect(admin.items.length).toBeGreaterThan(20);
    expect(admin.items.find((i) => i.item_id === 'blink')).toMatchObject({
      kind: 'effect',
      price: 2,
    });
    expect(
      admin.items.find((i) => i.item_id === 's-golden-freddy'),
    ).toMatchObject({
      kind: 'screamer',
      media_id: 'golden-freddy',
    });
    await give(ANA, 100);
    expect(await code(buy(ANA, 'blink'))).toBe('event_closed');
    await shop.updateSettings(CH, { enabled: true });
    expect(await code(buy(ANA, 'blink'))).toBe('engine_offline');
    await ready([]);
    // A media item whose file Studio does not hold is not sold; a drawn effect is.
    expect(await code(buy(ANA, 's-golden-freddy'))).toBe('media_missing');
    expect(await code(buy(ANA, 'blink'))).toBe('ok');
    // A stale heartbeat: the overlay is gone.
    await play();
    clock.advance(EVENT_SHOP.readyMs + 1);
    clock.advance(10 * 60_000);
    expect(await code(buy(ANA, 'fog'))).toBe('engine_offline');
    await ready();
    expect(await code(buy(ANA, 'unknown-item'))).toBe('item_not_found');
    await shop.updateItem(CH, 'fog', { enabled: false });
    expect(await code(buy(ANA, 'fog'))).toBe('item_disabled');
  });

  it('the viewer state: balance, items with thumbnails and why each one cannot be bought now', async () => {
    await open();
    await give(ANA, 12);
    const s = await shop.viewerState(CH, ANA.id);
    expect(s).toMatchObject({ enabled: true, engine_ready: true, balance: 12 });
    const blink = s.items.find((i) => i.item_id === 'blink')!;
    expect(blink).toMatchObject({
      available: true,
      thumb: 'assets/halloween/fx-blink.svg',
      reason: null,
    });
    expect(s.items.find((i) => i.item_id === 's-foxy')).toMatchObject({
      thumb: 'assets/halloween/foxy.jpg',
    });
    // An item whose media is missing says so.
    expect(s.items.find((i) => i.item_id === 's-mickey')).toMatchObject({
      available: false,
      reason: 'media_missing',
    });
    await buy(ANA, 'blink');
    const busy = await shop.viewerState(CH, BOB.id);
    expect(busy.items.find((i) => i.item_id === 'fog')).toMatchObject({
      available: false,
      reason: 'busy',
    });
  });
});

describe('purchase: debit and admission together, idempotent', () => {
  it('debits the price; refuses without enough Bonbons and writes nothing', async () => {
    await open();
    await give(ANA, 3);
    expect(await code(buy(ANA, 's-foxy'))).toBe('insufficient_bonbons');
    expect(await balance(ANA.id)).toBe(3);
    const r = await buy(ANA, 'blink');
    expect(r).toMatchObject({
      balance: 1,
      replayed: false,
      purchase: { status: 'queued', price: 2 },
    });
    expect((await shop.admin(CH)).purchases).toHaveLength(1);
  });

  it('the same click twice: one purchase, one debit; the same key for another item: refused', async () => {
    await open();
    await give(ANA, 20);
    const key = randomUUID();
    const a = await buy(ANA, 'blink', key);
    const b = await buy(ANA, 'blink', key);
    expect(b).toMatchObject({
      replayed: true,
      purchase: { purchase_id: a.purchase.purchase_id },
    });
    expect(await balance(ANA.id)).toBe(18);
    expect(await code(buy(ANA, 'fog', key))).toBe('idempotency_conflict');
  });
});

describe('limits that keep the stream playable', () => {
  it('one play at a time, no queue: busy while another purchase waits or plays', async () => {
    await open({ viewer_gap_ms: 0 });
    await give(ANA, 50);
    await give(BOB, 50);
    await buy(ANA, 'blink');
    expect(await code(buy(BOB, 'fog'))).toBe('busy');
    await play();
    expect(await code(buy(BOB, 'fog'))).toBe('ok');
  });

  it('a viewer waits between purchases; an item has its cooldown', async () => {
    await open({ viewer_gap_ms: 60_000 });
    await give(ANA, 50);
    await give(BOB, 50);
    await buy(ANA, 'blink');
    await play();
    const e = await buy(ANA, 'fog').catch((x: EventShopError) => x);
    expect(e).toMatchObject({ code: 'viewer_cooldown' });
    expect((e as EventShopError).details.retry_after_ms).toBeGreaterThan(0);
    // The item's own cooldown (60 s for effects) for everybody.
    expect(await code(buy(BOB, 'blink'))).toBe('item_cooldown');
    clock.advance(60_001);
    await ready();
    expect(await code(buy(BOB, 'blink'))).toBe('ok');
  });

  it('screamers: their own gap and an hourly quota; a refunded one does not count', async () => {
    await open({
      viewer_gap_ms: 0,
      screamer_gap_ms: 120_000,
      screamers_per_hour: 2,
    });
    await shop.updateItem(CH, 's-foxy', { cooldown_ms: 0 });
    await shop.updateItem(CH, 's-golden-freddy', { cooldown_ms: 0 });
    await give(ANA, 100);
    await buy(ANA, 's-foxy');
    await play();
    expect(await code(buy(ANA, 's-golden-freddy'))).toBe('screamer_cooldown');
    clock.advance(120_001);
    await ready();
    await buy(ANA, 's-golden-freddy');
    await play();
    clock.advance(120_001);
    await ready();
    expect(await code(buy(ANA, 's-foxy'))).toBe('screamer_quota');
    // Never taken (overlay silent): refunded, and it frees the quota.
    clock.advance(EVENT_SHOP.hourMs);
    await ready();
    await buy(ANA, 's-foxy');
    clock.advance(EVENT_SHOP.pickupMs + 1);
    await ready();
    expect(await code(buy(ANA, 's-golden-freddy'))).toBe('ok');
    // Screamers closed.
    await shop.updateSettings(CH, { rules: { screamers_per_hour: 0 } });
    await play();
    clock.advance(EVENT_SHOP.hourMs);
    await ready();
    expect(await code(buy(ANA, 's-foxy'))).toBe('screamers_closed');
  });
});

describe('execution: never replayed, refunded once when it never played', () => {
  it('claim → started → completed; only the holder of the attempt reports', async () => {
    await open();
    await give(ANA, 10);
    const { purchase } = await buy(ANA, 'blink');
    expect(await shop.claim('studio-B', CH)).toBeNull(); // not the ready overlay
    const c = (await shop.claim(STUDIO, CH))!;
    expect(c.play).toMatchObject({
      kind: 'effect',
      effect: 'blink',
      viewer_name: 'Ana',
      params: { durationMs: 900 },
    });
    expect(await shop.claim(STUDIO, CH)).toBeNull(); // one at a time
    expect(
      await code(
        shop.ack(purchase.purchase_id, {
          studio_instance_id: STUDIO,
          attempt_id: randomUUID(),
          event: 'started',
        }),
      ),
    ).toBe('not_attempt_holder');
    await shop.ack(purchase.purchase_id, {
      studio_instance_id: STUDIO,
      attempt_id: c.attempt_id,
      event: 'started',
    });
    const done = await shop.ack(purchase.purchase_id, {
      studio_instance_id: STUDIO,
      attempt_id: c.attempt_id,
      event: 'completed',
    });
    expect(done).toMatchObject({ status: 'completed', refund_status: 'none' });
    // A repeated report changes nothing.
    expect(
      await shop.ack(purchase.purchase_id, {
        studio_instance_id: STUDIO,
        attempt_id: c.attempt_id,
        event: 'failed',
      }),
    ).toMatchObject({ status: 'completed' });
    expect(await balance(ANA.id)).toBe(8);
  });

  it('not taken, or taken and not started in time: failed and refunded once (sweeps repeated)', async () => {
    await open({ viewer_gap_ms: 0 });
    await give(ANA, 10);
    const a = await buy(ANA, 'blink');
    clock.advance(EVENT_SHOP.pickupMs + 1);
    await shop.sweepAll();
    await shop.sweepAll();
    expect((await shop.admin(CH)).purchases[0]).toMatchObject({
      purchase_id: a.purchase.purchase_id,
      status: 'failed',
      error: 'not_taken',
      refund_status: 'refunded',
    });
    expect(await balance(ANA.id)).toBe(10);
    await ready();
    await buy(ANA, 'fog');
    await shop.claim(STUDIO, CH);
    clock.advance(EVENT_SHOP.startMs + 1);
    await shop.sweepAll();
    expect((await shop.admin(CH)).purchases[0]).toMatchObject({
      status: 'failed',
      error: 'not_started',
    });
    expect(await balance(ANA.id)).toBe(10);
    const refunds = (await shop.admin(CH)).ledger.filter(
      (l) => l.kind === 'refund',
    );
    expect(refunds).toHaveLength(2);
  });

  it('started and never ended: « unknown », no refund; failed after its start: no refund; before: refunded', async () => {
    await open({ viewer_gap_ms: 0 });
    await shop.updateItem(CH, 'fog', { cooldown_ms: 0 });
    await give(ANA, 20);
    await buy(ANA, 'fog');
    const c = (await shop.claim(STUDIO, CH))!;
    await shop.ack(c.purchase.purchase_id, {
      studio_instance_id: STUDIO,
      attempt_id: c.attempt_id,
      event: 'started',
    });
    clock.advance(EVENT_SHOP.maxPlayMs + 1);
    await shop.sweepAll();
    expect((await shop.admin(CH)).purchases[0]).toMatchObject({
      status: 'unknown',
      refund_status: 'none',
    });
    await ready();
    await buy(ANA, 'fog');
    await play('failed');
    clock.advance(1);
    expect((await shop.admin(CH)).purchases[0]).toMatchObject({
      status: 'failed',
      refund_status: 'none',
    });
    await buy(ANA, 'fog');
    const d = (await shop.claim(STUDIO, CH))!;
    await shop.ack(d.purchase.purchase_id, {
      studio_instance_id: STUDIO,
      attempt_id: d.attempt_id,
      event: 'failed',
      started: false,
      error: 'media_missing',
    });
    expect((await shop.admin(CH)).purchases[0]).toMatchObject({
      status: 'failed',
      refund_status: 'refunded',
    });
    expect(await balance(ANA.id)).toBe(20 - 3 - 3);
  });

  it('STOP ALL: what waits is refunded, what plays is ended (seen, no refund)', async () => {
    await open({ viewer_gap_ms: 0 });
    await give(ANA, 10);
    await buy(ANA, 'blink');
    await shop.claim(STUDIO, CH);
    expect(await shop.stopAll(CH)).toEqual({ stopped: 1 });
    expect((await shop.admin(CH)).purchases[0]).toMatchObject({
      status: 'failed',
      error: 'stopped',
      refund_status: 'refunded',
    });
    expect(await balance(ANA.id)).toBe(10);
  });
});

describe('conversion Jetons → Bonbons, capped per viewer and rolling hour', () => {
  it('debits the Jetons at the rate, credits the Bonbons, once per key; the cap and when it frees up', async () => {
    await open({ conversion_rate: 1000, conversion_cap_per_hour: 10 });
    await setTokens(ANA.id, 50_000);
    const key = randomUUID();
    const r = await shop.convert({
      idempotency_key: key,
      channel_id: CH,
      viewer: ANA,
      bonbons: 6,
    });
    expect(r).toMatchObject({
      bonbons: 6,
      jetons: 6000,
      balance: 6,
      conversion: { remaining: 4 },
    });
    expect(
      await shop.convert({
        idempotency_key: key,
        channel_id: CH,
        viewer: ANA,
        bonbons: 6,
      }),
    ).toMatchObject({
      replayed: true,
      balance: 6,
    });
    expect(await tokens(ANA.id)).toBe(44_000);
    const cap = await shop
      .convert({
        idempotency_key: randomUUID(),
        channel_id: CH,
        viewer: ANA,
        bonbons: 5,
      })
      .catch((e: EventShopError) => e);
    expect(cap).toMatchObject({
      code: 'conversion_cap',
      details: { remaining: 4 },
    });
    expect((cap as EventShopError).details.retry_after_ms).toBe(
      EVENT_SHOP.hourMs,
    );
    await shop.convert({
      idempotency_key: randomUUID(),
      channel_id: CH,
      viewer: ANA,
      bonbons: 4,
    });
    clock.advance(EVENT_SHOP.hourMs + 1);
    expect(
      (
        await shop.convert({
          idempotency_key: randomUUID(),
          channel_id: CH,
          viewer: ANA,
          bonbons: 10,
        })
      ).balance,
    ).toBe(20);
    expect(await tokens(ANA.id)).toBe(50_000 - 20_000);
  });

  it('not enough Jetons, event closed, conversion closed: refused, nothing moved', async () => {
    await open();
    await setTokens(BOB.id, 500);
    expect(
      await code(
        shop.convert({
          idempotency_key: randomUUID(),
          channel_id: CH,
          viewer: BOB,
          bonbons: 1,
        }),
      ),
    ).toBe('insufficient_tokens');
    expect(await tokens(BOB.id)).toBe(500);
    expect(await balance(BOB.id)).toBe(0);
    await shop.updateSettings(CH, { rules: { conversion_cap_per_hour: 0 } });
    expect(
      await code(
        shop.convert({
          idempotency_key: randomUUID(),
          channel_id: CH,
          viewer: BOB,
          bonbons: 1,
        }),
      ),
    ).toBe('conversion_closed');
    await shop.updateSettings(CH, { enabled: false });
    expect(
      await code(
        shop.convert({
          idempotency_key: randomUUID(),
          channel_id: CH,
          viewer: BOB,
          bonbons: 1,
        }),
      ),
    ).toBe('event_closed');
  });

  it('concurrent conversions of one viewer never pass the cap', async () => {
    await open({ conversion_cap_per_hour: 10, conversion_rate: 10 });
    await setTokens(ANA.id, 1_000_000);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        code(
          shop.convert({
            idempotency_key: randomUUID(),
            channel_id: CH,
            viewer: ANA,
            bonbons: 3,
          }),
        ),
      ),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'conversion_cap')).toHaveLength(3);
    expect(await balance(ANA.id)).toBe(9);
  });
});

describe('Bonbons for Twitch subs and gifts', () => {
  let n = 0;
  const ev = (
    over: Partial<AlertEventInput> & Record<string, unknown>,
  ): AlertEventInput =>
    ({
      channel_id: CH,
      source: 'twitch',
      source_event_id: `ev-${++n}`,
      type: 'sub',
      actor: { id: ANA.id, login: 'ana', display_name: 'Ana' },
      ...over,
    }) as AlertEventInput;

  it('the subscriber, the giver (per gifted sub), each recipient — once per event, even redelivered', async () => {
    await shop.updateSettings(CH, {
      enabled: true,
      rules: { sub_reward: 10, gift_giver_per_sub: 5, gift_recipient: 3 },
    });
    const sub = ev({ type: 'resub', months: 4 });
    await alerts.receive(sub);
    await alerts.receive(sub); // redelivery
    expect(await balance(ANA.id)).toBe(10);
    // Targeted gift: Bob gives Ana one sub.
    await alerts.receive(
      ev({
        type: 'gift_targeted',
        actor: { id: BOB.id, login: 'bob', display_name: 'Bob' },
        recipient: { id: ANA.id, login: 'ana', display_name: 'Ana' },
      }),
    );
    expect(await balance(BOB.id)).toBe(5);
    expect(await balance(ANA.id)).toBe(13);
    // Community gift of 4 by Bob, then the recipient lines (Ana is one of them).
    await alerts.receive(
      ev({
        type: 'gift_community',
        actor: { id: BOB.id, login: 'bob', display_name: 'Bob' },
        count: 4,
        community_gift_id: 'cg-1',
      }),
    );
    await alerts.receive(
      ev({
        type: 'gift_recipient',
        actor: { id: BOB.id, login: 'bob', display_name: 'Bob' },
        recipient: { id: ANA.id, login: 'ana', display_name: 'Ana' },
        community_gift_id: 'cg-1',
      }),
    );
    expect(await balance(BOB.id)).toBe(5 + 20);
    expect(await balance(ANA.id)).toBe(16);
    // Anonymous gift: the recipient only.
    await alerts.receive(
      ev({
        type: 'gift_targeted',
        actor: undefined,
        anonymous: true,
        recipient: { id: '91003', login: 'cy', display_name: 'Cy' },
      }),
    );
    expect(await balance('91003')).toBe(3);
  });

  it('closed event, a simulation in production, a follow: nothing; the Lab pays its simulations', async () => {
    await alerts.receive(ev({ type: 'sub' }));
    expect(await balance(ANA.id)).toBe(0);
    await shop.updateSettings(CH, { enabled: true });
    await alerts.receive(ev({ type: 'sub', source: 'simulation' }));
    await alerts.receive(ev({ type: 'follow' }));
    expect(await balance(ANA.id)).toBe(0);
    const lab = new EventShopService(db, clock, labEconomy, {
      rewardSimulations: true,
    });
    const labAlerts = new AlertsService(db, clock, () => 0);
    labAlerts.attachListener('event_shop', (q, e) => lab.onAlert(q, e));
    await labAlerts.receive(ev({ type: 'sub', source: 'simulation' }));
    expect(await balance(ANA.id)).toBe(10);
  });

  it('a failing listener never blocks the alert', async () => {
    alerts.attachListener('broken', async () => {
      throw new Error('boom');
    });
    await shop.updateSettings(CH, { enabled: true });
    const r = await alerts.receive(ev({ type: 'sub' }));
    expect(r.outcome).not.toBe('duplicate');
    expect(await balance(ANA.id)).toBe(10);
  });
});

describe('Studio grants (Tombola winners, gestures)', () => {
  it('by id or known name, once per click; never below 0', async () => {
    await shop.updateSettings(CH, { enabled: true });
    // A viewer the Core already knows (chat, presence): named by the streamer as he types it.
    await db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ('91001', 'ana', 'Ana')`,
    );
    const key = randomUUID();
    const g = {
      idempotency_key: key,
      channel_id: CH,
      viewer: ANA.id,
      amount: 8,
      reason: 'raffle' as const,
    };
    expect(await shop.grant(g, 'studio')).toMatchObject({
      balance: 8,
      replayed: false,
    });
    expect(await shop.grant(g, 'studio')).toMatchObject({
      balance: 8,
      replayed: true,
    });
    expect(
      await shop.grant(
        {
          ...g,
          idempotency_key: randomUUID(),
          viewer: '@ana',
          amount: -3,
          reason: 'grant',
        },
        'studio',
      ),
    ).toMatchObject({ balance: 5 });
    expect(
      await code(
        shop.grant(
          {
            ...g,
            idempotency_key: randomUUID(),
            viewer: 'Ana',
            amount: -6,
            reason: 'grant',
          },
          'studio',
        ),
      ),
    ).toBe('insufficient_bonbons');
    expect(
      await code(
        shop.grant(
          {
            ...g,
            idempotency_key: randomUUID(),
            viewer: 'personne',
            amount: 1,
          },
          'studio',
        ),
      ),
    ).toBe('viewer_unknown');
    const kinds = (await shop.admin(CH)).ledger.map((l) => l.kind);
    expect(kinds).toEqual(['remove', 'raffle']);
  });

  it('the ledger is append-only', async () => {
    await give(ANA, 5);
    await expect(
      db.query('update event_ledger set amount = 99'),
    ).rejects.toThrow(/append-only/);
    await expect(db.query('delete from event_ledger')).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('closing the event: temporary and reversible', () => {
  it('what is on screen ends normally; nothing more is sold or handed to Studio; balances stay; reopened as it was', async () => {
    await open({ viewer_gap_ms: 0 });
    await give(ANA, 20);
    await give(BOB, 20);
    // Ana's purchase is on screen (handed over and started) when the event closes.
    const { purchase: onScreen } = await buy(ANA, 'blink');
    const c = (await shop.claim(STUDIO, CH))!;
    await shop.ack(onScreen.purchase_id, {
      studio_instance_id: STUDIO,
      attempt_id: c.attempt_id,
      event: 'started',
    });
    const closed = await shop.updateSettings(CH, { enabled: false });
    expect(closed.enabled).toBe(false);
    // Closed: no purchase, no conversion, no claim; Ana's play still reports its end.
    expect(await code(buy(BOB, 'eyes'))).toBe('event_closed');
    expect(await shop.claim(STUDIO, CH)).toBeNull();
    const done = await shop.ack(onScreen.purchase_id, {
      studio_instance_id: STUDIO,
      attempt_id: c.attempt_id,
      event: 'completed',
    });
    expect(done).toMatchObject({ status: 'completed', refund_status: 'none' });
    expect(await balance(ANA.id)).toBe(18); // kept, not purged
    // An automatic reward (raffle) is refused while closed; Studio's own grant stays possible.
    expect(
      await code(
        shop.grant(
          {
            idempotency_key: randomUUID(),
            channel_id: CH,
            viewer: ANA.id,
            amount: 5,
            reason: 'raffle',
          },
          'test',
        ),
      ),
    ).toBe('event_closed');
    expect(
      await code(
        shop.grant(
          {
            idempotency_key: randomUUID(),
            channel_id: CH,
            viewer: ANA.id,
            amount: 1,
            reason: 'grant',
          },
          'test',
        ),
      ),
    ).toBe('ok');
    // Reopened later: the same shop, the same balances.
    await shop.updateSettings(CH, { enabled: true });
    await ready();
    expect(await code(buy(ANA, 'eyes'))).toBe('ok');
  });

  it('a purchase bought but not yet handed to Studio is refunded at closing (event_closed), once', async () => {
    await open({ viewer_gap_ms: 0 });
    await give(ANA, 10);
    await buy(ANA, 'blink'); // queued, not claimed
    const r = await shop.updateSettings(CH, { enabled: false });
    expect(r.refunded).toBe(1);
    expect((await shop.admin(CH)).purchases[0]).toMatchObject({
      status: 'failed',
      error: 'event_closed',
      refund_status: 'refunded',
    });
    expect(await balance(ANA.id)).toBe(10);
    // Closing again refunds nothing more.
    await shop.updateSettings(CH, { enabled: true });
    expect((await shop.updateSettings(CH, { enabled: false })).refunded).toBe(
      0,
    );
    expect(await balance(ANA.id)).toBe(10);
  });
});
