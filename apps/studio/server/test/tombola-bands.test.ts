import { describe, expect, it } from 'vitest';
import {
  addBand,
  bandProblems,
  MAX_BANDS,
  parseNumber,
  removeBand,
} from '../../web/src/tombola-bands.js';

// Tombola « Préparer » — the tiers' draft (26/10): edited freely, checked as a whole before « Enregistrer », with Core's
// own rules (raffle-lab/rules.ts validateConfig) said in plain words.

const DEFAULT = {
  step: 500,
  bands: [
    { from: 5_000, to: 20_000, pct: 78 },
    { from: 20_000, to: 40_000, pct: 18 },
    { from: 40_000, to: 50_000, pct: 4 },
  ],
};

describe('Tombola tiers draft', () => {
  it('the default configuration can be saved', () => {
    expect(bandProblems(DEFAULT)).toEqual([]);
  });

  it('intermediate states are allowed while editing, and every problem is said before saving', () => {
    // Moving an inner boundary: the next tier no longer starts where the previous one ends.
    const moved = structuredClone(DEFAULT);
    moved.bands[0]!.to = 25_000;
    expect(bandProblems(moved)).toEqual([
      'Tranche 2 doit commencer où finit la tranche 1 (25 000).',
    ]);
    moved.bands[1]!.from = 25_000;
    expect(bandProblems(moved)).toEqual([]);
    // One percentage changed alone: the total is said.
    const pct = structuredClone(DEFAULT);
    pct.bands[0]!.pct = 70;
    expect(bandProblems(pct)).toEqual([
      'Les pourcentages font 92 % au lieu de 100 %.',
    ]);
    const bad = {
      step: 0,
      bands: [{ from: 300, to: 200, pct: 120 }],
    };
    expect(bandProblems(bad)).toEqual([
      'Le pas doit être un nombre entier entre 1 et 100 000.',
      'Tranche 1 : la fin (200) doit être au-dessus du début (300).',
      'Tranche 1 : pourcentage entre 0 et 100.',
      'Les pourcentages font 120 % au lieu de 100 %.',
    ]);
    expect(
      bandProblems({ step: 1000, bands: [{ from: 500, to: 900, pct: 100 }] }),
    ).toEqual(['Le minimum (500) doit valoir au moins un pas (1 000).']);
    expect(
      bandProblems({
        step: 500,
        bands: [{ from: Number.NaN, to: 2000, pct: 100 }],
      }),
    ).toEqual(['Tranche 1 : montants entiers positifs attendus.']);
  });

  it('add a tier after the last one (0 %), remove one keeping the tiers contiguous, at most 8', () => {
    const more = addBand(DEFAULT);
    expect(more.bands.at(-1)).toEqual({ from: 50_000, to: 55_000, pct: 0 });
    expect(bandProblems(more)).toEqual([]);
    const fewer = removeBand(DEFAULT, 1);
    expect(fewer.bands).toEqual([
      { from: 5_000, to: 20_000, pct: 78 },
      { from: 20_000, to: 50_000, pct: 4 },
    ]);
    expect(bandProblems(fewer)).toEqual([
      'Les pourcentages font 82 % au lieu de 100 %.',
    ]);
    expect(removeBand(DEFAULT, 0).bands[0]).toEqual({
      from: 5_000,
      to: 40_000,
      pct: 18,
    });
    // The original draft is never changed in place (« Annuler » restores the saved tiers).
    expect(DEFAULT.bands).toHaveLength(3);
    let full = DEFAULT;
    while (full.bands.length < MAX_BANDS) full = addBand(full);
    expect(full.bands).toHaveLength(MAX_BANDS);
    expect(
      bandProblems({ ...full, bands: [...full.bands, full.bands[0]!] }),
    ).toContain('8 tranches au maximum.');
  });

  it('numbers typed in French', () => {
    expect(parseNumber('10 000')).toBe(10_000);
    expect(parseNumber('2,5')).toBe(2.5);
  });
});
