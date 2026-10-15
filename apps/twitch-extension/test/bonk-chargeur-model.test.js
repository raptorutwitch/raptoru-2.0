import { describe, expect, it } from 'vitest';
import {
  BONK_SPEEDS,
  createChargeurModel,
} from '../extension/shared/bonk-chargeur-model.js';

const POG = { id: 'twitch:pog' };
const FIRE = { id: 'unicode:1f525' };
const KEK = { id: 'twitch:kek' };
const load = (c, ...emotes) => emotes.forEach((e) => c.add(e));

describe('chargeur (Bonk lot 5) — loading', () => {
  it('one click = one munition, left to right, quantity per emote; capacity = Core max', () => {
    const c = createChargeurModel({ maxShots: 3 });
    expect(c.add(POG)).toEqual({ ok: true, first: true });
    load(c, FIRE, POG);
    expect(c.state.items.map((i) => [i.emote.id, i.qty])).toEqual([
      ['twitch:pog', 2],
      ['unicode:1f525', 1],
    ]);
    expect(c.add(KEK)).toEqual({ ok: false, reason: 'full' });
    expect(c.total()).toBe(3);
  });

  it('dec / remove / clear + undo', () => {
    const c = createChargeurModel({ maxShots: 10 });
    load(c, POG, POG, FIRE);
    c.dec('twitch:pog');
    expect(c.leftOf('twitch:pog')).toBe(1);
    c.remove('unicode:1f525');
    expect(c.total()).toBe(1);
    const snapshot = c.clear();
    expect(c.total()).toBe(0);
    c.restore(snapshot);
    expect(c.total()).toBe(1);
  });
});

describe('chargeur — Manuel', () => {
  it('each click fires the next munition in order; the price is one Bonk; no automatic salve', () => {
    const c = createChargeurModel({ maxShots: 10 });
    load(c, POG, POG, FIRE);
    expect(c.action()).toBe('fire');
    expect(c.price(200)).toBe(200);
    expect(c.salve()).toBeNull(); // never in Manuel
    expect([c.fire(), c.fire(), c.fire()].map((s) => s.emote.id)).toEqual([
      'twitch:pog',
      'twitch:pog',
      'unicode:1f525',
    ]);
    expect(c.fire()).toBeNull();
    expect(c.action()).toBe('rearm'); // no Boucle: a free reload instead
    c.rearm();
    expect(c.remaining()).toBe(3);
  });

  it('a refused shot gives its munition back (only the last one)', () => {
    const c = createChargeurModel({ maxShots: 10 });
    load(c, POG, FIRE);
    const a = c.fire();
    c.unfire(a);
    expect(c.remaining()).toBe(2);
    const b = c.fire();
    c.fire();
    c.unfire(b); // a later shot already left: nothing to give back
    expect(c.remaining()).toBe(0);
  });
});

describe('chargeur — Auto', () => {
  it('one click = every remaining munition; price = remaining × cost; locked until the end', () => {
    const c = createChargeurModel({ maxShots: 10 });
    load(c, POG, POG, FIRE, KEK, KEK, KEK, POG);
    c.fire(); // still Manuel: one shot
    expect(c.setMode('auto')).toBe(true);
    expect(c.remaining()).toBe(6); // the switch keeps the chargeur
    expect(c.price(200)).toBe(1200);
    const shots = c.salve();
    // One thumbnail per emote: the 3rd POG joined the first POG, firing order = carousel order.
    expect(shots.map((e) => e.id)).toEqual([
      'twitch:pog',
      'twitch:pog',
      'unicode:1f525',
      'twitch:kek',
      'twitch:kek',
      'twitch:kek',
    ]);
    expect(c.state.busy).toBe(true);
    expect(c.setMode('manual')).toBe(false); // switch locked during the salve
    expect(c.add(POG)).toEqual({ ok: false, reason: 'busy' });
    expect(c.salve()).toBeNull(); // no double salve
    c.endSalve(true);
    expect(c.remaining()).toBe(7); // reloaded, selection kept
    expect(c.setMode('manual')).toBe(true);
    expect(c.price(200)).toBe(200);
  });

  it('a refused salve consumes nothing', () => {
    const c = createChargeurModel({ maxShots: 10 });
    load(c, POG, FIRE);
    c.setMode('auto');
    c.salve();
    c.endSalve(false);
    expect(c.remaining()).toBe(2);
    expect(c.state.busy).toBe(false);
  });

  it('Manuel → Auto → Manuel: price recalculated both ways, chargeur untouched', () => {
    const c = createChargeurModel({ maxShots: 10 });
    for (let n = 0; n < 7; n++) c.add(POG);
    const prices = [];
    for (const mode of ['manual', 'auto', 'manual', 'auto']) {
      c.setMode(mode);
      prices.push(c.price(200));
    }
    expect(prices).toEqual([200, 1400, 200, 1400]);
    expect(c.remaining()).toBe(7);
  });

  it('4 speeds, clicked in order, clamped to Core bounds', () => {
    const c = createChargeurModel({ maxShots: 10 });
    const bounds = { min: 90, max: 600 };
    const seen = [];
    for (let n = 0; n < 4; n++) {
      c.cycleSpeed();
      seen.push([BONK_SPEEDS[c.state.speed - 1].name, c.cadenceMs(bounds)]);
    }
    expect(seen).toEqual([
      ['Rapide', 160],
      ['Très rapide', 95],
      ['Lent', 420],
      ['Moyen', 260],
    ]);
    c.cycleSpeed();
    c.cycleSpeed(); // Très rapide
    expect(c.cadenceMs({ min: 120, max: 600 })).toBe(120);
  });
});

describe('chargeur — during a salve', () => {
  it('the button keeps showing the salve (remaining price), never « Recharger », until it has played', () => {
    const c = createChargeurModel({ maxShots: 10 });
    load(c, POG, FIRE);
    c.setMode('auto');
    c.salve();
    c.state.pos = 2; // the view drains the munitions at the cadence
    expect(c.action()).toBe('send');
    expect(c.price(200)).toBe(0);
    c.endSalve(true);
    expect(c.action()).toBe('send');
    expect(c.price(200)).toBe(400);
  });
});
