import { describe, expect, it } from 'vitest';
import {
  dofusFontSize,
  donationSizes,
  endPlan,
  fill,
  formatAmount,
  FX_KINDS,
  fxFrames,
  giftCounterDuration,
  schedule,
  NAME_COLORS,
  pickNameColor,
  templateParts,
  textParts,
  withLook,
} from '../alerts-player/timeline.js';
import { TRANSITIONS } from '../src/alerts/placement-store.ts';
import {
  clipsOf,
  moveClip,
  setFx,
  TRANSITIONS as PAGE_TRANSITIONS,
} from '../../web/src/pages/alerts-model.ts';
import { NAME_COLORS as PAGE_COLORS } from '../../web/src/pages/alerts-inspector.ts';
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
    const { familyOfType } =
      await import('../../web/src/pages/alerts-model.ts');
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

describe('a variant look (Studio › Alertes): timings, transitions, wording', () => {
  const steps = (v) => schedule(v).map((s) => `${s.action}@${s.at}`);

  it('no look: exactly the steps of the frozen variant', () => {
    for (const v of Object.values(V)) {
      expect(withLook(v, undefined)).toBe(v);
      expect(schedule(withLook(v, {}))).toEqual(schedule(v));
    }
  });

  it('moves the text; a zone keeps the length of its own fade; the end of the alert never moves', () => {
    const raid = withLook(V.raid_default, { showAt: 2000, hideAt: 9000 });
    expect(raid.showAt).toBe(2000);
    expect(raid.fadeOutAt).toBe(9000 - 350);
    const bits = withLook(V.bits_default, { hideAt: 3000 });
    expect(bits.duration).toBe(V.bits_default.duration);
    expect(bits.mediaMs).toBe(V.bits_default.mediaMs);
  });

  it('its own exit ends at hideAt and clears the block, for every style', () => {
    const exit = { textExit: { kind: 'fade', ms: 300 } };
    expect(steps(withLook(V.follow_eren, exit))).toEqual([
      'text-show@800',
      'text-exit@4200',
      'text-clear@4500',
    ]);
    expect(steps(withLook(V.bits_default, exit))).toEqual([
      'text-show@800',
      'text-exit@3850',
      'text-clear@4150',
    ]);
    expect(steps(withLook(V.don_moneytest, exit))).toContain('text-clear@6800');
    const eren = steps(withLook(V.eren_sub, exit));
    expect(eren).not.toContain('subtitle-tremble@1050');
    expect(eren).toContain('subtitle-exit@1100');
    expect(eren).toContain('subtitle-clear@1400');
    // Coupe nette : pas d'animation, le texte part à hideAt.
    expect(
      steps(withLook(V.follow_eren, { textExit: { kind: 'cut', ms: 0 } })),
    ).toEqual(['text-show@800', 'text-clear@4500']);
  });

  it('the media leaves before the alert ends; its own fade gives way on that side only', () => {
    const mediaExit = { kind: 'fade', ms: 500 };
    expect(steps(withLook(V.follow_eren, { mediaExit }))).toContain(
      'video-exit@5792',
    );
    const don = withLook(V.don_moneytest, { mediaExit });
    expect(steps(don)).toContain('video-exit@7400');
    expect(steps(don).some((s) => s.startsWith('video-fade-out'))).toBe(false);
    expect(don.videoFade.in).toBe(V.don_moneytest.videoFade.in);
    const entered = withLook(V.don_moneytest, {
      mediaEnter: { kind: 'rise', ms: 400 },
    });
    expect(entered.videoFade.in).toBe(0);
    expect(entered.videoFade.outAt).toBe(V.don_moneytest.videoFade.outAt);
  });

  it('wording: only a style that reads its template; subtitles one by one; viewer data stays plain text', () => {
    expect(
      textParts(withLook(V.follow_eren, { text: 'Bienvenue {pseudo}' }), {
        pseudo: '<b>',
      }),
    ).toEqual([
      ['', 'Bienvenue '],
      ['alert-name', '<b>'],
    ]);
    const eren = withLook(V.eren_sub, {
      subtitles: [{}, { text: 'Merci {pseudo}', hideAt: 3000 }],
    });
    expect(eren.subtitles[0]).toEqual(V.eren_sub.subtitles[0]);
    expect(eren.subtitles[1]).toMatchObject({
      text: 'Merci {pseudo}',
      hideAt: 3000,
    });
  });

  it('frames: opacity alone for a fade, a transform added to the element for the others', () => {
    expect(fxFrames('cut', 'enter')).toBeNull();
    expect(fxFrames('fade', 'exit')).toEqual({
      opacity: [1, 0],
      transform: null,
    });
    expect(fxFrames('rise', 'enter').transform[0]).toBe('translate(0px, 40px)');
    expect(fxFrames('rise', 'exit').transform[1]).toBe('translate(0px, -40px)');
    expect(fxFrames('zoom', 'enter').transform).toEqual([
      'scale(0.82)',
      'scale(1)',
    ]);
    for (const kind of FX_KINDS)
      for (const phase of ['enter', 'exit'])
        expect(JSON.stringify(fxFrames(kind, phase))).not.toContain('NaN');
  });

  it('engine, server and page offer the same transitions and colours', () => {
    expect(TRANSITIONS).toEqual(FX_KINDS);
    expect(
      PAGE_TRANSITIONS.map(([k]) => k)
        .filter((k) => k !== 'origin')
        .sort(),
    ).toEqual([...FX_KINDS].sort());
    expect(PAGE_COLORS).toEqual(NAME_COLORS);
  });

  it('the timeline shows what the engine does, for every variant', () => {
    for (const v of Object.values(V)) {
      const text = schedule(v).filter((s) =>
        /^(text|subtitle)-show/.test(s.action),
      );
      expect(clipsOf(v).length, v.id).toBe(text.length);
      for (const [i, c] of clipsOf(v).entries())
        expect(c.in, v.id).toBe(text[i].at);
    }
    const v = V.follow_eren;
    const [c] = clipsOf(v);
    expect(moveClip(v, { nameColor: '#7ef0b4' }, c, 1000, 4000)).toEqual({
      nameColor: '#7ef0b4',
      showAt: 1000,
      hideAt: 4000 - c.tail,
    });
    // A block put back where it was saves nothing.
    expect(moveClip(v, {}, c, c.in, c.end)).toEqual({});
    const eren = V.eren_sub;
    const sub = clipsOf(eren)[1];
    expect(moveClip(eren, {}, sub, sub.in, sub.end)).toEqual({});
    expect(moveClip(eren, {}, sub, 1600, sub.end).subtitles).toEqual([
      {},
      { showAt: 1600 },
    ]);
    // Origin wipes the setting, a cut has no length.
    expect(
      setFx({ textEnter: { kind: 'fade', ms: 300 } }, 'textEnter', 'origin'),
    ).toEqual({});
    expect(setFx({}, 'textExit', 'cut')).toEqual({
      textExit: { kind: 'cut', ms: 0 },
    });
  });
});
