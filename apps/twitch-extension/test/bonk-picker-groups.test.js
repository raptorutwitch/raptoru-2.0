import { describe, expect, it } from 'vitest';
import { UNICODE_EMOJI_GROUPS } from '../extension/shared/unicode-emojis.js';
import {
  arrangeBonkPickerGroups,
  EMOJI_CATEGORIES,
} from '../extension/shared/bonk-picker-groups.js';
import { searchEmoteGroups } from '../extension/shared/emote-picker.js';

const emotesOf = (group) =>
  group.emotes.map((item) =>
    Array.isArray(item) ? { id: item[0], label: item[2] } : item,
  );

const twitch = (id, label, emotes) => ({ id, label, source: 'twitch', emotes });
const visible = [
  {
    id: 'favorites',
    label: 'Favoris',
    source: 'virtual',
    emotes: [{ id: 'twitch:a1', label: 'a1' }],
  },
  {
    id: 'recents',
    label: 'Récents',
    source: 'virtual',
    emotes: [{ id: 'twitch:b1', label: 'b1' }],
  },
  twitch('twitch-global', 'Twitch', [
    { id: 'twitch:g', label: 'Kappa', emote_type: 'globals' },
  ]),
  twitch('twitch-channel-a', 'Alpha', [
    { id: 'twitch:a1', label: 'a1', emote_type: 'subscriptions' },
    { id: 'twitch:a2', label: 'a2', emote_type: 'bitstier' },
  ]),
  twitch('twitch-channel-b', 'Beta', [
    { id: 'twitch:b1', label: 'b1', emote_type: 'bitstier' },
  ]),
  ...UNICODE_EMOJI_GROUPS,
];

describe('arrangeBonkPickerGroups', () => {
  const arranged = arrangeBonkPickerGroups(visible, emotesOf);

  it('orders Récents, Favoris, Twitch channels, one Bits family per owner, then Emoji categories', () => {
    expect(
      arranged.map((entry) => [entry.id, entry.family?.id ?? null]),
    ).toEqual([
      ['recents', null],
      ['favorites', null],
      ['twitch-global', 'twitch'],
      ['twitch-channel-a', 'twitch'],
      ['bits:twitch-channel-a', 'bits'],
      ['bits:twitch-channel-b', 'bits'],
      ...EMOJI_CATEGORIES.map((category) => [category.id, 'emoji']),
    ]);
    // Bits emotes leave the channel section; a channel with only Bits emotes has no Twitch section.
    expect(
      arranged
        .find((entry) => entry.id === 'twitch-channel-a')
        .emotes.map((e) => e.id),
    ).toEqual(['twitch:a1']);
  });

  it('keeps the whole Unicode bank, Smileys & personnes merged', () => {
    const emoji = arranged.filter((entry) => entry.family?.id === 'emoji');
    const total = UNICODE_EMOJI_GROUPS.reduce(
      (sum, group) => sum + group.emotes.length,
      0,
    );
    expect(emoji.reduce((sum, entry) => sum + entry.emotes.length, 0)).toBe(
      total,
    );
    expect(emoji[0]).toMatchObject({ label: 'Smileys & personnes' });
    expect(emoji[0].emotes.length).toBe(
      UNICODE_EMOJI_GROUPS.filter((g) =>
        ['unicode-smileys-emotion', 'unicode-people-body'].includes(g.id),
      ).reduce((sum, group) => sum + group.emotes.length, 0),
    );
  });

  it('7TV, BTTV, FFZ form one Extension family: channel then Globales, provider as sub-title', () => {
    const third = (provider, scope, label) => ({
      id: `${provider}-${scope}`,
      label,
      source: provider,
      scope,
      emotes: [{ id: `${provider}:${scope}`, label: 'x' }],
    });
    const out = arrangeBonkPickerGroups(
      [
        third('ffz', 'global', 'Globales'),
        third('7tv', 'channel', 'Raptoru_'),
        third('7tv', 'global', 'Globales'),
        third('bttv', 'channel', 'Raptoru_'),
        twitch('twitch-channel-b', 'Beta', [
          { id: 'twitch:b1', label: 'b1', emote_type: 'bitstier' },
        ]),
        UNICODE_EMOJI_GROUPS[0],
      ],
      emotesOf,
    );
    expect(out.map((entry) => [entry.id, entry.family.id])).toEqual([
      ['bits:twitch-channel-b', 'bits'],
      ['extension-channel', 'extension'],
      ['extension-global', 'extension'],
      ['emoji-smileys-people', 'emoji'],
    ]);
    const [channel, global] = out.filter(
      (entry) => entry.family.id === 'extension',
    );
    expect(channel.label).toBe('Raptoru_');
    // No empty sub-section: FFZ has no channel emotes, BTTV no global ones.
    expect(channel.parts.map((part) => part.label)).toEqual(['7TV', 'BTTV']);
    expect(global.parts.map((part) => part.label)).toEqual(['7TV', 'FFZ']);
    expect(channel.emotes.map((e) => e.id)).toEqual([
      '7tv:channel',
      'bttv:channel',
    ]);
  });

  it('an unknown Unicode group stays inside Emoji', () => {
    const out = arrangeBonkPickerGroups(
      [
        {
          id: 'unicode',
          label: 'Lab',
          source: 'unicode',
          emotes: [['unicode:1f600', '😀', 'smile']],
        },
      ],
      emotesOf,
    );
    expect(out).toMatchObject([{ id: 'unicode', family: { id: 'emoji' } }]);
  });
});

describe('search with categories', () => {
  it('matchLabel: false searches emote names only', () => {
    const groups = [
      {
        id: 'emoji-smileys-people',
        label: 'Smileys & personnes',
        matchLabel: false,
        emotes: [
          { id: 'x', label: 'grinning face' },
          { id: 'y', label: 'smiling face' },
        ],
      },
    ];
    expect(searchEmoteGroups(groups, 'smil').total).toBe(1);
    expect(searchEmoteGroups(groups, 'personnes').total).toBe(0);
  });
});
