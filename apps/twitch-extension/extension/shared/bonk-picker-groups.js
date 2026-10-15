// Organisation du picker Bonk en familles : Récents, Favoris, puis Twitch (une section par
// chaîne), Bits (une seule famille, sous-sections par chaîne via emote_type = bitstier),
// Extension (7TV / BTTV / FFZ, rangés par contexte : la chaîne puis Globales, avec la provenance
// en sous-titre) et Emoji (banque Unicode/Twemoji de l'extension, catégories façon Discord).
// Module pur : aucune dépendance au DOM.

const twemoji = (codepoints) => `assets/twemoji/svg/${codepoints}.svg`;

export const BONK_PICKER_FAMILIES = {
  twitch: { id: 'twitch', label: 'Twitch', tone: '#a970ff' },
  bits: { id: 'bits', label: 'Bits', tone: '#e879f9', iconSrc: 'assets/bonk/providers/bits.svg' },
  extension: { id: 'extension', label: 'Extension', tone: '#38bdf8', iconSrc: twemoji('1f9e9') },
  // Icône distincte de toutes ses catégories (Smileys = 😀) : le dossier ne se confond pas avec l'une d'elles.
  emoji: { id: 'emoji', label: 'Emoji', tone: '#f5c26b', iconSrc: twemoji('1f60e') },
};

/** Provenances de la famille Extension, dans l'ordre d'affichage. */
export const EXTENSION_PROVIDERS = [
  { id: '7tv', label: '7TV', iconSrc: 'assets/bonk/providers/7tv.svg' },
  { id: 'bttv', label: 'BTTV', iconSrc: 'assets/bonk/providers/bttv.svg' },
  { id: 'ffz', label: 'FFZ', iconSrc: 'assets/bonk/providers/ffz.svg' },
];

export const EMOJI_CATEGORIES = [
  { id: 'emoji-smileys-people', label: 'Smileys & personnes', from: ['unicode-smileys-emotion', 'unicode-people-body'], icon: '1f600' },
  { id: 'emoji-animals-nature', label: 'Animaux & nature', from: ['unicode-animals-nature'], icon: '1f43b' },
  { id: 'emoji-food-drink', label: 'Nourriture', from: ['unicode-food-drink'], icon: '1f354' },
  { id: 'emoji-activities', label: 'Activités', from: ['unicode-activities'], icon: '26bd' },
  { id: 'emoji-travel-places', label: 'Voyage & lieux', from: ['unicode-travel-places'], icon: '2708' },
  { id: 'emoji-objects', label: 'Objets', from: ['unicode-objects'], icon: '1f4a1' },
  { id: 'emoji-symbols', label: 'Symboles', from: ['unicode-symbols'], icon: '1f523' },
  { id: 'emoji-flags', label: 'Drapeaux', from: ['unicode-flags'], icon: '1f3c1' },
];

const VIRTUAL_ICONS = { recents: twemoji('1f558'), favorites: twemoji('2b50') };

/**
 * @param visibleGroups groupes du picker (virtuels + catalogue), dans l'ordre du catalogue
 * @param emotesOf     (group) => emotes normalisées du groupe
 * @returns [{ id, label?, group?, family, iconSrc?, scope?, parts?, emotes }] sans entrée vide.
 *          `parts` (famille Extension) : [{ id, provider, label, iconSrc, emotes }] non vides.
 */
export function arrangeBonkPickerGroups(visibleGroups, emotesOf) {
  const head = [];
  const twitch = [];
  const bits = [];
  const extension = { channel: new Map(), global: new Map() };
  let channelLabel = null;
  const other = [];
  const unicode = new Map();
  for (const group of visibleGroups) {
    const emotes = emotesOf(group);
    if (group.id === 'recents' || group.id === 'favorites') {
      head.push({ id: group.id, group, family: null, iconSrc: VIRTUAL_ICONS[group.id], emotes });
    } else if (group.source === 'unicode') {
      unicode.set(group.id, { group, emotes });
    } else if (group.source === 'twitch') {
      const bitsEmotes = emotes.filter((emote) => emote.emote_type === 'bitstier');
      const channelEmotes = bitsEmotes.length
        ? emotes.filter((emote) => emote.emote_type !== 'bitstier')
        : emotes;
      twitch.push({ id: group.id, group, family: BONK_PICKER_FAMILIES.twitch, emotes: channelEmotes });
      if (bitsEmotes.length) {
        bits.push({ id: `bits:${group.id}`, group, family: BONK_PICKER_FAMILIES.bits, emotes: bitsEmotes });
      }
    } else if (EXTENSION_PROVIDERS.some((provider) => provider.id === group.source)) {
      const scope = group.scope === 'global' ? 'global' : 'channel';
      if (scope === 'channel') channelLabel ??= group.label;
      const bucket = extension[scope];
      bucket.set(group.source, [...(bucket.get(group.source) ?? []), ...emotes]);
    } else {
      other.push({ id: group.id, group, family: null, emotes });
    }
  }
  // Extension : un contexte (chaîne, Globales) = une section ; la provenance devient un sous-titre.
  const contexts = ['channel', 'global'].map((scope) => {
    const parts = EXTENSION_PROVIDERS
      .map((provider) => ({
        id: `extension-${scope}-${provider.id}`,
        provider: provider.id,
        label: provider.label,
        iconSrc: provider.iconSrc,
        emotes: extension[scope].get(provider.id) ?? [],
      }))
      .filter((part) => part.emotes.length);
    return {
      id: `extension-${scope}`,
      label: scope === 'global' ? 'Globales' : (channelLabel || 'Chaîne'),
      scope,
      family: BONK_PICKER_FAMILIES.extension,
      parts,
      emotes: parts.flatMap((part) => part.emotes),
    };
  });
  const emoji = EMOJI_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    family: BONK_PICKER_FAMILIES.emoji,
    iconSrc: twemoji(category.icon),
    emotes: category.from.flatMap((id) => {
      const source = unicode.get(id);
      unicode.delete(id);
      return source?.emotes ?? [];
    }),
  }));
  // Groupe Unicode inconnu (catalogue futur) : conservé dans Emoji plutôt que perdu.
  for (const { group, emotes } of unicode.values()) {
    emoji.push({ id: group.id, group, family: BONK_PICKER_FAMILIES.emoji, emotes });
  }
  head.sort((left, right) => (left.id === 'recents' ? -1 : 0) - (right.id === 'recents' ? -1 : 0));
  return [...head, ...twitch, ...bits, ...contexts, ...emoji, ...other].filter((entry) => entry.emotes.length);
}
