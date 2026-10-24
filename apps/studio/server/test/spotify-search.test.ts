import { describe, expect, it } from 'vitest';
import { normalizeText, selectCandidate } from '../src/spotify/search.js';

// The historical search cases (CANONICAL_WORKSPACE/extension/test/spotify-v2.test.js « matching déterministe »,
// « recherche UX », « regroupe les copies »), unchanged: the port must decide exactly as the service in production did.

const t = (
  id: string,
  name: string,
  artists: string[],
  duration_ms = 200_000,
  extra: object = {},
) => ({
  id,
  name,
  artists: artists.map((name) => ({ name })),
  duration_ms,
  ...extra,
});
const FIXTURES = [
  t('4iV5W9uYEdYUVa79Axb7Rh', 'Young, Wild & Free', ['Wiz Khalifa'], 207000),
  t(
    '1bV5qzK2dW8rF3mN6pQ9sT',
    'Young, Wild & Free (Live)',
    ['Wiz Khalifa'],
    250000,
  ),
  t('6f9sD2kL4mN8pQ1rT5vW7x', 'Numb', ['Linkin Park'], 185000),
  t('7g1tH3mJ5nP8rS2vW4xY6z', 'Numb (Live)', ['Linkin Park'], 210000),
  t('2cX8vL4nR6pT1yW3qS5mK7', 'Long Test Track', ['Raptoru Fixtures'], 601000),
];

