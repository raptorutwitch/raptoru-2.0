// Bonk — the catalogue rules without any screen (moved from ui.js): sources and their order, emote normalisation,
// favourites, the role lock of Twitch emotes, the shot dispatch. Core stays the authority on every shot.

import { UNICODE_EMOJI_GROUPS } from './unicode-emojis.js';

const TWEMOJI_UNICODE_IDS = new Set(
  UNICODE_EMOJI_GROUPS.flatMap((group) => group.emotes ?? [])
    .map((item) => Array.isArray(item) ? String(item[0]) : String(item?.id ?? '')),
);

// Les emotes Unicode du catalogue gardent leur identifiant et leur glyph
// natifs. Seule leur couche visuelle pointe vers les SVG Twemoji locaux,
// afin de ne jamais convertir une emote Twitch/7TV/BTTV/FFZ.
export function bonkTwemojiAssetPath(emote) {
  const id = String(emote?.id ?? '').toLowerCase();
  if (emote?.source !== 'unicode' || !TWEMOJI_UNICODE_IDS.has(id)) return null;
  const codepoints = id.slice('unicode:'.length)
    .replace(/-fe0f/g, '')
    .split('-')
    .map((part) => part.replace(/^0+(?=[0-9a-f])/, ''))
    .join('-');
  return codepoints ? `assets/twemoji/svg/${codepoints}.svg` : null;
}

export function createTwitchBrandIcon() {
  const createNode = typeof document.createElementNS === 'function'
    ? (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag)
    : (tag) => document.createElement(tag);
  const svg = createNode('svg');
  svg.classList.add('jdm-emote-source__twitch-mark');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Twitch');
  svg.setAttribute('focusable', 'false');

  // Marque locale, monochrome et autonome : aucune image distante ni
  // dépendance au rendu de la police du viewer.
  const bubble = createNode('path');
  bubble.setAttribute('d', 'M3 3h18v11l-4 4h-4l-3 3v-3H3V3Z');
  bubble.setAttribute('fill', 'none');
  bubble.setAttribute('stroke', 'currentColor');
  bubble.setAttribute('stroke-linejoin', 'round');
  bubble.setAttribute('stroke-width', '1.8');
  const bars = createNode('path');
  bars.setAttribute('d', 'M9 7v5M15 7v5');
  bars.setAttribute('fill', 'none');
  bars.setAttribute('stroke', 'currentColor');
  bars.setAttribute('stroke-linecap', 'round');
  bars.setAttribute('stroke-width', '1.8');
  svg.append(bubble, bars);
  return svg;
}

const BONK_SOURCE_PRIORITY = Object.freeze({
  twitch: 20,
  '7tv': 30,
  bttv: 40,
  ffz: 50,
  unicode: 60,
});

const BONK_ARTIFICIAL_GROUP_IDS = new Set(['twitch-sub-dofus-preview']);

function normalizedBonkSource(value) {
  const source = String(value ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!source) return '';
  if (source === '7tv' || source.includes('7tv') || source.includes('seven-tv')) return '7tv';
  if (source === 'bttv' || source.includes('bttv') || source.includes('betterttv')) return 'bttv';
  if (source === 'ffz' || source.includes('frankerfacez')) return 'ffz';
  if (source === 'unicode' || source.includes('emoji')) return 'unicode';
  if (source === 'twitch' || source.includes('twitch') || source.includes('helix')) return 'twitch';
  return '';
}

function bonkGroupSource(group = {}) {
  const explicit = normalizedBonkSource(group.source ?? group.provider ?? group.platform);
  if (explicit) return explicit;
  const firstEmote = Array.isArray(group.emotes) && group.emotes.length && !Array.isArray(group.emotes[0])
    ? group.emotes[0]
    : null;
  const itemSource = normalizedBonkSource(firstEmote?.source ?? firstEmote?.provider ?? firstEmote?.platform);
  if (itemSource) return itemSource;
  const hint = `${group.id ?? ''} ${group.label ?? ''}`.toLowerCase();
  return normalizedBonkSource(hint) || 'twitch';
}

