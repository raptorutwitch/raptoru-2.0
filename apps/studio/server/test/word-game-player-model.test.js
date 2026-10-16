import { describe, expect, it } from 'vitest';
import { FRESH_MS, winsToPlay } from '../word-game-player/model.js';

// Jeu des mots V1 — OBS sound source model: one sound per winning message, never a replay
// (docs/WORD_GAME_PARITY.md § 18). Core's recent wins only hold paid winning messages.

const T0 = Date.parse('2026-10-16T20:00:00.000Z');
const win = (id, ms) => ({
  message_id: id,
  created_at: new Date(T0 + ms).toISOString(),
});

describe('sound source: which wins to play', () => {
  it('first read (nothing remembered): plays nothing, remembers the newest win', () => {
    expect(winsToPlay([win('a', 0), win('b', 1000)], null, T0 + 2000)).toEqual({
      play: [],
      cursor: win('b', 1000),
    });
    expect(winsToPlay([], null, T0)).toEqual({ play: [], cursor: null });
  });

  it('one new win → one sound', () => {
    const cursor = win('a', 0);
    expect(
      winsToPlay([win('b', 5000), win('a', 0)], cursor, T0 + 6000),
    ).toEqual({
      play: ['b'],
      cursor: win('b', 5000),
    });
  });

  it('two new wins between two reads → two sounds, oldest first', () => {
    const cursor = win('a', 0);
    const recent = [win('c', 2500), win('b', 2000), win('a', 0)]; // Core order: newest first
    expect(winsToPlay(recent, cursor, T0 + 3000).play).toEqual(['b', 'c']);
  });

  it('the same win read again → no second sound', () => {
    const first = winsToPlay(
      [win('b', 5000), win('a', 0)],
      win('a', 0),
      T0 + 6000,
    );
    expect(first.play).toEqual(['b']);
    expect(
      winsToPlay([win('b', 5000), win('a', 0)], first.cursor, T0 + 7000),
    ).toEqual({
      play: [],
      cursor: win('b', 5000),
    });
  });

  it('a reload with the remembered cursor: no replay; a fresh win missed meanwhile is played', () => {
    const remembered = win('b', 5000);
    expect(
      winsToPlay([win('b', 5000), win('a', 0)], remembered, T0 + 60_000).play,
    ).toEqual([]);
    expect(
      winsToPlay([win('c', 50_000), win('b', 5000)], remembered, T0 + 60_000)
        .play,
    ).toEqual(['c']);
  });

  it('a win older than FRESH_MS when first seen is not played', () => {
    const now = T0 + 10_000 + FRESH_MS + 1;
    expect(
      winsToPlay([win('b', 10_000), win('a', 0)], win('a', 0), now),
    ).toEqual({
      play: [],
      cursor: win('b', 10_000),
    });
  });

  it('two wins in the same millisecond: ordered by message id, both played once', () => {
    const r = winsToPlay(
      [win('y', 1000), win('x', 1000), win('a', 0)],
      win('a', 0),
      T0 + 2000,
    );
    expect(r.play).toEqual(['x', 'y']);
    expect(
      winsToPlay([win('y', 1000), win('x', 1000)], r.cursor, T0 + 3000).play,
    ).toEqual([]);
  });
});
