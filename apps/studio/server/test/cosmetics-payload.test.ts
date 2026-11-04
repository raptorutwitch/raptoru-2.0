// Studio › Boutique « Enregistrer » (apps/studio/web/src/cosmetics.ts): only the item's own fields reach the Core.
import { CosmeticItemInput } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { frameProblemsOf, itemPayload } from '../../web/src/cosmetics-item.js';

describe('Boutique: the saved item', () => {
  it('an item opened with « Modifier » (display fields of the list) is accepted by the Core’s strict schema', () => {
    // The real production row of 31/10 (gentil-fantome), as the list returns it, then « Masqué ».
    const fromList = {
      reward_id: 'gentil-fantome',
      kind: 'title',
      label: 'Loup-garou',
      description: '',
      rarity: 'common',
      category: 'general',
      unlock_level: null,
      active: true,
      sort: 0,
      status: 'hidden',
      style: {
        color: '#2ee6c1',
        effect: 'glow',
        weight: 'bold',
        gradient: { to: '#ad0505', from: '#f02d2d', angle: 225 },
      },
      image_id: null,
      image: null,
      event_key: null,
      owners: 0,
      offers: [],
      isNew: false,
    };
    expect(CosmeticItemInput.safeParse(fromList).success).toBe(false); // the bug
    const sent = itemPayload(fromList);
    expect(Object.keys(sent)).not.toEqual(
      expect.arrayContaining(['active', 'image', 'owners', 'offers', 'isNew']),
    );
    const parsed = CosmeticItemInput.safeParse(sent);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      reward_id: 'gentil-fantome',
      label: 'Loup-garou',
      status: 'hidden',
      style: { gradient: { from: '#f02d2d', to: '#ad0505', angle: 225 } },
    });
  });
});

describe('Atelier: a frame checked before sending (raptoru.fr lot 3)', () => {
  /** A 128 px frame: a ring between radii `from` and `to` (+ optional extra opaque pixels). */
  const ring = (from: number, to: number, extra: [number, number][] = []) => {
    const w = 128;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - w / 2);
        if (d >= from && d <= to) px[(y * w + x) * 4 + 3] = 255;
      }
    for (const [x, y] of extra) px[(y * w + x) * 4 + 3] = 255;
    return px;
  };
  it('a ring around the avatar circle passes; a filled centre, a touched border or a non-square canvas do not', () => {
    // 128 px: the avatar is a 40 px radius circle; 3 px of overlap allowed (12 of 512); 2 px of empty border.
    expect(frameProblemsOf(ring(38, 58), 128, 128)).toEqual([]);
    expect(frameProblemsOf(ring(10, 58), 128, 128)[0]).toMatch(/centre/);
    expect(frameProblemsOf(ring(38, 58, [[0, 64]]), 128, 128)[0]).toMatch(
      /bord/,
    );
    expect(
      frameProblemsOf(new Uint8ClampedArray(128 * 64 * 4), 128, 64),
    ).toEqual(['le cadre doit être carré']);
  });
});
