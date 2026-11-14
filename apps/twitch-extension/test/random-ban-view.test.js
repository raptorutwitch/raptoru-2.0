import { describe, expect, it } from 'vitest';
import {
  exactViewer,
  reelSchedule,
  carouselSlot,
  reelProgress,
  historyLine,
  matchViewers,
  resultModel,
  chargesModel,
  requestLine,
  sniperLine,
  sniperReadyText,
  waitText,
} from '../extension/shared/random-ban-model.js';

// Mini-jeux › Random Ban V5: the charges gauge is a PROJECTION of the Core's times (server_now, full_at) — the local
// clock only measures the time elapsed since the read, and a charge back asks for a new read.

const MIN = 60_000;
const NOW = '2026-11-12T20:10:00.000Z';
const after = (min) => new Date(Date.parse(NOW) + min * MIN).toISOString();
/** The Core's charges: 3 at most, one back every 10 min, `full` in `min` minutes. */
const core = (available, min) => ({
  available,
  max: 3,
  recharge_ms: 10 * MIN,
  next_at: min ? after(min - (Math.ceil(min / 10) - 1) * 10) : null,
  full_at: min ? after(min) : null,
  server_now: NOW,
});

describe('chargesModel', () => {
  it('no charge limit (Studio: 0): no gauge', () => {
    expect(chargesModel({ ...core(0, 0), max: 0 }, 0, 0)).toBeNull();
  });

  it('full: 3 of 3, nothing to wait for', () => {
    expect(chargesModel(core(3, 0), 0, 0)).toMatchObject({
      available: 3,
      level: 3,
      next_in_ms: 0,
      stale: false,
    });
  });

  it('from the server times, whatever the local clock says; the recharging one fills continuously', () => {
    // Empty, full in 30 min. A local clock 3 h off: only the elapsed time (4 min) counts.
    const readAt = Date.parse('2026-11-12T23:00:00Z');
    const m = chargesModel(core(0, 30), readAt, readAt + 4 * MIN);
    expect(m).toMatchObject({
      available: 0,
      next_in_ms: 6 * MIN,
      full_in_ms: 26 * MIN,
      stale: false,
    });
    expect(m.level).toBeCloseTo(0.4);
  });

  it('a charge back: stale (read the Core again)', () => {
    const m = chargesModel(core(1, 15), 0, 5 * MIN);
    expect(m).toMatchObject({
      available: 2,
      stale: true,
      next_in_ms: 10 * MIN,
    });
  });

  it('reduced motion: whole minutes only', () => {
    const m = chargesModel(core(0, 30), 0, 90_000, { reducedMotion: true });
    expect(m.level).toBeCloseTo(0.1); // 28 min 30 s left → shown as 29 min
  });
});

describe('texts', () => {
  it('wait text', () => {
    expect(waitText(45_000)).toBe('45 s');
    expect(waitText(250_000)).toBe('4 min 10 s');
    expect(waitText(16 * MIN)).toBe('16 min');
    expect(waitText(61_000, { seconds: false })).toBe('2 min');
  });

  it('request lines in the viewer’s words', () => {
    const base = {
      buyer: { id: '1' },
      source: 'extension',
      price_paid: 30_000,
      created_at: 'x',
    };
    expect(requestLine({ ...base, status: 'queued' })).toMatchObject({
      what: 'payé · en file',
      open: true,
      via: 'extension',
    });
    expect(
      requestLine({
        ...base,
        status: 'confirmed',
        target: { id: '2', name: 'Kiwi' },
        duration_s: 300,
      }).what,
    ).toBe('Kiwi exclu 5 min');
    expect(
      requestLine({
        ...base,
        status: 'confirmed',
        target: { id: '1', name: 'Moi' },
        duration_s: 300,
      }).what,
    ).toContain('CSC');
    expect(requestLine({ ...base, status: 'failed' })).toMatchObject({
      what: 'sans effet · remboursé',
      open: false,
    });
    expect(
      requestLine({
        ...base,
        source: 'channel_points',
        price_paid: null,
        status: 'flop',
      }),
    ).toMatchObject({ paid: 'points de chaîne', via: 'points de chaîne' });
    expect(requestLine({ ...base, status: 'queued' }).paid).toBe(
      '30 000 Jetons',
    );
  });
});

