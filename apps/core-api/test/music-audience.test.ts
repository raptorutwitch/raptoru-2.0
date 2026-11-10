import { describe, expect, it } from 'vitest';
import { musicOpenTo, parseMusicAudience } from '../src/ext/music-audience.js';

describe('MUSIC_HUB_EXTENSION', () => {
  it('parses off / on / testers, refuses anything else', () => {
    expect(parseMusicAudience(undefined)).toEqual({ mode: 'off' });
    expect(parseMusicAudience('off')).toEqual({ mode: 'off' });
    expect(parseMusicAudience('on')).toEqual({ mode: 'on' });
    const t = parseMusicAudience('testers:1,22');
    expect(t.mode === 'testers' && [...t.testers]).toEqual(['1', '22']);
    for (const bad of ['yes', 'testers:abc', 'testers:1,', 'ON'])
      expect(() => parseMusicAudience(bad)).toThrow();
  });

  it('opens to the Lab always, the broadcaster and listed ids in testers mode', () => {
    const t = parseMusicAudience('testers:7');
    const v = (userId: string | null, role = 'viewer') => ({ role, userId });
    expect(musicOpenTo({ mode: 'off' }, true, v(null))).toBe(true);
    expect(musicOpenTo({ mode: 'off' }, false, v('1', 'broadcaster'))).toBe(
      false,
    );
    expect(musicOpenTo(t, false, v('7'))).toBe(true);
    expect(musicOpenTo(t, false, v('8'))).toBe(false);
    expect(musicOpenTo(t, false, v(null))).toBe(false);
    expect(musicOpenTo(t, false, v('1', 'broadcaster'))).toBe(true);
    expect(musicOpenTo({ mode: 'on' }, false, v('8'))).toBe(true);
  });
});
