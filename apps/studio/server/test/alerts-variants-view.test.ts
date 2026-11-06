// Alertes, familles et variantes (apps/studio/web/src/pages/alerts-model.ts, alerts-inspector.ts) : ce que la page dit et envoie.
import { describe, expect, it } from 'vitest';
import {
  ALERT_VARIANTS,
  BITS_MINIMUM as CORE_BITS,
  FOLLOW_WEIGHTS,
  GIFT_THRESHOLDS,
  HALLOWEEN_VARIANTS,
  JERRY_THRESHOLDS,
} from '../../../core-api/src/alerts/variants.js';
import { inspectorHtml } from '../../web/src/pages/alerts-inspector.js';
import {
  type AlertVariantInfo,
  BITS_MINIMUM,
  chance,
  FAMILIES,
  type FamilyMode,
  familyById,
  FOLLOW,
  GIFT_MIN,
  PRESETS,
  playsText,
  toggleFollow,
  togglePool,
  triggerOf,
  variantName,
} from '../../web/src/pages/alerts-model.js';
import { identity } from '../../web/src/pages/alerts-place.js';

const all = [...Object.values(ALERT_VARIANTS), ...HALLOWEEN_VARIANTS].map(
  (v) => ({ ...v, missing: [] }),
) as unknown as AlertVariantInfo[];

const view = (familyId: string, mode: FamilyMode = 'auto') => {
  const family = familyById(familyId);
  const variants = all.filter(family.has);
  return {
    family,
    variants,
    cur: variants[0]!,
    settings: { families: {} },
    pools: null,
    mode,
    presetKey: 'normal',
    fake: PRESETS.normal!.data,
    look: {},
    unsaved: [],
    canReplace: false,
    sel: null,
    selLabel: '',
    place: identity().media,
    box: null,
    sharedBy: [],
  };
};

describe('Studio › Alertes › familles et variantes', () => {
  it('says what each family plays; Halloween is offered only where a Halloween variant exists', () => {
    expect(playsText('off', 'Raid', null)).toContain('Aucune animation');
    expect(playsText('halloween', 'Eren', 'le Ballon')).toBe(
      'le Ballon toujours (secours : Eren si le média manque).',
    );
    expect(playsText('auto', 'Eren', 'le Ballon')).toContain(
      'quand le profil Halloween est actif',
    );
    const raid = inspectorHtml(view('raid', 'off'));
    expect(raid).not.toContain('data-mode="halloween"');
    expect(raid).toMatch(/data-mode="off" class="on"/);
    expect(inspectorHtml(view('follow'))).toContain('data-mode="halloween"');
  });

  it('every variant of the catalogue belongs to a family and has a real name', () => {
    for (const v of all) {
      expect(
        FAMILIES.some((f) => f.has(v)),
        v.id,
      ).toBe(true);
      expect(variantName(v.id), v.id).not.toBe(v.id);
      expect(triggerOf(v), v.id).toBeTruthy();
    }
  });

  it('the page says the rules of the Core: weights, thresholds', () => {
    expect(FOLLOW).toEqual(FOLLOW_WEIGHTS);
    expect(BITS_MINIMUM).toBe(CORE_BITS);
    for (const [min, id] of GIFT_THRESHOLDS) expect(GIFT_MIN[id]).toBe(min);
    for (const [min, v] of JERRY_THRESHOLDS) expect(GIFT_MIN[v.id]).toBe(min);
  });

  it('follow: never an empty selection; nothing saved = every variant; chances follow the draw', () => {
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
    expect(chance({ families: {} }, 'follow_eren')).toBe(25);
    const s = {
      families: {},
      follow: ['follow_eren', 'follow_discord'],
      weights: { follow_discord: 60 },
    };
    expect(chance(s, 'follow_discord')).toBe(75);
    expect(chance(s, 'follow_dofus_ebene')).toBe(0);
  });

  it('ballons: the last one of a draw stays', () => {
    const one = { sub: [2], prime: [1, 2, 3, 4], resub: [1, 2, 3, 4] };
    expect(togglePool(one, 'sub', 2, false).sub).toEqual([2]);
    expect(togglePool(one, 'sub', 4, true).sub).toEqual([2, 4]);
  });
});
