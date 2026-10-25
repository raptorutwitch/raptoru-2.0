import { describe, expect, it } from 'vitest';
import {
  AUDIO_CHOICE_KEY,
  readChoice,
  restoreAudio,
  writeChoice,
} from '../sound-player/audio-choice.js';

function storage() {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}
const broken = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
};

describe('Soundboard player audio choice (bug 23/10: Ctrl+R forgot « Activer le son »)', () => {
  it('remembers on / off; anything else or an unreadable storage reads as no choice', () => {
    const s = storage();
    expect(readChoice(s)).toBeNull();
    writeChoice(s, 'on');
    expect(readChoice(s)).toBe('on');
    writeChoice(s, 'off');
    expect(readChoice(s)).toBe('off');
    s.setItem(AUDIO_CHOICE_KEY, 'maybe');
    expect(readChoice(s)).toBeNull();
    expect(readChoice(broken)).toBeNull();
    expect(() => writeChoice(broken, 'on')).not.toThrow();
  });

  it('restores: on → enabled when allowed, needs_click when refused or failing; off is never re-enabled', async () => {
    let tried = 0;
    const allow = async () => (tried++, true);
    expect(await restoreAudio('on', allow)).toBe('enabled');
    expect(await restoreAudio('on', async () => false)).toBe('needs_click');
    expect(
      await restoreAudio('on', async () => {
        throw new Error('NotAllowedError');
      }),
    ).toBe('needs_click');
    tried = 0;
    expect(await restoreAudio('off', allow)).toBe('off');
    expect(await restoreAudio(null, allow)).toBe('waiting');
    expect(tried).toBe(0); // a voluntary cut or no choice never even tries to unlock audio
  });
});
