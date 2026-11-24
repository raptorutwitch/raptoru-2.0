// Layout decision of the socle (app/layout.js, plan § 3.1–3.3): profiles, scales, hysteresis.
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeLayout, detectSurface } from '../extension/app/layout.js';

describe('computeLayout', () => {
  it.each([
    // plan § 3.3 — known sizes
    [651, 434, 'normal', 1, 1],
    [565, 376, 'normal', 0.866, 0.95],
    [521, 347, 'compact', 0.85, 0.95],
    [452, 301, 'compact', 0.85, 0.95],
    [377, 251, 'compact', 0.85, 0.95],
    [867, 578, 'large', 1.15, 1.1],
    [1053, 702, 'large', 1.15, 1.1],
    [318, 496, 'etroit', 1, 1],
    [390, 844, 'etroit', 1, 1],
    [844, 390, 'normal', 0.899, 0.95],
  ])('%ix%i → %s (kg %f, kt %f)', (w, h, profile, kg, kt) => {
    expect(computeLayout({ w, h })).toEqual({ profile, kg, kt });
  });

  it('keeps the previous profile within 8 px of the boundary (no flicker while resizing)', () => {
    // 0.85 × 434 = 368.9: 365 px high is compact when fresh, normal when coming from normal.
    expect(computeLayout({ w: 600, h: 365 }).profile).toBe('compact');
    expect(computeLayout({ w: 600, h: 365, prev: 'normal' }).profile).toBe(
      'normal',
    );
    expect(computeLayout({ w: 600, h: 355, prev: 'normal' }).profile).toBe(
      'compact',
    );
  });

  it('a narrow or portrait root is « étroit » with unit scales', () => {
    expect(computeLayout({ w: 359, h: 200 })).toEqual({
      profile: 'etroit',
      kg: 1,
      kt: 1,
    });
    expect(computeLayout({ w: 500, h: 500 }).profile).toBe('etroit');
  });
});

// Real phone, 24/11 (banc mobile, SM-S916B): the Twitch app opened mobile.html with the anchor of the channel's
// activation (anchor=component). Read as « video », every html[data-surface='mobile'] rule was dropped and the Casino
// collapsed to 346 × 0. The page and platform=mobile decide; the anchor only for a page that is not mobile.html.
describe('detectSurface', () => {
  const at = (href) => detectSurface(new URL(href, 'https://x.ext-twitch.tv/'));
  it.each([
    ['mobile.html?platform=mobile&anchor=component&mode=viewer', 'mobile'],
    ['mobile.html?platform=mobile&anchor=panel&mode=viewer', 'mobile'],
    ['mobile.html?anchor=video_overlay', 'mobile'],
    ['video_component.html?anchor=component&platform=web', 'video'],
    ['panel.html?anchor=panel&platform=web', 'panel'],
    ['panel.html?anchor=panel&popout=true', 'popout'],
    ['index.html?anchor=component', 'video'],
  ])('%s → %s', (href, surface) => {
    expect(at(href)).toBe(surface);
  });
  it('a phone frame that starts at 0 × 0 and grows to 382 × 444 is the narrow profile, no stale size', () => {
    expect(computeLayout({ w: 382, h: 444 })).toEqual({
      profile: 'etroit',
      kg: 1,
      kt: 1,
    });
  });
});
