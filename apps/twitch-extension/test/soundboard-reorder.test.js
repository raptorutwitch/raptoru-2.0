import { describe, expect, it } from 'vitest';
import {
  moveSoundboardItem,
  normalizeSoundboardOrder,
  reorderSoundboardVisibleSubset,
  soundboardDropSlot,
} from '../extension/shared/ui.js';

const ids = ['1', '2', '3', '4', '5', '6', '7', '8'];

describe('Soundboard reorder: strict insertion', () => {
  it('7 to the second place: only 2…6 move by one', () => {
    expect(moveSoundboardItem(ids, 6, 1)).toEqual([
      '1',
      '7',
      '2',
      '3',
      '4',
      '5',
      '6',
      '8',
    ]);
  });

  it('first → last and last → first', () => {
    expect(moveSoundboardItem(ids, 0, 7)).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '1',
    ]);
    expect(moveSoundboardItem(ids, 7, 0)).toEqual([
      '8',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
  });

  it('end → middle, and neighbours both ways', () => {
    expect(moveSoundboardItem(ids, 7, 3)).toEqual([
      '1',
      '2',
      '3',
      '8',
      '4',
      '5',
      '6',
      '7',
    ]);
    expect(moveSoundboardItem(ids, 2, 3)).toEqual([
      '1',
      '2',
      '4',
      '3',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(moveSoundboardItem(ids, 3, 2)).toEqual([
      '1',
      '2',
      '4',
      '3',
      '5',
      '6',
      '7',
      '8',
    ]);
  });

  it('cancel / same place / out of range: the order is unchanged (and never mutated)', () => {
    const before = [...ids];
    expect(moveSoundboardItem(ids, 4, 4)).toEqual(before);
    expect(moveSoundboardItem(ids, -1, 2)).toEqual(before);
    expect(moveSoundboardItem(ids, 2, 99)).toEqual(before);
    moveSoundboardItem(ids, 6, 1);
    expect(ids).toEqual(before);
  });

  it('every other sound keeps its relative order', () => {
    for (let from = 0; from < ids.length; from += 1) {
      for (let to = 0; to < ids.length; to += 1) {
        const next = moveSoundboardItem(ids, from, to);
        expect(next[to]).toBe(ids[from]);
        expect(next.filter((id) => id !== ids[from])).toEqual(
          ids.filter((id) => id !== ids[from]),
        );
      }
    }
  });

  it('saved then reloaded: the stored order is the one shown', () => {
    const stored = reorderSoundboardVisibleSubset(
      ids,
      ids,
      moveSoundboardItem(ids, 6, 1),
    );
    const reloaded = normalizeSoundboardOrder(
      JSON.parse(JSON.stringify(stored)),
      [...ids].reverse(),
    );
    expect(reloaded).toEqual(['1', '7', '2', '3', '4', '5', '6', '8']);
    // A sound added to the catalog later goes to the end, the personal order stays.
    expect(normalizeSoundboardOrder(stored, [...ids, '9'])).toEqual([
      ...stored,
      '9',
    ]);
  });
});

describe('Soundboard drop slot: read on the positions taken at the start of the drag', () => {
  // 3 columns × 2 rows of 100 × 40 cards, 10 px gaps.
  const slots = Array.from({ length: 6 }, (_, i) => ({
    left: (i % 3) * 110,
    top: Math.floor(i / 3) * 50,
    width: 100,
    height: 40,
  }));

  it('inside a slot: that slot', () => {
    expect(soundboardDropSlot(slots, 50, 20, 0)).toBe(0);
    expect(soundboardDropSlot(slots, 160, 70, 0)).toBe(4);
  });

  it('on a seam, in a gap or outside the grid: the current destination is kept (no flip-flop)', () => {
    expect(soundboardDropSlot(slots, 105, 20, 1)).toBe(1);
    expect(soundboardDropSlot(slots, 105, 20, 0)).toBe(0);
    expect(soundboardDropSlot(slots, 50, 45, 3)).toBe(3);
    expect(soundboardDropSlot(slots, 500, 500, 5)).toBe(5);
  });

  it('the edge of a slot (12 % margin) does not select it yet', () => {
    expect(soundboardDropSlot(slots, 113, 20, 0)).toBe(0);
    expect(soundboardDropSlot(slots, 125, 20, 0)).toBe(1);
  });
});