function firstBonkText(records, keys) {
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    for (const key of keys) {
      const value = record[key];
      if (value === null || value === undefined || typeof value === 'object') continue;
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
}

function firstBonkImageUrl(records, keys) {
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    for (const key of keys) {
      const value = record[key];
      if (typeof value !== 'string' || !value.trim()) continue;
      try {
        // Only consume an URL explicitly supplied by the runtime. A relative
        // string is not a profile image contract and must not be turned into
        // a made-up hôte local/network asset by the picker.
        const url = new URL(value.trim());
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
      } catch {
        // An invalid or relative avatar is deliberately ignored. The rail
        // keeps its text fallback instead of inventing a network asset.
      }
    }
  }
  return '';
}

function firstBonkAssetPath(records, keys) {
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    for (const key of keys) {
      const value = String(record[key] ?? '').trim().replaceAll('\\', '/');
      if (/^assets\/bonk\/[a-z0-9/_-]+\.svg$/iu.test(value)) return value;
    }
  }
  return '';
}

function bonkChannelIdentity(group = {}) {
  const firstEmote = Array.isArray(group.emotes) && group.emotes.length && !Array.isArray(group.emotes[0])
    ? group.emotes[0]
    : null;
  const nested = [
    group.channel,
    group.broadcaster,
    group.owner,
    group.user,
    group.channel_info,
    group.broadcaster_info,
    firstEmote?.channel,
    firstEmote?.broadcaster,
    firstEmote?.owner,
    firstEmote?.user,
  ].filter((value) => value && typeof value === 'object');
  const records = [group, ...nested, firstEmote].filter(Boolean);
  const id = firstBonkText(records, [
    'channel_id', 'broadcaster_id', 'twitch_channel_id', 'owner_id', 'user_id', 'twitch_user_id',
  ]) || firstBonkText(nested, ['id', 'channelId', 'broadcasterId', 'twitchId', 'userId']);
  const login = firstBonkText(records, [
    'channel_login', 'broadcaster_login', 'user_login', 'login', 'username',
  ]) || (typeof group.channel === 'string' ? group.channel.trim() : '');
  const displayName = firstBonkText(records, [
    'channel_display_name', 'broadcaster_name', 'display_name', 'channel_name', 'name',
  ]);
  const avatarUrl = firstBonkImageUrl(records, [
    'channel_avatar_url', 'avatar_url', 'profile_image_url', 'profile_image', 'profileImageUrl', 'avatar',
  ]);
  const avatarAsset = firstBonkAssetPath(records, [
    'channel_avatar_asset', 'avatar_asset', 'local_avatar_asset',
  ]);
  if (!id && !login) return null;
  const key = id ? `id:${id}` : `login:${login.toLocaleLowerCase('fr')}`;
  return {
    key,
    id,
    login,
    displayName: displayName || login,
    avatarUrl,
    avatarAsset,
  };
}

function isBonkTwitchGlobal(group, source) {
  if (source !== 'twitch') return false;
  if (group.scope === 'global' || group.type === 'global' || group.is_global === true || group.global === true) return true;
  if (String(group.owner_id ?? '').trim() === '0') return true;
  const hint = `${group.id ?? ''} ${group.label ?? ''}`.toLowerCase();
  return /(?:^|[-_:\s])global(?:[-_:\s]|$)/u.test(hint);
}

function isArtificialBonkGroup(group) {
  const id = String(group?.id ?? '').trim().toLowerCase();
  const label = String(group?.label ?? '').trim().toLocaleLowerCase('fr');
  return BONK_ARTIFICIAL_GROUP_IDS.has(id)
    || label === 'dofus & co';
}

function bonkGroupPriority(group) {
  const source = String(group?.source || 'twitch');
  if (source === 'twitch' && isBonkTwitchGlobal(group, source)) return 10;
  return BONK_SOURCE_PRIORITY[source] ?? 90;
}

/**
 * Reconcile runtime groups into stable source entries without changing emote
 * IDs. Twitch channel groups are merged only when the API provides an actual
 * channel ID/login; otherwise the original group remains a safe fallback.
 */
