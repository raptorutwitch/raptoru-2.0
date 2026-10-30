// « Chaudron des subs » card (apps/studio/web/src/halloween-cauldron.ts).
import { describe, expect, it } from 'vitest';
import {
  cauldronCard,
  cauldronFromForm,
  DEFAULT_CAULDRON,
} from '../../web/src/halloween-cauldron.js';

describe('Chaudron des subs', () => {
  it('the card says off / on with the count; the goal is clamped, the title trimmed', () => {
    expect(cauldronCard(DEFAULT_CAULDRON, null, null)).toContain(
      'Chaudron désactivé',
    );
    const on = { ...DEFAULT_CAULDRON, enabled: true, adjust: 2 };
    const html = cauldronCard(
      on,
      { enabled: true, count: 7, goal: 50 },
      {
        url: 'http://127.0.0.1:4100/halloween/cauldron.html#k',
        connected: true,
      },
    );
    expect(html).toContain('<b>7 / 50</b>');
    expect(html).toContain('+2');
    expect(html).toContain('cauldron.html#k');
    expect(
      cauldronFromForm(on, {
        title: '  Potion  ',
        goal: '0',
        count_resubs: false,
      }),
    ).toMatchObject({
      title: 'Potion',
      goal: 1,
      count_resubs: false,
      adjust: 2,
    });
    expect(
      cauldronFromForm(on, { title: 'x', goal: 'abc', count_resubs: true })
        .goal,
    ).toBe(50);
  });
});
