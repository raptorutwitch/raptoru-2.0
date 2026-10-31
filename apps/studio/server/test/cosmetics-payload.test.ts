// Studio › Boutique « Enregistrer » (apps/studio/web/src/cosmetics.ts): only the item's own fields reach the Core.
import { CosmeticItemInput } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { itemPayload } from '../../web/src/cosmetics-item.js';

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
