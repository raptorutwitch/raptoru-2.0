import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  admit,
  PLAYED_MEMORY,
  soundVolume,
} from '../word-game-player/model.js';

// Jeu des mots V1 — OBS sound source model: one sound per winning message, never a replay
// (docs/WORD_GAME_PARITY.md § 18). Core pushes committed wins only, live only.

/** Plays a sequence of received events; returns the ids actually played and the memory. */
const receive = (ids, played = []) => {
  const sounds = [];
  for (const id of ids) {
    const r = admit(played, id);
    played = r.played;
    if (r.play) sounds.push(id);
  }
  return { sounds, played };
};

describe('sound source: volume of the winning sound', () => {
  it('the volume sent by Studio (0–1), clamped; none (older Studio) → full volume', () => {
    expect(
      [0, 0.5, 1].map((volume) => soundVolume({ message_id: 'x', volume })),
    ).toEqual([0, 0.5, 1]);
    expect(soundVolume({ volume: 7 })).toBe(1);
    expect(soundVolume({ volume: -1 })).toBe(0);
    expect(soundVolume({ message_id: 'x' })).toBe(1);
    expect(soundVolume(null)).toBe(1);
  });

  it('the player applies it to its own Audio only (no other sound, no global volume)', async () => {
    const src = await readFile(
      join(import.meta.dirname, '..', 'word-game-player', 'player.js'),
      'utf8',
    );
    expect(src).toMatch(
      /const audio = new Audio\(SOUND_URL\);\s*audio\.volume = soundVolume\(win\);/,
    );
  });
});

describe('sound source: which events play', () => {
  it('one event → one sound', () => {
    expect(receive(['tw-1']).sounds).toEqual(['tw-1']);
  });

  it('the same event received twice → one sound', () => {
    expect(receive(['tw-1', 'tw-1']).sounds).toEqual(['tw-1']);
  });

  it('two distinct wins → two sounds, in order', () => {
    expect(receive(['tw-1', 'tw-2']).sounds).toEqual(['tw-1', 'tw-2']);
  });

  it('after a reload (remembered ids), an already played win delivered again does not replay', () => {
    const { played } = receive(['tw-1', 'tw-2']);
    expect(receive(['tw-2', 'tw-3'], played).sounds).toEqual(['tw-3']);
  });

  it('an event without a message id is ignored; the memory is bounded', () => {
    expect(receive([undefined, '', 42]).sounds).toEqual([]);
    const ids = Array.from({ length: PLAYED_MEMORY + 10 }, (_, i) => `tw-${i}`);
    const { played } = receive(ids);
    expect(played).toHaveLength(PLAYED_MEMORY);
    expect(played.at(-1)).toBe(ids.at(-1));
  });

  it('the source listens to pushed events: no polling, no timer, no read of recent wins', async () => {
    const js = await readFile(
      join(import.meta.dirname, '..', 'word-game-player', 'player.js'),
      'utf8',
    );
    expect(js).toContain('new EventSource(');
    expect(js).not.toMatch(/setTimeout|setInterval|fetch\(|recent|feed/);
  });
});
