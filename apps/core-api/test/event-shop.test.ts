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

  it('items added after the first seeding (30/10): inserted disabled on an existing catalogue, never over Studio’s edits', async () => {
    // A catalogue created before them (the Production one): only the original items.
    await shop.admin(CH);
    await db.query(
      `delete from event_shop_items where channel_id = $1 and item_id in ('flip', 'blur', 's-chika', 'fantome')`,
      [CH],
    );
    await shop.updateItem(CH, 'blink', { price: 7, label: 'Clin d’œil' });
    await shop.updateItem(CH, 'fantome', { price: 9 }).catch(() => {}); // deleted above: nothing to update
    const fresh = new EventShopService(db, clock, labEconomy); // a new Core process
    const items = (await fresh.admin(CH)).items;
    expect(items.find((i) => i.item_id === 'flip')).toMatchObject({
      kind: 'effect',
      effect: 'flip',
      enabled: false,
      params: { durationMs: 10000, mode: 'rotate' },
    });
    expect(items.find((i) => i.item_id === 'blur')).toMatchObject({
      effect: 'blur',
      enabled: false,
    });
    expect(items.find((i) => i.item_id === 's-chika')).toMatchObject({
      kind: 'screamer',
      media_id: 'chika',
      enabled: false,
    });
    expect(items.find((i) => i.item_id === 'fantome')).toMatchObject({
      kind: 'apparition',
      media_id: 'fantome',
      enabled: false,
    });
    // Studio's edits stay; nothing existing is touched; each item once.
    expect(items.find((i) => i.item_id === 'blink')).toMatchObject({
      price: 7,
      label: 'Clin d’œil',
      enabled: true,
    });
    expect(new Set(items.map((i) => i.item_id)).size).toBe(items.length);
    // Off until Studio turns it on: not sold.
    await give(ANA, 100);
    await open();
    expect(await code(buy(ANA, 'flip'))).toBe('item_disabled');
    await shop.updateItem(CH, 'flip', { enabled: true });
    expect(await code(buy(ANA, 'flip'))).toBe('ok');
  });

  it('retired items (30/10: alerts, a transition, dropped screamers) leave the shop; one already bought stays, disabled', async () => {
    await shop.admin(CH);
    const ins = (id: string, media: string) =>
      db.query(
        `insert into event_shop_items (channel_id, item_id, kind, media_id, effect, label, description, price,
           cooldown_ms, enabled, sort, params, updated_at)
         values ($1, $2, 'screamer', $3, null, $2, '', 10, 0, true, 999, '{}', now())`,
        [CH, id, media],
      );
    await ins('s-miss-minute', 'miss-minute');
    await ins('s-mutant-couteau', 'mutant-couteau');
    // Someone bought the mutant in the Lab before: its purchase keeps its item.
    await db.query(
      `insert into event_shop_purchases (purchase_id, season, channel_id, viewer_id, viewer_name, item_id, item_kind,
         label, price, idempotency_key, request_hash, status, created_at)
       values ('33333333-3333-4333-8333-333333333333', 'halloween-2026', $1, '91001', 'Ana', 's-mutant-couteau',
         'screamer', 'Mutant', 10, 'k-mutant', 'h', 'completed', now())`,
      [CH],
    );
    const items = (await new EventShopService(db, clock, labEconomy).admin(CH))
      .items;
    expect(items.find((i) => i.item_id === 's-miss-minute')).toBeUndefined();
    expect(items.find((i) => i.item_id === 's-mutant-couteau')).toMatchObject({
      enabled: false,
    });
    await open();
    await give(ANA, 100);
    expect(await code(buy(ANA, 's-mutant-couteau'))).toBe('item_disabled');
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

describe('the Jetons → Bonbons exchange is removed (30/10)', () => {
  it('refused everywhere, nothing moved, whatever the saved rules say; past exchanges stay in the ledger', async () => {
    await open({ conversion_rate: 1000, conversion_cap_per_hour: 10 });
    await setTokens(ANA.id, 50_000);
    // A past exchange (written before the removal) stays as it was.
    await db.query(
      `insert into event_wallets (season, channel_id, viewer_id, viewer_name, balance, updated_at)
       values ('halloween-2026', $1, $2, 'Ana', 3, now())`,
      [CH, ANA.id],
    );
    await db.query(
      `insert into event_ledger (season, channel_id, viewer_id, kind, amount, balance_after, key, actor, reason, created_at)
       values ('halloween-2026', $1, $2, 'convert', 3, 3, 'convert:old', 'viewer', '3000 jetons', now())`,
      [CH, ANA.id],
    );
    for (const via of [undefined, 'extension'] as const)
      expect(
        await code(
          shop.convert({
            idempotency_key: randomUUID(),
            channel_id: CH,
            viewer: ANA,
            bonbons: 1,
            ...(via ? { via } : {}),
          }),
        ),
      ).toBe('conversion_removed');
    expect(await tokens(ANA.id)).toBe(50_000);
    expect(await balance(ANA.id)).toBe(3);
    const state = await shop.viewerState(CH, ANA.id);
    expect(state.conversion).toMatchObject({ cap_per_hour: 0, remaining: 0 });
    expect(
      (await shop.viewerHistory(CH, ANA.id)).ledger.map((m) => m.kind),
    ).toContain('convert');
  });
});

describe('Bonbons earned (30/10): Prime, resub, Bits, donations, presence', () => {
  let n = 0;
  const ev = (
    over: Partial<AlertEventInput> & Record<string, unknown>,
  ): AlertEventInput =>
    ({
      channel_id: CH,
      source: 'twitch',
      source_event_id: `earn-${++n}`,
      type: 'sub',
      actor: { id: ANA.id, login: 'ana', display_name: 'Ana' },
      ...over,
    }) as AlertEventInput;

  it('Prime and resub: their own amounts; null = the sub’s; one renewal never pays twice', async () => {
    await shop.updateSettings(CH, { enabled: true, rules: { sub_reward: 10 } });
    await alerts.receive(ev({ tier: 'prime' }));
    expect(await balance(ANA.id)).toBe(10); // null: the sub's amount
    await shop.updateSettings(CH, {
      rules: { prime_reward: 4, resub_reward: 7 },
    });
    await alerts.receive(ev({ tier: 'prime' }));
    await alerts.receive(ev({ type: 'resub', months: 3 }));
    await alerts.receive(ev({ tier: '1000' }));
    expect(await balance(ANA.id)).toBe(10 + 4 + 7 + 10);
    await shop.updateSettings(CH, { rules: { prime_reward: null } });
    await alerts.receive(ev({ tier: 'prime' }));
    expect(await balance(ANA.id)).toBe(10 + 4 + 7 + 10 + 10);
  });

  it('Bits: per full step, from the Twitch cheer event only (once per event id); off by default', async () => {
    await shop.updateSettings(CH, { enabled: true });
    await alerts.receive(ev({ type: 'bits', bits: 500 }));
    expect(await balance(ANA.id)).toBe(0); // off by default
    await shop.updateSettings(CH, {
      rules: { bits_step: 100, bits_bonbons: 2 },
    });
    const cheer = ev({ type: 'bits', bits: 350 });
    await alerts.receive(cheer);
    await alerts.receive(cheer); // redelivered
    expect(await balance(ANA.id)).toBe(6);
    // A simulated / external « bits » event pays nothing in Production.
    await alerts.receive(
      ev({ type: 'bits', bits: 1000, source: 'simulation' }),
    );
    expect(await balance(ANA.id)).toBe(6);
  });

  it('donations: euros only, from the minimum, whole euros; the donor is the one viewer with exactly that name', async () => {
    await db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ($1, 'ana', 'Ana'), ($2, 'bob', 'Bob'),
         ('91003', 'twin', 'Twin'), ('91004', 'twin_', 'twin')`,
      [ANA.id, BOB.id],
    );
    await shop.updateSettings(CH, {
      enabled: true,
      rules: { donation_per_euro: 3, donation_min_cents: 200 },
    });
    const tip = (
      name: string,
      value: number,
      currency = 'EUR',
      id = `tip-${++n}`,
    ) =>
      alerts.receive({
        channel_id: CH,
        source: 'external',
        source_event_id: `streamelements-tip-${id}`,
        type: 'donation',
        actor: { display_name: name },
        amount: { value, decimal_place: 2, currency },
        provider: 'streamelements',
      } as AlertEventInput);
    await tip('ANA', 550); // 5,50 € → 5 × 3
    await tip('ana', 550, 'EUR', 'same'); // the same tip again: once
    await tip('ana', 550, 'EUR', 'same');
    await tip('Bob', 150); // under the minimum
    await tip('Bob', 1000, 'USD'); // no exchange rate guessed
    await tip('twin', 1000); // two viewers answer to « twin »: nobody
    await tip('Quelqu’un', 1000); // no such viewer
    expect(await balance(ANA.id)).toBe(15 + 15);
    expect(await balance(BOB.id)).toBe(0);
    expect(await balance('91003')).toBe(0);
    expect(
      (await shop.viewerHistory(CH, ANA.id)).ledger.map((m) => m.kind),
    ).toContain('donation_reward');
  });

  it('presence: validated minutes add up per viewer; one movement per full block; closed or off: nothing', async () => {
    await db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ($1, 'ana', 'Ana'), ($2, 'bob', 'Bob'),
         ('91009', 'botto', 'Botto')`,
      [ANA.id, BOB.id],
    );
    await db.query(
      `insert into loyalty_exclusions (twitch_user_id, reason, created_by) values ('91009', 'bot', 'test')`,
    );
    const at = (min: number) => new Date(T0.getTime() + min * 60_000);
    const seen = (seconds: number, ids: string[], min: number) =>
      db.tx((q) =>
        shop.presenceListener.validated(q, {
          streamId: 's1',
          seconds,
          viewerIds: ids,
          at: at(min),
        }),
      );
    await shop.updateSettings(CH, { enabled: true });
    await seen(600, [ANA.id], 0); // rule off by default
    expect(await balance(ANA.id)).toBe(0);
    await shop.updateSettings(CH, {
      rules: { presence_every_min: 10, presence_bonbons: 2 },
    });
    await seen(300, [ANA.id, BOB.id, '91009', CH], 10); // 5 min: no block yet
    expect(await balance(ANA.id)).toBe(0);
    await seen(300, [ANA.id, BOB.id, '91009', CH], 15); // 10 min: one block each
    expect([await balance(ANA.id), await balance(BOB.id)]).toEqual([2, 2]);
    expect(await balance('91009')).toBe(0); // excluded (bot)
    expect(await balance(CH)).toBe(0); // the broadcaster
    await seen(1500, [ANA.id], 20); // +25 min → 35 min: 3 blocks in all
    expect(await balance(ANA.id)).toBe(6);
    await shop.updateSettings(CH, { enabled: false });
    await seen(3600, [ANA.id], 80); // closed: nothing earned, nothing counted
    await shop.updateSettings(CH, { enabled: true });
    expect(await balance(ANA.id)).toBe(6);
    const moves = (await shop.viewerHistory(CH, ANA.id)).ledger;
    expect(moves.filter((m) => m.kind === 'presence')).toHaveLength(2);
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

  it('ON / OFF many times (OFF = « Fermer la boutique »: closing, then Studio’s STOP ALL): every purchase ends once, nothing left to play, no double refund, balances and history kept', async () => {
    await open({ viewer_gap_ms: 0 });
    await give(ANA, 30);
    await give(BOB, 30);
    const ledger = () =>
      db.query<{ n: number }>(
        "select count(*)::int as n from event_ledger where channel_id = $1 and kind = 'refund'",
        [CH],
      );
    // One play at a time: at each OFF the shop holds one purchase — on screen (seen), handed to Studio but not
    // started, or waiting — then once more with nothing at all.
    const states = ['on_screen', 'handed_over', 'waiting', 'none'] as const;
    let seen = 0;
    for (const state of states) {
      clock.advance(60 * 60_000); // past every cooldown
      await ready(); // Studio's heartbeat, as it beats every few seconds
      const c =
        state === 'none'
          ? null
          : (await buy(state === 'waiting' ? BOB : ANA, 'blink'),
            state === 'waiting' ? null : (await shop.claim(STUDIO, CH))!);
      if (state === 'on_screen') {
        await shop.ack(c!.purchase.purchase_id, {
          studio_instance_id: STUDIO,
          attempt_id: c!.attempt_id,
          event: 'started',
        });
        seen += c!.purchase.price;
      }
      // OFF, twice in a row (a double click): the second changes nothing.
      for (let k = 0; k < 2; k++) {
        await shop.updateSettings(CH, { enabled: false });
        await shop.stopAll(CH);
      }
      expect(await shop.claim(STUDIO, CH)).toBeNull();
      const live = await db.query(
        `select 1 from event_shop_purchases where channel_id = $1 and status in ('queued', 'executing')`,
        [CH],
      );
      expect(live).toHaveLength(0); // nothing left that could still play
      expect((await shop.viewerState(CH, ANA.id)).enabled).toBe(false);
      // A late report of the stopped play changes nothing (no refund, no second end).
      if (c)
        await shop
          .ack(c.purchase.purchase_id, {
            studio_instance_id: STUDIO,
            attempt_id: c.attempt_id,
            event: 'completed',
          })
          .catch(() => null);
      // ON again: the same shop, the same balances.
      await shop.updateSettings(CH, { enabled: true });
      await ready();
    }
    // Only what was seen is spent; the two others refunded exactly once.
    expect(
      ((await balance(ANA.id)) ?? 0) + ((await balance(BOB.id)) ?? 0),
    ).toBe(60 - seen);
    expect((await ledger())[0]!.n).toBe(2);
    const all = (await shop.admin(CH)).purchases;
    expect(all).toHaveLength(3);
    expect(all.filter((p) => p.refund_status === 'refunded')).toHaveLength(2);
    // Reopened: buying works again.
    clock.advance(60 * 60_000);
    await ready();
    expect(await code(buy(BOB, 'blink'))).toBe('ok');
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

describe('the transversal rules of paid interactions (moderation D4) and Studio’s viewer tools', () => {
  it('« Pause Raptoru » refuses a purchase (counted in the banner), nothing debited; a viewer blocked everywhere cannot buy', async () => {
    await open();
    await give(ANA, 10);
    await db.query(
      `insert into lab_global_state (channel_id, paused, paused_at, paused_by, refused_count, updated_at)
       values ($1, true, $2, 'test', 0, $2)`,
      [CH, clock.now()],
    );
    expect(await code(buy(ANA, 'blink'))).toBe('raptoru_paused');
    expect(await balance(ANA.id)).toBe(10);
    expect(
      (
        await db.query<{ n: number }>(
          'select refused_count as n from lab_global_state where channel_id = $1',
          [CH],
        )
      )[0]!.n,
    ).toBe(1);
    await db.query(
      'update lab_global_state set paused = false where channel_id = $1',
      [CH],
    );
    await db.query(
      `insert into lab_viewer_blocks (channel_id, viewer_id, module_id, until, reason, actor, created_at)
       values ($1, $2, 'all', null, 'test', 'test', $3)`,
      [CH, ANA.id, clock.now()],
    );
    expect(await code(buy(ANA, 'blink'))).toBe('viewer_blocked');
    expect(await balance(ANA.id)).toBe(10);
    // Bob is not blocked.
    await give(BOB, 5);
    expect(await code(buy(BOB, 'blink'))).toBe('ok');
  });

  it('find a viewer (Bonbons or only seen), credit them by their Twitch name, read their purchases and movements', async () => {
    await open();
    await db.query(
      `insert into lab_viewers (channel_id, viewer_id, display_name, first_seen, last_seen) values ($1, '91003', 'Carla_TV', $2, $2)`,
      [CH, clock.now()],
    );
    await give(ANA, 10);
    expect(await shop.searchViewers(CH, 'carla')).toEqual([
      { viewer_id: '91003', name: 'Carla_TV', balance: 0 },
    ]);
    // Credited by name (a viewer the channel has seen, no Bonbons yet); the same entry twice credits once.
    const key = randomUUID();
    const grant = () =>
      shop.grant(
        {
          idempotency_key: key,
          channel_id: CH,
          viewer: 'carla_tv',
          amount: 7,
          reason: 'grant',
          note: 'concours',
        },
        'test',
      );
    await grant();
    await grant();
    expect(await balance('91003')).toBe(7);
    await buy(ANA, 'blink');
    const h = await shop.viewerHistory(CH, ANA.id);
    expect(h.balance).toBe(8);
    expect(h.purchases[0]).toMatchObject({
      label: 'Clignement',
      price: 2,
      status: 'queued',
    });
    expect(h.ledger.map((l) => l.kind)).toEqual(['purchase', 'grant']);
    expect((await shop.searchViewers(CH, ''))[0]).toMatchObject({
      viewer_id: ANA.id,
      balance: 8,
    });
  });
});

describe('« Événements » for the Extension testers only (progressive opening)', () => {
  it('a non-tester does not get the module nor buy from the Extension; a tester does; the chat stays open to all', async () => {
    await open({ viewer_gap_ms: 0 });
    await give(ANA, 10);
    await give(BOB, 10);
    await shop.updateSettings(CH, {
      rules: { extension_audience: 'testers', extension_testers: [ANA.id] },
    });
    expect((await shop.viewerState(CH, ANA.id)).extension_allowed).toBe(true);
    expect((await shop.viewerState(CH, BOB.id)).extension_allowed).toBe(false);
    const viaExt = (viewer: typeof ANA, item_id: string) =>
      shop.purchase({
        idempotency_key: randomUUID(),
        channel_id: CH,
        viewer,
        item_id,
        via: 'extension',
      });
    expect(await code(viaExt(BOB, 'blink'))).toBe('not_invited');
    expect(await balance(BOB.id)).toBe(10);
    expect(
      await code(
        shop.convert({
          idempotency_key: randomUUID(),
          channel_id: CH,
          viewer: BOB,
          bonbons: 1,
          via: 'extension',
        }),
      ),
    ).toBe('conversion_removed');
    expect(await code(viaExt(ANA, 'blink'))).toBe('ok');
    // The chat (no `via`) is open to everyone.
    await shop.stopAll(CH);
    expect(await code(buy(BOB, 'fog'))).toBe('ok');
    // Back to everyone.
    await shop.updateSettings(CH, { rules: { extension_audience: 'all' } });
    expect((await shop.viewerState(CH, BOB.id)).extension_allowed).toBe(true);
  });
});
