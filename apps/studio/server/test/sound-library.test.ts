import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { peaksOf, wavePath } from '../../web/src/pages/soundboard-wave.js';
import { SoundLibrary } from '../src/sound-lab/library.js';

const file = async () =>
  join(await mkdtemp(join(tmpdir(), 'sound-library-')), 'sound-library.json');

describe('Soundboard categories (per profile file)', () => {
  it('survives a restart; an empty name takes the sound out of its category', async () => {
    const f = await file();
    const lib = await SoundLibrary.open(f);
    await lib.set('boop', '  Mèmes ');
    await lib.set('akh', 'Cris');
    await lib.set('akh', '');
    expect((await SoundLibrary.open(f)).categories).toEqual({ boop: 'Mèmes' });
  });

  it('concurrent changes all land, the last write holds them all', async () => {
    const f = await file();
    const lib = await SoundLibrary.open(f);
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) => lib.set(id, 'Cris')),
    );
    expect(
      Object.keys(
        (JSON.parse(await readFile(f, 'utf8')) as { categories: object })
          .categories,
      ),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('refuses a bad id or an overlong name, nothing changes', async () => {
    const lib = await SoundLibrary.open(await file());
    expect(() => lib.set('../x', 'Cris')).toThrow('invalid_sound');
    expect(() => lib.set('boop', 'x'.repeat(25))).toThrow('invalid_category');
    expect(() => lib.set('boop', 3)).toThrow('invalid_category');
    expect(lib.categories).toEqual({});
  });

  it('an unreadable file reads as no category', async () => {
    const lib = await SoundLibrary.open(join(tmpdir(), 'absent', 'x.json'));
    expect(lib.categories).toEqual({});
  });
});

describe('Soundboard waveform', () => {
  it('keeps the real peak of each slice, not normalised', () => {
    const data = Float32Array.from([0, 0.1, -0.25, 0, 0.05, 0, 0, -0.5]);
    expect(peaksOf(data, 2)).toEqual([0.25, 0.5]);
  });

  it('a silent slice stays visible as a thin bar', () => {
    expect(wavePath([0, 1], 40)).toBe('M0 19.5V20.5M1 0.0V40.0');
  });
});
