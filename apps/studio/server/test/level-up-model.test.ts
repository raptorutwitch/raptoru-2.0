import { describe, expect, it } from 'vitest';
import {
  parseLegacyPrefsExport,
  planSubBadges,
} from '../../web/src/pages/level-up-model.js';

// Level Up V2 (docs/LEVEL_UP_V2.md): what Studio decides before sending anything — the order of the sub badges (one every
// 10 levels) and the rows of the first extension's sound choices.

// The streamer's folder as it is (« Badge de ma chaine », inspected on 15/11/2026): eleven numbered sub badges (the 11th is
// also kept as a Bits badge — on purpose, confirmed by Antoni), older versions of 1 to 8 in « Obsolète », Bits badges and
// Clip Studio files in subfolders.
const ROOT = 'Badge de ma chaine';
const f = (path: string, hash: string, size = 1000) => ({
  path: `${ROOT}/${path}`,
  hash,
  size,
});
const FOLDER = [
  f('1. UglyTitan.png', 'h1'),
  f('10. FoundingTitan.png', 'h10'),
  f('11. Badge HK.png', 'hk'),
  f('2. CartTtian.png', 'h2'),
  f('3. FemaleTitan.png', 'h3'),
  f('4. JawTitan.png', 'h4'),
  f('5. ArmoredTitan.png', 'h5'),
  f('6.ColossalTitan.png', 'h6'),
  f('7. WarHammerTitan.png', 'h7'),
  f('8. BeastTitan.png', 'h8'),
  f('9. AttackTitan.png', 'h9'),
  f('Badges Bits/Archi.png', 'b1'),
  f('Badges Bits/Badge Bits sans nom aussi.png', 'hk'),
  f('Badges Bits/Fichier csp/Coeur.clip', 'c1'),
  f('Badges Bits/Obsolète/100 bits.png', 'b2'),
  f('Obsolète/1.Badge Titan laid.png', 'o1'),
  f('Obsolète/2. Badge Charette.png', 'o2'),
  f('Obsolète/7. Warhammer titan Badge.png', 'o7'),
];

describe('the sub badges in their order (one every 10 levels)', () => {
  it('the numbered pictures at the top of the folder, 1 → level 10 … 10 → level 100; subfolders and old versions aside', () => {
    const plan = planSubBadges(FOLDER);
    expect(plan.badges.map((b) => [b.n, b.level, b.name])).toEqual([
      [1, 10, 'UglyTitan'],
      [2, 20, 'CartTtian'],
      [3, 30, 'FemaleTitan'],
      [4, 40, 'JawTitan'],
      [5, 50, 'ArmoredTitan'],
      [6, 60, 'ColossalTitan'],
      [7, 70, 'WarHammerTitan'],
      [8, 80, 'BeastTitan'],
      [9, 90, 'AttackTitan'],
      [10, 100, 'FoundingTitan'],
      [11, 110, 'Badge HK'],
    ]);
    // « 10. » sorts after « 1. » as a number, never as text; an old « 7. » in « Obsolète » is never a second 7.
    expect(plan.badges.filter((b) => b.n === 7).map((b) => b.path)).toEqual([
      `${ROOT}/7. WarHammerTitan.png`,
    ]);
    expect(plan.ignored.every((i) => i.why === 'subfolder')).toBe(true);
    expect(plan.ignored).toHaveLength(7);
    // The order of the 11 is validated (15/11): no doubt; the 11th's twin among the Bits badges is only a remark.
    expect(plan.badges.filter((b) => b.doubt)).toEqual([]);
    expect(plan.badges.filter((b) => b.note).map((b) => [b.n, b.note])).toEqual(
      [
        [
          11,
          `aussi présent dans ${ROOT}/Badges Bits/Badge Bits sans nom aussi.png`,
        ],
      ],
    );
    expect(plan.issues).toEqual([]);
  });

  it('never guessed: two different pictures under one number leave the palier empty; a missing number is said; a copy is one picture', () => {
    const plan = planSubBadges([
      f('1. A.png', 'a'),
      f('1. A (copie).png', 'a'), // the same picture twice: one badge
      f('2. B.png', 'b'),
      f('2. B grand.png', 'b-large'), // two different pictures: which one? not guessed
      f('4. D.png', 'd'),
      f('5. E.png', 'd'), // the picture of the 4th again, as the 5th: which palier? a doubt on both
      f('notes.txt', 'n'),
      f('sans numero.png', 's'),
    ]);
    expect(plan.badges.map((b) => [b.n, b.level, !!b.doubt])).toEqual([
      [1, 10, false],
      [4, 40, true],
      [5, 50, true],
    ]);
    expect(plan.issues).toEqual([
      expect.stringContaining('Le numéro 2 est porté par 2 images différentes'),
      'Aucun badge numéroté 3 : le palier 30 reste vide.',
    ]);
    expect(plan.ignored.map((i) => i.why).sort()).toEqual([
      'no_number',
      'not_image',
    ]);
  });
});

describe('the first extension’s sound choices (Supabase export)', () => {
  it('CSV as Supabase exports it: on / off, dates, quoted fields; unreadable rows counted, never sent', () => {
    const csv = [
      'channel_id,twitch_user_id,twitch_login,level_up_sfx_opt_in,updated_at',
      '83603689,111,ana,true,2026-10-01 10:00:00.123+00',
      '83603689,222,"bob, le vrai",false,2026-10-02 11:00:00+00',
      '83603689,,ghost,true,',
      'pas-un-canal,333,cid,true,2026-10-03 10:00:00+00',
    ].join('\r\n');
    expect(parseLegacyPrefsExport(csv)).toEqual({
      rows: [
        {
          channel_id: '83603689',
          twitch_user_id: '111',
          twitch_login: 'ana',
          level_up_sfx_opt_in: true,
          updated_at: '2026-10-01T10:00:00.123Z',
        },
        {
          channel_id: '83603689',
          twitch_user_id: '222',
          twitch_login: 'bob, le vrai',
          level_up_sfx_opt_in: false,
          updated_at: '2026-10-02T11:00:00.000Z',
        },
        {
          channel_id: '83603689',
          twitch_user_id: null,
          twitch_login: 'ghost',
          level_up_sfx_opt_in: true,
          updated_at: null,
        },
      ],
      invalid: 1,
    });
  });

  it('the JSON the dashboard gives', () => {
    expect(
      parseLegacyPrefsExport(
        JSON.stringify([
          {
            channel_id: '83603689',
            twitch_user_id: '111',
            twitch_login: 'ana',
            level_up_sfx_opt_in: false,
            updated_at: '2026-10-01T10:00:00+00:00',
          },
        ]),
      ).rows,
    ).toEqual([
      {
        channel_id: '83603689',
        twitch_user_id: '111',
        twitch_login: 'ana',
        level_up_sfx_opt_in: false,
        updated_at: '2026-10-01T10:00:00.000Z',
      },
    ]);
  });
});
