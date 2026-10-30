// Alertes › Variantes (apps/studio/web/src/alerts-variants.ts): what the card shows and saves.
import { describe, expect, it } from 'vitest';
import {
  playsText,
  toggleFollow,
  variantsView,
} from '../../web/src/alerts-variants.js';

describe('Studio › Alertes › Variantes', () => {
  it('says what each family plays; Halloween is offered only where a Halloween variant exists', () => {
    expect(playsText('off', 'Raid', null)).toContain('aucune animation');
    expect(playsText('halloween', 'Eren', 'le Ballon')).toBe(
      'le Ballon toujours (secours : Eren si le média manque)',
    );
    expect(playsText('auto', 'Eren', 'le Ballon')).toContain(
      'quand le profil Halloween est actif',
    );
    const html = variantsView({ families: { raid: 'off' } }, null);
    const raid = /<select data-family="raid"[^]*?<\/select>/.exec(html)![0];
    expect(raid).not.toContain('value="halloween"');
    expect(raid).toContain('value="off" selected');
    expect(variantsView({ families: {} }, 'unknown_variant')).toContain(
      'Refusé : unknown_variant',
    );
  });

  it('follow checkboxes: never an empty selection; nothing saved = every variant', () => {
    expect(toggleFollow(undefined, 'follow_discord', false)).toEqual([
      'follow_dofus_ebene',
      'follow_dofus_eliatrope',
      'follow_dofus_emeraude',
      'follow_eren',
    ]);
    expect(toggleFollow(['follow_eren'], 'follow_eren', false)).toBeNull();
    expect(toggleFollow(['follow_eren'], 'follow_discord', true)).toEqual([
      'follow_eren',
      'follow_discord',
    ]);
  });
});
