import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  loadWordBank,
  parseWordBank,
  WORD_BANK_FILE,
  WORD_BANK_SHA256,
} from '../src/word-game/bank.js';
import {
  type ActiveWord,
  ageSeconds,
  baseReward,
  breakerBonus,
  comboBonus,
  CYCLE_ANNOUNCEMENT,
  decorateWord,
  EMPTY_ANNOUNCER,
  EMPTY_STREAK,
  evaluateMessage,
  findAnnouncementText,
  formatJetons,
  ofName,
  isGoldenRoll,
  matchWords,
  motsText,
  nextWordDelayMs,
  pickVariant,
  STREAK_VARIANTS,
  pickWord,
  publishText,
  shuffleLetters,
  speedMultiplier,
  type Streak,
  streakAnnouncement,
  streakAnnouncementText,
  streakTier,
  streakmotText,
  wordReward,
} from '../src/word-game/rules.js';

// Jeu des mots V1 — Lot 1: the pure rules against docs/WORD_GAME_PARITY.md (§ numbers in the titles).

const T0 = Date.UTC(2026, 9, 16, 20, 0, 0);
const at = (seconds: number) => T0 + seconds * 1000;
const word = (w: string, o: Partial<ActiveWord> = {}): ActiveWord => ({
  occurrenceId: `occ-${w}`,
  word: w,
  shuffled: [...w].reverse().join(''),
  golden: false,
  createdAt: T0,
  ...o,
});
const alice = { id: '1001', displayName: 'Alice' };
const bob = { id: '1002', displayName: 'Bob' };
const streakOf = (holder: typeof alice, count: number): Streak => ({
  holderId: holder.id,
  holderName: holder.displayName,
  count,
});
/** Deterministic rng returning the given values in turn. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('word bank (§ 16)', () => {
  it('is the legacy list, byte for byte (LF content), with its single duplicate counted once', () => {
    const lf = readFileSync(WORD_BANK_FILE, 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(lf, 'utf8').digest('hex')).toBe(
      WORD_BANK_SHA256,
    );
    const lines = lf.split('\n').filter(Boolean);
    expect(lines).toHaveLength(15_737);
    expect(lines.filter((l) => l === 'loser')).toHaveLength(2);
    const bank = loadWordBank();
    expect(bank).toHaveLength(15_736);
    expect(bank.filter((w) => w === 'loser')).toHaveLength(1);
  });

  it('keeps every word unchanged: lowercase, NFC, accents, 4 to 19 letters, all rewardable', () => {
    const bank = loadWordBank();
    expect(bank.every((w) => w === w.toLowerCase())).toBe(true);
    expect(bank.every((w) => w === w.normalize('NFC'))).toBe(true);
    expect(bank.filter((w) => /[^a-z]/.test(w))).toHaveLength(4_296);
    const lengths = bank.map((w) => Array.from(w).length);
    expect(Math.min(...lengths)).toBe(4);
    expect(Math.max(...lengths)).toBe(19);
    expect(() => bank.forEach((w) => baseReward(w))).not.toThrow();
    expect(bank).toContain('crâner');
  });

  it('tolerates CRLF and blank lines without changing any word', () => {
    expect(parseWordBank('angle\r\ncrâne\r\n\r\nangle\n')).toEqual([
      'angle',
      'crâne',
    ]);
  });
});

describe('detection (§ 17)', () => {
  it('finds a word anywhere in the message, case ignored', () => {
    expect(matchWords('angle', [word('angle')])).toHaveLength(1);
    expect(matchWords('ANGLE', [word('angle')])).toHaveLength(1);
    expect(matchWords('je dis Angle !', [word('angle')])).toHaveLength(1);
    expect(matchWords('rectangles', [word('angle')])).toHaveLength(1);
    expect(matchWords('chateau', [word('chat')])).toHaveLength(1);
    expect(matchWords('!join angle', [word('angle')])).toHaveLength(1);
    expect(matchWords('angl e', [word('angle')])).toHaveLength(0);
  });

  it('requires the accents (case ignored on accented letters too)', () => {
    expect(matchWords('crâne', [word('crâne')])).toHaveLength(1);
    expect(matchWords('CRÂNE', [word('crâne')])).toHaveLength(1);
    expect(matchWords('crane', [word('crâne')])).toHaveLength(0);
    expect(matchWords('CRANE', [word('crâne')])).toHaveLength(0);
  });

  it('returns every active word contained, newest first, each occurrence once', () => {
    const old = word('angle', { createdAt: at(0) });
    const mid = word('requin', { createdAt: at(60) });
    const recent = word('tournis', { createdAt: at(120) });
    expect(
      matchWords('requin angle tournis', [old, mid, recent]).map((w) => w.word),
    ).toEqual(['tournis', 'requin', 'angle']);
    // Two occurrences of the same word (impossible in V1, § 16): both count, like the legacy.
    const twin = word('angle', {
      occurrenceId: 'occ-angle-2',
      createdAt: at(30),
    });
    expect(matchWords('angle', [old, twin]).map((w) => w.occurrenceId)).toEqual(
      ['occ-angle-2', 'occ-angle'],
    );
  });
});

describe('reward of one word (§§ 4, 5, 6)', () => {
  it('base = 100 × characters, accents counted as one', () => {
    expect(baseReward('angle')).toBe(500);
    expect(baseReward('crâne')).toBe(500);
    expect(baseReward('rouble')).toBe(600);
    expect(() => baseReward('abc')).toThrow(RangeError);
  });

  it('speed multiplier tiers and thresholds', () => {
    expect(speedMultiplier(0)).toMatchObject({ num: 3, den: 1, tier: 'fast' });
    expect(speedMultiplier(29).tier).toBe('fast');
    expect(speedMultiplier(30)).toMatchObject({
      num: 1,
      den: 1,
      tier: 'normal',
    });
    expect(speedMultiplier(299)).toMatchObject({ num: 1, den: 1 });
    expect(speedMultiplier(300)).toMatchObject({
      num: 1500,
      den: 1500,
      tier: 'normal',
    });
    expect(speedMultiplier(1799).tier).toBe('normal');
    expect(speedMultiplier(1800)).toMatchObject({
      num: 2,
      den: 1,
      tier: 'old',
    });
  });

  it.each([
    [10, 1800],
    [29, 1800],
    [30, 600],
    [120, 600],
    [300, 600],
    [900, 840],
    [1050, 900],
    [1799, 1200],
    [1800, 1200],
    [2000, 1200],
  ])(
    '6 letters (base 600) found at %i s → %i (§ 5 reference)',
    (age, points) => {
      expect(wordReward('rouble', age, false).points).toBe(points);
    },
  );

  it('golden × 4, after rounding, and with speed', () => {
    expect(wordReward('rouble', 120, false).points).toBe(600);
    expect(wordReward('rouble', 120, true).points).toBe(2400);
    expect(wordReward('rouble', 10, true)).toEqual({
      points: 7200,
      tier: 'fast',
      fast: true,
    });
    expect(wordReward('rouble', 900, true).points).toBe(3360);
  });

  it('rounds to 10, half up, without float drift', () => {
    // 4 letters at 375 s: 400 × (1575 / 1500) / 10 = 42.0 → 420.
    expect(wordReward('ange', 375, false).points).toBe(420);
    // 5 letters at 315 s: 500 × (1515 / 1500) / 10 = 50.5 → half up → 510.
    expect(wordReward('angle', 315, false).points).toBe(510);
    // 7 letters at 301 s: 700 × (1501 / 1500) / 10 = 70.0466… → 700.
    expect(wordReward('tournis', 301, false).points).toBe(700);
    // 19 letters at 1 799 s: 1900 × (2999 / 1500) / 10 = 379.87… → 3800.
    expect(wordReward('a'.repeat(19), 1799, false).points).toBe(3800);
  });

  it('age is counted in whole seconds', () => {
    expect(ageSeconds(T0, T0 + 29_999)).toBe(29);
    expect(ageSeconds(T0, T0 + 30_000)).toBe(30);
    expect(ageSeconds(T0, T0 - 5)).toBe(0);
  });
});

describe('bonuses (§§ 7, 9)', () => {
  it('combo by words found in the same message', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(comboBonus)).toEqual([
      0, 0, 500, 1000, 2500, 5000, 5000, 5000,
    ]);
  });

  it('breaker by the length of the broken streak', () => {
    expect([0, 1, 2, 3, 4, 5, 7, 8, 11, 12, 20].map(breakerBonus)).toEqual([
      0, 0, 0, 500, 500, 1000, 1000, 2000, 2000, 4000, 4000,
    ]);
  });
});

describe('one message (§§ 4, 7, 8, 9)', () => {
  it('ignores a message without active word', () => {
    expect(
      evaluateMessage({
        message: 'bonjour',
        chatter: alice,
        now: at(10),
        active: [word('angle')],
        streak: EMPTY_STREAK,
      }),
    ).toBeNull();
  });

  it('one normal word: points, streak 1, total = points', () => {
    const out = evaluateMessage({
      message: 'angle',
      chatter: alice,
      now: at(120),
      active: [word('angle')],
      streak: EMPTY_STREAK,
    })!;
    expect(out.finds).toEqual([
      {
        occurrenceId: 'occ-angle',
        word: 'angle',
        golden: false,
        fast: false,
        tier: 'normal',
        age: 120,
        points: 500,
        streakAfter: 1,
      },
    ]);
    expect(out).toMatchObject({ combo: 0, breaker: null, total: 500 });
    expect(out.streak).toEqual(streakOf(alice, 1));
  });

  it('two words: points of each + combo 500; streak +1 per word', () => {
    const out = evaluateMessage({
      message: 'angle requin',
      chatter: alice,
      now: at(10),
      active: [word('angle'), word('requin', { createdAt: at(-200) })],
      streak: EMPTY_STREAK,
    })!;
    // angle: 10 s → ×3 = 1500 ; requin: 210 s → ×1 = 600.
    expect(out.finds.map((f) => [f.word, f.points, f.streakAfter])).toEqual([
      ['angle', 1500, 1],
      ['requin', 600, 2],
    ]);
    expect(out.combo).toBe(500);
    expect(out.total).toBe(2600);
    expect(out.streak.count).toBe(2);
  });

  it('three words → combo 1 000; four → 2 500; five and more → 5 000', () => {
    const words = [
      'angle',
      'requin',
      'tournis',
      'rouble',
      'artificiel',
      'métallique',
    ];
    const run = (n: number) =>
      evaluateMessage({
        message: words.slice(0, n).join(' '),
        chatter: alice,
        now: at(120),
        active: words.map((w, i) => word(w, { createdAt: T0 - i })),
        streak: EMPTY_STREAK,
      })!;
    const pts = (n: number) =>
      words.slice(0, n).reduce((s, w) => s + 100 * Array.from(w).length, 0);
    expect(run(3)).toMatchObject({ combo: 1000, total: pts(3) + 1000 });
    expect(run(4)).toMatchObject({ combo: 2500, total: pts(4) + 2500 });
    expect(run(5)).toMatchObject({ combo: 5000, total: pts(5) + 5000 });
    expect(run(6)).toMatchObject({ combo: 5000, total: pts(6) + 5000 });
    expect(run(6).streak.count).toBe(6);
  });

  it('golden word in the total, with speed', () => {
    const out = evaluateMessage({
      message: 'rouble',
      chatter: alice,
      now: at(5),
      active: [word('rouble', { golden: true })],
      streak: EMPTY_STREAK,
    })!;
    expect(out.finds[0]).toMatchObject({
      golden: true,
      fast: true,
      points: 7200,
    });
    expect(out.total).toBe(7200);
  });

  it('the holder continues: +1, no breaker', () => {
    const out = evaluateMessage({
      message: 'angle',
      chatter: alice,
      now: at(120),
      active: [word('angle')],
      streak: streakOf(alice, 4),
    })!;
    expect(out.streak).toEqual(streakOf(alice, 5));
    expect(out.breaker).toBeNull();
    expect(out.total).toBe(500);
  });

  it('another viewer takes the streak with 1; no breaker under 3', () => {
    const out = evaluateMessage({
      message: 'angle',
      chatter: bob,
      now: at(120),
      active: [word('angle')],
      streak: streakOf(alice, 2),
    })!;
    expect(out.streak).toEqual(streakOf(bob, 1));
    expect(out.breaker).toBeNull();
  });

  it.each([
    [3, 500],
    [4, 500],
    [5, 1000],
    [7, 1000],
    [8, 2000],
    [11, 2000],
    [12, 4000],
    [25, 4000],
  ])('breaking a streak of %i pays %i, added to the total', (broken, bonus) => {
    const out = evaluateMessage({
      message: 'angle',
      chatter: bob,
      now: at(120),
      active: [word('angle')],
      streak: streakOf(alice, broken),
    })!;
    expect(out.breaker).toEqual({
      bonus,
      brokenId: alice.id,
      brokenName: 'Alice',
      brokenCount: broken,
    });
    expect(out.total).toBe(500 + bonus);
    expect(out.streak).toEqual(streakOf(bob, 1));
  });

  it('breaker paid once per message, even with several words; streak +1 per word', () => {
    const out = evaluateMessage({
      message: 'angle requin tournis',
      chatter: bob,
      now: at(120),
      active: [
        word('angle', { createdAt: at(2) }),
        word('requin', { createdAt: at(1) }),
        word('tournis', { createdAt: at(0) }),
      ],
      streak: streakOf(alice, 6),
    })!;
    expect(out.breaker?.bonus).toBe(1000);
    expect(out.finds.map((f) => f.streakAfter)).toEqual([1, 2, 3]);
    // 500 + 600 + 700 (×1) + combo 1 000 + breaker 1 000.
    expect(out.total).toBe(3800);
  });
});

describe('streak announcements (§ 10)', () => {
  const step = (
    state: typeof EMPTY_ANNOUNCER,
    holder: typeof alice,
    count: number,
  ) => streakAnnouncement(state, streakOf(holder, count));

  it('announces at 3, then every +3 of the same player', () => {
    let state = EMPTY_ANNOUNCER;
    const announced: number[] = [];
    for (let n = 1; n <= 13; n++) {
      const r = step(state, alice, n);
      if (r.announce) announced.push(n);
      state = r.state;
    }
    expect(announced).toEqual([3, 6, 9, 12]);
  });

  it('a multi-word jump shifts the next one (2 → 4 announces at 4, then ≥ 7)', () => {
    const first = step(EMPTY_ANNOUNCER, alice, 4);
    expect(first.announce).toBe(true);
    expect(step(first.state, alice, 6).announce).toBe(false);
    expect(step(first.state, alice, 7).announce).toBe(true);
  });

  it('a new player starts over', () => {
    const alice6 = step(step(EMPTY_ANNOUNCER, alice, 3).state, alice, 6);
    expect(alice6.announce).toBe(true);
    const bob1 = step(alice6.state, bob, 1);
    expect(bob1).toEqual({
      announce: false,
      state: { lastAnnounced: 0, userId: bob.id },
    });
    expect(step(bob1.state, bob, 3).announce).toBe(true);
  });

  it('texts by tier and variant (§ 12.5)', () => {
    expect(streakAnnouncementText('Alice', 3, 1)).toBe(
      '🔥 @Alice est EN FEU ! 3 mots d’affilée !',
    );
    expect(streakAnnouncementText('Alice', 4, 4)).toBe(
      '🔥 Ça chauffe pour @Alice ! 4 mots d’affilée !',
    );
    expect(streakAnnouncementText('Alice', 5, 2)).toBe(
      '🔥🔥 @Alice ne s’arrête plus ! 5 mots d’affilée !',
    );
    expect(streakAnnouncementText('Alice', 7, 3)).toBe(
      '🔥🔥 @Alice enchaîne tout ! 7 mots d’affilée !',
    );
    expect(streakAnnouncementText('Alice', 8, 4)).toBe(
      '⚡ Rien n’arrête @Alice ! 8 mots d’affilée !',
    );
    expect(streakAnnouncementText('Alice', 11, 1)).toBe(
      '⚡ @Alice entre en DOMINATION ! 11 mots d’affilée !',
    );
    expect(streakAnnouncementText('Alice', 12, 1)).toBe(
      '👑 @Alice devient MAÎTRE DES MOTS ! 12 mots d’affilée !',
    );
    expect(streakAnnouncementText('Alice', 30, 4)).toBe(
      '👑 Le royaume des mots appartient à @Alice ! 30 mots d’affilée !',
    );
    expect(() => streakAnnouncementText('Alice', 2, 1)).toThrow(RangeError);
  });

  it('variant drawn uniformly among 1–8, never the one to avoid (no two identical phrases in a row)', () => {
    expect(STREAK_VARIANTS).toBe(8);
    expect([0, 0.125, 0.5, 0.999].map((v) => pickVariant(() => v))).toEqual([
      1, 2, 5, 8,
    ]);
    // Avoiding 3: the 7 others, uniformly (0 → 1, the slot of 3 → 4, the top → 8).
    expect([0, 2 / 7, 0.999].map((v) => pickVariant(() => v, 3))).toEqual([
      1, 4, 8,
    ]);
    for (let i = 0; i < 1000; i++)
      for (const avoid of [1, 4, 8]) {
        const v = pickVariant(Math.random, avoid);
        expect(v).not.toBe(avoid);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(8);
      }
    // Every variant of every tier is a real phrase, none twice in a tier, no em dash.
    for (const count of [3, 5, 8, 12]) {
      const texts = Array.from({ length: 8 }, (_, i) =>
        streakAnnouncementText('Alice', count, i + 1),
      );
      expect(new Set(texts).size).toBe(8);
      for (const t of texts) {
        expect(t).toContain('@Alice');
        expect(t).not.toContain('—');
      }
    }
    expect([3, 4, 5, 7, 8, 11, 12, 40].map(streakTier)).toEqual([
      3, 3, 5, 5, 8, 8, 12, 12,
    ]);
  });
});

describe('chat texts (§ 12)', () => {
  it('cycle announcement and ONE publication message per word, golden included (§ 12.2)', () => {
    expect(CYCLE_ANNOUNCEMENT).toBe(
      'Trouve le mot caché parmi ces lettres et remporte des jetons !',
    );
    expect(publishText('elgan', false)).toBe('-> elgan <-');
    expect(publishText('elgan', true)).toBe('🔸 elgan 🔸');
  });

  it('word decoration by speed', () => {
    expect(decorateWord('angle', 'fast')).toBe('⚡angle⚡');
    expect(decorateWord('angle', 'normal')).toBe('"angle"');
    expect(decorateWord('angle', 'old')).toBe('✨angle✨');
  });

  const outcome = (o: {
    message: string;
    active: ActiveWord[];
    now: number;
    streak?: Streak;
    chatter?: typeof alice;
  }) =>
    evaluateMessage({
      chatter: o.chatter ?? alice,
      streak: o.streak ?? EMPTY_STREAK,
      ...o,
    })!;

  it('find announcement: one word, no bonus', () => {
    const out = outcome({
      message: 'angle',
      active: [word('angle')],
      now: at(120),
    });
    expect(findAnnouncementText('Alice', out)).toBe(
      '@Alice a trouvé le mot "angle" ! +500 Jetons',
    );
  });

  it('find announcement: fast golden word', () => {
    const out = outcome({
      message: 'angle',
      active: [word('angle', { golden: true })],
      now: at(3),
    });
    expect(findAnnouncementText('Alice', out)).toBe(
      '@Alice a trouvé le mot ⚡angle⚡ ! +6 000 Jetons 🪙 x4',
    );
  });

  it('find announcement: old word, breaker only — one message, the breaker shown apart', () => {
    const out = outcome({
      message: 'angle',
      active: [word('angle')],
      now: at(1900),
      chatter: bob,
      streak: streakOf(alice, 3),
    });
    // 1 000 for the word + 500 breaker = the single credit of 1 500.
    expect(out.total).toBe(1500);
    expect(findAnnouncementText('Bob', out)).toBe(
      "@Bob a trouvé le mot ✨angle✨ ! +1 000 Jetons et brise la streak de 3 d'Alice 💥 +500 breaker !",
    );
  });

  it('find announcement: several words, combo + breaker + golden', () => {
    const out = outcome({
      message: 'angle requin',
      active: [
        word('angle', { createdAt: at(100), golden: true }),
        word('requin'),
      ],
      now: at(110),
      chatter: bob,
      streak: streakOf(alice, 5),
    });
    // angle: 10 s, ×3, golden → 6 000 ; requin: 110 s → 600 ; combo 500 ; breaker 1 000.
    expect(out.total).toBe(8100);
    expect(findAnnouncementText('Bob', out)).toBe(
      '🔥 @Bob a trouvé 2 mots: ⚡angle⚡, "requin" ! +7 100 Jetons (⚡ +500 combo) 🪙 x4 et brise la streak de 5 d\'Alice 💥 +1 000 breaker ! 🔥',
    );
  });

  it('find announcement: combo only', () => {
    const out = outcome({
      message: 'angle requin',
      active: [word('angle', { createdAt: at(1) }), word('requin')],
      now: at(120),
    });
    expect(findAnnouncementText('Alice', out)).toBe(
      '🔥 @Alice a trouvé 2 mots: "angle", "requin" ! +1 600 Jetons (⚡ +500 combo) 🔥',
    );
  });

  it('the example of the request: 3 500 for the word, 500 breaker, 4 000 credited', () => {
    // cravache (8 letters): 800, < 30 s ×3 → 2 400 ; golden would be ×4 — here a plain fast word + combo 0.
    const out = outcome({
      message: 'cravache',
      active: [word('cravache')],
      now: at(10),
      chatter: { id: 'e1', displayName: 'Eejyil' },
      streak: { holderId: 'a1', holderName: 'Aouh', count: 4 },
    });
    expect(out.breaker?.bonus).toBe(500);
    expect(findAnnouncementText('Eejyil', out)).toBe(
      `@Eejyil a trouvé le mot ⚡cravache⚡ ! +${formatJetons(out.total - 500)} Jetons et brise la streak de 4 d'Aouh 💥 +500 breaker !`,
    );
    // Announced amounts = the credited total, never the breaker twice.
    const shown = findAnnouncementText('Eejyil', out).match(/\+([\d ]+) /g)!;
    expect(
      shown.map((x) => Number(x.replace(/[^\d]/g, ''))).reduce((a, b) => a + b),
    ).toBe(out.total);
  });

  it("de / d' : vowel or y (any case, accents ignored) → d', otherwise de ; the name is kept as it is", () => {
    expect(
      ['Aouh', 'Eejyil', 'Imhotep', 'Yuni', 'oscar', 'uLtra', 'Élodie'].map(
        ofName,
      ),
    ).toEqual([
      "d'Aouh",
      "d'Eejyil",
      "d'Imhotep",
      "d'Yuni",
      "d'oscar",
      "d'uLtra",
      "d'Élodie",
    ]);
    expect(['Raptoru_', 'bob', 'Zed', '_x', '42'].map(ofName)).toEqual([
      'de Raptoru_',
      'de bob',
      'de Zed',
      'de _x',
      'de 42',
    ]);
  });

  it('!mots (§ 12.7)', () => {
    expect(motsText([])).toBe('Aucun mot en cours !');
    expect(
      motsText([
        word('angle', { shuffled: 'lagne', createdAt: at(0) }),
        word('requin', { shuffled: 'quiner', createdAt: at(60) }),
      ]),
    ).toBe('🎲 Mots restants : quiner | lagne');
  });

  it('!streakmot (§ 12.8)', () => {
    expect(streakmotText(EMPTY_STREAK)).toBe(
      '🔥 Aucune streak du Jeu des mots en cours.',
    );
    expect(streakmotText(streakOf(alice, 1))).toBe(
      '🔥 @Alice est à 1 mots d’affilée.',
    );
    expect(streakmotText(streakOf(alice, 2))).toBe(
      '🔥 @Alice est à 2 mots d’affilée.',
    );
    expect(streakmotText(streakOf(alice, 3))).toBe(
      '🔥 @Alice est actuellement EN FEU : 3 mots d’affilée !',
    );
  });
});

describe('draw (§§ 6, 13, 16)', () => {
  it('golden when the 1–100 roll is ≤ 10 (10 %)', () => {
    expect(isGoldenRoll(1)).toBe(true);
    expect(isGoldenRoll(10)).toBe(true);
    expect(isGoldenRoll(11)).toBe(false);
    expect(isGoldenRoll(100)).toBe(false);
  });

  it('next word in 300 000 – 900 000 ms, bounds included', () => {
    expect(nextWordDelayMs(() => 0)).toBe(300_000);
    expect(nextWordDelayMs(() => 0.999_999_999)).toBe(900_000);
  });

  it('never draws an active word; a found word can come back', () => {
    const bank = ['angle', 'requin', 'tournis'];
    for (let i = 0; i < 50; i++)
      expect(pickWord(bank, ['angle', 'tournis'], Math.random)).toBe('requin');
    expect(
      pickWord(bank, ['angle', 'requin', 'tournis'], Math.random),
    ).toBeNull();
    expect(pickWord(bank, [], seq(0))).toBe('angle');
  });

  it('shuffles the characters, accents kept as letters', () => {
    const s = shuffleLetters('crâne', seq(0.1, 0.7, 0.3, 0.9));
    expect([...s].sort()).toEqual([...'crâne'].sort());
    expect(shuffleLetters('angle', () => 0.999)).toBe('angle');
  });
});