export function organizeBonkSourceGroups(rawGroups = []) {
  const merged = new Map();
  const channelAliases = new Map();
  let order = 0;
  for (const rawGroup of Array.isArray(rawGroups) ? rawGroups : []) {
    if (!rawGroup || typeof rawGroup !== 'object' || !Array.isArray(rawGroup.emotes) || !rawGroup.emotes.length) continue;
    if (isArtificialBonkGroup(rawGroup)) continue;
    const source = bonkGroupSource(rawGroup);
    const global = isBonkTwitchGlobal(rawGroup, source);
    const channel = source === 'twitch' && !global ? bonkChannelIdentity(rawGroup) : null;
    let key = global
      ? 'twitch-global'
      : channel
        ? `twitch-channel:${channel.key}`
        : `${source}:${String(rawGroup.id ?? `group-${order}`)}`;
    if (channel) {
      const aliases = [
        channel.id ? `id:${channel.id}` : '',
        channel.login ? `login:${channel.login.toLocaleLowerCase('fr')}` : '',
      ].filter(Boolean);
      const knownKey = aliases.map((alias) => channelAliases.get(alias)).find(Boolean);
      if (knownKey) key = knownKey;
      for (const alias of aliases) channelAliases.set(alias, key);
    }
    const current = merged.get(key);
    const group = {
      ...rawGroup,
      id: global ? 'twitch-global' : channel ? key : String(rawGroup.id ?? `group-${order}`),
      source,
      label: global
        ? 'Twitch'
        : channel?.displayName || String(rawGroup.label ?? 'Twitch'),
      icon: global ? String(rawGroup.icon || 'T') : String(rawGroup.icon || ''),
      emotes: [...rawGroup.emotes],
      _bonkOrder: order,
    };
    if (channel) {
      if (channel.id) group.channel_id = channel.id;
      if (channel.login) group.channel_login = channel.login;
      if (channel.displayName) group.channel_display_name = channel.displayName;
      if (channel.avatarUrl) group.channel_avatar_url = channel.avatarUrl;
      if (channel.avatarAsset) group.channel_avatar_asset = channel.avatarAsset;
    }
    if (!current) {
      merged.set(key, group);
    } else {
      current.emotes.push(...group.emotes);
      if (!current.channel_id && group.channel_id) current.channel_id = group.channel_id;
      if (!current.channel_login && group.channel_login) current.channel_login = group.channel_login;
      if (!current.channel_display_name && group.channel_display_name) {
        current.channel_display_name = group.channel_display_name;
        current.label = group.channel_display_name;
      }
      if (!current.channel_avatar_url && group.channel_avatar_url) current.channel_avatar_url = group.channel_avatar_url;
      if (!current.channel_avatar_asset && group.channel_avatar_asset) current.channel_avatar_asset = group.channel_avatar_asset;
    }
    order += 1;
  }
  return [...merged.values()]
    .sort((left, right) => bonkGroupPriority(left) - bonkGroupPriority(right) || left._bonkOrder - right._bonkOrder)
    .map(({ _bonkOrder, ...group }) => group);
}

export function normalizeBonkEmote(group, item) {
  if (Array.isArray(item)) {
    return {
      id: String(item[0]),
      glyph: String(item[1]),
      label: String(item[2]),
      source: normalizedBonkSource(group.source) || bonkGroupSource(group),
      groupId: group.id,
      previewOnly: Boolean(group.preview_only),
    };
  }
  return {
    ...item,
    id: String(item.id),
    label: String(item.label ?? item.name ?? item.id),
    source: normalizedBonkSource(item.source) || normalizedBonkSource(group.source) || bonkGroupSource(group),
    groupId: group.id,
    previewOnly: Boolean(item.preview_only ?? group.preview_only),
  };
}

export function buildBonkEmoteIndex(rawGroups = []) {
  const seenEmoteIds = new Set();
  const realGroups = organizeBonkSourceGroups(rawGroups).map((group) => {
    const emotes = [];
    for (const item of group.emotes ?? []) {
      const emote = normalizeBonkEmote(group, item);
      if (seenEmoteIds.has(emote.id)) continue;
      seenEmoteIds.add(emote.id);
      emotes.push(emote);
    }
    return { ...group, emotes };
  }).filter((group) => group.emotes.length);
  const emoteById = new Map();
  for (const group of realGroups) {
    for (const item of group.emotes) emoteById.set(item.id, item);
  }
  return { realGroups, emoteById };
}

