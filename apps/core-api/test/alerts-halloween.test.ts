import type { AlertEventInput } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlertsService } from '../src/alerts/service.js';
import { decideAlert, type AlertProfile } from '../src/alerts/rules.js';
import { HALLOWEEN_VARIANTS } from '../src/alerts/variants.js';
import type { Db } from '../src/db/db.js';
import { labEconomy } from '../src/economy/economy.js';
import { EventShopService } from '../src/event-shop/service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Halloween alert profile (docs/HALLOWEEN.md § 14): off by default (the usual alerts, untouched); on, Miss Minute for
// follows, the Ballon for sub / Prime / resub (drawn from each one's chosen animations), Jerry for gifts (thresholds 1 /
// 5 / 10 / 20 of the media); the usual variant travels with it (Studio's fallback); one alert per event, as always.

const CH = '900800';
let db: Db;
let alerts: AlertsService;
let shop: EventShopService;
let rolls: number[];

beforeEach(async () => {
  db = await createTestDb();
  const clock = new FakeClock(new Date('2026-10-31T18:00:00Z'));
  rolls = [];
  alerts = new AlertsService(db, clock, () => rolls.shift() ?? 0);
  shop = new EventShopService(db, clock, labEconomy);
});

let n = 0;
const ev = (over: Partial<AlertEventInput> = {}): AlertEventInput => ({
  channel_id: CH,
  source: 'simulation',
  source_event_id: `hw-${++n}`,
  type: 'follow',
  actor: { id: '1', login: 'alice', display_name: 'Alice' },
  ...over,
});
const variantOf = async (e: AlertEventInput) =>
  (await alerts.receive(e)).alert?.variant;

const ALL = { sub: [1, 2, 3, 4], prime: [1, 2, 3, 4], resub: [1, 2, 3, 4] };

describe('Halloween alert profile', () => {
  it('off by default and with no event row: the usual variants, unchanged (no fallback attached)', async () => {
    expect((await variantOf(ev()))!.id).toBe('follow_dofus_ebene');
    await shop.admin(CH); // the event's settings exist, profile off
    const v = (await variantOf(ev({ type: 'sub', tier: '1000' })))!;
    expect(v.id).toBe('eren_sub');
    expect(v.fallback).toBeUndefined();
  });

  it('on: Miss Minute, the Ballon (sub / Prime / resub), Jerry by threshold; the usual one frozen as fallback', async () => {
    await shop.updateSettings(CH, { rules: { halloween_alerts: true } });
    const follow = (await variantOf(ev()))!;
    expect(follow).toMatchObject({
      id: 'hw_follow_miss_minute',
      video: 'Halloween Follow Miss Minute.webm',
      fallback: { id: 'follow_dofus_ebene' },
    });
    rolls = [0.99]; // a sub draws nothing for its usual variant (Eren): the one roll is the Ballon's
    expect((await variantOf(ev({ type: 'sub', tier: '1000' })))!).toMatchObject(
      {
        id: 'hw_ballon_sub_4',
        audio: 'Halloween Ballon V2.mp3',
        fallback: { id: 'eren_sub' },
      },
    );
    rolls = [0.3];
    expect((await variantOf(ev({ type: 'sub', tier: 'prime' })))!.id).toBe(
      'hw_ballon_prime_2',
    );
    rolls = [0.6];
    const resub = (await variantOf(
      ev({ type: 'resub', tier: '1000', months: 7 }),
    ))!;
    expect(resub.id).toBe('hw_ballon_resub_3');
    expect(resub.text).toContain('{months}');
    for (const [count, id] of [
      [1, 'hw_gift_1'],
      [4, 'hw_gift_1'],
      [5, 'hw_gift_5'],
      [12, 'hw_gift_10'],
      [50, 'hw_gift_20'],
    ] as const)
      expect((await variantOf(ev({ type: 'gift_community', count })))!.id).toBe(
        id,
      );
    expect(
      (await variantOf(
        ev({
          type: 'gift_targeted',
          recipient: { id: '2', login: 'bob', display_name: 'Bob' },
        }),
      ))!.id,
    ).toBe('hw_gift_targeted');
    // No Halloween variant: the usual ones; a gift's recipients are still absorbed (no double count).
    expect((await variantOf(ev({ type: 'raid', viewers: 3 })))!.id).toBe(
      'raid_default',
    );
    expect((await alerts.receive(ev({ type: 'gift_recipient' }))).outcome).toBe(
      'absorbed',
    );
  });

  it('the Ballon draws only among the animations chosen for each event; back to the usual alerts when off', async () => {
    await shop.updateSettings(CH, {
      rules: {
        halloween_alerts: true,
        halloween_ballon: { sub: [2], prime: [4], resub: [1, 3] },
      },
    });
    rolls = [0, 0.99];
    expect((await variantOf(ev({ type: 'sub', tier: '1000' })))!.id).toBe(
      'hw_ballon_sub_2',
    );
    rolls = [0.1];
    expect((await variantOf(ev({ type: 'sub', tier: 'prime' })))!.id).toBe(
      'hw_ballon_prime_4',
    );
    rolls = [0.99];
    expect(
      (await variantOf(ev({ type: 'resub', tier: '1000', months: 2 })))!.id,
    ).toBe('hw_ballon_resub_3');
    await shop.updateSettings(CH, { rules: { halloween_alerts: false } });
    expect((await variantOf(ev({ type: 'sub', tier: '1000' })))!.id).toBe(
      'eren_sub',
    );
    // An invalid pool is refused by the rules' schema (never an empty draw).
    await expect(
      shop.updateSettings(CH, {
        rules: { halloween_ballon: { sub: [], prime: [1], resub: [1] } },
      }),
    ).rejects.toThrow();
  });

  it('a redelivered event: one alert, the variant decided the first time (even if the profile changed since)', async () => {
    await shop.updateSettings(CH, { rules: { halloween_alerts: true } });
    const e = ev({ source_event_id: 'tw-same' });
    const first = await alerts.receive(e);
    await shop.updateSettings(CH, { rules: { halloween_alerts: false } });
    const again = await alerts.receive(e);
    expect(again.outcome).toBe('duplicate');
    expect(again.alert!.alert_id).toBe(first.alert!.alert_id);
    expect(again.alert!.variant.id).toBe('hw_follow_miss_minute');
  });

  it('a Studio test may ask for the Halloween variant while the profile is off; a real Twitch event never can', async () => {
    expect((await variantOf(ev({ test_profile: 'halloween' })))!.id).toBe(
      'hw_follow_miss_minute',
    );
    expect(
      (await variantOf(ev({ source: 'twitch', test_profile: 'halloween' })))!
        .id,
    ).toBe('follow_dofus_ebene');
    expect((await variantOf(ev()))!.id).toBe('follow_dofus_ebene');
  });

  it('pure rule: every Halloween variant has its media named and a usual fallback for each covered event', () => {
    const profile: AlertProfile = { halloween: true, ballon: ALL };
    for (const v of HALLOWEEN_VARIANTS) {
      expect(v.video).toMatch(/^Halloween .+\.webm$/);
      expect(v.id).toMatch(/^hw_[a-z0-9_]+$/);
    }
    const d = decideAlert(ev({ type: 'bits', bits: 5 }), () => 0, profile);
    expect(d.outcome).toBe('below_threshold');
  });
});