describe('Sniper texts', () => {
  it('ready / for glory, from the server times', () => {
    const now = '2026-11-12T20:00:00.000Z';
    expect(
      sniperReadyText({ ready: true, ready_at: null, bonus: 2000 }, 0, 0, now),
    ).toContain('+2 000 Jetons');
    expect(
      sniperReadyText(
        { ready: false, ready_at: '2026-11-12T20:12:00.000Z', bonus: 2000 },
        0,
        0,
        now,
      ),
    ).toBe(
      'Sniper pour la gloire : prime possible dans 12 min (aucun Random Ban d’ici là).',
    );
  });
  it('one line per decision; nothing without a prediction', () => {
    expect(sniperLine({ wish: null })).toBeNull();
    expect(
      sniperLine({ wish: { name: 'Kiwi' }, sniper: 'hit', sniper_bonus: 2000 }),
    ).toBe('🎯 Kiwi · SNIPER ! prime gagnée +2 000');
    expect(sniperLine({ wish: { name: 'Kiwi' }, sniper: 'glory_hit' })).toBe(
      '🎯 Kiwi · SNIPER ! pour la gloire (sans prime)',
    );
  });
});

// Refonte 13/11 — the Sniper typed freely, with suggestions; the stage's result and the history panel's lines.
const POOL = [
  { id: '1', login: 'pika', name: 'Pika' },
  { id: '2', login: 'pikachuu', name: 'Pikachuu' },
  { id: '3', login: 'kiwitv', name: 'KiwiTV' },
  { id: '4', login: 'kiwi', name: 'Kiwi' },
  { id: '5', login: 'lunablue', name: 'LunaBlue' },
];

describe('Sniper suggestions', () => {
  it('the exact account first (login or name, « @ » and case aside), then prefixes', () => {
    const s = matchViewers(POOL, '@PIKA');
    expect(s.map((x) => x.id)).toEqual(['1', '2']);
    expect(s[0].exact).toBe(true);
    expect(s[1].exact).toBe(false);
  });
  it('a small typo is suggested, never marked exact', () => {
    const s = matchViewers(POOL, 'lunablu3');
    expect(s.map((x) => x.id)).toEqual(['5']);
    expect(s[0].exact).toBe(false);
    expect(matchViewers(POOL, 'zz')).toEqual([]);
    expect(matchViewers(POOL, '   ')).toEqual([]);
  });
  it('exactViewer: the one sure account only', () => {
    expect(exactViewer(POOL, ' @kiwi ')?.id).toBe('4');
    expect(exactViewer(POOL, 'kiw')).toBeNull();
    expect(
      exactViewer(
        [
          { id: 'a', login: 'x1', name: 'Same' },
          { id: 'b', login: 'x2', name: 'same' },
        ],
        'same',
      ),
    ).toBeNull();
  });
});

