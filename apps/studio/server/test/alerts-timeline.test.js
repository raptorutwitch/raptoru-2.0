import { describe, expect, it } from 'vitest';
import {
  dofusFontSize,
  donationSizes,
  endPlan,
  fill,
  formatAmount,
  giftCounterDuration,
  schedule,
  NAME_COLORS,
  pickNameColor,
  templateParts,
  textParts,
} from '../alerts-player/timeline.js';
import { ALERT_VARIANTS } from '../../../core-api/src/alerts/variants.ts';
import { playLeaseMs } from '../../../core-api/src/alerts/service.ts';

// Twitch alerts V1 (A2) — the pure part of the shared engine (OBS source = Studio preview), on the REAL catalogue:
// legacy formatting / sizing rules, the text steps of each variant and when an alert ends.

const V = ALERT_VARIANTS;

describe('legacy formatting and sizing', () => {
  it('formats the donation amount like the legacy page', () => {
    expect(formatAmount('5', 'EUR')).toBe('5€');
    expect(formatAmount('12.50', 'USD')).toBe('$12.50');
    expect(formatAmount('3', 'GBP')).toBe('£3');
    expect(formatAmount('7', 'CAD')).toBe('7 CAD');
    expect(formatAmount('5€', 'EUR')).toBe('5€');
    expect(formatAmount('', 'EUR')).toBe('');
  });

  it('fills templates with plain text (no HTML interpretation here)', () => {
    expect(fill('{pseudo} × {count}', { pseudo: '<b>x</b>', count: 5 })).toBe(
      '<b>x</b> × 5',
    );
    expect(fill('{pseudo} {unknown}', {})).toBe(' {unknown}');
    // Halloween resub (docs/HALLOWEEN.md § 14): the months of the event.
    expect(fill('se réabonne : {months} mois !', { months: 13 })).toBe(
      'se réabonne : 13 mois !',
    );
  });

  it('shrinks Dofus names over 14 characters, sizes the donation texts', () => {
    expect(dofusFontSize(14)).toBe(44);
    expect(dofusFontSize(28)).toBe(22);
    expect(
      donationSizes('a'.repeat(19), '1234.56€ x', 'm'.repeat(200)),
    ).toEqual({ name: 34, amount: 34, message: 17 });
    expect(donationSizes('court', '5€', '')).toEqual({
      name: 46,
      amount: 42,
      message: 26,
    });
  });

  it('counts gifts up in min(1500, 650 + 18 × N) ms', () => {
    expect(giftCounterDuration(1)).toBe(668);
    expect(giftCounterDuration(20)).toBe(1010);
    expect(giftCounterDuration(100)).toBe(1500);
  });
});

describe('text steps of each variant', () => {
  it('Eren sub: show, tremble 350 ms before the end, out', () => {
    expect(schedule(V.eren_sub)).toEqual([
      { at: 300, action: 'subtitle-show', index: 0 },
      { at: 1050, action: 'subtitle-tremble', index: 0 },
      { at: 1400, action: 'subtitle-out', index: 0 },
      { at: 1500, action: 'subtitle-show', index: 1 },
      { at: 3950, action: 'subtitle-tremble', index: 1 },
      { at: 4300, action: 'subtitle-out', index: 1 },
    ]);
  });

  it('bits, raid and gifts: show, fade, clear at the variant timings', () => {
    expect(schedule(V.bits_default).map((s) => [s.at, s.action])).toEqual([
      [800, 'text-show'],
      [3800, 'text-fade'],
      [4150, 'text-clear'],
    ]);
    expect(schedule(V.raid_default).map((s) => [s.at, s.action])).toEqual([
      [1500, 'text-show'],
      [7650, 'text-fade'],
      [8000, 'text-clear'],
    ]);
    const gift = schedule(V.subgift_5).map((s) => s.action);
    expect(gift).toEqual(['text-show', 'text-fade', 'text-clear']);
  });

  it('donation: text and the video fade-out', () => {
    expect(schedule(V.don_moneytest).map((s) => [s.at, s.action])).toEqual([
      [2660, 'text-show'],
      [6800, 'text-hide'],
      [6800, 'video-fade-out'],
    ]);
  });

  it('every follow variant shows its name', () => {
    for (const id of Object.keys(V).filter((k) => k.startsWith('follow_')))
      expect(schedule(V[id]).map((s) => s.action)[0]).toMatch(
        /text-show|subtitle-show/,
      );
  });
});

