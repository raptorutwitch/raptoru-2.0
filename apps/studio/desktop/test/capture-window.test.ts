import { describe, expect, it } from 'vitest';
import { pickCaptureWindow } from '../src/capture-window.js';

// Halloween Chaos (docs/HALLOWEEN.md § 4 bis): the window the overlay captures. Never Studio's own windows (the overlay
// would capture itself), the chosen title when it is open, nothing when it is closed (no other window by surprise).

const S = (id: string, name: string) => ({ id, name });
const LIST = [
  S('window:1:0', 'Raptoru Halloween'),
  S('window:2:0', 'Dofus - Raptoru'),
  S('window:3:0', ''),
  S('window:4:0', 'OBS 32.0 - Profil : Twitch'),
];
const OWN = new Set(['window:1:0']);

describe('pickCaptureWindow', () => {
  it('automatic: the first listed window that is not Studio’s own nor untitled', () => {
    expect(pickCaptureWindow(LIST, OWN, null)?.name).toBe('Dofus - Raptoru');
    expect(pickCaptureWindow([LIST[0]!], OWN, null)).toBeNull();
  });
  it('chosen: exact title, else contained (any case); a closed choice gives nothing', () => {
    expect(pickCaptureWindow(LIST, OWN, 'OBS 32.0 - Profil : Twitch')?.id).toBe(
      'window:4:0',
    );
    expect(pickCaptureWindow(LIST, OWN, 'dofus')?.id).toBe('window:2:0');
    expect(pickCaptureWindow(LIST, OWN, 'Raptoru Halloween')).toBeNull();
    expect(pickCaptureWindow(LIST, OWN, 'Elden Ring')).toBeNull();
  });
});