describe('the stage and the history', () => {
  const base = {
    request_id: 'r1',
    source: 'extension',
    buyer: { id: '9', name: 'Alice' },
    target: { id: '1', name: 'Pika' },
    duration_s: 300,
    price_paid: 30_000,
    created_at: '2026-11-13T20:00:00Z',
  };
  it('a strip to scroll, then the outcome', () => {
    expect(
      resultModel({ ...base, status: 'searching', target: null }),
    ).toMatchObject({ phase: 'wait', open: true });
    expect(
      resultModel({
        ...base,
        status: 'timeout_requested',
        strip: { items: [{ id: '1' }], stop: 0 },
      }),
    ).toMatchObject({ phase: 'reel', text: 'Sanction en cours…' });
    expect(resultModel({ ...base, status: 'confirmed' })).toMatchObject({
      text: 'Exclu 5 min',
      tone: 'ok',
    });
    expect(
      resultModel({
        ...base,
        status: 'confirmed',
        target: { id: '9', name: 'Alice' },
      }).text,
    ).toMatch(/CSC/);
    expect(resultModel({ ...base, status: 'failed' })).toMatchObject({
      tone: 'bad',
    });
  });
  it('the Sniper: hit with its bonus once in the words, unresolved said as such', () => {
    const hit = resultModel({
      ...base,
      status: 'confirmed',
      wish: { id: '1', name: 'Pika' },
      sniper: 'hit',
      sniper_bonus: 2000,
    });
    expect(hit.sniper).toMatchObject({ hit: true, bonus: 2000 });
    expect(hit.sniper).toMatchObject({ tone: 'hit' });
    expect(hit.sniper.text).toMatch(/^🎯 Touché : Pika · \+2.000 Jetons$/);
    const miss = resultModel({ ...base, status: 'confirmed', wish: { id: '1', name: 'Pika' }, sniper: 'miss' });
    expect(miss.sniper).toMatchObject({ hit: false, tone: 'miss', text: '🎯 Raté · tu visais Pika' });
    const gloryMiss = resultModel({ ...base, status: 'confirmed', wish: { id: '1', name: 'Pika' }, sniper: 'glory' });
    expect(gloryMiss.sniper.text).toBe('🎯 Raté · tu visais Pika (pour la gloire)');
    const gloryHit = resultModel({ ...base, status: 'confirmed', wish: { id: '1', name: 'Pika' }, sniper: 'glory_hit' });
    expect(gloryHit.sniper).toMatchObject({ hit: true, bonus: 0, tone: 'hit', text: '🎯 Touché : Pika · pour la gloire' });
    // Not decided yet (the target may already show): never a success, never a failure.
    const armed = resultModel({ ...base, status: 'timeout_requested', wish: { id: '1', name: 'Pika' }, sniper: 'armed' });
    expect(armed.sniper).toMatchObject({ hit: false, tone: 'wait', text: '🎯 Visé : Pika · verdict…' });
    const un = resultModel({
      ...base,
      status: 'confirmed',
      wish: { id: null, name: null, text: 'Pikka' },
      sniper: 'unresolved',
    });
    expect(un.sniper).toMatchObject({
      hit: false,
      name: 'Pikka',
      tone: 'wait',
      text: '🎯 « Pikka » · vérifié par un modérateur',
    });
  });
  it('a history line: who, who was drawn, the result, the price, the Sniper', () => {
    const l = historyLine({
      ...base,
      status: 'confirmed',
      wish: { id: '2', name: 'Pikachuu' },
      sniper: 'miss',
    });
    expect(l).toMatchObject({
      buyer: 'Alice',
      target: 'Pika',
      result: 'Exclu 5 min',
    });
    expect(l.meta).toMatch(/extension · 30/);
    expect(l.sniper).toBe('🎯 Pikachuu · raté');
  });
});

// V3 (14/11) — the recovery gauge slides continuously between the tier marks; the reel slows down to its stop.
describe('reel rhythm', () => {
  it('fast first, slower at the end, about the total asked', () => {
    const d = reelSchedule(23, 3400);
    expect(d).toHaveLength(23);
    expect(d[22]).toBeGreaterThan(d[0] * 5);
    for (let i = 1; i < d.length; i++)
      expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
    expect(Math.abs(d.reduce((a, b) => a + b, 0) - 3400)).toBeLessThan(25);
    expect(reelSchedule(1)).toEqual([0]);
  });
});

// V4 (14/11) — the machine is a carousel: the centre whole, the neighbours smaller and darker; a clean stop.
describe('draw machine carousel', () => {
  it('the centre is whole and in front; neighbours smaller, darker, symmetric', () => {
    expect(carouselSlot(0)).toMatchObject({
      x: 0,
      scale: 1,
      opacity: 1,
      front: true,
    });
    const r = carouselSlot(1);
    const l = carouselSlot(-1);
    expect(r.x).toBeCloseTo(-l.x);
    expect(r.scale).toBeLessThan(1);
    expect(r.opacity).toBeLessThan(1);
    expect(r.front).toBe(false);
    expect(carouselSlot(3).opacity).toBe(0); // far ones fade out
  });
  it('moving continuously: the scale shrinks as a portrait leaves the centre', () => {
    expect(carouselSlot(0.3).scale).toBeLessThan(1);
    expect(carouselSlot(0.3).scale).toBeGreaterThan(carouselSlot(0.8).scale);
  });
  it('the reel: fast at once, slow at the end, exactly on the target at the end (no overshoot)', () => {
    expect(reelProgress(0)).toBe(0);
    expect(reelProgress(1)).toBe(1);
    expect(reelProgress(0.25)).toBeGreaterThan(0.6);
    let last = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const p = reelProgress(t);
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThanOrEqual(1);
      last = p;
    }
  });
});
