import type { AlertEventInput } from '@raptoru/schemas';
import { DEFAULT_EVENT_RULES } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlertsService } from '../src/alerts/service.js';
import type { Db } from '../src/db/db.js';
import { labEconomy } from '../src/economy/economy.js';
import { EventShopService } from '../src/event-shop/service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Chaudron des subs (docs/HALLOWEEN.md § 13): the subgoal counted from the Twitch events the Core already records —
// sub / targeted gift 1, community gift its count, its recipients nothing (absorbed), resub 1 when counted; a
// redelivered event never counts twice; Production ignores simulations; reset and manual correction by Studio.

const CH = '900900';
let db: Db;
let clock: FakeClock;
let alerts: AlertsService;
let prod: EventShopService;
let lab: EventShopService;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(new Date('2026-10-31T18:00:00Z'));
  alerts = new AlertsService(db, clock, () => 0);
  prod = new EventShopService(db, clock, labEconomy);
  lab = new EventShopService(db, clock, labEconomy, {
    rewardSimulations: true,
  });
});

let n = 0;
const ev = (over: Partial<AlertEventInput> & Record<string, unknown>) =>
  alerts.receive({
    channel_id: CH,
    source: 'twitch',
    source_event_id: `c-${++n}`,
    type: 'sub',
    tier: '1000',
    actor: { id: '1', login: 'ana', display_name: 'Ana' },
    ...over,
  } as AlertEventInput);
const on = (over: Partial<typeof DEFAULT_EVENT_RULES.cauldron> = {}) =>
  prod.updateSettings(CH, {
    rules: {
      cauldron: {
        ...DEFAULT_EVENT_RULES.cauldron,
        enabled: true,
        goal: 20,
        ...over,
      },
    },
  });

describe('Chaudron des subs', () => {
  it('off by default: nothing counted, nothing shown', async () => {
    await ev({});
    expect(await prod.cauldron(CH)).toEqual({ enabled: false });
  });

  it('counts sub, resub, targeted gift 1, a community gift its count, its recipients nothing; once per event', async () => {
    await on();
    await ev({});
    await ev({ type: 'resub', months: 4 });
    await ev({ type: 'sub', tier: 'prime' });
    await ev({
      type: 'gift_targeted',
      recipient: { id: '2', login: 'bob', display_name: 'Bob' },
    });
    await ev({ type: 'gift_community', count: 5, community_gift_id: 'g1' });
    for (let i = 0; i < 5; i++)
      await ev({
        type: 'gift_recipient',
        community_gift_id: 'g1',
        recipient: { id: `r${i}`, login: `r${i}`, display_name: `R${i}` },
      });
    const same = { source_event_id: 'same-id' };
    await ev(same);
    await ev(same); // redelivered by Twitch / the bot
    await ev({ type: 'follow' });
    await ev({ type: 'bits', bits: 500 });
    const c = await prod.cauldron(CH);
    expect(c).toMatchObject({
      enabled: true,
      goal: 20,
      count: 1 + 1 + 1 + 1 + 5 + 1,
    });
    if (!c.enabled) throw new Error('enabled');
    expect(c.recent[0]).toMatchObject({ type: 'sub', units: 1, name: 'Ana' });
    expect(c.recent).toHaveLength(5);
  });

  it('resubs can be left out; Production ignores simulations, the Lab counts them', async () => {
    await on({ count_resubs: false });
    await ev({ type: 'resub', months: 2 });
    await ev({ source: 'simulation' });
    expect((await prod.cauldron(CH)) as { count: number }).toMatchObject({
      count: 0,
    });
    expect((await lab.cauldron(CH)) as { count: number }).toMatchObject({
      count: 1,
    });
  });

  it('a new goal from now (reset) and a manual correction; never below 0; a restart recounts the same rows', async () => {
    await on();
    await ev({});
    await ev({});
    clock.set(new Date('2026-10-31T19:00:00Z'));
    await on({ since: clock.now().toISOString() });
    expect(await prod.cauldron(CH)).toMatchObject({ count: 0 });
    await ev({ type: 'gift_community', count: 10 });
    await on({ since: clock.now().toISOString(), adjust: 3 });
    expect(await prod.cauldron(CH)).toMatchObject({ count: 13 });
    await on({ since: clock.now().toISOString(), adjust: -50 });
    expect(await prod.cauldron(CH)).toMatchObject({ count: 0 });
    // Another Core instance (a restart): the same count from the same rows.
    await on({ since: clock.now().toISOString() });
    const again = new EventShopService(db, clock, labEconomy);
    expect(await again.cauldron(CH)).toMatchObject({ count: 10 });
  });

  it('settings are checked: goal ≥ 1, a real date', async () => {
    await expect(on({ goal: 0 })).rejects.toThrow();
    await expect(on({ since: 'hier' })).rejects.toThrow();
  });
});
