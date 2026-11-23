import { SoundLabSoundId } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { checkWav } from '../../../core-api/src/sound-lab/wav.js';
import {
  CUT,
  clampCut,
  encodeWav,
  fadeEdges,
  nameFromFile,
  sameChannels,
  soundIdFor,
} from '../../web/src/pages/soundboard-cut.js';

// The Soundboard editor's cut, without DOM (docs/SOUNDBOARD.md § Ajouter un son): what Studio publishes is exactly what
// the Core accepts.

const tone = (frames: number, f = 440) =>
  Float32Array.from({ length: frames }, (_, i) =>
    Math.sin((2 * Math.PI * f * i) / CUT.rate),
  );

describe('Soundboard editor — the cut', () => {
  it('the WAV Studio encodes is accepted as is by the Core (mono and stereo), duration exact', () => {
    const mono = encodeWav([tone(CUT.rate * 2)], CUT.rate);
    expect(checkWav(Buffer.from(mono))).toMatchObject({
      mime: 'audio/wav',
      duration_ms: 2000,
      size: 44 + CUT.rate * 2 * 2,
    });
    const stereo = encodeWav([tone(4410), tone(4410, 220)], CUT.rate);
    expect(checkWav(Buffer.from(stereo)).duration_ms).toBe(100);
    // Full scale clamps, never wraps around.
    const loud = encodeWav([Float32Array.from([2, -2, 1, -1])], CUT.rate);
    const view = new DataView(loud.buffer);
    expect([44, 46, 48, 50].map((at) => view.getInt16(at, true))).toEqual([
      32767, -32768, 32767, -32768,
    ]);
  });

  it('the selection stays between 0,1 s and 20 s inside the file; the moved handle keeps its place', () => {
    expect(clampCut(1, 3, 10)).toEqual({ start: 1, end: 3 });
    expect(clampCut(-5, 50, 60, 'end')).toEqual({ start: 30, end: 50 }); // 20 s max: the start follows
    expect(clampCut(5, 40, 60, 'start')).toEqual({ start: 5, end: 25 }); // 20 s max: the end follows
    expect(clampCut(4, 4.02, 10, 'end')).toEqual({ start: 3.92, end: 4.02 }); // 0,1 s min
    expect(clampCut(9.99, 10, 10, 'start')).toEqual({ start: 9.9, end: 10 });
    expect(clampCut(0, 99, 3)).toEqual({ start: 0, end: 3 });
  });

  it('mono when both channels are the same; a short fade at both ends; no fade longer than half the cut', () => {
    const l = tone(1000);
    expect(sameChannels([l, l.slice()])).toBe(true);
    expect(sameChannels([l, tone(1000, 220)])).toBe(false);
    expect(sameChannels([l])).toBe(true);
    const flat = [new Float32Array(1000).fill(1)];
    fadeEdges(flat, CUT.rate);
    const n = Math.round(CUT.fadeS * CUT.rate);
    expect(flat[0]![0]).toBe(0);
    expect(flat[0]![999]).toBe(0);
    expect(flat[0]![n]).toBe(1);
    const tiny = [new Float32Array(10).fill(1)];
    fadeEdges(tiny, CUT.rate);
    // Ten samples: the two fades meet in the middle, nothing is amplified.
    expect([...tiny[0]!].map((v) => Math.round(v * 10) / 10)).toEqual([
      0, 0.2, 0.4, 0.6, 0.8, 0.8, 0.6, 0.4, 0.2, 0,
    ]);
  });

  it('the proposed name and the new sound id', () => {
    expect(nameFromFile('Ouais_mon_gars (meme).MP3')).toBe(
      'Ouais mon gars (meme)',
    );
    expect(nameFromFile('<script>.wav')).toBe('script');
    expect(nameFromFile('.mp3')).toBe('Nouveau son');
    const id = soundIdFor('Ça c’est l’été — œuvre !', () => 0.5);
    expect(id).toBe('ca-c-est-l-ete-uvre-888888');
    expect(SoundLabSoundId.safeParse(id).success).toBe(true);
    expect(SoundLabSoundId.safeParse(soundIdFor('!!!')).success).toBe(true);
    expect(SoundLabSoundId.safeParse(soundIdFor('x'.repeat(80))).success).toBe(
      true,
    );
  });
});