/**
 * Keep only canonical favorite IDs that still exist in the current catalog.
 * The order is personal (most recently toggled first) and duplicates are
 * removed without mutating the stored array.
 */
export function normalizeBonkFavoriteIds(storedIds, emoteIds) {
  const valid = new Set(
    emoteIds && typeof emoteIds[Symbol.iterator] === 'function'
      ? [...emoteIds].map(String)
      : [],
  );
  const seen = new Set();
  const result = [];
  for (const rawId of Array.isArray(storedIds) ? storedIds : []) {
    const id = String(rawId);
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Toggle one canonical Bonk favorite. Invalid/stale IDs are ignored so a
 * persisted favorite can never create a synthetic emote in the UI.
 */
export function toggleBonkFavoriteIds(storedIds, emoteId, emoteIds) {
  const id = String(emoteId ?? '');
  const available = new Set(
    emoteIds && typeof emoteIds[Symbol.iterator] === 'function'
      ? [...emoteIds].map(String)
      : [],
  );
  const current = normalizeBonkFavoriteIds(storedIds, available);
  if (!id || !available.has(id)) return current;
  return current.includes(id)
    ? current.filter((candidate) => candidate !== id)
    : [id, ...current];
}

/**
 * Build the rail from groups that contain real emotes. Virtual entries are
 * derived from the current favorite/recent IDs on every render so they never
 * become stale after a toggle or a catalog refresh.
 */
export function buildBonkVisibleGroups(realGroups, { favoriteIds = [], recentIds = [] } = {}) {
  const groups = [];
  if (Array.isArray(favoriteIds) && favoriteIds.length) {
    groups.push({ id: 'favorites', label: 'Favoris', icon: '⭐', source: 'virtual' });
  }
  if (Array.isArray(recentIds) && recentIds.length) {
    groups.push({ id: 'recents', label: 'Récents', icon: '🕘', source: 'virtual' });
  }
  return [
    ...groups,
    ...(Array.isArray(realGroups) ? realGroups.filter((group) => group?.emotes?.length) : []),
  ];
}

// Lab : seul le rôle viewer devient le compte Twitch connecté ; modérateur et broadcaster gardent
// une identité fictive sans emotes Twitch personnelles (Core refuserait : viewer_not_linked).
export const BONK_TWITCH_ROLE_HINT = 'Disponible en rôle viewer lié à Twitch';
export function bonkTwitchLockedForRole(state) {
  return state?.environment === 'lab' && ['moderator', 'broadcaster'].includes(state?.role);
}

export function isBonkEmoteSelectable(emote, { demoMode = false, twitchLocked = false } = {}) {
  if (twitchLocked && emote?.source === 'twitch') return false;
  return !(emote?.previewOnly && !demoMode);
}

/**
 * Lance immédiatement une intention Bonk et ne sérialise jamais les appels.
 * Une erreur de rafraîchissement ne transforme pas une action déjà acceptée
 * en échec visible ; l'action elle-même reste toutefois signalée au caller.
 */
export function dispatchBonkImmediately(task, {
  onRefresh = async () => {},
  onSuccess = () => {},
  onError = () => {},
} = {}) {
  let request;
  try {
    request = task();
  } catch (error) {
    request = Promise.reject(error);
  }
  return Promise.resolve(request)
    .then(async (result) => {
      try { await onRefresh(); } catch { /* le prochain polling récupérera l'état */ }
      onSuccess(result);
      return result;
    })
    .catch((error) => {
      onError(error);
      return null;
    });
}

// Twitch interprète parfois un double-clic rapide sur la surface de
// l'extension comme une demande de plein écran. Cette protection reste
// strictement attachée au CTA Bonk : elle neutralise uniquement l'événement
// agrégé `dblclick`, jamais les deux `click` qui l'ont produit.
export function preventBonkDoubleClick(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}