describe('variants per family (Studio › Alertes › Variantes, 30/10)', () => {
  const outcome = async (e: AlertEventInput) =>
    (await alerts.receive(e)).outcome;

  it('nothing saved: exactly the behaviour so far (profile off → usual, on → Halloween)', async () => {
    expect(await alerts.variantSettings(CH)).toEqual({ families: {} });
    expect((await variantOf(ev()))!.id).toBe('follow_dofus_ebene');
    await shop.updateSettings(CH, { rules: { halloween_alerts: true } });
    expect((await variantOf(ev()))!.id).toBe('hw_follow_miss_minute');
  });

  it('per family: usual only, Halloween only (even profile off, with its fallback), off = recorded, not animated', async () => {
    await alerts.updateVariantSettings(CH, {
      families: { follow: 'usual', sub: 'halloween', raid: 'off' },
    });
    await shop.updateSettings(CH, { rules: { halloween_alerts: true } });
    expect((await variantOf(ev()))!.id).toBe('follow_dofus_ebene'); // ignores the profile
    await shop.updateSettings(CH, { rules: { halloween_alerts: false } });
    const sub = (await variantOf(ev({ type: 'sub', tier: '1000' })))!;
    expect(sub.id).toMatch(/^hw_ballon_sub_[1-4]$/);
    expect(sub.fallback?.id).toBe('eren_sub');
    // Prime is its own family: still « auto » (profile off → the usual Eren).
    expect((await variantOf(ev({ type: 'sub', tier: 'prime' })))!.id).toBe(
      'eren_sub',
    );
    expect(await outcome(ev({ type: 'raid', viewers: 12 }))).toBe('disabled');
    const rows = await db.query<{ outcome: string }>(
      `select outcome from alert_events where type = 'raid'`,
    );
    expect(rows.map((r) => r.outcome)).toEqual(['disabled']);
    expect(
      (await db.query(`select 1 from alert_items where type = 'raid'`)).length,
    ).toBe(0);
  });

  it('follow: only the checked usual variants are drawn (their weights kept between them)', async () => {
    await alerts.updateVariantSettings(CH, {
      follow: ['follow_eren', 'follow_discord'],
    });
    rolls = [0];
    expect((await variantOf(ev()))!.id).toBe('follow_eren');
    rolls = [0.999];
    expect((await variantOf(ev()))!.id).toBe('follow_discord');
    // Saving another family keeps the follow selection.
    await alerts.updateVariantSettings(CH, { families: { gift: 'usual' } });
    expect(await alerts.variantSettings(CH)).toEqual({
      families: { gift: 'usual' },
      follow: ['follow_eren', 'follow_discord'],
    });
  });

  it('refused, nothing saved: empty selection, unknown variant, Halloween on a family without one, unknown family', async () => {
    for (const bad of [
      { follow: [] },
      { follow: ['nope'] },
      { families: { raid: 'halloween' } },
      { families: { cheer: 'off' } },
      { families: { follow: 'sometimes' } },
    ])
      await expect(alerts.updateVariantSettings(CH, bad)).rejects.toThrow();
    expect(await alerts.variantSettings(CH)).toEqual({ families: {} });
  });

  it('the « Alertes Halloween » tests still play the Halloween media, whatever the families say', async () => {
    await alerts.updateVariantSettings(CH, { families: { follow: 'off' } });
    expect((await variantOf(ev({ test_profile: 'halloween' })))!.id).toBe(
      'hw_follow_miss_minute',
    );
    expect(await outcome(ev())).toBe('disabled');
  });
});
