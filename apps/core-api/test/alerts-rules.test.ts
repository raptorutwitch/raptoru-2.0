import type { AlertEventInput } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { alertData, decideAlert, weighted } from '../src/alerts/rules.js';
import {
  ALERT_VARIANTS,
  BITS_MINIMUM,
  FOLLOW_WEIGHTS,
} from '../src/alerts/variants.js';

// Twitch alerts V1 (A1) — legacy variants and selection rules against docs/TWITCH_ALERTS_PARITY_2026-10.md § 1.

const ev = (over: Partial<AlertEventInput>): AlertEventInput => ({
  channel_id: '900800',
  source: 'simulation',
  source_event_id: 'e1',
  type: 'follow',
  actor: { id: '1', login: 'alice', display_name: 'Alice' },
  ...over,
});
const idOf = (e: AlertEventInput, r: number) => {
  const d = decideAlert(e, () => r);
  return d.outcome === 'queued' ? d.variant.id : d.outcome;
};

describe('follow: five variants, SAMMI weights 20/20/20/20/1', () => {
  it('weights exactly as the deck; the random source decides deterministically', () => {
    expect(FOLLOW_WEIGHTS).toEqual([
      ['follow_dofus_ebene', 20],
      ['follow_dofus_eliatrope', 20],
      ['follow_dofus_emeraude', 20],
      ['follow_eren', 20],
      ['follow_discord', 1],
    ]);
    // total 81: [0,20) ébène, [20,40) éliatrope, [40,60) émeraude, [60,80) Eren, [80,81) Discord
    expect(
      [0, 19.9, 20, 40, 60, 79.9, 80, 80.99].map((x) => idOf(ev({}), x / 81)),
    ).toEqual([
      'follow_dofus_ebene',
      'follow_dofus_ebene',
      'follow_dofus_eliatrope',
      'follow_dofus_emeraude',
      'follow_eren',
      'follow_eren',
      'follow_discord',
      'follow_discord',
    ]);
  });

  it('over many draws, Discord is rare (≈ 1/81)', () => {
    let seed = 7;
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const counts: Record<string, number> = {};
    for (let i = 0; i < 81_000; i++) {
      const id = weighted(FOLLOW_WEIGHTS, rng);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts.follow_discord).toBeGreaterThan(700);
    expect(counts.follow_discord).toBeLessThan(1300);
    expect(counts.follow_eren).toBeGreaterThan(18_000);
  });
});

describe('other events', () => {
  it('sub and resub: the same Eren variant, two distinct event types', () => {
    expect(idOf(ev({ type: 'sub' }), 0.5)).toBe('eren_sub');
    expect(idOf(ev({ type: 'resub', months: 12 }), 0.5)).toBe('eren_sub');
  });

  it('community gift thresholds 1 / 5 / 10 / 20', () => {
    const at = (count: number) =>
      idOf(ev({ type: 'gift_community', count }), 0);
    expect([1, 4, 5, 9, 10, 19, 20, 100].map(at)).toEqual([
      'subgift_1',
      'subgift_1',
      'subgift_5',
      'subgift_5',
      'subgift_10',
      'subgift_10',
      'subgift_20',
      'subgift_20',
    ]);
  });

  it('targeted gift alerts; a community recipient is absorbed (never its own alert)', () => {
    expect(idOf(ev({ type: 'gift_targeted' }), 0)).toBe('subgift_targeted');
    expect(
      idOf(ev({ type: 'gift_recipient', community_gift_id: 'c1' }), 0),
    ).toBe('absorbed');
  });

  it(`bits: below ${BITS_MINIMUM} no alert, from ${BITS_MINIMUM} the bits variant`, () => {
    expect(idOf(ev({ type: 'bits', bits: 9 }), 0)).toBe('below_threshold');
    expect(idOf(ev({ type: 'bits', bits: 10 }), 0)).toBe('bits_default');
  });

  it('raid: its found media (A2), text / position / timings flagged provisional', () => {
    expect(idOf(ev({ type: 'raid', viewers: 42 }), 0)).toBe('raid_default');
    expect(ALERT_VARIANTS.raid_default).toMatchObject({
      video: 'Raid Titan.webm',
      audio: 'Raptoru_Alerte_Raid_Sound.mp3',
      keepAudio: true,
      text: '{pseudo} débarque avec {viewers} viewers !',
      mediaMs: 19916,
      provisional: true,
    });
  });

  it('donation: MoneyTest with its TTS metadata', () => {
    expect(idOf(ev({ type: 'donation' }), 0)).toBe('don_moneytest');
    expect(ALERT_VARIANTS.don_moneytest!.tts!.template).toBe(
      '{pseudo} a donné {amount}. Message du don : {message}',
    );
  });
});

describe('legacy timings copied exactly', () => {
  it('a sample of every family', () => {
    expect(ALERT_VARIANTS.follow_dofus_emeraude).toMatchObject({
      showAt: 2000,
      hideAt: 3300,
      textTop: '29.8%',
      maxFontSize: 35,
    });
    expect(ALERT_VARIANTS.eren_sub!.subtitles).toEqual([
      { text: "Qu'est-ce que tu fous ?!", showAt: 300, hideAt: 1400 },
      {
        text: 'Remercie {pseudo} pour son abonnement !',
        showAt: 1500,
        hideAt: 4300,
      },
    ]);
    expect(ALERT_VARIANTS.subgift_20).toMatchObject({
      showAt: 2279,
      fadeOutAt: 5745,
      hideAt: 6093,
      volume: 0.15,
      zone: { x: 820, y: 261, w: 319, h: 48 },
      priority: 50,
    });
    expect(ALERT_VARIANTS.bits_default).toMatchObject({
      showAt: 800,
      fadeOutAt: 3800,
      hideAt: 4150,
      duration: 3850,
      zone: { x: 761, y: 156, w: 400, h: 80 },
      priority: 20,
    });
    expect(ALERT_VARIANTS.don_moneytest).toMatchObject({
      showAt: 2660,
      hideAt: 6800,
      duration: 7600,
      priority: 40,
    });
    expect(
      Object.values(ALERT_VARIANTS).map((v) => [v.id, v.priority]),
    ).toContainEqual(['follow_discord', 10]);
  });
});

describe('display data (untrusted)', () => {
  it('anonymous gifter → « Un généreux anonyme »; recipient, count, bits, donation amount', () => {
    expect(
      alertData(
        ev({
          type: 'gift_targeted',
          actor: undefined,
          anonymous: true,
          recipient: { display_name: 'Bob' },
        }),
      ),
    ).toMatchObject({
      pseudo: 'Un généreux anonyme',
      recipient: 'Bob',
      anonymous: true,
    });
    expect(alertData(ev({ type: 'gift_community', count: 5 }))).toMatchObject({
      pseudo: 'Alice',
      count: 5,
      anonymous: false,
    });
    expect(alertData(ev({ type: 'bits', bits: 100 }))).toMatchObject({
      amount: '100',
    });
    expect(
      alertData(
        ev({
          type: 'donation',
          amount: { value: 1250, decimal_place: 2, currency: 'EUR' },
          message: '<b>gg</b>',
        }),
      ),
    ).toMatchObject({ amount: '12.50', currency: 'EUR', message: '<b>gg</b>' });
  });
});
