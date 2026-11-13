import { describe, expect, it } from 'vitest';
import {
  exactViewer,
  historyLine,
  matchViewers,
  resultModel,
  gaugeModel,
  requestLine,
  sniperLine,
  sniperReadyText,
  waitText,
} from '../extension/shared/random-ban-model.js';

// Mini-jeux › Random Ban: the gauge is a PROJECTION of the Core's times (server_now, next_drop_at, normal_at) — the
// local clock only measures the time elapsed since the read, and a fallen step asks for a new read.

const MIN = 60_000;
const quote = {
  level: 2,
  price: 50_000,
  next_price: 30_000,
  server_now: '2026-11-12T20:10:00.000Z',
  next_drop_at: '2026-11-12T20:15:00.000Z',
  normal_at: '2026-11-12T20:25:00.000Z',
};

describe('gaugeModel', () => {
  it('normal price: no gauge', () => {
    expect(
      gaugeModel({ ...quote, level: 0, next_drop_at: null }, 0, 0, 5 * MIN),
    ).toBeNull();
  });

  it('from the server times, whatever the local clock says', () => {
    // A local clock 3 h off: only the elapsed time (90 s) counts.
    const readAt = Date.parse('2026-11-12T23:00:00Z');
    const g = gaugeModel(quote, readAt, readAt + 90_000, 5 * MIN);
    expect(g).toMatchObject({
      price: 50_000,
      next_price: 30_000,
      next_in_ms: 210_000,
      normal_in_ms: 810_000,
      stale: false,
    });
    expect(g.fraction).toBeCloseTo(0.7);
  });

  it('the step falls: stale (read the Core again), the amount shown never changes by itself', () => {
    const g = gaugeModel(quote, 0, 5 * MIN, 5 * MIN);
    expect(g).toMatchObject({ next_in_ms: 0, stale: true, price: 50_000 });
  });

  it('reduced motion: whole minutes only', () => {
    const g = gaugeModel(quote, 0, 90_000, 5 * MIN, { reducedMotion: true });
    expect(g.fraction).toBeCloseTo(4 / 5); // 3 min 30 s left → shown as 4 of 5 minutes
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
    expect(hit.sniper.text).toMatch(/SNIPER ! \+2.000 Jetons/);
    const un = resultModel({
      ...base,
      status: 'confirmed',
      wish: { id: null, name: null, text: 'Pikka' },
      sniper: 'unresolved',
    });
    expect(un.sniper).toMatchObject({
      hit: false,
      name: 'Pikka',
      text: 'Pronostic à vérifier',
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