describe('Spotify search (historical port)', () => {
  it('normalizes accents, punctuation and « & »', () => {
    expect(normalizeText('ÀÉ Wiz & Khalifa!')).toBe('ae wiz and khalifa');
  });

  it('natural examples, typos, order and accents', () => {
    for (const [input, id] of [
      ['young wild and free wiz khalifa', '4iV5W9uYEdYUVa79Axb7Rh'],
      ['wiz kalifa yound wild fre', '4iV5W9uYEdYUVa79Axb7Rh'],
      ['numb linkin park', '6f9sD2kL4mN8pQ1rT5vW7x'],
    ] as const) {
      const s = selectCandidate(input, FIXTURES);
      expect(s.status, input).toBe('MATCHED');
      expect(s.status === 'MATCHED' && s.top.candidate.id).toBe(id);
    }
    const candidates = [
      t('aaaaaaaaaaaaaaaaaaaaaa', 'Young Wild & Free', ['Wiz Khalifa'], 207000),
      t(
        'bbbbbbbbbbbbbbbbbbbbbb',
        'Young Wild & Free (Remix)',
        ['Wiz Khalifa'],
        207000,
      ),
    ];
    const s = selectCandidate('WIZ KHALIFA — YOUNG WILD & FREE', candidates);
    expect(s.status === 'MATCHED' && s.top.candidate.id).toBe(
      'aaaaaaaaaaaaaaaaaaaaaa',
    );
    const remix = selectCandidate(
      'young wild free remix wiz khalifa',
      candidates,
    );
    expect(remix.status === 'MATCHED' && remix.top.candidate.id).toBe(
      'bbbbbbbbbbbbbbbbbbbbbb',
    );
  });

  it('« Lucky - Lucky Twice » explicit and natural beat the close false matches', () => {
    const candidates = [
      t('lucky-song', 'The Lucky Twice Song', ['Lucky Twice'], 185800),
      t('lucky-track-a', 'Lucky', ['Lucky Twice'], 205786),
      t('lucky-track-b', 'Lucky', ['Lucky Twice'], 205786),
      t(
        'lucky-nightcore',
        "I'm so lucky! - Nightcore",
        ['Lucky Twice', 'Tik Tok Trends', 'sped up + slowed'],
        170312,
      ),
      t('lucky-riize', 'Lucky', ['RIIZE'], 167219),
    ];
    const explicit = selectCandidate('Lucky - Lucky Twice', candidates);
    expect(explicit.status).toBe('MATCHED');
    if (explicit.status !== 'MATCHED') return;
    expect(explicit.top.candidate.id).toBe('lucky-track-a');
    expect(explicit.top.structured_exact).toBe(true);
    expect(explicit.margin).toBeGreaterThanOrEqual(0.08);
    const natural = selectCandidate('lucky lucky twice', candidates);
    expect(natural.status === 'MATCHED' && natural.top.candidate.id).toBe(
      'lucky-track-a',
    );
    expect(natural.status === 'MATCHED' && natural.top.strong_role_match).toBe(
      true,
    );
    const lola = selectCandidate('Lola - RK', [
      t('lola-track', 'Lola', ['RK']),
      t('lola-close', 'Lola Song', ['Other']),
    ]);
    expect(lola.status === 'MATCHED' && lola.top.candidate.id).toBe(
      'lola-track',
    );
  });

  it('artist context, title only and versions stay careful', () => {
    const variants = [
      t('numb-original', 'Numb', ['Linkin Park'], 185000),
      t('numb-live', 'Numb (Live)', ['Linkin Park'], 210000),
    ];
    const original = selectCandidate('numb linkin park', variants);
    expect(original.status === 'MATCHED' && original.top.candidate.id).toBe(
      'numb-original',
    );
    const live = selectCandidate('numb live linkin park', variants);
    expect(live.status === 'MATCHED' && live.top.candidate.id).toBe(
      'numb-live',
    );
    const afterDark = selectCandidate('after dark mr kitty', [
      t('after-dark', 'After Dark', ['Mr.Kitty'], 250000),
      t('after-dark-tonight', 'After Dark Tonight', ['Mr.Kitty'], 250000),
    ]);
    expect(afterDark.status === 'MATCHED' && afterDark.top.candidate.id).toBe(
      'after-dark',
    );
    const titleOnly = selectCandidate('after dark', [
      t('after-dark', 'After Dark', ['Mr.Kitty'], 250000),
      t('after-dark-tonight', 'After Dark Tonight', ['Mr.Kitty'], 250000),
    ]);
    expect(titleOnly.status === 'MATCHED' && titleOnly.top.candidate.id).toBe(
      'after-dark',
    );
    const niche = selectCandidate('midnight blue niche artist', [
      t('niche', 'Midnight Blue', ['Niche Artist']),
      t('popular', 'Midnight Blue (Popular Mix)', ['Popular Artist']),
    ]);
    expect(niche.status === 'MATCHED' && niche.top.candidate.id).toBe('niche');
    const ambiguous = selectCandidate('lucky', [
      t('lucky-twice', 'Lucky', ['Lucky Twice'], 205786),
      t('lucky-riize', 'Lucky', ['RIIZE'], 167219),
    ]);
    expect(ambiguous.status).toBe('AMBIGUOUS');
  });

  it('copies of one recording are grouped, Live stays a variant', () => {
    const artists = ['Snoop Dogg', 'Wiz Khalifa', 'Bruno Mars'];
    const s = selectCandidate('young wild and free wiz khalifa', [
      t('recording-single', 'Young, Wild & Free', artists, 207333, {
        external_ids: { isrc: 'US-TEST-00001' },
      }),
      t('recording-compilation', 'Young, Wild & Free', artists, 207333),
      t(
        'recording-feature',
        'Young, Wild & Free (feta. Bruno Mars)',
        artists,
        207333,
      ),
      t(
        'recording-remaster',
        'Young, Wild & Free (Remastered 2011)',
        artists,
        207500,
        { external_ids: { isrc: 'US-TEST-00001' } },
      ),
      t('recording-live', 'Young, Wild & Free (Live)', artists, 250000),
    ]);
    expect(s.status).toBe('MATCHED');
    if (s.status !== 'MATCHED') return;
    expect(['recording-single', 'recording-compilation']).toContain(
      s.top.candidate.id,
    );
    expect(s.equivalence_groups[0]!.members).toHaveLength(4);
    expect(s.distinct_ranked).toHaveLength(2);
    expect(s.second!.candidate.id).toBe('recording-live');
    expect(s.margin).toBeGreaterThanOrEqual(0.08);
  });

  it('two near-equal results: ambiguous (nothing added); a popular title alone: ambiguous', () => {
    expect(
      selectCandidate('numb linkin park', [
        t('aaaaaaaaaaaaaaaaaaaaaa', 'Numb', ['Linkin Park'], 185000),
        t('bbbbbbbbbbbbbbbbbbbbbb', 'Numb', ['Linkin Park'], 197000),
      ]).status,
    ).toBe('AMBIGUOUS');
    expect(selectCandidate('numb', FIXTURES).status).toBe('AMBIGUOUS');
    expect(selectCandidate('nothing like this at all', FIXTURES).status).toBe(
      'NOT_FOUND',
    );
  });
});