describe('end of an alert (real cycle, not the SAMMI fixed waits)', () => {
  it('a sound that plays on delays the end (raid, Eren sub)', () => {
    expect(endPlan(V.raid_default)).toMatchObject({
      imposedMs: null,
      waitVideoEnd: true,
      keepAudio: true,
    });
    expect(endPlan(V.eren_sub).keepAudio).toBe(true);
  });

  it('an imposed duration ends it at duration + 300 ms (legacy)', () => {
    expect(endPlan(V.bits_default)).toMatchObject({
      imposedMs: 4150,
      waitVideoEnd: false,
    });
    expect(endPlan(V.don_moneytest).imposedMs).toBe(7900);
  });

  it('the safety timeout stays inside the Core playing lease', () => {
    for (const v of Object.values(V)) {
      if (!v.video) continue;
      expect(endPlan(v).safetyMs).toBeLessThan(playLeaseMs(v));
    }
  });
});

describe('texts (inserted with textContent by the engine)', () => {
  it('community gift: name × animated counter; anonymous pseudo kept as given', () => {
    expect(
      textParts(V.subgift_5, { pseudo: 'Un généreux anonyme', count: 5 }),
    ).toEqual([
      ['gift-name', 'Un généreux anonyme'],
      ['gift-x', '×'],
      ['gift-count', '0'],
    ]);
  });

  it('targeted gift: the recipient only (the gifter stays in the data)', () => {
    expect(
      textParts(V.subgift_targeted, { pseudo: 'Alice', recipient: 'Bob' }),
    ).toEqual([['gift-recipient', 'Bob']]);
  });

  it('bits: « [gem] × N » above, « pseudo me permet de manger ! » below', () => {
    expect(textParts(V.bits_default, { pseudo: 'A', amount: '250' })).toEqual([
      ['bits-logo', ''],
      ['bits-amount', '× 250'],
      ['bits-break', ''],
      ['bits-name', 'A'],
      ['', 'me permet de manger !'],
    ]);
  });

  it('name colour: one of the palette, never twice in a row', () => {
    let previous = null;
    for (let i = 0; i < 50; i++) {
      const c = pickNameColor(previous);
      expect(NAME_COLORS).toContain(c);
      expect(c).not.toBe(previous);
      previous = c;
    }
    expect(pickNameColor(NAME_COLORS[0], () => 0)).toBe(NAME_COLORS[1]);
  });

  it('follows and Eren sub: the pseudo in its own coloured part', () => {
    expect(textParts(V.follow_eren, { pseudo: '<b>A</b>' })).toEqual([
      ['alert-name', '<b>A</b>'],
      ['', ' vient de follow !'],
    ]);
    expect(
      templateParts(
        V.eren_sub.subtitles[1].text,
        { pseudo: 'A' },
        {
          pseudo: 'alert-name',
        },
      ),
    ).toEqual([
      ['', 'Remercie '],
      ['alert-name', 'A'],
      ['', ' pour son abonnement !'],
    ]);
  });

  it('raid: pseudo and viewers around « débarque avec … titans ! »', () => {
    expect(
      textParts(V.raid_default, { pseudo: '<img src=x>', viewers: 42 }),
    ).toEqual([
      ['zone-name', '<img src=x>'],
      ['', 'débarque avec'],
      ['zone-number', '42'],
      ['', 'titans !'],
    ]);
  });
});

describe('families (OBS source layers)', () => {
  it('same families, mapping and stacking order as the Core contract and the Studio tab', async () => {
    const { ALERT_FAMILIES, ALERT_TYPES, alertFamilyOf } =
      await import('@raptoru/schemas');
    const { familyOfType } = await import('../../web/src/alerts-view.ts');
    const { FAMILY_ORDER, familyLayer, familyOf } =
      await import('../alerts-player/timeline.js');
    expect(FAMILY_ORDER).toEqual([...ALERT_FAMILIES]);
    for (const t of ALERT_TYPES) {
      expect(familyOf(t), t).toBe(alertFamilyOf(t));
      if (t !== 'gift_recipient')
        expect(familyOfType(t), t).toBe(alertFamilyOf(t));
    }
    // Follow at the bottom, raid on top (visual only).
    expect(FAMILY_ORDER.map(familyLayer)).toEqual([1, 2, 3, 4, 5]);
    expect(familyLayer('raid')).toBeGreaterThan(familyLayer('donation'));
  });

  it('name colours: a new alert avoids the previous one and those on screen', async () => {
    const { NAME_COLORS, pickNameColor } =
      await import('../alerts-player/timeline.js');
    const busy = NAME_COLORS.slice(0, 5);
    for (let i = 0; i < 20; i++)
      expect(pickNameColor(busy)).toBe(NAME_COLORS[5]);
    for (let i = 0; i < 20; i++)
      expect(busy.slice(1)).not.toContain(pickNameColor(busy.slice(1)));
  });
});
