import { describe, expect, it } from 'vitest';
import { pickScreenSource } from '../src/capture-window.js';

// Halloween Chaos (docs/HALLOWEEN.md § 4 bis): the Chaos window captures the monitor it covers — that one, never
// another screen by surprise (a monitor unplugged meanwhile: nothing).

const S = (id: string, display_id: string) => ({ id, name: id, display_id });
const SCREENS = [S('screen:0:0', '876116052'), S('screen:1:0', '3382901566')];

describe('pickScreenSource', () => {
  it('the source of the covered monitor', () => {
    expect(pickScreenSource(SCREENS, 3382901566)?.id).toBe('screen:1:0');
    expect(pickScreenSource(SCREENS, 876116052)?.id).toBe('screen:0:0');
  });
  it('a monitor not offered: nothing', () => {
    expect(pickScreenSource(SCREENS, 42)).toBeNull();
    expect(pickScreenSource([], 876116052)).toBeNull();
  });
});
