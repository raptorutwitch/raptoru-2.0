import { describe, expect, it } from 'vitest';
import {
  gridMetrics,
  searchEmoteGroups,
  sectionSignature,
} from '../extension/shared/emote-picker.js';

const groups = [
  {
    id: 'favorites',
    label: 'Favoris',
    virtual: true,
    emotes: [{ id: 'twitch:1', label: 'raptoruHype' }],
  },
  {
    id: 'twitch-channel-83603689',
    label: 'raptoru_',
    keywords: ['raptoru_', 'raptoru_'],
    emotes: [
      { id: 'twitch:1', label: 'raptoruHype' },
      { id: 'twitch:2', label: 'raptoruGG' },
    ],
  },
  {
    id: 'twitch-channel-2',
    label: 'Kameto',
    keywords: ['kamet0'],
    emotes: [
      { id: 'twitch:3', label: 'kametoHype' },
      { id: 'twitch:4', label: 'kametoLUL' },
    ],
  },
  {
    id: 'unicode-smileys-emotion',
    label: 'Visages',
    emotes: [{ id: 'unicode:1f600', label: 'grinning face' }],
  },
];

describe('searchEmoteGroups', () => {
  it('matches emote names across channels, grouped in catalog order', () => {
    const found = searchEmoteGroups(groups.slice(1), 'hype');
    expect(found.groups.map((g) => [g.id, g.emotes.map((e) => e.id)])).toEqual([
      ['twitch-channel-83603689', ['twitch:1']],
      ['twitch-channel-2', ['twitch:3']],
    ]);
    expect(found.total).toBe(2);
  });

  it('a channel name or login brings the whole channel', () => {
    expect(
      searchEmoteGroups(groups.slice(1), 'KAMET0').groups[0].emotes,
    ).toHaveLength(2);
    expect(searchEmoteGroups(groups.slice(1), 'kameto').total).toBe(2);
  });

  it('is accent/case-insensitive, deduplicates ids and caps results', () => {
    expect(searchEmoteGroups(groups, 'RAPTORU').total).toBe(2); // favoris + chaîne : une seule fois
    const capped = searchEmoteGroups(groups.slice(1), 'o', 3);
    expect(capped.shown).toBe(3);
    expect(capped.total).toBe(4);
    expect(searchEmoteGroups(groups, '   ').groups).toEqual([]);
    expect(
      searchEmoteGroups(
        [{ id: 'x', label: 'Été', emotes: [{ id: 'a', label: 'a' }] }],
        'ete',
      ).total,
    ).toBe(1);
  });
});

describe('sectionSignature', () => {
  it('changes only when the rendered content changes', () => {
    const base = sectionSignature(groups[2]);
    expect(
      sectionSignature({ ...groups[2], emotes: [...groups[2].emotes] }),
    ).toBe(base);
    expect(
      sectionSignature({ ...groups[2], emotes: groups[2].emotes.slice(1) }),
    ).not.toBe(base);
    expect(sectionSignature({ ...groups[2], label: 'Autre' })).not.toBe(base);
  });
});

describe('gridMetrics', () => {
  it('matches an auto-fill grid of square cells', () => {
    // 268 px, cellule min 40, gap 4 -> 6 colonnes de 41.33 px.
    const m = gridMetrics(268, 13, 40, 4);
    expect(m.columns).toBe(6);
    expect(m.height).toBeCloseTo((3 * (268 - 20)) / 6 + 2 * 4);
    expect(gridMetrics(268, 0, 40, 4).height).toBe(0);
    expect(gridMetrics(10, 2, 40, 4).columns).toBe(1);
  });
});
