// Rendu des modules, partagé par l'overlay desktop et le viewer mobile.
// Les deux surfaces ont la MÊME logique et des CSS différents : une seule
// implémentation métier, deux mises en page.

import { ERROR_LABELS, errorLabel } from './api.js';
import { modulePresentation, notificationCount, resolveExperience, syncNotificationCenter } from './experience.js';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  resolveNotification,
  unreadNotificationCount,
} from './notifications.js';
import { RUNTIME } from './runtime-config.js';
import { walletPaymentMethods, walletCanPayTokens } from './wallet-payment.js';
import {
  createFeedbackSlot,
  createIconButton,
  createWalletFace,
  createCurrencySwitch,
  createMultiCurrencyPayment,
  formatWalletExactValue,
  normalizeSearchQuery,
  providerPresentation,
  UI_ICONS,
  updateFeedbackSlot,
  updateIconButton,
} from './ui-primitives.js';
import { UNICODE_EMOJI_GROUPS } from './unicode-emojis.js';
import { createEmotePicker } from './emote-picker.js';
import { createHubCarousel, hubIcon } from './hub-carousel.js';
import { arrangeBonkPickerGroups } from './bonk-picker-groups.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

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

// Icônes du Soundboard (sbx-*) : tracés simples, couleur héritée.
const SBX_ICON_PATHS = {
  play: '<path d="M8.5 6.2v11.6a.9.9 0 0 0 1.4.8l9.2-5.8a.9.9 0 0 0 0-1.6L9.9 5.4a.9.9 0 0 0-1.4.8Z" fill="currentColor"/>',
  star: '<path class="sbx-star" d="M11.1 3.9a1 1 0 0 1 1.8 0l2.07 4.2 4.63.68a1 1 0 0 1 .56 1.7l-3.35 3.27.79 4.61a1 1 0 0 1-1.45 1.06L12 17.24l-4.15 2.18a1 1 0 0 1-1.45-1.06l.79-4.61-3.35-3.27a1 1 0 0 1 .56-1.7l4.63-.68Z" stroke-linejoin="round"/>',
  speaker: '<path d="M4.5 9.6v4.8h3.2l4.3 3.7V5.9L7.7 9.6Z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path class="sbx-wave sbx-wave--1" d="M15.3 9.4a3.6 3.6 0 0 1 0 5.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path class="sbx-wave sbx-wave--2" d="M17.9 6.9a7.2 7.2 0 0 1 0 10.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path class="sbx-mute" d="m15.6 9.8 4.4 4.4m0-4.4-4.4 4.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  close: '<path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  sort: '<path d="M8 5v14m0 0-3-3m3 3 3-3M16 19V5m0 0-3 3m3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  send: '<path d="M5 12h12m-4.5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8.2v4.3l2.8 1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

function sbxIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `sbx-icon sbx-icon--${name}`);
  svg.innerHTML = SBX_ICON_PATHS[name];
  return svg;
}

function sbxEqualizer() {
  const eq = document.createElement('span');
  eq.className = 'sbx-eq';
  eq.setAttribute('aria-hidden', 'true');
  eq.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  return eq;
}

function createNotificationBellIcon() {
  const createNode = typeof document.createElementNS === 'function'
    ? (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag)
    : (tag) => document.createElement(tag);
  const svg = createNode('svg');
  svg.classList.add('jdm-notification-toggle__icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const bell = createNode('path');
  bell.setAttribute('d', 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z');
  bell.setAttribute('fill', 'none');
  bell.setAttribute('stroke', 'currentColor');
  bell.setAttribute('stroke-linecap', 'round');
  bell.setAttribute('stroke-linejoin', 'round');
  bell.setAttribute('stroke-width', '1.8');

  const clapper = createNode('path');
  clapper.setAttribute('d', 'M10 21h4');
  clapper.setAttribute('fill', 'none');
  clapper.setAttribute('stroke', 'currentColor');
  clapper.setAttribute('stroke-linecap', 'round');
  clapper.setAttribute('stroke-width', '1.8');

  svg.append(bell, clapper);
  return svg;
}

function createTwitchBrandIcon() {
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

export function isBonkEmoteSelectable(emote, { demoMode = false } = {}) {
  return !(emote?.previewOnly && !demoMode);
}

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

// Le pot garde une valeur exacte et groupée. On remplace l'espace fine de
// l'API Intl par une espace insécable normale pour que la séparation reste
// perceptible dans la petite carte Tombola.
function fmtRafflePotAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('fr-FR').replace(/\u202f/gu, '\u00a0');
}

function soundPreviewUrls(sound) {
  const variants = Array.isArray(sound?.variants) ? sound.variants : [];
  const urls = variants.length
    ? variants.map((variant) => variant?.preview_url)
    : [sound?.preview_url];
  return urls.filter(Boolean).map(String);
}

function chooseSoundPreviewUrl(sound) {
  const urls = soundPreviewUrls(sound);
  if (!urls.length) return null;
  const raw = Number(Math.random());
  const bounded = Number.isFinite(raw) ? raw : 0;
  const index = Math.min(urls.length - 1, Math.max(0, Math.floor(bounded * urls.length)));
  return urls[index];
}

const PREVIEW_VOLUME_KEY = 'raptoru-live:soundboard-preview-volume';
const SOUNDBOARD_FAVORITES_KEY = 'raptoru-live:soundboard-favorites';
const SOUNDBOARD_RECENTS_KEY = 'raptoru-live:soundboard-recents';
const SOUNDBOARD_ORDER_KEY = 'raptoru-live:soundboard-order';
const SOUNDBOARD_ALIASES_KEY = 'raptoru-live:soundboard-aliases';
export const SOUNDBOARD_ALIAS_MAX_LENGTH = 32;
const TUTORIAL_DISABLED_PREFIX = 'raptoru-live:tutorial-disabled:';
const EMOTE_CATALOG_REFRESH_MS = 10 * 60 * 1000;
const SOUNDBOARD_HELP_PAGES = Object.freeze([
  'Choisis un son dans la liste, puis appuie sur Envoyer pour le jouer sur le stream.',
  'Utilise 🔊 pour écouter gratuitement un son avant de l’envoyer.',
  'Tu peux payer en Jetons ou utiliser un Crédit. Change de monnaie avec le switch ou le wallet.',
  'Utilise 🔍 pour retrouver rapidement un son.',
  '🔊 règle le volume de tes aperçus.',
]);
export const EMOTE_AUTH_POLL_INTERVAL_MS = 2_000;
export const EMOTE_AUTH_TIMEOUT_MS = 90_000;
export const EMOTE_AUTH_POPUP_GRACE_MS = 5_000;
const ACTIONS_MODULE = Object.freeze({
  id: 'actions',
  label: 'Actions',
  icon: '✓',
  description: 'Suis chaque interaction, de la file jusqu’à sa lecture ou son remboursement.',
});
// Hub « Pop Premium » : icône et couleurs propres à chaque module (présentation uniquement).
const HUB_MODULE_STYLES = Object.freeze({
  tts: { icon: 'tts', color: '#a855f7', color2: '#6366f1' },
  soundboard: { icon: 'soundboard', color: '#06b6d4', color2: '#3b82f6' },
  bonk: { icon: 'bonk', color: '#f59e0b', color2: '#ef4444' },
  raffle_join: { icon: 'raffle_join', color: '#ec4899', color2: '#a855f7' },
  moderation: { icon: 'moderation', color: '#10b981', color2: '#0e7490' },
});
const HUB_DEFAULT_STYLE = Object.freeze({ icon: 'module', color: '#8b5cf6', color2: '#6366f1' });
const MODERATION_MODULE = Object.freeze({
  id: 'moderation',
  label: 'Modération',
  icon: '⚔',
  description: 'Valide les messages TTS et consulte l’activité du stream.',
});

function homeModuleDescription(mod) {
  return modulePresentation(mod?.id).homeDescription || String(mod?.description || '').trim();
}

function visibleModuleLabel(mod) {
  return mod?.id === ACTIONS_MODULE.id ? 'Historique' : mod?.label;
}

function normalizeTtsDraft(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function ttsDraftLength(value) {
  return Array.from(normalizeTtsDraft(value)).length;
}

function readStoredIds(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function writeStoredIds(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage facultatif */ }
}

/**
 * Reconcile the viewer's personal Soundboard order with the current catalog.
 * Canonical IDs already known by the viewer keep their positions, new IDs are
 * appended in catalog order, and stale IDs are discarded.
 */
export function normalizeSoundboardOrder(storedIds, catalogIds) {
  const catalog = Array.isArray(catalogIds) ? catalogIds.map(String) : [];
  const valid = new Set(catalog);
  const seen = new Set();
  const order = [];
  for (const rawId of Array.isArray(storedIds) ? storedIds : []) {
    const id = String(rawId);
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  for (const rawId of catalog) {
    if (seen.has(rawId)) continue;
    seen.add(rawId);
    order.push(rawId);
  }
  return order;
}

/**
 * Apply a reorder made in a filtered view to the canonical personal order.
 * Hidden IDs keep their slots while the visible IDs receive the new relative
 * order. This keeps filtering a view and never turns it into a destructive
 * second ordering system.
 */
export function reorderSoundboardVisibleSubset(order, visibleIds, reorderedVisibleIds) {
  const base = Array.isArray(order) ? order.map(String) : [];
  const visible = [];
  const visibleSet = new Set();
  for (const rawId of Array.isArray(visibleIds) ? visibleIds : []) {
    const id = String(rawId);
    if (visibleSet.has(id) || !base.includes(id)) continue;
    visibleSet.add(id);
    visible.push(id);
  }
  const nextVisible = [];
  const seen = new Set();
  for (const rawId of Array.isArray(reorderedVisibleIds) ? reorderedVisibleIds : []) {
    const id = String(rawId);
    if (!visibleSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    nextVisible.push(id);
  }
  for (const id of visible) {
    if (seen.has(id)) continue;
    seen.add(id);
    nextVisible.push(id);
  }
  let cursor = 0;
  return base.map((id) => (visibleSet.has(id) ? nextVisible[cursor++] : id));
}

export function normalizeSoundboardAlias(value, maxLength = SOUNDBOARD_ALIAS_MAX_LENGTH) {
  const limit = Math.max(1, Number(maxLength) || SOUNDBOARD_ALIAS_MAX_LENGTH);
  return Array.from(String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim())
    .slice(0, limit)
    .join('');
}

function aliasValue(aliases, soundId) {
  if (aliases instanceof Map) return normalizeSoundboardAlias(aliases.get(String(soundId)) ?? '');
  return normalizeSoundboardAlias(aliases?.[String(soundId)] ?? '');
}

export function soundboardSoundLabel(sound, aliases = {}) {
  const id = String(sound?.id ?? '');
  return aliasValue(aliases, id) || String(sound?.label ?? id);
}

export function soundboardSoundMatchesQuery(sound, query, aliases = {}) {
  const normalizedQuery = normalizeSearchQuery(String(query ?? '').trim());
  if (!normalizedQuery) return true;
  const id = String(sound?.id ?? '');
  return normalizeSearchQuery(`${soundboardSoundLabel(sound, aliases)} ${sound?.label ?? ''} ${id}`)
    .includes(normalizedQuery);
}

/**
 * Return a calculated Soundboard view without mutating the catalog or the
 * personal order. A–Z follows the displayed label (therefore a local alias
 * when present); all other business values remain catalog values.
 */
export function sortSoundboardSounds(sounds, {
  sort = 'custom',
  customOrder = [],
  recents = [],
  aliases = {},
  paymentMethod = 'tokens',
  moduleTokenCost = 500,
} = {}) {
  const source = Array.isArray(sounds) ? [...sounds] : [];
  const catalogIds = source.map((sound) => String(sound?.id ?? ''));
  const personalOrder = normalizeSoundboardOrder(customOrder, catalogIds);
  const personalRank = new Map(personalOrder.map((id, index) => [id, index]));
  const recentRank = new Map(
    (Array.isArray(recents) ? recents : []).map(String).map((id, index) => [id, index]),
  );
  const sourceRank = new Map(catalogIds.map((id, index) => [id, index]));
  const displayedLabel = (sound) => soundboardSoundLabel(sound, aliases);
  const labelKey = (sound) => displayedLabel(sound).trim();
  const priceFor = (sound) => {
    const preferred = paymentMethod === 'credits'
      ? Number(sound?.credit_cost)
      : Number(sound?.token_cost ?? moduleTokenCost);
    const fallback = paymentMethod === 'credits'
      ? Number(sound?.token_cost ?? moduleTokenCost)
      : Number(sound?.credit_cost);
    return Number.isFinite(preferred)
      ? preferred
      : Number.isFinite(fallback)
        ? fallback
        : Number.POSITIVE_INFINITY;
  };
  const compareSource = (a, b) => (sourceRank.get(String(a?.id ?? '')) ?? Number.MAX_SAFE_INTEGER)
    - (sourceRank.get(String(b?.id ?? '')) ?? Number.MAX_SAFE_INTEGER);
  if (sort === 'alpha') {
    return source.sort((a, b) => (
      labelKey(a).localeCompare(labelKey(b), 'fr', { sensitivity: 'base' })
      || compareSource(a, b)
    ));
  }
  if (sort === 'price') {
    return source.sort((a, b) => (
      priceFor(a) - priceFor(b)
      || labelKey(a).localeCompare(labelKey(b), 'fr', { sensitivity: 'base' })
      || compareSource(a, b)
    ));
  }
  if (sort === 'recent') {
    return source.sort((a, b) => (
      (recentRank.get(String(a?.id ?? '')) ?? Number.MAX_SAFE_INTEGER)
      - (recentRank.get(String(b?.id ?? '')) ?? Number.MAX_SAFE_INTEGER)
      || compareSource(a, b)
    ));
  }
  return source.sort((a, b) => (
    (personalRank.get(String(a?.id ?? '')) ?? Number.MAX_SAFE_INTEGER)
    - (personalRank.get(String(b?.id ?? '')) ?? Number.MAX_SAFE_INTEGER)
    || compareSource(a, b)
  ));
}

function readStoredAliases(key, soundIds) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const valid = new Set([...soundIds].map(String));
    return Object.fromEntries(Object.entries(value)
      .map(([id, alias]) => [String(id), normalizeSoundboardAlias(alias)])
      .filter(([id, alias]) => valid.has(id) && alias));
  } catch {
    return {};
  }
}

function writeStoredAliases(key, aliases) {
  try { localStorage.setItem(key, JSON.stringify(aliases)); } catch { /* stockage facultatif */ }
}

function rememberStoredId(key, id, limit = 12) {
  const value = [String(id), ...readStoredIds(key).filter((candidate) => candidate !== String(id))];
  writeStoredIds(key, value.slice(0, limit));
}

function tutorialPreferenceKey(tutorial) {
  return `${TUTORIAL_DISABLED_PREFIX}${tutorial?.id ?? 'core'}:v${tutorial?.version ?? 1}`;
}

function readTutorialDisabled(tutorial) {
  try { return localStorage.getItem(tutorialPreferenceKey(tutorial)) === '1'; } catch { return false; }
}

function writeTutorialDisabled(tutorial, disabled) {
  try {
    const key = tutorialPreferenceKey(tutorial);
    if (disabled) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch { /* stockage facultatif */ }
}

function clampPreviewVolume(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function readPreviewVolume() {
  try {
    const saved = Number(localStorage.getItem(PREVIEW_VOLUME_KEY));
    // Twitch exige que l'audio d'une extension soit coupé par défaut.
    // Le viewer peut l'activer explicitement avec le curseur avant l'aperçu.
    return Number.isFinite(saved) ? clampPreviewVolume(saved) : 0;
  } catch {
    return 0;
  }
}

function savePreviewVolume(value) {
  try { localStorage.setItem(PREVIEW_VOLUME_KEY, String(value)); } catch { /* stockage facultatif */ }
}

function raffleSeconds(raffle) {
  const endsAt = Date.parse(raffle?.ends_at || '');
  if (Number.isFinite(endsAt)) return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return Math.max(0, Number(raffle?.ends_in_s || 0));
}

function raffleIsActive(raffle) {
  return Boolean(raffle?.open) && !raffle?.unavailable && !raffle?.closed_at;
}

function raffleNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function raffleAmount(record) {
  const pot = record?.pot && typeof record.pot === 'object' ? record.pot : null;
  const candidates = [
    [pot, 'amount'],
    [record, 'pot'],
    [record, 'pot_amount'],
    [record, 'total_pot'],
    [record, 'total_amount'],
    [record, 'prize_pool'],
    [record, 'amount'],
  ];
  for (const [source, key] of candidates) {
    const value = raffleNumber(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function raffleCurrency(record) {
  const pot = record?.pot && typeof record.pot === 'object' ? record.pot : null;
  for (const value of [pot?.currency, record?.currency, record?.pot_currency, record?.unit]) {
    const text = String(value ?? '').trim();
    if (text) return text.slice(0, 24);
  }
  return '';
}

function raffleDateLabel(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function raffleHistoryDate(row) {
  for (const value of [row?.created_at, row?.drawn_at, row?.ended_at, row?.closed_at, row?.opened_at]) {
    if (value) return value;
  }
  return null;
}

function raffleTimerSource(raffle) {
  if (Number.isFinite(Date.parse(raffle?.ends_at || ''))) return 'ends_at';
  if (raffleNumber(raffle?.ends_in_s) !== null) return 'ends_in_s';
  return 'none';
}

function raffleTotalSeconds(raffle) {
  for (const value of [
    raffle?.total_duration_s,
    raffle?.duration_s,
    raffle?.duration_seconds,
    raffle?.window_duration_s,
  ]) {
    const seconds = raffleNumber(value);
    if (seconds !== null && seconds > 0) return Math.ceil(seconds);
  }
  const openedAt = Date.parse(raffle?.opened_at || '');
  const endsAt = Date.parse(raffle?.ends_at || '');
  if (Number.isFinite(openedAt) && Number.isFinite(endsAt) && endsAt > openedAt) {
    return Math.max(1, Math.ceil((endsAt - openedAt) / 1000));
  }
  return null;
}

export function emoteCatalogStateKey(emotes, twitchUserId = '') {
  return [
    String(twitchUserId || ''),
    emotes?.twitch_connected === true ? 'viewer' : 'public',
    emotes?.seven_tv === true ? '7tv' : 'no-7tv',
    emotes?.bttv === true ? 'bttv' : 'no-bttv',
    emotes?.ffz === true ? 'ffz' : 'no-ffz',
  ].join('|');
}

export function shouldAutoOpenTutorial({
  isStudioPreview = false,
  tutorialDisabled = false,
  openModule = null,
  modules = [],
} = {}) {
  return !isStudioPreview
    && !tutorialDisabled
    && !openModule
    && !modules.some((module) => module?.id === 'bonk');
}

/**
 * Attend la confirmation serveur d'une autorisation viewer sans dépendre de
 * window.opener. Le premier contrôle est immédiat, puis les contrôles restent
 * séquentiels pour ne jamais empiler des GET /state.
 */
export function createEmoteAuthorizationPoller({
  check,
  isPopupClosed = () => false,
  onSuccess = () => {},
  onStopped = () => {},
  intervalMs = EMOTE_AUTH_POLL_INTERVAL_MS,
  timeoutMs = EMOTE_AUTH_TIMEOUT_MS,
  popupGraceMs = EMOTE_AUTH_POPUP_GRACE_MS,
  now = () => Date.now(),
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
  cancel = (timer) => globalThis.clearTimeout(timer),
} = {}) {
  if (typeof check !== 'function') throw new TypeError('oauth_poll_check_required');
  const safeNow = () => {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  };
  const safeDelay = (value) => Math.max(0, Number(value) || 0);
  let active = false;
  let timer = null;
  let generation = 0;
  let startedAt = 0;
  let popupClosedAt = null;

  function clearTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  async function stop(reason, { notify = true } = {}) {
    const wasActive = active;
    active = false;
    generation += 1;
    clearTimer();
    if (notify && wasActive) await onStopped(reason);
  }

  async function tick(runGeneration) {
    if (!active || runGeneration !== generation) return;
    const current = safeNow();
    if (current - startedAt >= timeoutMs) {
      await stop('timeout');
      return;
    }

    let closed = false;
    try { closed = isPopupClosed() === true; } catch { closed = true; }
    if (closed && popupClosedAt === null) popupClosedAt = current;

    let confirmed = false;
    try { confirmed = (await check({ popupClosed: closed })) === true; } catch { /* prochain poll */ }
    if (!active || runGeneration !== generation) return;
    if (confirmed) {
      await stop('success', { notify: false });
      await onSuccess();
      return;
    }

    const afterCheck = safeNow();
    if (afterCheck - startedAt >= timeoutMs) {
      await stop('timeout');
      return;
    }
    if (popupClosedAt !== null && afterCheck - popupClosedAt >= popupGraceMs) {
      await stop('popup_closed');
      return;
    }

    const remainingGrace = popupClosedAt === null
      ? intervalMs
      : Math.max(0, popupGraceMs - (afterCheck - popupClosedAt));
    timer = schedule(() => {
      timer = null;
      void tick(runGeneration);
    }, safeDelay(Math.min(intervalMs, remainingGrace)));
  }

  return {
    start() {
      void stop('restart', { notify: false });
      active = true;
      generation += 1;
      startedAt = safeNow();
      popupClosedAt = null;
      void tick(generation);
    },
    stop(reason = 'cancelled') {
      return stop(reason);
    },
    get active() { return active; },
  };
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

export function bonkFeedbackForResult(result = {}) {
  const status = String(result?.status ?? '').trim().toLowerCase();
  if (status === 'queued') return 'Bonk accepté · en file ✓';
  if (status === 'delivered') return 'Bonk livré ✓';
  if (status === 'spawned') return 'Bonk apparu ✓';
  return 'Bonk accepté ✓';
}

/**
 * Returns only a reliable, user-facing Soundboard reason. Unknown errors stay
 * deliberately reason-less so the feedback never invents a cause from a
 * technical message or an exception string.
 */
export function soundboardFeedbackForError(error) {
  const code = String(error?.code ?? '').trim();
  return {
    kind: 'error',
    reason: code && Object.hasOwn(ERROR_LABELS, code) ? errorLabel(code) : '',
  };
}

// Une erreur de saisie, de solde ou de course normale reste locale au module.
// Seuls les incidents qui peuvent nécessiter une nouvelle action méritent une
// entrée persistante dans le Centre ; les messages de succès restent toujours
// des feedbacks éphémères.
const ACTIONABLE_RUNTIME_ERROR_CODES = new Set([
  // Les pannes temporaires restent dans le feedback local de l'action ; elles
  // ne méritent pas une entrée persistante dans l'historique du viewer.
  'moderation_batch_partial_failure',
  'redemption_expired',
  'redemption_not_found',
  'redemption_wrong_reward',
  'tts_control_failed',
  'tts_control_timeout',
  'tts_control_uncertain',
  'wallet_debit_failed',
  'wallet_debit_uncertain',
]);

const ACTION_REQUIRED_RUNTIME_ERROR_CODES = new Set([
  'moderation_batch_partial_failure',
  'redemption_expired',
  'redemption_not_found',
  'wallet_debit_uncertain',
  'tts_control_failed',
  'tts_control_timeout',
  'tts_control_uncertain',
]);

export function shouldPersistRuntimeError(error) {
  const code = String(error?.code ?? error?.message ?? '').trim();
  return ACTIONABLE_RUNTIME_ERROR_CODES.has(code);
}

// Retire une occurrence précise avant le dispatch : le mode munitions reste
// une orchestration UI locale et les doublons sont volontairement conservés.
export function consumeNextBonkAmmo(ammo) {
  if (!Array.isArray(ammo) || !ammo.length) return null;
  return ammo.shift();
}

// Fait progresser une occurrence précise sans mélanger la préparation et le
// dispatch réseau : en boucle la pile reste intacte, sinon l'occurrence est
// retirée comme dans le mode Pass 5.
export function consumeBonkAmmoAtIndex(ammo, index = 0, { loop = false } = {}) {
  if (!Array.isArray(ammo) || !ammo.length) return { emote: null, nextIndex: 0 };
  const requestedIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  const safeIndex = Math.min(Math.max(requestedIndex, 0), ammo.length - 1);
  const emote = ammo[safeIndex];
  if (loop) return { emote, nextIndex: (safeIndex + 1) % ammo.length };
  ammo.splice(safeIndex, 1);
  return { emote, nextIndex: Math.min(safeIndex, ammo.length) };
}

// Recale l'index après le retrait d'une occurrence, y compris quand Loop
// pointe vers le dernier élément et doit repartir au début du cycle.
export function removeBonkAmmoAtIndex(ammo, index = 0, nextIndex = 0, { loop = false } = {}) {
  if (!Array.isArray(ammo) || !ammo.length || !Number.isInteger(index)
    || index < 0 || index >= ammo.length) {
    return { emote: null, nextIndex: 0 };
  }
  const [emote] = ammo.splice(index, 1);
  if (!ammo.length) return { emote, nextIndex: 0 };
  const requestedNextIndex = Number.isFinite(nextIndex) ? Math.trunc(nextIndex) : 0;
  let adjustedIndex = Math.max(requestedNextIndex, 0);
  if (index < adjustedIndex) adjustedIndex -= 1;
  adjustedIndex = loop
    ? ((adjustedIndex % ammo.length) + ammo.length) % ammo.length
    : Math.min(adjustedIndex, ammo.length);
  return { emote, nextIndex: adjustedIndex };
}

// En quittant Loop, les occurrences déjà parcourues dans le cycle courant
// ne redeviennent pas des tirs à venir. La prochaine occurrence devient donc
// l'index zéro de la pile restante, sans aucun callback ni débit.
export function disableBonkAmmoLoop(ammo, index = 0) {
  if (!Array.isArray(ammo) || !ammo.length) return 0;
  const requestedIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  const safeIndex = Math.min(Math.max(requestedIndex, 0), ammo.length);
  if (safeIndex > 0) ammo.splice(0, safeIndex);
  return 0;
}

/**
 * @param {object} options
 *   root      élément hôte
 *   client    client EBS
 *   onRefresh callback après une action réussie
 */
export function createModulePanel({ root, client, onRefresh, initialModule = null, onNotificationChange = null }) {
  let state = null;
  let openModule = initialModule;
  let busy = false;
  let loadError = null;
  let retryLoad = null;
  let successMessage = null;
  let actionError = null;
  let ttsActionError = null;
  let tutorialOpen = false;
  let notificationCenterOpen = false;
  let viewerPreferencesOpen = false;
  let viewerPreferenceIdentity = null;
  let viewerPreferenceLoaded = false;
  let viewerPreferenceLoading = false;
  let viewerPreferenceSaving = false;
  let viewerPreferenceValue = false;
  let viewerPreferenceError = false;
  let viewerPreferenceRequest = 0;
  let tutorialStep = 0;
  let tutorialAutoOpened = false;
  let tutorialDisabled = false;
  // Chaque module possède sa monnaie ; le wallet est sa projection et son
  // sélecteur unique, tandis que la dépensabilité reste évaluée par le CTA.
  let selectedPaymentMethod = 'tokens';
  let ttsPaymentMethod = 'tokens';
  let paymentWalletSync = null;
  let soundboardVolumeOpen = false;
  let soundboardVolumeSync = null;
  let soundboardSearchClose = null;
  let soundboardDeselect = null;
  let soundboardDragCancel = null;
  // Compte à rebours des cooldowns Soundboard (mis à jour sur place, sans reconstruire la grille).
  let soundboardCooldownTimer = null;
  let soundboardVolumeHeaderButton = null;
  // Hub : module sélectionné dans le carousel et monnaie affichée par le wallet (consultation).
  let hubSelectedId = null;
  let hubWalletMethod = 'tokens';
  let hubCarousel = null;
  let soundboardFeedback = null;
  let soundboardFeedbackTimer = null;
  let soundboardFeedbackSequence = 0;
  let moderationHistoryQuery = '';
  let moderationHistoryModule = '';
  let moderationHistoryStatus = '';
  let moderationUsersQuery = '';
  let moderationUsers = null;
  let moderationSelectedUser = null;
  let moderationUserHistoryOpen = false;
  let moderationSubmodule = 'users';
  let moderationSuspensionSelectionUserId = '';
  let moderationSuspendSelection = new Set();
  let moderationUnsuspendSelection = new Set();
  let moderationSuspensionDuration = '600000';
  let moderationSuspensionCustomValue = '';
  let moderationSuspensionCustomUnit = 'minutes';
  const moderationSuspensionDurationOptions = [
    ['600000', '10 min'],
    ['3600000', '1 heure'],
    ['86400000', '24 heures'],
    ['', 'Indéfinie'],
    ['custom', 'Personnalisée'],
  ];
  const moderationSuspensionDurationUnits = [
    ['seconds', 'secondes'],
    ['minutes', 'minutes'],
    ['hours', 'heures'],
    ['days', 'jours'],
  ];
  const moderationCustomDurationMinMs = 60_000;
  const moderationCustomDurationMaxMs = 365 * 24 * 60 * 60 * 1000;
  const isStudioPreview = new URLSearchParams(globalThis.location?.search || '').get('studio') === '1';
  let previewAudio = null;
  let previewRestore = null;
  let previewSoundId = null;
  // Twitch démarre l'audio d'une extension à 0 %. Le viewer l'active
  // explicitement avec le curseur ; ce réglage local n'affecte aucun débit.
  let previewVolume = readPreviewVolume();
  let bonkInFlight = 0;
  let bonkFeedbackMessage = '';
  let bonkFeedbackKind = 'ok';
  let bonkAmmoMode = false;
  let bonkAmmunition = [];
  let bonkAmmoIndex = 0;
  let bonkAmmoLoop = false;
  let bonkDrawerOpen = false;
  let bonkEmotePicker = null;
  let raffleHistoryOpen = false;
  let raffleTimer = null;
  let raffleTimerSnapshot = null;
  let raffleJoinConfirmedWindowId = null;
  let emoteCatalog = null;
  let emoteCatalogKey = null;
  let emoteCatalogLoadedAt = 0;
  let emoteLoading = false;
  let emoteError = null;
  let emoteCatalogGeneration = 0;
  let emoteForceReloadPending = false;
  let emoteAuthorizationStarting = false;
  let emoteAuthorizationPopup = null;
  let emoteAuthorizationPoller = null;
  let emoteAuthorizationFinishing = false;
  const drafts = {
    tts: { text: '' },
    soundboard: {
      selectedId: null,
      query: '',
      searchOpen: true,
      sort: 'custom',
      favoritesOnly: false,
      // Tous / Favoris / Récents (filtre toujours visible).
      view: 'all',
    },
    bonk: { selectedId: null, activeGroupId: null, query: '', searchOpen: false },
  };
  root.classList.add('jdm-shell');
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (notificationCenterOpen || viewerPreferencesOpen || tutorialOpen || soundboardVolumeOpen || drafts.soundboard.searchOpen || bonkDrawerOpen || raffleHistoryOpen || moderationUserHistoryOpen) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (tutorialOpen) {
      tutorialOpen = false;
      render();
      return;
    }
    if (notificationCenterOpen) {
      notificationCenterOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-notification-toggle')?.focus({ preventScroll: true }));
      return;
    }
    if (viewerPreferencesOpen) {
      viewerPreferencesOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-viewer-preferences-toggle')?.focus({ preventScroll: true }));
      return;
    }
    if (soundboardVolumeOpen) {
      soundboardVolumeOpen = false;
      soundboardVolumeSync?.(false);
      return;
    }
    if (drafts.soundboard.searchOpen) {
      event.preventDefault();
      soundboardSearchClose?.();
      return;
    }
    if (bonkDrawerOpen) {
      bonkDrawerOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-bonk-drawer-toggle')?.focus({ preventScroll: true }));
      return;
    }
    if (raffleHistoryOpen) {
      raffleHistoryOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-raffle-history-toggle')?.focus({ preventScroll: true }));
      return;
    }
    if (moderationUserHistoryOpen) {
      moderationUserHistoryOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-mod-user-history-toggle')?.focus({ preventScroll: true }));
    }
  });
  // Une interaction dans le catalogue reste une interaction interne : elle ne
  // doit pas faire disparaître la barre pendant qu'un viewer choisit un tri,
  // active Favoris ou clique une carte. Seul un clic hors du corps Soundboard
  // replie automatiquement la zone ; le bouton et Escape restent explicites.
  root.addEventListener('click', (event) => {
    if (!drafts.soundboard.searchOpen
      || event.target?.closest?.('.rl-soundboard')) return;
    const closeSearch = soundboardSearchClose;
    queueMicrotask(() => {
      if (drafts.soundboard.searchOpen) closeSearch?.();
    });
  }, true);
  root.addEventListener('click', (event) => {
    const target = event.target;
    if (soundboardVolumeOpen && !event.target?.closest?.('.sbx-vol')) {
      soundboardVolumeOpen = false;
      soundboardVolumeSync?.(false);
    }
    if (!soundboardDeselect || !target?.closest?.('.rl-soundboard')) return;
    // Une carte et ses contrôles restent dans leur flux d'interaction. Tout
    // clic dans le reste du module désélectionne la carte courante.
    if (target.closest('.sbx-card, .sbx-dock, .sbx-head, .sbx-vol')) return;
    soundboardDeselect();
  });
  document.addEventListener('click', (event) => {
    if (!notificationCenterOpen && !viewerPreferencesOpen) return;
    const target = event.target;
    if (target?.closest?.('.jdm-notification-center')
      || target?.closest?.('.jdm-viewer-preferences')
      || target?.closest?.('.jdm-notification-toggle')
      || target?.closest?.('.jdm-viewer-preferences-toggle')) return;
    notificationCenterOpen = false;
    viewerPreferencesOpen = false;
    renderPreservingViewport();
  });

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (
      event.source !== emoteAuthorizationPopup
      || data?.type !== 'raptoru:oauth-complete'
      || data?.flow !== 'viewer-emotes'
      || data?.ok !== true
    ) return;
    let oauthOrigin = '';
    try { oauthOrigin = new URL(RUNTIME.siteUrl).origin; } catch { return; }
    if (!oauthOrigin || event.origin !== oauthOrigin) return;

    // Le message est le chemin rapide, mais le serveur reste l'autorité :
    // on relit /state avant de considérer l'autorisation comme terminée.
    void confirmEmoteAuthorization();
  });

  function pendingFor(moduleId) {
    return (state?.pending_actions ?? []).filter((a) => a.module_id === moduleId);
  }

  function soundboardCreditBalance() {
    return pendingFor('soundboard').reduce(
      (total, action) => total + Math.max(0, Number(action.credits_remaining ?? 1)),
      0,
    );
  }

  function canModerate() {
    return state?.moderation?.tts?.can_moderate === true;
  }

  function identityShared() {
    return state?.identity_shared === true;
  }

  function interactionsAvailableForState({ allowLab = true } = {}) {
    return identityShared()
      && (state?.interactions?.available !== false || (allowLab && state?.lab_mode));
  }

  function moduleById(id) {
    if (id === ACTIONS_MODULE.id) return ACTIONS_MODULE;
    if (id === MODERATION_MODULE.id) return canModerate() ? MODERATION_MODULE : null;
    return (state?.modules ?? []).find((m) => m.id === id) ?? null;
  }

  let runtimeNotificationSequence = 0;

  function notificationModuleForNode(node, fallback = null) {
    const fromDom = node?.closest?.('[data-module]')?.dataset?.module;
    return String(fromDom || fallback || openModule || 'global').trim() || 'global';
  }

  function publishRuntimeNotification(notification) {
    if (!notification) return null;
    const item = notify(notification);
    if (item) onNotificationChange?.();
    return item;
  }

  function runtimeNotificationForError(error, {
    module = 'global',
    title = 'Action échouée',
    actionModule = module,
    dedupeKey = null,
  } = {}) {
    const code = String(error?.code ?? error?.message ?? '').trim();
    if (!shouldPersistRuntimeError(error)) return null;
    const key = dedupeKey || `runtime:${module}:${code}`;
    const action = actionModule && actionModule !== 'global'
      ? { label: `Ouvrir ${notificationModuleLabel(actionModule)}`, module: actionModule }
      : null;
    return {
      id: `${key}:${Date.now()}:${++runtimeNotificationSequence}`,
      module,
      type: ACTION_REQUIRED_RUNTIME_ERROR_CODES.has(code) ? 'action_required' : 'error',
      severity: ACTION_REQUIRED_RUNTIME_ERROR_CODES.has(code) ? 'action_required' : 'error',
      title,
      message: errorLabel(code),
      created_at: new Date().toISOString(),
      dedupe_key: key,
      action,
    };
  }

  function runtimeNotificationForConfirmation({
    module,
    title,
    message,
    actionModule = module,
    dedupeKey,
    type = 'action_required',
  }) {
    if (!message) return null;
    const key = dedupeKey || `runtime:${module}:confirmation`;
    const action = actionModule && actionModule !== 'global'
      ? { label: `Ouvrir ${notificationModuleLabel(actionModule)}`, module: actionModule }
      : null;
    return {
      id: `${key}:${Date.now()}:${++runtimeNotificationSequence}`,
      module,
      type,
      severity: type,
      title,
      message: String(message),
      created_at: new Date().toISOString(),
      dedupe_key: key,
      action,
    };
  }

  const savedScrollPositions = new Map();

  function captureScrollPositions() {
    const positions = new Map([...root.querySelectorAll('[data-scroll-key]')]
      .map((node) => [node.dataset.scrollKey, {
        top: node.scrollTop,
        left: node.scrollLeft,
      }]));
    for (const [key, value] of positions) savedScrollPositions.set(key, value);
    return positions;
  }

  function restoreScrollPositions(positions = savedScrollPositions) {
    if (!positions?.size) return;
    for (const node of root.querySelectorAll('[data-scroll-key]')) {
      if (!positions.has(node.dataset.scrollKey)) continue;
      const position = positions.get(node.dataset.scrollKey);
      // Tolère les snapshots numériques de versions précédentes de la vue.
      node.scrollTop = typeof position === 'number' ? position : position?.top ?? 0;
      node.scrollLeft = typeof position === 'number' ? 0 : position?.left ?? 0;
    }
  }

  function renderPreservingViewport() {
    const scrollPositions = captureScrollPositions();
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const draftKey = active?.dataset?.draftKey ?? null;
    const selection = draftKey && typeof active.selectionStart === 'number'
      ? [active.selectionStart, active.selectionEnd]
      : null;
    render();
    restoreScrollPositions(scrollPositions);
    if (!scrollPositions.size) restoreScrollPositions(savedScrollPositions);
    if (draftKey) {
      const replacement = root.querySelector(`[data-draft-key="${draftKey}"]`);
      replacement?.focus({ preventScroll: true });
      if (selection && typeof replacement?.setSelectionRange === 'function') {
        replacement.setSelectionRange(...selection);
      }
    }
  }

  function updateState(next, { render = true } = {}) {
    // Soundboard ouvert et poll identique : rien à redessiner (grille, scroll et aperçu intacts).
    const unchanged = render && (openModule === 'soundboard' || !openModule) && !loadError
      && JSON.stringify(state) === JSON.stringify(next);
    const previousKey = emoteCatalogStateKey(state?.emotes, state?.twitch_user_id);
    const nextKey = emoteCatalogStateKey(next?.emotes, next?.twitch_user_id);
    const nextRaffle = next?.raffle;
    const nextWindowId = String(nextRaffle?.window_id || '').trim();
    if (raffleJoinConfirmedWindowId
      && (!nextRaffle?.open || nextWindowId !== raffleJoinConfirmedWindowId)) {
      raffleJoinConfirmedWindowId = null;
    }
    if (raffleJoinConfirmedWindowId
      && nextRaffle?.open
      && nextWindowId === raffleJoinConfirmedWindowId
      && nextRaffle.joined !== true) {
      next = {
        ...next,
        raffle: { ...nextRaffle, joined: true },
      };
    }
    state = next;
    if (previousKey !== nextKey) {
      emoteCatalogGeneration += 1;
      emoteCatalog = null;
      emoteCatalogKey = null;
      emoteCatalogLoadedAt = 0;
      emoteError = null;
      if (render) queueMicrotask(() => loadEmotes({ force: true }));
    }
    loadError = null;
    retryLoad = null;
    actionError = null;
    ttsActionError = null;
    syncViewerPreferenceIdentity(next);
    if (render && !unchanged) renderPreservingViewport();
  }

  function closeEmoteAuthorizationPopup() {
    const popup = emoteAuthorizationPopup;
    emoteAuthorizationPopup = null;
    try { popup?.close(); } catch { /* fenêtre déjà fermée */ }
  }

  async function confirmEmoteAuthorization({ refreshed = false } = {}) {
    if (emoteAuthorizationFinishing) return false;
    emoteAuthorizationFinishing = true;
    try {
      if (!refreshed) {
        const next = await client.refresh();
        if (next && typeof next === 'object') updateState(next, { render: false });
      }
      if (state?.emotes?.twitch_connected !== true) return false;

      const poller = emoteAuthorizationPoller;
      emoteAuthorizationPoller = null;
      await poller?.stop('success');
      closeEmoteAuthorizationPopup();
      emoteAuthorizationStarting = false;
      renderPreservingViewport();
      await loadEmotes({ force: true });
      flash(root, 'Emotes Twitch connectées.', 'ok');
      return true;
    } catch {
      // Le polling garde la main si une relecture transitoire échoue.
      return false;
    } finally {
      emoteAuthorizationFinishing = false;
    }
  }

  function startEmoteAuthorizationPolling() {
    const popup = emoteAuthorizationPopup;
    let poller;
    poller = createEmoteAuthorizationPoller({
      check: async () => {
        const next = await client.refresh();
        if (next && typeof next === 'object') updateState(next, { render: false });
        return state?.emotes?.twitch_connected === true;
      },
      isPopupClosed: () => {
        try { return popup?.closed === true; } catch { return true; }
      },
      onSuccess: () => confirmEmoteAuthorization({ refreshed: true }),
      onStopped: (reason) => {
        if (emoteAuthorizationPoller === poller) emoteAuthorizationPoller = null;
        if (reason === 'success') return;
        emoteAuthorizationStarting = false;
        closeEmoteAuthorizationPopup();
        renderPreservingViewport();
      },
    });
    emoteAuthorizationPoller = poller;
    poller.start();
  }

  function stopSoundPreview() {
    const audio = previewAudio;
    const restore = previewRestore;
    previewAudio = null;
    previewRestore = null;
    previewSoundId = null;
    try {
      audio?.pause();
      if (audio) audio.currentTime = 0;
    } catch { /* le nettoyage audio reste best-effort */ }
    restore?.();
    syncSoundboardPreviewButtons();
  }

  function stopRaffleTimer() {
    if (raffleTimer === null) return;
    if (typeof globalThis.clearInterval === 'function') globalThis.clearInterval(raffleTimer);
    raffleTimer = null;
  }

  function navigateTo(moduleId) {
    if (moduleId !== null && !moduleById(moduleId)) return;
    if (moduleId !== null) {
      notificationCenterOpen = false;
      viewerPreferencesOpen = false;
    }
    if (moduleId !== 'soundboard') stopSoundPreview();
    if (moduleId !== 'soundboard') clearSoundboardFeedback({ render: false });
    if (moduleId !== 'raffle_join') {
      stopRaffleTimer();
      raffleTimerSnapshot = null;
      raffleHistoryOpen = false;
    }
    captureScrollPositions();
    openModule = moduleId;
    if (moduleId !== 'bonk') {
      bonkAmmoMode = false;
      bonkAmmunition = [];
      bonkAmmoIndex = 0;
      bonkAmmoLoop = false;
      bonkDrawerOpen = false;
    }
    soundboardVolumeOpen = false;
    if (moduleId === 'soundboard') {
      tutorialOpen = false;
      tutorialStep = 0;
    }
    render();
    restoreScrollPositions();
  }

  async function loadEmotes({ force = false } = {}) {
    if (emoteLoading) {
      if (force) emoteForceReloadPending = true;
      return;
    }
    const requestKey = emoteCatalogStateKey(state?.emotes, state?.twitch_user_id);
    if (!force && emoteCatalog
      && emoteCatalogKey === requestKey
      && Date.now() - emoteCatalogLoadedAt < EMOTE_CATALOG_REFRESH_MS) return;
    if (!state?.emotes?.connected || !client.emotes) return;
    const generation = emoteCatalogGeneration;
    emoteLoading = true;
    emoteError = null;
    try {
      const result = force && client.refreshEmotes
        ? await client.refreshEmotes()
        : await client.emotes();
      if (!result.connected) throw Object.assign(new Error('emotes_not_connected'), { code: 'emotes_not_connected' });
      if (generation === emoteCatalogGeneration
        && requestKey === emoteCatalogStateKey(state?.emotes, state?.twitch_user_id)) {
        emoteCatalog = {
          groups: result.groups ?? [],
          count: Number(result.count || 0),
          diagnostics: result.diagnostics ?? null,
          twitch_connected: result.twitch_connected === true,
        };
        emoteCatalogKey = requestKey;
        emoteCatalogLoadedAt = Date.now();
      }
    } catch {
      if (generation === emoteCatalogGeneration) {
        emoteError = 'Impossible de charger le catalogue d’emotes pour le moment.';
      }
    } finally {
      emoteLoading = false;
      renderPreservingViewport();
      if (emoteForceReloadPending) {
        emoteForceReloadPending = false;
        queueMicrotask(() => loadEmotes({ force: true }));
      }
    }
  }

  function flash(node, message, kind = 'error') {
    const box = el('p', `jdm-flash jdm-flash--${kind}`, message);
    node.append(box);
    setTimeout(() => box.remove(), 4000);
  }

  function clearSoundboardFeedback({ render: shouldRender = true } = {}) {
    if (soundboardFeedbackTimer !== null) {
      clearTimeout(soundboardFeedbackTimer);
      soundboardFeedbackTimer = null;
    }
    soundboardFeedback = null;
    if (shouldRender) renderPreservingViewport();
  }

  function setSoundboardFeedback(kind, error = null) {
    if (soundboardFeedbackTimer !== null) clearTimeout(soundboardFeedbackTimer);
    const reason = kind === 'error' ? soundboardFeedbackForError(error).reason : '';
    const sequence = ++soundboardFeedbackSequence;
    soundboardFeedback = { kind, reason, sequence };
    const duration = reason ? 3_800 : kind === 'success' ? 2_300 : 2_900;
    soundboardFeedbackTimer = setTimeout(() => {
      if (soundboardFeedback?.sequence !== sequence) return;
      soundboardFeedback = null;
      soundboardFeedbackTimer = null;
      // Retire uniquement la couche déjà montée. Un rerender ici pourrait
      // déplacer le caret/viewport d’une autre interaction qui vient juste
      // de commencer, et le feedback est purement décoratif.
      try { root.querySelector('.sbx-toast')?.remove(); } catch { /* vue déjà démontée */ }
    }, duration);
  }

  function createSoundboardFeedbackOverlay() {
    const feedback = soundboardFeedback;
    const toast = el('div', 'sbx-toast');
    if (!feedback) {
      toast.hidden = true;
      toast.setAttribute('aria-hidden', 'true');
      return toast;
    }
    const isError = feedback.kind === 'error';
    toast.classList.add(isError ? 'is-error' : 'is-success');
    toast.setAttribute('role', isError ? 'alert' : 'status');
    toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');
    const title = isError ? 'Non envoyé' : 'Envoyé au stream';
    toast.append(el('span', 'sbx-toast__mark', isError ? '!' : '✓'));
    const text = el('span', 'sbx-toast__text');
    text.append(el('strong', '', title));
    if (feedback.reason) text.append(el('span', '', feedback.reason));
    toast.append(text);
    return toast;
  }

  async function beginEmoteAuthorization(node) {
    if (emoteAuthorizationStarting) return;
    if (state?.identity_shared !== true) {
      const requestIdShare = window.Twitch?.ext?.actions?.requestIdShare;
      if (typeof requestIdShare !== 'function') {
        flash(node, 'Le partage d’identité est indisponible dans cet aperçu. Ouvre l’extension sur Twitch.', 'error');
        return;
      }
      try {
        requestIdShare();
        flash(node, 'Confirme d’abord le partage d’identité Twitch, puis autorise tes emotes.', 'ok');
      } catch {
        flash(node, 'Twitch n’a pas pu ouvrir la demande d’identité. Rouvre l’extension puis réessaie.', 'error');
      }
      return;
    }

    if (emoteAuthorizationPopup && !emoteAuthorizationPopup.closed) {
      try { emoteAuthorizationPopup.focus(); } catch { /* focus best effort */ }
      flash(node, 'La fenêtre Twitch est déjà ouverte.', 'ok');
      return;
    }
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      flash(node, 'Autorise les fenêtres Twitch pour ouvrir la connexion des emotes.', 'error');
      return;
    }
    emoteAuthorizationPopup = popup;
    emoteAuthorizationStarting = true;
    try {
      const result = await client.startEmoteOAuth();
      const authorizationUrl = new URL(String(result?.authorization_url || ''));
      if (
        authorizationUrl.protocol !== 'https:'
        || authorizationUrl.hostname !== 'id.twitch.tv'
        || authorizationUrl.pathname !== '/oauth2/authorize'
      ) throw new Error('invalid_oauth_url');
      popup.location.replace(authorizationUrl.href);
      startEmoteAuthorizationPolling();
      flash(node, 'Autorise user:read:emotes dans la fenêtre Twitch, puis reviens ici.', 'ok');
    } catch (error) {
      const poller = emoteAuthorizationPoller;
      emoteAuthorizationPoller = null;
      void poller?.stop('start_failed');
      try { popup.close(); } catch { /* fenêtre déjà fermée */ }
      closeEmoteAuthorizationPopup();
      emoteAuthorizationStarting = false;
      renderPreservingViewport();
      flash(node, errorLabel(error?.code), 'error');
    }
  }

  async function disconnectEmoteAuthorization(node) {
    if (!client.disconnectEmotes) return;
    try {
      await client.disconnectEmotes();
      emoteCatalogGeneration += 1;
      emoteCatalog = null;
      emoteError = null;
      if (state?.emotes) state.emotes.twitch_connected = false;
      try { await onRefresh?.(); } catch { /* le polling synchronisera l’état */ }
      flash(node, 'Accès aux emotes personnelles retiré. Les emotes publiques restent disponibles.', 'ok');
      await loadEmotes({ force: true });
    } catch (error) {
      flash(node, errorLabel(error?.code), 'error');
    }
  }

  async function run(node, task, {
    onSuccess,
    success,
    errorScope = null,
    feedbackScope = null,
    confirm,
    pending,
    notification = null,
  } = {}) {
    if (busy) return;
    busy = true;
    actionError = null;
    if (feedbackScope === 'soundboard') successMessage = null;
    if (errorScope === 'tts') ttsActionError = null;
    root.dataset.busy = '1';
    if (feedbackScope !== 'soundboard') flash(
      node,
      pending === undefined ? 'Envoi en cours…' : (typeof pending === 'function' ? pending() : pending),
      'ok',
    );
    try {
      const result = await task();
      await onSuccess?.(result);
      const confirmation = await confirm?.(result);
      // L'action est déjà acceptée par l'EBS à ce stade. Une panne du simple
      // rafraîchissement ne doit jamais transformer ce succès en erreur ni
      // pousser le viewer à cliquer une seconde fois.
      try { await onRefresh?.(); } catch { /* le prochain polling récupérera l'état */ }
      const shouldNotifyConfirmation = notification
        && (typeof notification.shouldNotify !== 'function' || notification.shouldNotify(confirmation));
      if (notification?.dedupeKey && (!confirmation || confirmation.confirmed !== false || !shouldNotifyConfirmation)) {
        resolveNotification(notification.dedupeKey);
      }
      if (shouldNotifyConfirmation) {
        publishRuntimeNotification(runtimeNotificationForConfirmation({
          ...notification,
          message: confirmation?.message || notification.message,
          dedupeKey: notification.dedupeKey,
        }));
      }
      // Le rafraîchissement reconstruit le panneau. Poser le succès après lui
      // évite qu'il soit aussitôt consommé par un premier rendu intermédiaire.
      actionError = confirmation?.confirmed === false
        ? String(confirmation.message || 'Commande envoyée, exécution non confirmée')
        : null;
      if (errorScope === 'tts') ttsActionError = null;
      if (feedbackScope !== 'soundboard') {
        if (confirmation?.confirmed === true) {
          successMessage = String(confirmation.message || (typeof success === 'function' ? success(result) : success || 'Action exécutée ✓'));
        } else if (confirmation?.confirmed === false) {
          successMessage = null;
        } else if (success !== undefined) {
          successMessage = typeof success === 'function' ? success(result) : success;
        } else if (result?.status === 'pending_review') successMessage = 'Message envoyé en validation ✓';
        else if (result?.status === 'queued') successMessage = 'Action mise en file ✓';
        else successMessage = 'Action envoyée ✓';
      }
      if (feedbackScope === 'soundboard') setSoundboardFeedback('success');
    } catch (error) {
      const message = errorLabel(error?.code);
      if (errorScope === 'tts') ttsActionError = message;
      else if (feedbackScope !== 'soundboard') actionError = message;
      if (feedbackScope === 'soundboard') setSoundboardFeedback('error', error);
      const notificationModule = notificationModuleForNode(node,
        notification?.module || (errorScope === 'tts' ? 'tts' : feedbackScope === 'soundboard' ? 'soundboard' : null));
      publishRuntimeNotification(runtimeNotificationForError(error, {
        module: notificationModule,
        title: notification?.title || `Action ${notificationModule === 'global' ? '' : `${notificationModule} `}échouée`.replace(/\s+/g, ' ').trim(),
        actionModule: notification?.actionModule || notificationModule,
        dedupeKey: notification?.dedupeKey || null,
      }));
    } finally {
      busy = false;
      delete root.dataset.busy;
      renderPreservingViewport();
    }
  }

  function moderationAction(name, ...args) {
    if (typeof client?.[name] !== 'function') {
      return Promise.reject(Object.assign(new Error('moderation_action_unavailable'), {
        code: 'moderation_action_unavailable',
      }));
    }
    return client[name](...args);
  }

  const TTS_CONTROL_CONFIRMATION_TIMEOUT_MS = 8_000;
  const waitForTtsControl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ttsControlFinalMessage = (action, result) => {
    const final = String(result?.final_status || result?.status || '').toLowerCase();
    if (final === 'no_active') return 'Aucun TTS actif.';
    return ({
      stop: 'TTS arrêté ✓',
      pause: 'TTS en pause ✓',
      resume: 'TTS repris ✓',
      purge: 'File TTS purgée ✓',
    })[action] || 'Action TTS exécutée ✓';
  };
  async function confirmTtsControl(result, action) {
    const immediate = String(result?.final_status || result?.status || '').toLowerCase();
    if (['executed', 'no_active'].includes(immediate)) {
      return { confirmed: immediate === 'executed', message: ttsControlFinalMessage(action, result) };
    }
    const commandId = String(result?.command_id || '').trim();
    if (!commandId || typeof client?.ttsControlStatus !== 'function') {
      return { confirmed: false, message: 'Commande acceptée, exécution non confirmée' };
    }
    const deadline = Date.now() + TTS_CONTROL_CONFIRMATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const status = await client.ttsControlStatus(commandId);
        const final = String(status?.final_status || status?.status || '').toLowerCase();
        if (final === 'executed') return { confirmed: true, message: ttsControlFinalMessage(action, status) };
        if (final === 'no_active') return { confirmed: false, message: 'Aucun TTS actif.' };
        if (['failed', 'timeout', 'uncertain'].includes(final)) {
          return { confirmed: false, message: final === 'failed'
            ? 'La commande TTS a échoué.'
            : 'Commande envoyée, exécution non confirmée' };
        }
      } catch (error) {
        if (error?.code !== 'tts_control_status_not_found') {
          return { confirmed: false, message: 'Commande acceptée, exécution non confirmée' };
        }
      }
      await waitForTtsControl(250);
    }
    return { confirmed: false, message: 'Commande envoyée, exécution non confirmée' };
  }

  function runModerationControl(node, task, { action, acceptedMessage, successMessage } = {}) {
    return run(node, task, {
      pending: acceptedMessage,
      success: successMessage,
      confirm: (result) => confirmTtsControl(result, action),
      notification: {
        module: 'moderation',
        title: 'Contrôle TTS non confirmé',
        actionModule: 'moderation',
        dedupeKey: `runtime:moderation:tts:${action}`,
        shouldNotify: (confirmation) => confirmation?.confirmed === false
          && String(confirmation?.message || '').trim() !== 'Aucun TTS actif.',
      },
    });
  }

  function syncBonkFeedback(node) {
    if (!node) return;
    const message = bonkFeedbackMessage || (bonkInFlight ? 'Bonk en cours…' : '');
    updateFeedbackSlot(node, message, { kind: bonkFeedbackKind });
    node.classList.toggle(
      'jdm-bonk-feedback--error',
      bonkFeedbackKind === 'error' && Boolean(message),
    );
  }


  function sendBonk(node, task) {
    // Chaque clic démarre immédiatement sa propre requête. Le client lui donne
    // une clé d’idempotence unique ; aucun échec ne vide ou n’annule les autres.
    bonkInFlight += 1;
    bonkFeedbackMessage = 'Bonk en cours…';
    bonkFeedbackKind = 'ok';
    syncBonkFeedback(node);
    let request;
    try {
      request = task();
    } catch (error) {
      request = Promise.reject(error);
    }
    Promise.resolve(request)
      .then(async (result) => {
        try { await onRefresh?.(); } catch { /* le prochain polling récupérera l’état */ }
        bonkFeedbackMessage = bonkFeedbackForResult(result);
        bonkFeedbackKind = 'ok';
        syncBonkFeedback(node);
      })
      .catch((error) => {
        bonkFeedbackMessage = `Bonk non envoyé · ${errorLabel(error?.code)}`;
        bonkFeedbackKind = 'error';
        syncBonkFeedback(node);
        publishRuntimeNotification(runtimeNotificationForError(error, {
          module: 'bonk',
          title: 'Bonk non envoyé',
          actionModule: 'bonk',
        }));
      })
      .finally(() => {
        bonkInFlight = Math.max(0, bonkInFlight - 1);
        syncBonkFeedback(node);
        renderPreservingViewport();
      });
  }

  // --- formulaires par module ----------------------------------------------

  function ttsForm(mod, body) {
    const pending = pendingFor('tts');
    const interactionsAvailable = state?.interactions?.available !== false;
    const moderation = state?.moderation?.tts ?? {};
    const ttsAvailable = interactionsAvailable
      && !moderation.paused
      && !moderation.blocked
      && !moderation.viewer_busy
      && Number(moderation.cooldown_remaining_s || 0) <= 0;
    const approvalMode = moderation.mode === 'approval';
    const ttsRules = mod.tts_rules && typeof mod.tts_rules === 'object' ? mod.tts_rules : null;
    const actionLabel = approvalMode ? 'Soumettre' : 'Envoyer';
    const { displayMethods, spendMethods } = walletPaymentMethods(mod, state);
    const supportsPaymentMethod = (method) => spendMethods.includes(method);
    const paymentMethodsFor = () => displayMethods;

    const normalizePaymentMethod = (methods) => {
      const available = methods.length ? methods : ['tokens'];
      if (available.includes(ttsPaymentMethod)) return ttsPaymentMethod;
      ttsPaymentMethod = available[0];
      return ttsPaymentMethod;
    };

    const quoteFor = (raw) => {
      const length = ttsDraftLength(normalizeTtsDraft(raw));
      const tier = (ttsRules?.tiers || []).find((candidate) => (
        length >= Number(candidate.min)
          && (candidate.max === null || length <= Number(candidate.max))
      ));
      const multiplier = Number(tier?.price_multiplier || 1);
      return {
        length,
        tier,
        multiplier,
        price: tier
          ? Math.round(Number(ttsRules.base_price) * multiplier)
          : Number(mod.token_cost || 0),
      };
    };

    const maxChars = Math.max(1, Number(mod.max_chars) || 800);
    const field = el('textarea', 'jdm-input jdm-tts-input');
    // maxlength compte les unites UTF-16 dans le navigateur, alors que le
    // contrat serveur compte les points de code. Le controle metier ci-dessous
    // reste donc la source de verite ; cette borne evite seulement une saisie
    // deraisonnable avant le retour serveur.
    field.maxLength = maxChars * 2;
    field.rows = 2;
    field.placeholder = 'Ton message…';
    field.setAttribute('aria-label', 'Message TTS');
    field.dataset.draftKey = 'tts-text';
    field.value = drafts.tts.text;

    const counter = el('span', 'jdm-counter', `${ttsDraftLength(field.value)}/${maxChars}`);
    const help = el('p', 'jdm-hint jdm-tts-help', 'Écris du texte pour le faire lire à l’oral sur le stream.');
    const actions = el('div', 'jdm-actions jdm-tts-actions');
    actions.setAttribute('aria-label', 'Actions TTS');

    const payload = () => {
      const text = normalizeTtsDraft(field.value);
      if (!text) {
        flash(body, 'Écris un message.');
        return null;
      }
      if (Array.from(text).length > maxChars) {
        flash(body, `Message trop long : ${maxChars} caractères maximum.`);
        return null;
      }
      return { text };
    };

    let paymentControl = null;
    const syncControls = () => {
      const valid = Boolean(normalizeTtsDraft(field.value))
        && ttsDraftLength(field.value) <= maxChars;
      counter.textContent = `${ttsDraftLength(field.value)}/${maxChars}`;
      const hasText = Boolean(normalizeTtsDraft(field.value));
      const quote = quoteFor(field.value);
      const methods = paymentMethodsFor();
      const method = normalizePaymentMethod(methods);
      const usingCredits = method === 'credits';
      const cost = usingCredits ? 1 : quote.price;
      const methodSupported = supportsPaymentMethod(method);
      const methodAvailable = usingCredits ? pending.length > 0 : walletCanPayTokens(state.wallet, cost);
      const unit = usingCredits ? 'crédit' : 'jetons';
      const costLabel = `${fmt(cost)} ${unit}`;
      if (hasText) {
        const tierText = quote.tier
          ? ` · palier ${quote.tier.id} · ×${String(quote.multiplier).replace('.', ',')}`
          : '';
        // Le prix reste dans le CTA : la ligne d'aide décrit uniquement la
        // longueur et le palier pour éviter une seconde source visuelle de
        // vérité sur le coût.
        help.textContent = `${fmt(quote.length)} caractères${tierText}`;
      } else {
        help.textContent = 'Écris du texte pour le faire lire à l’oral sur le stream.';
      }
      actions.classList.toggle('is-visible', hasText);
      actions.setAttribute('aria-hidden', String(!hasText));
      body.dataset.paymentMethod = method;
      paymentWalletSync?.(methods, (next) => {
        ttsPaymentMethod = next;
        syncControls();
      });
      paymentControl?.sync({
        method,
        methods,
        cost: fmt(cost),
        unit,
        disabled: !valid || !ttsAvailable || !methodSupported || !methodAvailable,
        hint: !ttsAvailable
          ? 'TTS indisponible'
          : !methodSupported
            ? 'Paiement indisponible pour cette monnaie'
            : usingCredits && !pending.length
              ? 'Crédits TTS indisponibles'
              : !usingCredits && !methodAvailable
                ? 'Jetons insuffisants ou solde indisponible'
                : '',
        label: actionLabel,
        ariaLabel: hasText ? `${actionLabel} pour ${costLabel}` : actionLabel,
        title: hasText ? `${actionLabel} pour ${costLabel}` : actionLabel,
        amounts: {
          tokens: state?.wallet?.unavailable ? null : state?.wallet?.available,
          credits: Array.isArray(state?.pending_actions) ? pending.length : null,
        },
      });
    };

    paymentControl = createMultiCurrencyPayment({
      className: 'rl-pay--tts',
      modern: true,
      actionLabel,
      enableMethodSwitch: true,
      onMethodChange: (method) => {
        ttsPaymentMethod = method;
        syncControls();
      },
      onAction: (method) => {
        if (!ttsAvailable || !supportsPaymentMethod(method)) return;
        if (method === 'tokens' && !walletCanPayTokens(state.wallet, quoteFor(field.value).price)) return;
        const data = payload();
        if (!data) return;
        if (method === 'credits') {
          return run(body, () => pending[0]
            ? client.useRedemption(pending[0].redemption_id, 'tts', data)
            : Promise.reject(Object.assign(new Error('insufficient_credits'), { code: 'insufficient_credits' })), {
            errorScope: 'tts',
            onSuccess: () => { drafts.tts.text = ''; },
          });
        }
        return run(body, () => client.spendTokens('tts', data), {
          errorScope: 'tts',
          onSuccess: () => { drafts.tts.text = ''; },
        });
      },
    });

    if (state?.lab_mode) {
      const lab = el('button', 'jdm-btn jdm-ui-action jdm-btn--primary jdm-tts-action jdm-tts-action--lab', 'Tester gratuitement');
      lab.type = 'button';
      lab.addEventListener('click', () => {
        const data = payload();
        if (data) return run(body, () => client.runLab('tts', data), {
          errorScope: 'tts',
          onSuccess: () => { drafts.tts.text = ''; },
        });
      });
      actions.append(lab);
    }

    field.addEventListener('input', () => {
      drafts.tts.text = field.value;
      syncControls();
    });

    const row = el('div', 'jdm-row');
    row.append(counter);
    const composer = el('div', 'jdm-tts-composer');
    composer.append(field, row);
    body.append(composer, help, actions);
    actions.prepend(paymentControl.node);
    if (ttsActionError) {
      body.append(el('p', 'jdm-flash jdm-flash--error jdm-tts-error', ttsActionError));
    }
    if (!interactionsAvailable && !state?.lab_mode) {
      body.append(el('p', 'jdm-hint', 'Interactions en pause : SAMMI se reconnecte. Ton crédit et tes jetons restent intacts.'));
    } else if (moderation.paused) {
      body.append(el('p', 'jdm-hint', 'Le TTS est mis en pause par la modération. Rien ne sera consommé.'));
    } else if (moderation.blocked) {
      body.append(el('p', 'jdm-hint', 'Le TTS n’est pas disponible pour ton compte.'));
    } else if (moderation.viewer_busy) {
      body.append(el('p', 'jdm-hint', 'Ton TTS précédent est encore en attente ou en lecture.'));
    } else if (Number(moderation.cooldown_remaining_s || 0) > 0) {
      body.append(el('p', 'jdm-hint', `Cooldown TTS : encore ${fmt(moderation.cooldown_remaining_s)} s.`));
    } else if (approvalMode) {
      body.append(el('p', 'jdm-hint', 'Validation active : ton message attendra un accord, sans consommer ton crédit ni tes jetons avant celui-ci.'));
    }
    if (mod.kinds?.includes('redemption')) {
      body.append(el('p', 'jdm-hint jdm-tts-credit-hint',
        `Ou utilise la récompense TTS (${fmt(mod.channel_points_cost)} points) dans le menu Twitch : elle apparaîtra ici.`));
    }
    syncControls();
  }

  function syncSoundboardPreviewButtons() {
    for (const button of root.querySelectorAll('.sbx-card__play')) {
      if (button.disabled) continue;
      const active = Boolean(previewSoundId) && button.dataset.soundId === previewSoundId;
      const label = button.dataset.soundLabel || 'ce son';
      button.classList.toggle('is-previewing', active);
      button.closest('.sbx-card')?.classList.toggle('is-previewing', active);
      button.setAttribute('aria-pressed', String(active));
      button.title = active ? 'Arrêter l’aperçu' : 'Écouter (aperçu, rien n’est envoyé)';
      button.setAttribute('aria-label', active ? `Arrêter l’aperçu de ${label}` : `Écouter ${label}`);
    }
  }

  // Soundboard viewer (markup sbx-*, feuille soundboard.css). Le son est la star : cartes lisibles,
  // aperçu distinct de l'achat, prix et envoi regroupés dans la barre d'action du bas.
  function soundboardForm(mod, body) {
    const pending = pendingFor('soundboard');
    const interactionsAvailable = interactionsAvailableForState();
    const sounds = Array.isArray(mod.sounds) ? mod.sounds : [];
    const soundById = new Map(sounds.map((sound) => [String(sound.id), sound]));
    const soundIds = new Set(soundById.keys());
    if (!soundIds.has(drafts.soundboard.selectedId)) drafts.soundboard.selectedId = null;
    if (!['custom', 'alpha', 'price'].includes(drafts.soundboard.sort)) drafts.soundboard.sort = 'custom';
    if (!['all', 'favorites', 'recents'].includes(drafts.soundboard.view)) drafts.soundboard.view = 'all';
    drafts.soundboard.searchOpen = true;
    let selectedSound = drafts.soundboard.selectedId;
    let selectedCreditRedemption = null;
    let favorites = readStoredIds(SOUNDBOARD_FAVORITES_KEY).filter((id) => soundIds.has(id));
    let recents = readStoredIds(SOUNDBOARD_RECENTS_KEY).filter((id) => soundIds.has(id));
    let customOrder = normalizeSoundboardOrder(readStoredIds(SOUNDBOARD_ORDER_KEY), [...soundIds]);
    let aliases = readStoredAliases(SOUNDBOARD_ALIASES_KEY, soundIds);
    writeStoredIds(SOUNDBOARD_FAVORITES_KEY, favorites);
    writeStoredIds(SOUNDBOARD_RECENTS_KEY, recents);
    writeStoredIds(SOUNDBOARD_ORDER_KEY, customOrder);
    writeStoredAliases(SOUNDBOARD_ALIASES_KEY, aliases);
    const displayLabelFor = (sound) => soundboardSoundLabel(sound, aliases);

    body.classList.add('rl-soundboard', 'sbx');

    const { displayMethods, spendMethods } = walletPaymentMethods(mod, state);
    const methods = displayMethods.length ? displayMethods : ['tokens'];
    const supportsPaymentMethod = (method) => spendMethods.includes(method);
    if (!methods.includes(selectedPaymentMethod)) selectedPaymentMethod = methods[0];
    const tokenCostOf = (sound) => Number(sound?.token_cost ?? mod.token_cost ?? 500);
    const creditCostOf = (sound) => Number(sound?.credit_cost ?? 1);

    // État d'un son vu par le viewer. Core reste l'autorité (il refuse de toute façon) : ceci
    // n'est qu'un affichage, recalculé chaque seconde pendant un cooldown.
    const availability = (sound) => {
      if (sound?.enabled === false) return { kind: 'disabled', label: 'Indisponible', hint: 'Ce son est désactivé' };
      const left = (sound?.cooldown_until ? Date.parse(sound.cooldown_until) : 0) - Date.now();
      if (left > 0) {
        const seconds = Math.ceil(left / 1000);
        return { kind: 'cooldown', label: `${seconds} s`, hint: `Disponible dans ${seconds} s`, left };
      }
      if (sound?.running && sound.playback_mode === 'ignore_if_running') {
        return { kind: 'running', label: 'En cours', hint: 'Ce son est déjà en cours de lecture' };
      }
      return null;
    };
    const durationText = (sound) => {
      if (String(sound.id) === 'random') return 'Son surprise';
      const ms = Number(sound.duration_ms || 0);
      return ms ? `${(ms / 1000).toFixed(1).replace('.', ',')} s` : '';
    };

    // --- En-tête : recherche, tri, filtres, état du lecteur -------------------------------------
    const head = el('div', 'sbx-head');
    const searchBox = el('label', 'sbx-search');
    const search = el('input', 'sbx-search__input');
    search.id = 'soundboard-search';
    search.type = 'search';
    search.placeholder = 'Rechercher un son';
    search.value = drafts.soundboard.query;
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.setAttribute('aria-label', 'Rechercher un son');
    search.dataset.draftKey = 'soundboard-query';
    const clearSearch = el('button', 'sbx-search__clear');
    clearSearch.type = 'button';
    clearSearch.setAttribute('aria-label', 'Effacer la recherche');
    clearSearch.append(sbxIcon('close'));
    searchBox.append(sbxIcon('search'), search, clearSearch);

    const sortWrap = el('div', 'sbx-sort');
    const sortButton = el('button', 'sbx-iconbtn sbx-sort__button');
    sortButton.type = 'button';
    sortButton.title = 'Trier';
    sortButton.setAttribute('aria-haspopup', 'menu');
    sortButton.setAttribute('aria-expanded', 'false');
    sortButton.setAttribute('aria-label', 'Trier le catalogue');
    sortButton.append(sbxIcon('sort'));
    const sortMenu = el('div', 'sbx-menu');
    sortMenu.setAttribute('role', 'menu');
    sortMenu.hidden = true;
    const SORTS = [['custom', 'Mon ordre'], ['alpha', 'A → Z'], ['price', 'Prix croissant']];
    const sortItems = SORTS.map(([value, label]) => {
      const item = el('button', 'sbx-menu__item', label);
      item.type = 'button';
      item.dataset.sort = value;
      item.setAttribute('role', 'menuitemradio');
      item.addEventListener('click', () => {
        drafts.soundboard.sort = value;
        openSortMenu(false);
        syncSort();
        renderGrid();
      });
      return item;
    });
    const sortNote = el('p', 'sbx-menu__note', 'Mon ordre : maintiens une carte pour la déplacer.');
    sortMenu.append(...sortItems, sortNote);
    sortWrap.append(sortButton, sortMenu);
    const syncSort = () => {
      for (const item of sortItems) {
        const on = item.dataset.sort === drafts.soundboard.sort;
        item.classList.toggle('is-active', on);
        item.setAttribute('aria-checked', String(on));
      }
      sortButton.classList.toggle('is-set', drafts.soundboard.sort !== 'custom');
    };
    const openSortMenu = (open) => {
      sortMenu.hidden = !open;
      sortWrap.classList.toggle('is-open', open);
      sortButton.setAttribute('aria-expanded', String(open));
    };
    sortButton.addEventListener('click', () => openSortMenu(sortMenu.hidden));
    sortWrap.addEventListener('focusout', () => queueMicrotask(() => {
      if (!sortWrap.contains(document.activeElement)) openSortMenu(false);
    }));
    sortWrap.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || sortMenu.hidden) return;
      event.stopPropagation();
      openSortMenu(false);
      sortButton.focus({ preventScroll: true });
    });
    syncSort();

    const filters = el('div', 'sbx-filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Afficher');
    const VIEWS = [['all', 'Tous'], ['favorites', 'Favoris'], ['recents', 'Récents']];
    const filterButtons = VIEWS.map(([id, label]) => {
      const chip = el('button', 'sbx-filter');
      chip.type = 'button';
      chip.dataset.view = id;
      if (id === 'favorites') chip.append(sbxIcon('star'));
      chip.append(el('span', 'sbx-filter__label', label), el('span', 'sbx-filter__count'));
      chip.addEventListener('click', () => {
        drafts.soundboard.view = id;
        drafts.soundboard.favoritesOnly = id === 'favorites';
        syncFilters();
        renderGrid();
      });
      return chip;
    });
    filters.append(...filterButtons);
    const syncFilters = () => {
      for (const chip of filterButtons) {
        const on = chip.dataset.view === drafts.soundboard.view;
        chip.classList.toggle('is-active', on);
        chip.setAttribute('aria-pressed', String(on));
        const count = chip.dataset.view === 'favorites' ? favorites.length
          : chip.dataset.view === 'recents' ? recents.length : sounds.length;
        chip.querySelector('.sbx-filter__count').textContent = String(count);
      }
    };
    syncFilters();

    // Lecteur du Studio : information discrète (Core refuse de toute façon sans lecteur prêt).
    const status = el('span', 'sbx-status');
    if (mod.player_ready === false) {
      status.classList.add('is-offline');
      status.title = 'Le lecteur audio du Studio n’est pas prêt : un envoi serait refusé sans rien consommer.';
      status.append(el('span', 'sbx-status__dot'), el('span', '', 'Lecteur hors ligne'));
    } else if (mod.player_ready === true) {
      status.classList.add('is-online');
      status.title = 'Lecteur audio du Studio prêt';
      status.append(el('span', 'sbx-status__dot'), el('span', '', 'Lecteur prêt'));
    }

    const searchRow = el('div', 'sbx-head__row');
    searchRow.append(searchBox, sortWrap);
    const filterRow = el('div', 'sbx-head__row sbx-head__row--filters');
    filterRow.append(filters, status);
    head.append(searchRow, filterRow);

    // --- Grille ----------------------------------------------------------------------------------
    const grid = el('div', 'sbx-grid');
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-label', 'Catalogue Soundboard');
    grid.dataset.scrollKey = 'soundboard-grid';

    const visibleSounds = () => {
      let candidates = sounds.filter((sound) => soundboardSoundMatchesQuery(sound, drafts.soundboard.query, aliases));
      if (drafts.soundboard.view === 'favorites') {
        candidates = candidates.filter((sound) => favorites.includes(String(sound.id)));
      } else if (drafts.soundboard.view === 'recents') {
        return recents.map((id) => candidates.find((sound) => String(sound.id) === id)).filter(Boolean);
      }
      return sortSoundboardSounds(candidates, {
        sort: drafts.soundboard.sort,
        customOrder,
        recents,
        aliases,
        paymentMethod: selectedPaymentMethod,
        moduleTokenCost: mod.token_cost,
      });
    };

    const playSoundPreview = async (sound, trigger = null) => {
      if (!soundPreviewUrls(sound).length) return;
      if (!previewVolume) {
        showBarNotice('Monte le volume des aperçus (🔊 en haut) pour écouter.');
        return;
      }
      let audio = null;
      const soundId = String(sound.id);
      const restore = () => {
        trigger?.classList.remove('is-previewing');
        if (previewRestore === restore) {
          previewRestore = null;
          if (previewAudio === audio) previewAudio = null;
          if (previewSoundId === soundId) previewSoundId = null;
        }
        syncSoundboardPreviewButtons();
      };
      const previewUrl = chooseSoundPreviewUrl(sound);
      try {
        stopSoundPreview();
        audio = new Audio();
        previewAudio = audio;
        audio.preload = 'auto';
        audio.src = new URL(String(previewUrl), document.baseURI).href;
        audio.volume = previewVolume / 100;
        previewRestore = restore;
        previewSoundId = soundId;
        syncSoundboardPreviewButtons();
        audio.addEventListener('ended', restore, { once: true });
        await audio.play();
      } catch (error) {
        if (previewAudio !== audio) {
          restore();
          return;
        }
        const mediaCode = Number(audio?.error?.code || 0);
        const errorCode = mediaCode ? `MEDIA_${mediaCode}` : String(error?.name || 'AUDIO_ERROR');
        console.warn('[Raptoru Live] sound_preview_failed', {
          code: errorCode,
          source: String(previewUrl || ''),
          message: String(error?.message || audio?.error?.message || 'preview_failed').slice(0, 180),
        });
        stopSoundPreview();
        showBarNotice(`Aperçu indisponible (${errorCode}). Rien n’a été envoyé.`);
      }
    };

    const selectSound = (sound) => {
      selectedSound = String(sound.id);
      drafts.soundboard.selectedId = selectedSound;
      setActionState();
    };

    // Réordonnancement personnel (tri « Mon ordre ») : appui long puis glisser, ou Alt+flèches.
    let dragPending = null;
    let dragSession = null;
    let dragJustDroppedId = null;
    const dragDelayMs = 300;
    const bindGlobalPointerTracking = (onMove, onUp, onCancel) => {
      const target = globalThis.window;
      if (!target || typeof target.addEventListener !== 'function') return () => {};
      target.addEventListener('pointermove', onMove, { passive: false });
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onCancel);
      return () => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onCancel);
      };
    };
    const clearDragPending = () => {
      const current = dragPending;
      dragPending = null;
      if (!current) return;
      if (current.timer !== null) globalThis.clearTimeout?.(current.timer);
      current.detach?.();
    };
    const positionDraggedItem = (session, event) => {
      session.item.style.setProperty('--sbx-drag-x', `${(Number(event.clientX) || 0) - session.offsetX}px`);
      session.item.style.setProperty('--sbx-drag-y', `${(Number(event.clientY) || 0) - session.offsetY}px`);
    };
    const moveDragPlaceholder = (session, event) => {
      const x = Number(event.clientX) || 0;
      const y = Number(event.clientY) || 0;
      let target = null;
      let targetRect = null;
      let nearest = Number.POSITIVE_INFINITY;
      for (const candidate of grid.querySelectorAll('.sbx-card')) {
        const rect = candidate.getBoundingClientRect();
        const distance = ((rect.left + rect.width / 2) - x) ** 2 + ((rect.top + rect.height / 2) - y) ** 2;
        if (distance < nearest) {
          nearest = distance;
          target = candidate;
          targetRect = rect;
        }
      }
      if (!target) {
        grid.append(session.placeholder);
        return;
      }
      const before = y < targetRect.top + targetRect.height / 2
        || (Math.abs(y - (targetRect.top + targetRect.height / 2)) < targetRect.height / 2
          && x < targetRect.left + targetRect.width / 2);
      const sibling = before ? target : target.nextSibling;
      if (sibling === session.placeholder) return;
      if (sibling) grid.insertBefore(session.placeholder, sibling);
      else grid.append(session.placeholder);
    };
    const finishDrag = ({ commit = false } = {}) => {
      clearDragPending();
      const session = dragSession;
      if (!session) return;
      dragSession = null;
      session.detach?.();
      const parent = session.placeholder.parentNode;
      if (parent && !commit) {
        const reference = [...grid.querySelectorAll('.sbx-card')][session.visibleIds.indexOf(session.soundId)] ?? null;
        if (reference) parent.insertBefore(session.placeholder, reference);
      }
      if (parent) parent.replaceChild(session.item, session.placeholder);
      session.item.classList.remove('is-dragging');
      session.item.style.removeProperty('--sbx-drag-x');
      session.item.style.removeProperty('--sbx-drag-y');
      session.item.style.removeProperty('--sbx-drag-w');
      session.item.style.removeProperty('--sbx-drag-h');
      grid.classList.remove('is-dragging');
      soundboardDragCancel = null;
      if (!commit) return;
      const reordered = [...grid.querySelectorAll('.sbx-card')].map((item) => String(item.dataset.soundId));
      customOrder = reorderSoundboardVisibleSubset(customOrder, session.visibleIds, reordered);
      writeStoredIds(SOUNDBOARD_ORDER_KEY, customOrder);
      dragJustDroppedId = session.soundId;
      renderGrid();
      globalThis.setTimeout?.(() => {
        if (dragJustDroppedId === session.soundId) dragJustDroppedId = null;
      }, 0);
    };
    const beginDrag = (current) => {
      if (dragPending !== current || dragSession || drafts.soundboard.sort !== 'custom') return;
      current.detach?.();
      dragPending = null;
      const item = current.item;
      const parent = item?.parentNode;
      if (!parent) return;
      const rect = item.getBoundingClientRect();
      const placeholder = el('div', 'sbx-card-placeholder');
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.style.setProperty('--sbx-drag-h', `${rect.height}px`);
      const visibleIds = [...grid.querySelectorAll('.sbx-card')].map((candidate) => String(candidate.dataset.soundId));
      parent.insertBefore(placeholder, item);
      root.append(item);
      item.classList.add('is-dragging');
      grid.classList.add('is-dragging');
      item.style.setProperty('--sbx-drag-w', `${rect.width}px`);
      item.style.setProperty('--sbx-drag-h', `${rect.height}px`);
      const session = {
        item,
        placeholder,
        soundId: current.soundId,
        pointerId: current.pointerId,
        offsetX: current.clientX - rect.left,
        offsetY: current.clientY - rect.top,
        visibleIds,
        detach: null,
      };
      dragSession = session;
      positionDraggedItem(session, current);
      session.detach = bindGlobalPointerTracking(
        (event) => {
          if (event.pointerId !== session.pointerId) return;
          event.preventDefault?.();
          positionDraggedItem(session, event);
          moveDragPlaceholder(session, event);
        },
        (event) => {
          if (event.pointerId !== session.pointerId) return;
          event.preventDefault?.();
          finishDrag({ commit: true });
        },
        (event) => {
          if (event.pointerId === session.pointerId) finishDrag();
        },
      );
      soundboardDragCancel = () => finishDrag();
    };
    const dragExcludedTarget = (target) => Boolean(target?.closest?.('.sbx-card__play, .sbx-card__fav, .sbx-alias'));
    const startDragPending = (item, soundId, event) => {
      if (drafts.soundboard.sort !== 'custom' || drafts.soundboard.view !== 'all' || dragSession
        || event.isPrimary === false || (event.button !== undefined && event.button !== 0)
        || dragExcludedTarget(event.target)) return;
      clearDragPending();
      const pointerId = event.pointerId ?? 1;
      const current = {
        item,
        soundId,
        pointerId,
        clientX: Number(event.clientX) || 0,
        clientY: Number(event.clientY) || 0,
        timer: null,
        detach: null,
      };
      dragPending = current;
      current.detach = bindGlobalPointerTracking(
        (moveEvent) => {
          if (moveEvent.pointerId !== pointerId || dragPending !== current) return;
          const dx = (Number(moveEvent.clientX) || 0) - current.clientX;
          const dy = (Number(moveEvent.clientY) || 0) - current.clientY;
          if (Math.hypot(dx, dy) > 10) clearDragPending();
        },
        (upEvent) => {
          if (upEvent.pointerId === pointerId && dragPending === current) clearDragPending();
        },
        (upEvent) => {
          if (upEvent.pointerId === pointerId && dragPending === current) clearDragPending();
        },
      );
      current.timer = globalThis.setTimeout?.(() => beginDrag(current), dragDelayMs) ?? null;
    };
    const reorderWithKeyboard = (soundId, key) => {
      if (drafts.soundboard.sort !== 'custom' || drafts.soundboard.view !== 'all') return false;
      const visibleIds = [...grid.querySelectorAll('.sbx-card')].map((item) => String(item.dataset.soundId));
      const index = visibleIds.indexOf(String(soundId));
      if (index < 0) return false;
      let columns = 1;
      try {
        columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/u).length);
      } catch { /* une colonne par défaut */ }
      const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -columns : columns;
      const target = Math.min(visibleIds.length - 1, Math.max(0, index + delta));
      if (target === index) return false;
      const reordered = [...visibleIds];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      customOrder = reorderSoundboardVisibleSubset(customOrder, visibleIds, reordered);
      writeStoredIds(SOUNDBOARD_ORDER_KEY, customOrder);
      renderGrid();
      queueMicrotask(() => grid.querySelector(`.sbx-card[data-sound-id="${CSS.escape(String(soundId))}"] .sbx-card__main`)
        ?.focus({ preventScroll: true }));
      return true;
    };

    // Nom personnel (clic droit / Maj+F2) : stocké localement, n'affecte que ce viewer.
    const openAliasEditor = (sound, card, returnFocus = null) => {
      if (card.querySelector('.sbx-alias')) return;
      const soundId = String(sound.id);
      const originalLabel = String(sound.label ?? soundId);
      const currentAlias = aliasValue(aliases, soundId);
      const form = el('form', 'sbx-alias');
      form.setAttribute('aria-label', `Nom personnel de ${originalLabel}`);
      const input = el('input', 'sbx-alias__input');
      input.type = 'text';
      input.maxLength = SOUNDBOARD_ALIAS_MAX_LENGTH;
      input.value = currentAlias;
      input.placeholder = originalLabel;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `Nom personnel de ${originalLabel}`);
      input.dataset.draftKey = `soundboard-alias-${soundId}`;
      const save = el('button', 'sbx-alias__btn sbx-alias__btn--save', '✓');
      save.type = 'submit';
      save.setAttribute('aria-label', 'Valider le nom personnel');
      const restore = el('button', 'sbx-alias__btn', '↺');
      restore.type = 'button';
      restore.hidden = !currentAlias;
      restore.setAttribute('aria-label', 'Restaurer le nom original');
      restore.title = 'Restaurer le nom original';
      form.append(input, save, restore);
      for (const type of ['click', 'pointerdown']) form.addEventListener(type, (event) => event.stopPropagation());
      form.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      const persistAlias = (value) => {
        const next = normalizeSoundboardAlias(value);
        if (!next || normalizeSearchQuery(next) === normalizeSearchQuery(originalLabel)) delete aliases[soundId];
        else aliases[soundId] = next;
        writeStoredAliases(SOUNDBOARD_ALIASES_KEY, aliases);
        renderGrid();
      };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        persistAlias(input.value);
      });
      restore.addEventListener('click', (event) => {
        event.preventDefault();
        persistAlias('');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        renderGrid();
        queueMicrotask(() => returnFocus?.focus?.({ preventScroll: true }));
      });
      card.classList.add('is-editing');
      card.append(form);
      input.focus({ preventScroll: true });
      input.select();
    };

    const syncCard = (card) => {
      const sound = soundById.get(String(card.dataset.soundId));
      if (!sound) return;
      const soundId = String(sound.id);
      const unavailable = availability(sound);
      const playing = !unavailable && sound.running === true;
      card.dataset.state = unavailable?.kind ?? (playing ? 'playing' : 'available');
      const selected = soundId === selectedSound;
      card.classList.toggle('is-selected', selected);
      const main = card.querySelector('.sbx-card__main');
      main.disabled = Boolean(unavailable);
      main.setAttribute('aria-pressed', String(selected));
      main.title = unavailable ? unavailable.hint : aliases[soundId] ? `Nom original : ${sound.label ?? soundId}` : '';
      const meta = card.querySelector('.sbx-card__meta');
      meta.replaceChildren();
      if (unavailable?.kind === 'cooldown') {
        meta.append(sbxIcon('clock'), el('span', '', unavailable.label));
        const total = Number(sound.cooldown_ms || 0);
        card.style.setProperty('--sbx-cd', total > 0 ? String(Math.min(1, unavailable.left / total)) : '0');
      } else {
        card.style.removeProperty('--sbx-cd');
        if (unavailable) meta.append(el('span', '', unavailable.label));
        else if (playing) meta.append(sbxEqualizer(), el('span', '', 'En lecture'));
        else meta.append(el('span', '', durationText(sound)));
      }
      const favoriteOn = favorites.includes(soundId);
      card.classList.toggle('is-favorite', favoriteOn);
      const fav = card.querySelector('.sbx-card__fav');
      fav.setAttribute('aria-pressed', String(favoriteOn));
      fav.setAttribute('aria-label', favoriteOn
        ? `Retirer ${displayLabelFor(sound)} des favoris`
        : `Ajouter ${displayLabelFor(sound)} aux favoris`);
      fav.title = favoriteOn ? 'Retirer des favoris' : 'Ajouter aux favoris';
    };

    const buildCard = (sound) => {
      const soundId = String(sound.id);
      const label = displayLabelFor(sound);
      const card = el('div', 'sbx-card');
      card.dataset.soundId = soundId;
      card.setAttribute('role', 'listitem');
      if (soundId === 'random') card.classList.add('is-random');

      const main = el('button', 'sbx-card__main');
      main.type = 'button';
      main.setAttribute('aria-label', `Sélectionner ${label}`);
      main.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown');

      const play = el('button', 'sbx-card__play');
      play.type = 'button';
      play.dataset.soundId = soundId;
      play.dataset.soundLabel = label;
      if (!soundPreviewUrls(sound).length || sound.studio_placeholder === true) {
        play.disabled = true;
        play.classList.add('is-empty');
        play.append(el('span', 'sbx-card__dice', soundId === 'random' ? '🎲' : '·'));
        play.title = soundId === 'random' ? 'Son choisi au hasard à l’envoi' : 'Aperçu indisponible';
        play.setAttribute('aria-label', play.title);
      } else {
        play.append(sbxIcon('play'), sbxEqualizer());
      }
      play.addEventListener('click', (event) => {
        event.stopPropagation();
        if (previewSoundId === soundId) stopSoundPreview();
        else void playSoundPreview(sound, play);
      });

      const text = el('span', 'sbx-card__text');
      text.append(el('span', 'sbx-card__name', label), el('span', 'sbx-card__meta'));

      const fav = el('button', 'sbx-card__fav');
      fav.type = 'button';
      fav.append(sbxIcon('star'));
      fav.addEventListener('pointerdown', (event) => event.stopPropagation());
      fav.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        favorites = favorites.includes(soundId) ? favorites.filter((id) => id !== soundId) : [soundId, ...favorites];
        writeStoredIds(SOUNDBOARD_FAVORITES_KEY, favorites);
        syncFilters();
        if (drafts.soundboard.view === 'favorites') renderGrid();
        else syncCard(card);
        fav.classList.toggle('is-popping', favorites.includes(soundId));
      });
      fav.addEventListener('animationend', () => fav.classList.remove('is-popping'));

      main.addEventListener('click', (event) => {
        if (dragJustDroppedId === soundId) {
          event.preventDefault();
          dragJustDroppedId = null;
          return;
        }
        selectSound(sound);
      });
      main.addEventListener('keydown', (event) => {
        if (event.key === 'F2' && event.shiftKey) {
          event.preventDefault();
          openAliasEditor(sound, card, main);
          return;
        }
        if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
          && reorderWithKeyboard(soundId, event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
      card.addEventListener('pointerdown', (event) => startDragPending(card, soundId, event));
      card.addEventListener('contextmenu', (event) => {
        if (dragExcludedTarget(event.target)) return;
        event.preventDefault();
        openAliasEditor(sound, card, main);
      });
      card.append(main, play, text, fav);
      syncCard(card);
      return card;
    };

    const emptyMessage = () => {
      if (drafts.soundboard.query.trim()) return ['Aucun son trouvé', `Rien ne correspond à « ${drafts.soundboard.query.trim()} ».`];
      if (drafts.soundboard.view === 'favorites') return ['Pas encore de favori', 'Touche l’étoile d’une carte pour la retrouver ici.'];
      if (drafts.soundboard.view === 'recents') return ['Aucun son récent', 'Tes derniers envois apparaîtront ici.'];
      return ['Soundboard vide', 'Aucun son n’est disponible pour le moment.'];
    };

    const renderGrid = () => {
      const previousScrollTop = grid.scrollTop;
      const candidates = visibleSounds();
      if (!candidates.length) {
        const [title, copy] = emptyMessage();
        const empty = el('div', 'sbx-empty');
        empty.append(el('strong', '', title), el('span', '', copy));
        grid.replaceChildren(empty);
      } else {
        grid.replaceChildren(...candidates.map(buildCard));
      }
      grid.classList.toggle('is-reorderable', drafts.soundboard.sort === 'custom' && drafts.soundboard.view === 'all');
      setActionState();
      syncSoundboardPreviewButtons();
      grid.scrollTop = previousScrollTop;
    };

    grid.addEventListener('click', (event) => {
      if (event.target === grid || event.target?.closest?.('.sbx-empty')) deselectSound();
    });
    search.addEventListener('input', () => {
      drafts.soundboard.query = search.value;
      clearSearch.hidden = !search.value;
      renderGrid();
    });
    const resetSearch = () => {
      const had = Boolean(search.value || drafts.soundboard.query);
      drafts.soundboard.query = '';
      search.value = '';
      clearSearch.hidden = true;
      if (had) renderGrid();
    };
    soundboardSearchClose = resetSearch;
    clearSearch.hidden = !search.value;
    clearSearch.addEventListener('click', (event) => {
      event.preventDefault();
      resetSearch();
      search.focus({ preventScroll: true });
    });
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !search.value) return;
      event.preventDefault();
      event.stopPropagation();
      resetSearch();
    });

    // --- Barre d'action : son choisi, monnaie, prix, envoi -----------------------------------------
    const dock = el('div', 'sbx-dock');
    const toastSlot = el('div', 'sbx-toast-slot');
    const bar = el('div', 'sbx-bar');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Envoyer le son sélectionné');
    const barSound = el('div', 'sbx-bar__sound');
    const barEyebrow = el('span', 'sbx-bar__eyebrow');
    const barName = el('strong', 'sbx-bar__name');
    barSound.append(barEyebrow, barName);

    const walletSwitch = createCurrencySwitch({
      className: 'sbx-wallet',
      ariaLabel: 'Payer avec',
      tipPlacement: 'above',
      onChange: (method) => {
        selectedPaymentMethod = method;
        setActionState();
        if (drafts.soundboard.sort === 'price') renderGrid();
      },
    });
    const wallet = walletSwitch.node;

    const price = el('div', 'sbx-price');
    const priceValue = el('span', 'sbx-price__value');
    const priceUnit = el('span', 'sbx-price__unit');
    price.append(el('span', 'sbx-price__coin'), priceValue, priceUnit);

    const send = el('button', 'sbx-send');
    send.type = 'button';
    send.append(el('span', 'sbx-send__label', 'Envoyer'), sbxIcon('send'), el('span', 'sbx-send__spinner'));
    bar.append(barSound, wallet, price, send);
    dock.append(toastSlot, bar);

    let barNotice = null;
    let barNoticeTimer = null;
    function showBarNotice(message) {
      barNotice = message;
      clearTimeout(barNoticeTimer);
      barNoticeTimer = setTimeout(() => {
        barNotice = null;
        if (body.isConnected) setActionState();
      }, 3500);
      setActionState();
    }

    const setActionState = () => {
      const sound = soundById.get(String(selectedSound || ''));
      const studioPlaceholder = isStudioPreview && sound?.studio_placeholder === true;
      const creditCost = creditCostOf(sound);
      const tokenCost = tokenCostOf(sound);
      selectedCreditRedemption = sound
        ? pending.find((action) => Number(action.credits_remaining ?? 0) >= creditCost) ?? null
        : null;
      if (!methods.includes(selectedPaymentMethod)) selectedPaymentMethod = methods[0];
      const method = selectedPaymentMethod;
      paymentWalletSync?.(methods, (next) => {
        selectedPaymentMethod = next;
        setActionState();
      });
      const usingCredits = method === 'credits';
      const unavailable = sound ? availability(sound) : null;
      const hasEnoughTokens = walletCanPayTokens(state.wallet, tokenCost);
      const methodSupported = supportsPaymentMethod(method);
      const methodAvailable = usingCredits ? Boolean(selectedCreditRedemption) : hasEnoughTokens;
      const cost = usingCredits ? creditCost : tokenCost;
      const unit = usingCredits ? `crédit${creditCost > 1 ? 's' : ''}` : 'jetons';
      const hint = !sound ? ''
        : studioPlaceholder ? 'Placeholder Studio · aucune action réelle'
          : unavailable ? unavailable.hint
            : mod.player_ready === false ? 'Lecteur du Studio hors ligne'
            : !interactionsAvailable && !state?.lab_mode
              ? identityShared() ? 'Interactions en pause, rien ne sera consommé' : 'Partage ton identité Twitch pour envoyer'
              : !methodSupported ? 'Paiement indisponible pour cette monnaie'
                : usingCredits && !selectedCreditRedemption ? 'Aucun crédit Soundboard disponible'
                  : !usingCredits && !hasEnoughTokens
                    ? state?.wallet?.unavailable === true ? 'Solde de jetons indisponible' : 'Jetons insuffisants'
                    : '';

      body.dataset.paymentMethod = method;
      body.classList.toggle('has-selection', Boolean(sound));
      bar.dataset.empty = String(!sound);
      bar.dataset.method = method;
      walletSwitch.sync({
        method,
        methods,
        amounts: {
          tokens: state?.wallet?.unavailable ? null : state?.wallet?.available,
          credits: Array.isArray(state?.pending_actions) ? soundboardCreditBalance() : null,
        },
      });
      const eyebrow = barNotice || (!sound
        ? mod.player_ready === false ? 'Lecteur du Studio hors ligne' : 'Écoute avec ▶, puis choisis'
        : hint || 'Prêt à envoyer');
      barEyebrow.textContent = eyebrow;
      barEyebrow.dataset.tone = barNotice || hint || mod.player_ready === false ? 'warn' : sound ? 'ok' : 'muted';
      barName.textContent = sound ? displayLabelFor(sound) : 'Choisis un son';
      const nextPrice = sound ? fmt(cost) : '—';
      if (priceValue.textContent !== nextPrice || price.dataset.method !== method) {
        priceValue.textContent = nextPrice;
        price.classList.remove('is-bump');
        void price.offsetWidth;
        price.classList.add('is-bump');
      }
      price.dataset.method = method;
      priceUnit.textContent = unit;
      send.disabled = studioPlaceholder || !sound || !methodSupported || !methodAvailable || Boolean(unavailable)
        || (!interactionsAvailable && !state?.lab_mode);
      const summary = sound ? `Envoyer ${displayLabelFor(sound)} pour ${fmt(cost)} ${unit}` : 'Choisis d’abord un son';
      send.setAttribute('aria-label', summary);
      send.title = summary;
      for (const card of grid.querySelectorAll('.sbx-card')) {
        const selected = card.dataset.soundId === selectedSound;
        if (card.classList.contains('is-selected') !== selected) syncCard(card);
      }
    };

    const deselectSound = () => {
      stopSoundPreview();
      selectedSound = null;
      drafts.soundboard.selectedId = null;
      setActionState();
    };
    soundboardDeselect = deselectSound;

    const clearSound = () => {
      stopSoundPreview();
      if (selectedSound) {
        rememberStoredId(SOUNDBOARD_RECENTS_KEY, selectedSound);
        recents = readStoredIds(SOUNDBOARD_RECENTS_KEY).filter((id) => soundIds.has(id));
      }
      selectedSound = null;
      drafts.soundboard.selectedId = null;
      syncFilters();
      renderGrid();
    };

    send.addEventListener('click', () => {
      const sound = soundById.get(String(selectedSound || ''));
      const method = selectedPaymentMethod;
      if (!sound || send.disabled || !supportsPaymentMethod(method)) return;
      if (method === 'credits') {
        return run(body, () => selectedCreditRedemption
          ? client.useRedemption(selectedCreditRedemption.redemption_id, 'soundboard', { sound_id: selectedSound })
          : Promise.reject(Object.assign(new Error('insufficient_credits'), { code: 'insufficient_credits' })), {
          feedbackScope: 'soundboard',
          onSuccess: clearSound,
        });
      }
      if (!walletCanPayTokens(state.wallet, tokenCostOf(sound))) return;
      return run(body, () => client.spendTokens('soundboard', { sound_id: selectedSound }), {
        feedbackScope: 'soundboard',
        onSuccess: clearSound,
      });
    });

    // --- Volume des aperçus (haut-parleur du titre) : réglage local, n'affecte que ce viewer ---
    const volumeHeading = soundboardVolumeHeaderButton?.parentNode || null;
    const volumeZone = el('div', 'sbx-vol');
    const volumeHandle = soundboardVolumeHeaderButton || el('button', 'sbx-vol-trigger');
    volumeHandle.type = 'button';
    if (!volumeHandle.querySelector('svg')) volumeHandle.replaceChildren(sbxIcon('speaker'));
    volumeHandle.setAttribute('aria-controls', 'soundboard-preview-volume-popover');
    const volumePopover = el('div', 'sbx-vol__pop');
    volumePopover.id = 'soundboard-preview-volume-popover';
    volumePopover.setAttribute('role', 'dialog');
    volumePopover.setAttribute('aria-label', 'Volume des aperçus');
    volumePopover.addEventListener('click', (event) => event.stopPropagation());
    const volumeHead = el('div', 'sbx-vol__head');
    const volumeValue = el('span', 'sbx-vol__value');
    volumeHead.append(el('strong', '', 'Volume des aperçus'), volumeValue);
    const volumeRow = el('div', 'sbx-vol__row');
    const volumeMute = el('button', 'sbx-vol__mute');
    volumeMute.type = 'button';
    volumeMute.append(sbxIcon('speaker'));
    const volumeRange = el('input', 'sbx-vol__range');
    volumeRange.type = 'range';
    volumeRange.min = '0';
    volumeRange.max = '100';
    volumeRange.step = '5';
    volumeRange.setAttribute('aria-label', 'Volume des aperçus');
    volumeRow.append(volumeMute, volumeRange);
    volumePopover.append(volumeHead, volumeRow, el('p', 'sbx-vol__note', 'Pour toi seulement · rien n’est joué sur le stream'));
    volumeZone.append(volumeHandle, volumePopover);
    let volumeBeforeMute = previewVolume || 60;
    const paintVolume = () => {
      const level = previewVolume === 0 ? 'mute' : previewVolume < 50 ? 'low' : 'high';
      volumeZone.dataset.level = level;
      volumeValue.textContent = previewVolume ? `${previewVolume} %` : 'Muet';
      volumeRange.value = String(previewVolume);
      volumeRange.style.setProperty('--v', `${previewVolume}%`);
      volumeMute.setAttribute('aria-label', previewVolume ? 'Couper les aperçus' : 'Réactiver les aperçus');
      volumeMute.title = volumeMute.getAttribute('aria-label');
      if (previewAudio) previewAudio.volume = previewVolume / 100;
    };
    const setPreviewVolume = (value) => {
      previewVolume = clampPreviewVolume(value);
      savePreviewVolume(previewVolume);
      paintVolume();
    };
    volumeRange.addEventListener('input', () => setPreviewVolume(volumeRange.value));
    volumeMute.addEventListener('click', () => {
      if (previewVolume) {
        volumeBeforeMute = previewVolume;
        setPreviewVolume(0);
      } else setPreviewVolume(volumeBeforeMute || 60);
    });
    paintVolume();
    const syncVolume = (open, { focus = false } = {}) => {
      soundboardVolumeOpen = Boolean(open);
      volumeZone.classList.toggle('is-open', soundboardVolumeOpen);
      volumePopover.setAttribute('aria-hidden', String(!soundboardVolumeOpen));
      volumeHandle.setAttribute('aria-expanded', String(soundboardVolumeOpen));
      volumeHandle.setAttribute('aria-label', soundboardVolumeOpen
        ? 'Fermer le volume des aperçus'
        : 'Régler le volume des aperçus');
      volumeHandle.title = 'Volume des aperçus';
      for (const control of volumePopover.querySelectorAll('input, button')) {
        control.tabIndex = soundboardVolumeOpen ? 0 : -1;
      }
      if (focus && soundboardVolumeOpen) {
        requestAnimationFrame(() => volumeRange.focus({ preventScroll: true }));
      }
    };
    soundboardVolumeSync = syncVolume;
    volumeHandle.addEventListener('click', (event) => {
      event.stopPropagation();
      syncVolume(!soundboardVolumeOpen, { focus: !soundboardVolumeOpen });
    });
    volumeZone.addEventListener('focusout', () => {
      queueMicrotask(() => {
        if (soundboardVolumeOpen && !volumeZone.contains(document.activeElement)) syncVolume(false);
      });
    });
    syncVolume(soundboardVolumeOpen);
    if (soundboardVolumeHeaderButton) {
      volumeHeading?.prepend(volumeZone);
      soundboardVolumeHeaderButton = null;
    } else {
      searchRow.append(volumeZone);
    }

    body.append(head, grid, dock);
    renderGrid();
    // Compte à rebours sur place tant qu'un son est en cooldown (arrêté au prochain rendu).
    if (sounds.some((sound) => sound.cooldown_until && Date.parse(sound.cooldown_until) > Date.now())) {
      soundboardCooldownTimer = setInterval(() => {
        for (const card of grid.querySelectorAll('.sbx-card[data-state="cooldown"]')) syncCard(card);
        if (selectedSound) setActionState();
      }, 1000);
    }
    // Hauteur disponible sous l'en-tête : la grille défile dans le module, la barre reste visible.
    requestAnimationFrame(() => {
      if (!body.isConnected) return;
      const top = body.getBoundingClientRect().top + (document.scrollingElement?.scrollTop ?? 0);
      body.style.setProperty('--sb-top', `${Math.max(0, Math.round(top))}px`);
      // Marges du conteneur sous le module (padding bas du panel) : rien ne doit déborder la page.
      const page = document.scrollingElement;
      const overflow = page ? page.scrollHeight - page.clientHeight : 0;
      if (overflow > 0) body.style.setProperty('--sb-bottom', `${6 + overflow}px`);
    });
  }

  function bonkForm(mod, body) {
    const pending = pendingFor('bonk');
    const interactionsAvailable = interactionsAvailableForState();
    const favoriteKey = 'raptoru-live:bonk-favorites';
    const recentKey = 'raptoru-live:bonk-recents';
    let favorites = readStoredIds(favoriteKey);
    let recents = readStoredIds(recentKey);
    let selectedEmote = null;

    // Bonk est un outil de tir séquentiel : le premier clic prépare le tir,
    // les clics suivants ajoutent naturellement les prochaines emotes. On
    // conserve les primitives de munitions existantes pour garder l'ordre,
    // la boucle, la consommation synchrone et le contrat d'envoi inchangés.
    bonkAmmoMode = true;
    bonkDrawerOpen = false;

    const emoteStateKey = emoteCatalogStateKey(state?.emotes, state?.twitch_user_id);
    let oauthControls = null;
    const emoteCatalogExpired = !emoteCatalogLoadedAt
      || Date.now() - emoteCatalogLoadedAt >= EMOTE_CATALOG_REFRESH_MS;
    if (state?.emotes?.connected
      && (!emoteCatalog || emoteCatalogKey !== emoteStateKey || emoteCatalogExpired)
      && !emoteLoading) {
      queueMicrotask(loadEmotes);
    }
    if (state?.emotes?.twitch_connected === false) {
      body.append(el('p', 'jdm-emote-personal-locked', '🔒 Emotes Twitch · Autorise Twitch pour afficher tes emotes personnelles et sub.'));
      const connect = el('button', 'jdm-emote-connect', emoteAuthorizationStarting ? 'Ouverture Twitch…' : 'Autoriser mes emotes Twitch');
      connect.type = 'button';
      connect.disabled = emoteAuthorizationStarting;
      connect.setAttribute('aria-label', 'Autoriser l’accès à mes emotes Twitch');
      connect.addEventListener('click', () => beginEmoteAuthorization(body));
      body.append(connect);
      body.append(el('p', 'jdm-emote-connect__hint', 'Accès minimal user:read:emotes. Les emotes publiques restent utilisables sans autorisation.'));
    } else if (state?.emotes?.twitch_connected === true) {
      oauthControls = el('div', 'jdm-emote-oauth-controls');
      const refresh = createIconButton({
        icon: UI_ICONS.refresh,
        label: 'Actualiser les emotes Twitch',
        title: 'Actualiser les emotes Twitch',
        className: 'jdm-emote-oauth-button',
        iconClassName: 'jdm-emote-oauth-button__icon',
      });
      refresh.addEventListener('click', () => loadEmotes({ force: true }));
      const disconnect = createIconButton({
        icon: UI_ICONS.close,
        label: 'Retirer l’accès Twitch aux emotes',
        title: 'Retirer l’accès Twitch',
        className: 'jdm-emote-oauth-button',
        iconClassName: 'jdm-emote-oauth-button__icon',
      });
      disconnect.addEventListener('click', () => disconnectEmoteAuthorization(body));
      oauthControls.append(refresh, disconnect);
      // Placés dans la ligne de recherche du picker (voir plus bas), plus au-dessus de la grille.
    }
    if (emoteLoading) {
      body.append(el('p', 'jdm-hint', 'Chargement de tes emotes Twitch…'));
    } else if (emoteError) {
      body.append(el('p', 'jdm-hint', emoteError));
    }
    if (emoteCatalog?.diagnostics) {
      const info = emoteCatalog.diagnostics;
      const details = el('details', 'jdm-emote-diagnostics');
      details.append(el('summary', null, 'Diagnostic emotes'));
      details.append(el('pre', null, JSON.stringify(info, null, 2)));
      body.append(details);
    }

    const rawRealGroups = [
      ...(emoteCatalog?.groups ?? mod.emote_catalog?.groups ?? []),
      ...UNICODE_EMOJI_GROUPS,
    ];
    const { realGroups, emoteById } = buildBonkEmoteIndex(rawRealGroups);
    selectedEmote = emoteById.get(drafts.bonk.selectedId) ?? null;

    const normalizedFavorites = normalizeBonkFavoriteIds(favorites, emoteById.keys());
    if (normalizedFavorites.length !== favorites.length
      || normalizedFavorites.some((id, index) => id !== favorites[index])) {
      writeStoredIds(favoriteKey, normalizedFavorites);
    }
    favorites = normalizedFavorites;
    recents = recents.filter((id) => emoteById.has(id));
    if (recents.length !== readStoredIds(recentKey).length) writeStoredIds(recentKey, recents);

    const getGroups = () => buildBonkVisibleGroups(realGroups, {
      favoriteIds: favorites,
      recentIds: recents,
    });
    const groupEmotes = (group) => {
      if (group.id === 'favorites') return favorites.map((id) => emoteById.get(id)).filter(Boolean);
      if (group.id === 'recents') return recents.map((id) => emoteById.get(id)).filter(Boolean);
      return group.emotes.map((item) => normalizeBonkEmote(group, item));
    };

    // Adaptateur vers le picker générique : grille statique (static_url), animation au survol
    // ou à la sélection via image_url. Twemoji reste la couche visuelle des emotes Unicode.
    const demoMode = state?.demo_mode === true;
    const pickerItem = (emote) => {
      const twemoji = bonkTwemojiAssetPath(emote);
      return {
        id: emote.id,
        label: emote.label,
        // image_url est l'URL animée quand l'emote l'est : animée directement dans la grille.
        src: twemoji ?? emote.image_url ?? null,
        animated: emote.animated === true,
        glyph: emote.mark ?? emote.glyph,
        disabled: !isBonkEmoteSelectable(emote, { demoMode }),
      };
    };
    // Familles (Récents, Favoris, Twitch, Bits, Extension, Emoji) : voir bonk-picker-groups.js.
    const PROVIDER_KEYWORDS = {
      bits: ['bits'],
      '7tv': ['7tv', 'seventv'],
      bttv: ['bttv', 'betterttv'],
      ffz: ['ffz', 'frankerfacez'],
    };
    const pickerGroups = () => {
      const arranged = arrangeBonkPickerGroups(getGroups(), groupEmotes);
      // Avatar Twitch d'une chaîne (s'il est connu) réutilisé pour son contexte Extension.
      const avatars = new Map();
      for (const { group } of arranged) {
        if (group?.source !== 'twitch') continue;
        const avatar = providerPresentation(group).avatarUrl;
        if (avatar) avatars.set(String(group.channel_display_name ?? group.label).toLowerCase(), avatar);
      }
      return arranged.map((entry) => {
        const { group, family } = entry;
        const provider = group ? providerPresentation(group) : null;
        const isExtension = family?.id === 'extension';
        const label = entry.label ?? (group.id === 'twitch-global'
          ? 'Twitch'
          : String(group.label || provider.label || 'Emoji'));
        const globalContext = isExtension && entry.scope === 'global';
        const parts = entry.parts?.map((part) => ({
          id: part.id,
          label: part.label,
          iconSrc: part.iconSrc,
          keywords: PROVIDER_KEYWORDS[part.provider] ?? [],
          emotes: part.emotes.map(pickerItem),
        }));
        return {
          id: entry.id,
          label,
          keywords: [
            group?.channel_login,
            group?.channel_display_name,
            ...(PROVIDER_KEYWORDS[family?.id] ?? []),
            ...(isExtension ? ['extension'] : []),
          ].filter(Boolean),
          matchLabel: family?.id !== 'emoji',
          icon: isExtension || provider?.icon === 'twitch' ? label.slice(0, 1).toUpperCase() : provider?.icon ?? '•',
          iconSrc: entry.iconSrc ?? (globalContext ? 'assets/twemoji/svg/1f310.svg' : null),
          iconNode: group?.id === 'twitch-global' ? createTwitchBrandIcon() : null,
          avatarUrl: isExtension
            ? (globalContext ? null : avatars.get(label.toLowerCase()) ?? null)
            : provider?.avatarUrl ?? null,
          family: family
            ? { ...family, iconNode: family.id === 'twitch' ? createTwitchBrandIcon() : null }
            : null,
          virtual: group?.source === 'virtual',
          // Ordre personnel : glisser-déposer (souris) dans la section Favoris uniquement.
          reorderable: entry.id === 'favorites',
          ...(parts ? { parts } : {}),
          emotes: parts ? parts.flatMap((part) => part.emotes) : entry.emotes.map(pickerItem),
        };
      });
    };

    // Instance unique : le rendu global (polling) la déplace sans reconstruire ses cellules.
    bonkEmotePicker ??= createEmotePicker({
      label: 'Emotes Bonk',
      railKey: 'raptoru-live:bonk-rail-open',
    });
    const emotePicker = bonkEmotePicker;
    const picker = el('div', 'jdm-bonk-picker rl-bonk-picker');

    const modeBar = el('div', 'jdm-bonk-modebar');
    const modeToggle = el('button', 'jdm-bonk-ammo-toggle', '+ Munitions');
    modeToggle.type = 'button';
    modeToggle.hidden = true;
    modeToggle.tabIndex = -1;
    modeToggle.setAttribute('aria-hidden', 'true');
    modeToggle.setAttribute('aria-pressed', String(bonkAmmoMode));
    modeToggle.setAttribute('aria-controls', 'bonk-ammo-tray');
    modeToggle.title = 'Préparer plusieurs emotes dans l’ordre';
    const loopToggle = el('button', 'jdm-bonk-loop-toggle', '↻');
    loopToggle.type = 'button';
    loopToggle.hidden = true;
    loopToggle.setAttribute('aria-pressed', String(bonkAmmoLoop));
    loopToggle.setAttribute('aria-label', 'Boucle des munitions');
    loopToggle.title = 'Boucle';
    const ammoStatus = el('span', 'jdm-bonk-ammo-status');
    ammoStatus.setAttribute('aria-live', 'polite');
    modeBar.append(modeToggle, loopToggle, ammoStatus);

    const ammoTray = el('div', 'jdm-bonk-ammo');
    ammoTray.id = 'bonk-ammo-tray';
    ammoTray.setAttribute('aria-label', 'Séquence de tirs Bonk');
    ammoTray.setAttribute('aria-hidden', 'true');
    const ammoSummary = el('span', 'jdm-bonk-ammo__summary');
    ammoSummary.setAttribute('aria-hidden', 'true');
    const ammoList = el('div', 'jdm-bonk-ammo__list');
    ammoList.setAttribute('role', 'list');
    const ammoClear = el('button', 'jdm-bonk-ammo__clear', '×');
    ammoClear.type = 'button';
    ammoClear.setAttribute('aria-label', 'Vider la séquence Bonk');
    ammoClear.title = 'Vider la séquence';
    ammoTray.append(ammoSummary, ammoList, ammoClear);

    const drawer = el('aside', 'jdm-ui-drawer jdm-bonk-drawer');
    drawer.id = 'bonk-config-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Configuration Bonk');
    drawer.setAttribute('aria-hidden', String(!bonkDrawerOpen));
    const drawerHead = el('div', 'jdm-bonk-drawer__head');
    const drawerTitle = el('strong', 'jdm-bonk-drawer__title', 'Configuration Bonk');
    const drawerHint = el('span', 'jdm-bonk-drawer__hint', 'Mode de tir et chargeur local');
    const drawerClose = createIconButton({
      icon: UI_ICONS.close,
      label: 'Fermer la configuration Bonk',
      title: 'Fermer la configuration',
      className: 'jdm-bonk-drawer__close',
      iconClassName: 'jdm-bonk-drawer__close-icon',
    });
    drawerHead.append(drawerTitle, drawerHint, drawerClose);
    drawer.append(drawerHead, modeBar, ammoTray);

    const chosen = el('div', 'jdm-bonk-choice');
    chosen.setAttribute('aria-label', 'Emote sélectionnée');
    chosen.setAttribute('aria-live', 'polite');
    const chosenPreview = el('span', 'jdm-bonk-choice__preview', '…');
    const chosenName = el('span', 'jdm-bonk-choice__name', 'Choisis une emote');
    const favoriteButton = el('button', 'jdm-bonk-choice__favorite', '☆');
    favoriteButton.type = 'button';
    favoriteButton.disabled = true;
    favoriteButton.setAttribute('aria-label', 'Ajouter l’emote aux favoris');
    chosen.append(chosenPreview, chosenName, favoriteButton);

    const actions = el('div', 'jdm-bonk-actions');
    const actionButtons = [];
    let instantBonkButton = null;
    const bonkFeedback = createFeedbackSlot({
      className: 'jdm-bonk-feedback',
      label: 'Retour du Bonk',
    });
    const addAction = (className, label, task) => {
      const button = el('button', `jdm-ui-action ${className}`, label);
      button.type = 'button';
      button.disabled = true;
      button.addEventListener('click', () => {
        const payload = getPayload();
        if (payload) return run(body, () => task(payload));
      });
      actionButtons.push(button);
      actions.append(button);
    };

    const nextBonkAmmo = () => {
      if (!bonkAmmunition.length) {
        bonkAmmoIndex = 0;
        return null;
      }
      if (bonkAmmoLoop) {
        bonkAmmoIndex = ((bonkAmmoIndex % bonkAmmunition.length) + bonkAmmunition.length)
          % bonkAmmunition.length;
      }
      return bonkAmmunition[bonkAmmoIndex] ?? null;
    };

    const toggleFavorite = (emoteId) => {
      const id = String(emoteId ?? '');
      if (!emoteById.has(id)) return false;
      favorites = toggleBonkFavoriteIds(favorites, id, emoteById.keys());
      writeStoredIds(favoriteKey, favorites);
      emotePicker.setData(pickerGroups());
      syncSelection();
      return true;
    };

    emotePicker.setHandlers({
      onSelect: (id) => {
        const emote = emoteById.get(id);
        if (!emote || !isBonkEmoteSelectable(emote, { demoMode })) return;
        bonkAmmoMode = true;
        if (!bonkAmmunition.length) bonkAmmoIndex = 0;
        bonkAmmunition.push(emote);
        selectedEmote = emote;
        drafts.bonk.selectedId = emote.id;
        recents = [emote.id, ...recents.filter((item) => item !== emote.id)].slice(0, 36);
        writeStoredIds(recentKey, recents);
        renderAmmo();
        syncBonkDrawer();
        syncSelection();
        emotePicker.setData(pickerGroups());
      },
      onFavorite: (id) => toggleFavorite(id),
      onReorder: (ids) => {
        // Même ensemble, nouvel ordre : aucune emote ne peut être ajoutée ou perdue ici.
        const next = normalizeBonkFavoriteIds(ids, emoteById.keys());
        if (next.length !== favorites.length || next.some((id) => !favorites.includes(id))) return;
        favorites = next;
        writeStoredIds(favoriteKey, favorites);
        emotePicker.setData(pickerGroups());
        syncSelection();
      },
    });

    function renderAmmo() {
      const count = bonkAmmunition.length;
      const visible = bonkAmmoMode && count > 0;
      const nextIndex = bonkAmmoMode && nextBonkAmmo() ? bonkAmmoIndex : -1;
      modeToggle.hidden = true;
      modeToggle.tabIndex = -1;
      modeToggle.setAttribute('aria-hidden', 'true');
      modeToggle.textContent = bonkAmmoMode ? '✓ Munitions' : '+ Munitions';
      modeToggle.setAttribute('aria-pressed', String(bonkAmmoMode));
      modeToggle.title = bonkAmmoMode
        ? 'Revenir au mode simple sans tirer les munitions'
        : 'Préparer plusieurs emotes dans l’ordre';
      loopToggle.hidden = !bonkAmmoMode || count === 0;
      loopToggle.setAttribute('aria-pressed', String(bonkAmmoLoop));
      loopToggle.setAttribute('aria-label', bonkAmmoLoop
        ? 'Désactiver la boucle de la séquence'
        : 'Activer la boucle de la séquence');
      loopToggle.title = bonkAmmoLoop ? 'Boucle activée' : 'Activer la boucle';
      loopToggle.classList.toggle('is-on', bonkAmmoLoop);
      ammoStatus.textContent = count
        ? `Séquence · ${count} tir${count > 1 ? 's' : ''}`
        : 'Ajoute une emote pour préparer le tir';
      ammoTray.classList.toggle('is-visible', visible);
      ammoTray.setAttribute('aria-hidden', String(!visible));
      ammoSummary.textContent = count ? `${count} tir${count > 1 ? 's' : ''}` : '';
      ammoClear.hidden = !visible;
      ammoClear.disabled = !count;
      ammoList.replaceChildren();
      if (!bonkAmmoMode) return;
      for (const [index, emote] of bonkAmmunition.entries()) {
        const item = el('button', `jdm-bonk-ammo__item${index === nextIndex ? ' is-next' : ''}`);
        item.type = 'button';
        item.dataset.ammoIndex = String(index);
        item.setAttribute('aria-label', `Retirer ${emote.label}, tir ${index + 1}`);
        item.title = index === nextIndex
          ? `Prochain tir · ${emote.label}`
          : `Retirer ${emote.label}, tir ${index + 1}`;
        if (index === nextIndex) item.setAttribute('aria-current', 'true');
        const emoteImageUrl = bonkTwemojiAssetPath(emote) ?? emote.image_url;
        if (emoteImageUrl) {
          const image = el('img', 'jdm-bonk-ammo__image');
          image.src = emoteImageUrl;
          image.alt = '';
          image.loading = 'lazy';
          item.append(image);
        } else if (emote.mark) {
          const mark = el('span', 'jdm-bonk-ammo__mark', emote.mark);
          mark.dataset.tone = emote.tone ?? 'violet';
          item.append(mark);
        } else {
          item.append(el('span', 'jdm-bonk-ammo__glyph', emote.glyph ?? '◌'));
        }
        item.addEventListener('click', () => {
          const removed = removeBonkAmmoAtIndex(
            bonkAmmunition,
            index,
            bonkAmmoIndex,
            { loop: bonkAmmoLoop },
          );
          bonkAmmoIndex = removed.nextIndex;
          renderAmmo();
          syncBonkDrawer();
          syncSelection();
        });
        ammoList.append(item);
      }
      ammoStatus.classList.remove('is-updated');
      void ammoStatus.offsetWidth;
      ammoStatus.classList.add('is-updated');
    }

    function syncSelection() {
      const dockEmote = bonkAmmoMode ? nextBonkAmmo() : selectedEmote;
      const queue = new Map();
      for (const [index, item] of bonkAmmunition.entries()) {
        if (!queue.has(item.id)) queue.set(item.id, index + 1);
      }
      emotePicker.setState({
        selected: [...queue.keys(), ...(selectedEmote ? [selectedEmote.id] : [])],
        favorites,
        queue,
        next: dockEmote?.id ?? null,
      });
      chosen.classList.toggle('is-empty', !dockEmote);
      chosen.classList.toggle('is-selected', Boolean(dockEmote));
      chosen.classList.toggle('is-next', bonkAmmoMode && Boolean(dockEmote));
      picker.classList.toggle('has-selection', Boolean(dockEmote));
      chosenPreview.replaceChildren();
      if (!dockEmote) {
        chosenPreview.textContent = '…';
        chosenName.textContent = 'Choisis une emote';
        favoriteButton.textContent = '☆';
        favoriteButton.disabled = true;
        favoriteButton.classList.remove('is-active');
        favoriteButton.setAttribute('aria-pressed', 'false');
      } else {
        const emoteImageUrl = bonkTwemojiAssetPath(dockEmote) ?? dockEmote.image_url;
        if (emoteImageUrl) {
          const image = el('img', 'jdm-bonk-choice__image');
          image.src = emoteImageUrl;
          image.alt = '';
          chosenPreview.append(image);
        } else {
          chosenPreview.textContent = dockEmote.mark ?? dockEmote.glyph ?? '◌';
          if (dockEmote.mark) chosenPreview.dataset.tone = dockEmote.tone ?? 'violet';
          else delete chosenPreview.dataset.tone;
        }
        chosenName.textContent = dockEmote.label;
        chosen.setAttribute('aria-label', bonkAmmoMode
          ? `Prochaine emote : ${dockEmote.label}`
          : `Emote sélectionnée : ${dockEmote.label}`);
        const favoriteTarget = selectedEmote ?? dockEmote;
        const isFavorite = favorites.includes(favoriteTarget.id);
        favoriteButton.textContent = isFavorite ? '★' : '☆';
        favoriteButton.disabled = !favoriteTarget;
        // Tactile : ce bouton gère le favori de l'emote touchée en dernier, nommée explicitement
        // (la barre peut afficher une autre emote : la prochaine de la séquence).
        favoriteButton.classList.toggle('is-active', isFavorite);
        favoriteButton.setAttribute('aria-pressed', String(isFavorite));
        favoriteButton.setAttribute('aria-label', isFavorite
          ? `Retirer ${favoriteTarget.label} des favoris`
          : `Ajouter ${favoriteTarget.label} aux favoris`);
        favoriteButton.title = favoriteButton.getAttribute('aria-label');
      }
      for (const button of actionButtons) button.disabled = !dockEmote || !interactionsAvailable;
      if (instantBonkButton) instantBonkButton.disabled = !dockEmote || !interactionsAvailable;
      composer.classList.toggle('is-visible', Boolean(dockEmote));
      composer.setAttribute('aria-hidden', String(!dockEmote));
    }

    favoriteButton.addEventListener('click', () => {
      const favoriteTarget = selectedEmote ?? nextBonkAmmo();
      if (!favoriteTarget) return;
      toggleFavorite(favoriteTarget.id);
    });

    modeToggle.addEventListener('click', () => {
      bonkAmmoMode = !bonkAmmoMode;
      if (bonkAmmoMode) {
        // Le passage explicite en mode munitions commence vide : aucune
        // sélection simple existante n’est ajoutée implicitement.
        selectedEmote = null;
        drafts.bonk.selectedId = null;
        if (!bonkAmmunition.length) bonkAmmoIndex = 0;
      }
      renderAmmo();
      syncBonkDrawer();
      syncSelection();
    });
    loopToggle.addEventListener('click', () => {
      if (!bonkAmmoMode) return;
      const nextLoop = !bonkAmmoLoop;
      if (!nextLoop) bonkAmmoIndex = disableBonkAmmoLoop(bonkAmmunition, bonkAmmoIndex);
      bonkAmmoLoop = nextLoop;
      renderAmmo();
      syncBonkDrawer();
      syncSelection();
      ammoStatus.textContent = nextLoop ? 'Boucle activée' : 'Boucle désactivée';
    });
    ammoClear.addEventListener('click', () => {
      if (!bonkAmmunition.length) return;
      bonkAmmunition = [];
      bonkAmmoIndex = 0;
      renderAmmo();
      syncBonkDrawer();
      syncSelection();
    });

    const getPayload = (emote = bonkAmmoMode ? nextBonkAmmo() : selectedEmote) => {
      if (!emote) {
        bonkFeedbackMessage = 'Choisis une emote.';
        bonkFeedbackKind = 'error';
        syncBonkFeedback(bonkFeedback);
        return null;
      }
      if (!isBonkEmoteSelectable(emote, { demoMode: state?.demo_mode === true })) {
        bonkFeedbackMessage = 'Connecte tes emotes Twitch pour utiliser celle-ci.';
        bonkFeedbackKind = 'error';
        syncBonkFeedback(bonkFeedback);
        return null;
      }
    // Le Bonk vise la caméra du streamer, pas un autre spectateur.
      return {
        target_login: 'streamer',
        emotes: [emote.id],
        emote_source: emote.source,
        emote_glyph: emote.glyph ?? null,
      };
    };
    // Bonk est volontairement token-only : il n'existe pas de reward Twitch dédié.
    // La prochaine occurrence locale est consommée avant chaque dispatch, puis
    // le clic suivant peut partir immédiatement même si le précédent est encore
    // en vol.
    if (mod.token_cost) {
      instantBonkButton = el('button', 'jdm-btn jdm-ui-action jdm-btn--primary', null);
      instantBonkButton.type = 'button';
      instantBonkButton.append(
        el('strong', 'jdm-bonk-cta__label', 'BONK'),
        el('span', 'jdm-bonk-cta__cost', `${fmt(mod.token_cost)} jetons`),
      );
      instantBonkButton.setAttribute('aria-label', `Bonk · ${fmt(mod.token_cost)} jetons`);
      // Le dblclick est neutralisé uniquement sur ce CTA. Les click qui le
      // composent continuent chacun leur chemin normal de spam Bonk.
      instantBonkButton.addEventListener('dblclick', preventBonkDoubleClick);
      instantBonkButton.addEventListener('click', () => {
        const emote = bonkAmmoMode ? nextBonkAmmo() : selectedEmote;
        const payload = getPayload(emote);
        if (!payload) return;
        // La progression est synchrone : le clic suivant lit déjà la munition
        // suivante, même si le callback réseau précédent est encore actif.
        if (bonkAmmoMode) {
          const consumed = consumeBonkAmmoAtIndex(bonkAmmunition, bonkAmmoIndex, {
            loop: bonkAmmoLoop,
          });
          if (!consumed.emote) return;
          bonkAmmoIndex = consumed.nextIndex;
        }
        renderAmmo();
        syncBonkDrawer();
        syncSelection();
        void sendBonk(bonkFeedback, () => client.spendTokens('bonk', payload));
      });
      actions.append(instantBonkButton);
    }
    if (state?.lab_mode) {
      addAction('jdm-btn jdm-btn--primary', 'Tester le Bonk', (payload) => client.runLab('bonk', payload));
    }

    const composer = el('div', 'jdm-bonk-composer');
    composer.append(chosen, actions);
    const dockMode = el('span', 'jdm-bonk-dock__mode', 'Choisis tes emotes');
    const drawerToggle = createIconButton({
      icon: '☷',
      label: 'Ouvrir la configuration Bonk',
      title: 'Configurer le mode de tir',
      className: 'jdm-bonk-drawer-toggle jdm-btn--secondary',
      iconClassName: 'jdm-bonk-drawer-toggle__icon',
      visibleLabel: 'Config',
    });
    drawerToggle.setAttribute('aria-controls', drawer.id);
    drawerToggle.setAttribute('aria-haspopup', 'dialog');
    drawerToggle.hidden = true;
    drawerToggle.tabIndex = -1;
    drawerToggle.setAttribute('aria-hidden', 'true');
    const dockMeta = el('div', 'jdm-bonk-dock__meta');
    dockMeta.append(dockMode, modeBar, drawerToggle);
    const dock = el('div', 'jdm-bonk-dock');
    dock.append(dockMeta, ammoTray, composer);
    const syncBonkDrawer = () => {
      const count = bonkAmmunition.length;
      const modeLabel = count
        ? `${count} tir${count > 1 ? 's' : ''}`
        : 'Choisis tes emotes';
      dock.dataset.sequenceCount = String(count);
      dockMode.textContent = count ? `×${count}` : modeLabel;
      dockMode.classList.toggle('is-empty', !count);
      dockMode.setAttribute('aria-label', count
        ? `Séquence de ${modeLabel}`
        : 'Choisis tes emotes pour préparer un Bonk');
      dockMode.title = count ? `Séquence de ${modeLabel}` : modeLabel;
      drawer.classList.toggle('is-open', bonkDrawerOpen);
      drawer.setAttribute('aria-hidden', String(!bonkDrawerOpen));
      drawerToggle.setAttribute('aria-expanded', String(bonkDrawerOpen));
      updateIconButton(drawerToggle, {
        icon: bonkDrawerOpen ? UI_ICONS.close : '☷',
        label: bonkDrawerOpen ? 'Fermer la configuration Bonk' : 'Ouvrir la configuration Bonk',
        title: bonkDrawerOpen ? 'Fermer la configuration' : 'Configurer le mode de tir',
      });
      drawer.inert = !bonkDrawerOpen;
      drawerClose.tabIndex = bonkDrawerOpen ? 0 : -1;
      drawer.hidden = true;
      drawerToggle.hidden = true;
      drawerToggle.tabIndex = -1;
      drawerToggle.setAttribute('aria-hidden', 'true');
    };
    drawerToggle.addEventListener('click', () => {
      bonkDrawerOpen = !bonkDrawerOpen;
      syncBonkDrawer();
      if (bonkDrawerOpen) {
        queueMicrotask(() => drawerClose.focus({ preventScroll: true }));
      }
    });
    drawerClose.addEventListener('click', () => {
      bonkDrawerOpen = false;
      syncBonkDrawer();
      queueMicrotask(() => drawerToggle.focus({ preventScroll: true }));
    });
    picker.append(emotePicker.nav, emotePicker.searchRow, emotePicker.scroller, bonkFeedback, dock, drawer);
    body.append(picker);
    if (!interactionsAvailable && !state?.lab_mode) {
      body.append(el('p', 'jdm-hint', identityShared()
        ? 'Interactions temporairement indisponibles : SAMMI se reconnecte. Aucun jeton ne sera consommé.'
        : 'Partage ton identité Twitch pour utiliser les interactions. Aucun jeton ne sera consommé.'));
    }
    emotePicker.setExtras(oauthControls);
    emotePicker.setData(pickerGroups());
    emotePicker.attached();
    renderAmmo();
    syncBonkDrawer();
    syncSelection();
    syncBonkFeedback(bonkFeedback);
  }

  function raffleForm(mod, body) {
    stopRaffleTimer();
    const raffle = state?.raffle ?? { open: false };
    const unavailable = Boolean(raffle.unavailable);
    const active = raffleIsActive(raffle);
    const historyRows = Array.isArray(raffle.history) ? raffle.history : [];
    const participants = Array.isArray(raffle.participants) ? raffle.participants : [];
    const announcedParticipantCount = raffleNumber(raffle.participant_count);
    const participantCount = announcedParticipantCount ?? participants.length;
    const viewerLogin = String(raffle.viewer_login || '').trim().replace(/^@+/, '').toLowerCase();
    const timerSource = raffleTimerSource(raffle);
    const stateKey = unavailable ? 'unavailable' : active ? 'active' : 'inactive';

    const screen = el('section', 'jdm-raffle-screen');
    screen.dataset.raffleState = stateKey;
    screen.setAttribute('aria-label', 'Tombola');

    const historyToggle = createIconButton({
      icon: UI_ICONS.history,
      label: raffleHistoryOpen ? 'Fermer l’historique Tombola' : 'Ouvrir l’historique Tombola',
      title: raffleHistoryOpen ? 'Fermer l’historique' : 'Historique des tombolas',
      className: 'jdm-raffle-history-toggle',
      iconClassName: 'jdm-raffle-history-toggle__icon',
      visibleLabel: 'Historique',
    });
    historyToggle.setAttribute('aria-controls', 'raffle-history-panel');
    historyToggle.setAttribute('aria-expanded', String(raffleHistoryOpen));
    if (historyRows.length) historyToggle.append(el('span', 'jdm-raffle-history-count', String(historyRows.length)));

    const layout = el('div', `jdm-raffle-layout${active ? ' is-active' : ' is-inactive'}`);
    const overview = el('section', 'jdm-raffle-overview');
    overview.setAttribute('aria-label', 'État de la Tombola');

    const pot = el('section', 'jdm-raffle-pot');
    const potAmount = raffleNumber(raffle.total);
    const potUnit = 'jetons';
    const potValue = el('strong', 'jdm-raffle-pot__value', potAmount === null ? '—' : fmtRafflePotAmount(potAmount));
    const potUnitNode = el('span', 'jdm-raffle-pot__unit', potAmount === null ? '' : potUnit);
    pot.append(
      el('span', 'jdm-raffle-card__eyebrow', potAmount === null
        ? (unavailable ? 'TOMBOLA INDISPONIBLE' : 'TOMBOLA FERMÉE')
        : active ? 'À GAGNER' : 'POT'),
      potValue,
      potUnitNode,
    );
    if (potAmount !== null) pot.dataset.hasAmount = 'true';

    const timer = el('section', 'jdm-raffle-timer');
    timer.dataset.source = timerSource;
    timer.dataset.closed = String(!active);
    timer.setAttribute('role', 'timer');
    const timerValue = el('time', 'jdm-raffle-timer__value', '0');
    timer.append(timerValue);

    const timerWindowId = String(raffle.window_id || '').trim();
    const timerEndsAt = String(raffle.ends_at || '').trim();
    const serverRemaining = raffleNumber(raffle.ends_in_s);
    const snapshotRemaining = timerSource === 'ends_in_s' ? serverRemaining : null;
    const explicitTotal = raffleTotalSeconds(raffle);
    const snapshotChanged = !raffleTimerSnapshot
      || raffleTimerSnapshot.active !== active
      || raffleTimerSnapshot.windowId !== timerWindowId
      || raffleTimerSnapshot.source !== timerSource
      || raffleTimerSnapshot.endsAt !== timerEndsAt
      || raffleTimerSnapshot.serverRemaining !== snapshotRemaining;
    if (snapshotChanged) {
      const initialRemaining = active
        ? timerSource === 'ends_at'
          ? raffleSeconds(raffle)
          : serverRemaining ?? 0
        : 0;
      raffleTimerSnapshot = {
        active,
        windowId: timerWindowId,
        source: timerSource,
        endsAt: timerEndsAt,
        serverRemaining: snapshotRemaining,
        syncedAt: Date.now(),
        initialRemaining,
        totalSeconds: explicitTotal ?? Math.max(1, initialRemaining),
      };
    } else if (explicitTotal !== null) {
      raffleTimerSnapshot.totalSeconds = explicitTotal;
    }
    const timerTotal = Math.max(1, Number(raffleTimerSnapshot?.totalSeconds || 1));
    const currentTimerSeconds = () => {
      if (!active) return 0;
      if (timerSource === 'ends_at') return raffleSeconds(raffle);
      if (timerSource === 'ends_in_s' && raffleTimerSnapshot?.serverRemaining !== null) {
        return Math.max(0, Math.ceil(
          raffleTimerSnapshot.serverRemaining - (Date.now() - raffleTimerSnapshot.syncedAt) / 1000,
        ));
      }
      return 0;
    };

    const syncTimer = () => {
      const seconds = currentTimerSeconds();
      const hasTimerSource = timerSource !== 'none';
      timerValue.textContent = active && hasTimerSource ? String(seconds) : active ? '—' : '0';
      timerValue.setAttribute('aria-label', !active
        ? (unavailable ? 'Tombola indisponible' : 'Tombola fermée')
        : hasTimerSource
          ? `${seconds} seconde${seconds > 1 ? 's' : ''} restante${seconds > 1 ? 's' : ''}`
          : 'Temps restant indisponible');
      timer.setAttribute('aria-label', !active
        ? (unavailable ? 'Tombola indisponible' : 'Tombola fermée')
        : hasTimerSource ? 'Temps restant' : 'Temps restant indisponible');
      timerValue.dataset.seconds = String(seconds);
      timer.dataset.seconds = String(seconds);
      timer.dataset.totalSeconds = String(timerTotal);
      timer.style.setProperty('--raffle-progress', String(
        active && hasTimerSource ? Math.max(0, Math.min(1, seconds / timerTotal)) : 0,
      ));
    };
    syncTimer();
    if (active && timerSource !== 'none' && typeof globalThis.window?.setInterval === 'function') {
      raffleTimer = globalThis.window.setInterval(syncTimer, 1000);
    }

    const joinZone = active ? el('div', 'jdm-raffle-join-zone jdm-raffle-join-drawer') : null;
    if (joinZone) {
      joinZone.setAttribute('aria-label', 'Inscription à la Tombola');
      const joinCopy = el('div', 'jdm-raffle-join-drawer__copy');
      joinCopy.append(
        el('strong', 'jdm-raffle-join-drawer__title', raffle.joined ? 'Participation confirmée' : 'Participe au tirage'),
        el('span', 'jdm-raffle-join-drawer__hint', raffle.joined
          ? 'Ton inscription est déjà prise en compte.'
          : 'Une inscription suffit pour participer.'),
      );
      const join = el('button', 'jdm-btn jdm-btn--primary jdm-raffle-join', raffle.joined ? 'Inscrit ✓' : 'Inscription');
      join.type = 'button';
      join.disabled = Boolean(raffle.joined);
      join.setAttribute('aria-disabled', String(Boolean(raffle.joined)));
      join.setAttribute('aria-label', raffle.joined ? 'Participation confirmée' : 'S’inscrire à la Tombola');
      join.title = raffle.joined ? 'Participation confirmée' : 'Inscription à la Tombola';
      if (!raffle.joined) join.addEventListener('click', () => run(joinZone, () => client.joinRaffle(), {
        onSuccess: (result) => {
          const windowId = String(result?.window_id || raffle.window_id || '').trim();
          if (!windowId) return;
          raffleJoinConfirmedWindowId = windowId;
          if (state?.raffle?.window_id === windowId) {
            state = { ...state, raffle: { ...state.raffle, joined: true } };
          }
        },
        success: (result) => (result?.duplicate === true ? null : 'Inscription confirmée ✓'),
      }));
      joinZone.append(joinCopy, join);
    }

    overview.append(pot, timer);
    if (joinZone) overview.append(joinZone);
    if (!active) {
      overview.append(el(
        'p',
        'jdm-raffle-state-copy',
        unavailable ? 'La Tombola est momentanément indisponible.' : 'Aucune tombola en cours.',
      ));
    }

    // Une zone de résultat existe dans la composition, mais elle ne lit que
    // l'historique déjà livré par le serveur lorsque la tombola n'est plus
    // active. Aucune donnée de gagnant n'est déduite de l'état ouvert : le
    // délai de révélation reste donc entièrement piloté par le contrat actuel.
    const latestResult = !active && historyRows.length ? historyRows[0] : null;
    const resultWinners = Array.isArray(latestResult?.winners)
      ? latestResult.winners.filter((winner) => String(
        winner?.display_name ?? winner?.displayName ?? winner?.login ?? '',
      ).trim())
      : [];
    const resultRevealed = resultWinners.length > 0;
    const resultZone = el('section', `jdm-raffle-result${resultRevealed ? ' is-revealed' : ' is-waiting'}`);
    resultZone.dataset.resultState = resultRevealed ? 'revealed' : 'waiting';
    resultZone.setAttribute('aria-live', 'polite');
    resultZone.setAttribute('aria-label', resultRevealed ? 'Résultat de la Tombola' : 'Résultat de la Tombola en attente');
    resultZone.append(
      el('span', 'jdm-raffle-result__eyebrow', resultRevealed ? 'DERNIER RÉSULTAT' : 'RÉSULTAT'),
      el('strong', 'jdm-raffle-result__title', resultRevealed ? 'Gagnant(s)' : active ? 'Après le tirage' : 'En attente'),
    );
    if (resultRevealed) {
      const resultList = el('ul', 'jdm-raffle-result__winners');
      resultList.dataset.scrollKey = 'raffle-result-winners';
      resultList.setAttribute('aria-label', 'Liste des gagnants');
      const resultCurrency = raffleCurrency(latestResult);
      for (const winner of resultWinners) {
        const login = String(winner?.display_name ?? winner?.displayName ?? winner?.login ?? '')
          .trim().replace(/^@+/, '');
        if (!login) continue;
        const amount = raffleAmount(winner);
        const currency = raffleCurrency(winner) || resultCurrency;
        const winnerLine = el('li', 'jdm-raffle-result__winner');
        winnerLine.append(
          el('strong', 'jdm-raffle-result__winner-name', `@${login}`),
          ...(amount === null
            ? []
            : [el('span', 'jdm-raffle-result__winner-amount', `${fmt(amount)}${currency ? ` ${currency}` : ''}`)]),
        );
        resultList.append(winnerLine);
      }
      if (resultList.children.length) resultZone.append(resultList);
    } else {
      resultZone.append(el(
        'span',
        'jdm-raffle-result__hint',
        active ? 'Le ou les gagnants apparaîtront ici après la révélation.' : 'Aucun gagnant communiqué pour le moment.',
      ));
    }

    let participantSection = null;
    if (active) {
      participantSection = el('section', 'jdm-raffle-participants');
      participantSection.setAttribute('aria-label', 'Participants à la Tombola');
      const participantHead = el('div', 'jdm-raffle-participants__head');
      participantHead.append(
        el('strong', 'jdm-raffle-participants__count', `Participants · ${participantCount}`),
      );
      const participantList = el('ul', 'jdm-raffle-participants__list');
      participantList.dataset.scrollKey = 'raffle-participants';
      participantList.setAttribute('aria-label', 'Liste des participants');
      if (!participants.length) {
        participantList.append(el('li', 'jdm-hint', 'Aucun participant pour le moment.'));
      } else {
        for (const participant of participants) {
          const login = String(participant?.login || '').trim().replace(/^@+/, '').toLowerCase();
          if (!login) continue;
          const displayName = String(participant?.display_name ?? participant?.displayName ?? login)
            .trim().replace(/^@+/, '') || login;
          const isViewer = Boolean(viewerLogin) && login === viewerLogin;
          const sources = [
            ...(Array.isArray(participant?.sources) ? participant.sources : []),
            participant?.source,
          ]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter((value, index, values) => (
              ['chat', 'extension'].includes(value) && values.indexOf(value) === index
            ));
          const explicitFirstSource = [
            participant?.registration_source,
            participant?.first_source,
            participant?.source,
          ]
            .map((value) => String(value || '').trim().toLowerCase())
            .find((value) => ['chat', 'extension'].includes(value));
          const sourceTone = explicitFirstSource
            ? explicitFirstSource
            : sources.length > 1
              ? 'mixed'
              : sources[0] === 'chat'
              ? 'chat'
              : sources[0] === 'extension'
                ? 'extension'
                : 'unknown';
          const sourceLabel = explicitFirstSource === 'chat'
            ? 'Chat'
            : explicitFirstSource === 'extension'
              ? 'Extension'
              : sources.length > 1
                ? 'Sources multiples'
            : sourceTone === 'chat'
              ? 'Chat'
              : sourceTone === 'extension'
                ? 'Extension'
                : 'Source inconnue';
          const row = el('li', `jdm-raffle-participants__item${isViewer ? ' jdm-raffle-participants__item--self' : ''}`);
          row.append(
            el('strong', 'jdm-raffle-participants__login', `@${displayName}`),
            el('span', `jdm-raffle-participants__source is-${sourceTone}`, sourceLabel),
          );
          if (isViewer) row.append(el('span', 'jdm-raffle-participants__viewer', '✓ Vous'));
          participantList.append(row);
        }
      }
      participantSection.append(participantHead, participantList, resultZone);
      layout.append(overview, participantSection);
    } else {
      layout.append(overview, resultZone);
    }

    const historyPanel = el('aside', 'jdm-ui-drawer jdm-raffle-history-panel');
    historyPanel.id = 'raffle-history-panel';
    historyPanel.setAttribute('role', 'dialog');
    historyPanel.setAttribute('aria-label', 'Historique des tombolas');
    historyPanel.setAttribute('aria-hidden', String(!raffleHistoryOpen));
    historyPanel.inert = !raffleHistoryOpen;
    historyPanel.classList.toggle('is-screen-fallback', !active);
    historyPanel.classList.toggle('is-open', raffleHistoryOpen);
    const historyHead = el('div', 'jdm-raffle-history-panel__head');
    const historyClose = createIconButton({
      icon: UI_ICONS.close,
      label: 'Fermer l’historique Tombola',
      title: 'Fermer l’historique',
      className: 'jdm-raffle-history__close',
      iconClassName: 'jdm-raffle-history__close-icon',
    });
    historyClose.tabIndex = raffleHistoryOpen ? 0 : -1;
    historyHead.append(
      el('strong', 'jdm-raffle-history-panel__title', `Historique${historyRows.length ? ` · ${historyRows.length}` : ''}`),
      el('span', 'jdm-raffle-history-panel__hint', 'Données fournies par le serveur'),
      historyClose,
    );
    historyPanel.append(historyHead);
    if (!historyRows.length) {
      historyPanel.append(el('p', 'jdm-hint', 'Pas encore d’historique.'));
    } else {
      const historyList = el('ol', 'jdm-raffle-history__list');
      historyList.dataset.scrollKey = 'raffle-history';
      for (const [index, raffleRow] of historyRows.entries()) {
        const entry = el('li', 'jdm-raffle-history__entry');
        entry.dataset.historyIndex = String(index);
        const dateLabel = raffleDateLabel(raffleHistoryDate(raffleRow));
        entry.append(el('strong', 'jdm-raffle-history__entry-title', dateLabel ? `Tombola · ${dateLabel}` : 'Tombola'));
        const rowAmount = raffleAmount(raffleRow);
        const rowCurrency = raffleCurrency(raffleRow);
        if (rowAmount !== null) {
          entry.append(el('span', 'jdm-raffle-history__pot', `Pot : ${fmt(rowAmount)}${rowCurrency ? ` ${rowCurrency}` : ''}`));
        }
        const winners = el('ul', 'jdm-raffle-history__winners');
        const winnerRows = Array.isArray(raffleRow?.winners) ? raffleRow.winners : [];
        for (const winner of winnerRows) {
          const login = String(winner?.display_name ?? winner?.displayName ?? winner?.login ?? '')
            .trim().replace(/^@+/, '');
          if (!login) continue;
          const amount = raffleAmount(winner);
          const currency = raffleCurrency(winner) || rowCurrency;
          winners.append(el('li', 'jdm-raffle-history__winner', `@${login}${amount === null ? '' : ` · ${fmt(amount)}${currency ? ` ${currency}` : ''}`}`));
        }
        if (!winners.children.length) winners.append(el('li', 'jdm-raffle-history__winner jdm-raffle-history__winner--unknown', 'Résultat non communiqué'));
        entry.append(winners);
        historyList.append(entry);
      }
      historyPanel.append(historyList);
    }

    historyToggle.addEventListener('click', () => {
      raffleHistoryOpen = !raffleHistoryOpen;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector(raffleHistoryOpen
        ? '.jdm-raffle-history__close'
        : '.jdm-raffle-history-toggle')?.focus({ preventScroll: true }));
    });
    historyClose.addEventListener('click', () => {
      raffleHistoryOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-raffle-history-toggle')?.focus({ preventScroll: true }));
    });

    screen.append(layout);
    const historyFooter = el('footer', 'jdm-raffle-footer');
    historyFooter.append(historyToggle);
    screen.append(historyFooter, historyPanel);

    body.append(screen);
  }

  function moderationForm() {
    const moderation = state?.moderation?.tts;
    if (!moderation?.can_moderate) return null;
    const section = el('section', 'jdm-moderation jdm-moderation--screen');
    section.setAttribute('aria-label', 'Console de modération');
    const subnav = el('nav', 'jdm-moderation__subnav');
    subnav.setAttribute('aria-label', 'Sous-modules de modération');
    subnav.setAttribute('role', 'tablist');
    const submodules = [
      ['tts', '🚨', 'TTS urgence'],
      ['history', '🕘', 'Historique'],
      ['users', '👤', 'Utilisateurs'],
      ['modules', '◫', 'Modules'],
    ];
    for (const [id, icon, label] of submodules) {
      const selected = moderationSubmodule === id;
      const tab = el('button', `jdm-btn jdm-moderation__tab${selected ? ' jdm-btn--primary' : ''}`);
      tab.type = 'button';
      tab.dataset.submodule = id;
      tab.id = `moderation-tab-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('aria-controls', 'moderation-panel');
      tab.setAttribute('aria-label', label);
      tab.title = label;
      const iconNode = el('span', 'jdm-moderation__tab-icon', icon);
      iconNode.setAttribute('aria-hidden', 'true');
      tab.append(iconNode, el('span', 'jdm-moderation__tab-label', label));
      tab.addEventListener('click', () => {
        moderationSubmodule = id;
        if (id !== 'users') moderationUserHistoryOpen = false;
        renderPreservingViewport();
      });
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const currentIndex = submodules.findIndex(([submoduleId]) => submoduleId === id);
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? submodules.length - 1
            : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + submodules.length) % submodules.length;
        const nextId = submodules[nextIndex][0];
        const nextTab = subnav.querySelector(`[data-submodule="${nextId}"]`);
        if (nextId === id) {
          nextTab?.focus({ preventScroll: true });
          return;
        }
        nextTab?.click();
        root.querySelector(`[data-submodule="${nextId}"]`)?.focus({ preventScroll: true });
      });
      subnav.append(tab);
    }
    const content = el('div', 'jdm-moderation__subpanel');
    content.dataset.scrollKey = 'module-moderation';
    content.id = 'moderation-panel';
    content.setAttribute('role', 'tabpanel');
    content.setAttribute('aria-labelledby', `moderation-tab-${moderationSubmodule}`);
    const ttsPanel = el('div', 'jdm-moderation__tts');
    const pending = moderation.pending ?? [];
    const ttsStateLabel = moderation.paused ? 'En pause' : 'Actif';
    const ttsState = el('div', 'jdm-moderation__tts-status', `${ttsStateLabel} · ${pending.length} en attente`);
    ttsState.setAttribute('role', 'status');
    ttsState.setAttribute('aria-label', `État global du TTS : ${ttsStateLabel} · ${pending.length} en attente`);

    const controls = el('div', 'jdm-moderation__controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Commandes TTS');
    const pause = el('button', 'jdm-btn', moderation.paused ? 'Reprendre le TTS' : 'Pause TTS');
    pause.type = 'button';
    pause.addEventListener('click', () => runModerationControl(section, () => (
      moderation.paused
        ? client.resumeTts?.() ?? moderationAction('setTtsModeration', { paused: false })
        : client.pauseTts?.() ?? moderationAction('setTtsModeration', { paused: true })
    ), {
      action: moderation.paused ? 'resume' : 'pause',
      acceptedMessage: moderation.paused ? 'Reprise demandée…' : 'Pause demandée…',
      successMessage: moderation.paused ? 'TTS repris ✓' : 'TTS en pause ✓',
    }));
    const stop = el('button', 'jdm-btn jdm-btn--danger', 'Stop TTS');
    stop.type = 'button';
    stop.addEventListener('click', () => runModerationControl(section,
      () => client.stopTts?.() ?? moderationAction('stopTts'),
      { action: 'stop', acceptedMessage: 'Arrêt demandé…', successMessage: 'TTS arrêté ✓' }));
    const purge = el('button', 'jdm-btn jdm-btn--danger', 'Purger la file');
    purge.type = 'button';
    purge.addEventListener('click', () => runModerationControl(section,
      () => client.purgeTts?.() ?? moderationAction('purgeTts'),
      { action: 'purge', acceptedMessage: 'Purge demandée…', successMessage: 'File TTS purgée ✓' }));
    controls.append(pause, stop, purge);
    ttsPanel.append(ttsState, controls);

    if (!pending.length) {
      ttsPanel.append(el('p', 'jdm-hint', 'Aucun TTS en attente.'));
    } else {
      const list = el('div', 'jdm-moderation__list');
      for (const item of pending) {
        const card = el('article', 'jdm-moderation__item');
        card.append(
          el('strong', 'jdm-moderation__viewer', `@${item.login}`),
          el('p', 'jdm-moderation__text', item.text),
        );
        const actions = el('div', 'jdm-moderation__actions');
        actions.setAttribute('role', 'group');
        actions.setAttribute('aria-label', `Actions TTS pour @${item.login}`);
        const approve = el('button', 'jdm-btn jdm-btn--primary', 'Lire');
        approve.type = 'button';
        approve.addEventListener('click', () => run(card, () => moderationAction(
          'decideTtsSubmission', item.submission_id, 'approve',
        )));
        const reject = el('button', 'jdm-btn', 'Refuser');
        reject.type = 'button';
        reject.addEventListener('click', () => run(card, () => moderationAction(
          'decideTtsSubmission', item.submission_id, 'reject',
        )));
        const ban = el('button', 'jdm-btn jdm-btn--danger', 'Bloquer');
        ban.type = 'button';
        ban.addEventListener('click', () => run(card, () => {
          if (typeof client?.rejectAndBanTtsSubmission !== 'function') {
            return Promise.reject(Object.assign(new Error('moderation_atomic_unavailable'), {
              code: 'moderation_atomic_unavailable',
            }));
          }
          return client.rejectAndBanTtsSubmission(item.submission_id, {
            reason: 'Blocage depuis l’extension',
          });
        }, { success: 'Demande refusée et utilisateur bloqué ✓' }));
        actions.append(approve, reject, ban);
        card.append(actions);
        list.append(card);
      }
      ttsPanel.append(list);
    }

    if (moderationSubmodule === 'tts') content.append(ttsPanel);
    if (moderationSubmodule === 'history') content.append(moderationHistoryPanel() ?? moderatorActivityHistory());
    if (moderationSubmodule === 'users') content.append(moderationUsersPanel());
    if (moderationSubmodule === 'modules') content.append(moderationModulesPanel());
    section.append(subnav, content);
    return section;
  }

  function tutorialDialog(tutorial) {
    const index = Math.min(Math.max(0, tutorialStep), tutorial.steps.length - 1);
    tutorialStep = index;
    const step = tutorial.steps[index];
    const overlay = el('div', 'jdm-tour');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'jdm-tour-title');

    const card = el('section', 'jdm-tour__card');
    const top = el('div', 'jdm-tour__top');
    top.append(
      el('span', 'jdm-tour__count', `${index + 1}/${tutorial.steps.length}`),
    );
    const skip = el('button', 'jdm-tour__skip', 'Passer');
    skip.type = 'button';
    skip.addEventListener('click', () => {
      tutorialOpen = false;
      render();
    });
    top.append(skip);

    const icon = el('span', 'jdm-tour__icon', step.icon);
    icon.setAttribute('aria-hidden', 'true');
    const kicker = step.kicker ? el('p', 'jdm-tour__kicker', step.kicker) : null;
    const title = el('h2', 'jdm-tour__title', step.title);
    title.id = 'jdm-tour-title';
    const heading = el('div', 'jdm-tour__heading');
    const headingCopy = el('div', 'jdm-tour__heading-copy');
    if (kicker) headingCopy.append(kicker);
    headingCopy.append(title);
    heading.append(icon, headingCopy);
    const copy = el('p', 'jdm-tour__copy', step.body);
    const highlights = el('div', 'jdm-tour__highlights');
    for (const highlight of step.highlights ?? []) {
      const chip = el('span', 'jdm-tour__highlight', highlight.label);
      chip.dataset.tone = highlight.tone ?? 'violet';
      highlights.append(chip);
    }
    const command = step.command ? el('code', 'jdm-tour__command', step.command) : null;

    const identityAction = step.action === 'identity'
      ? el(
        'button',
        'jdm-btn jdm-btn--primary jdm-tour__identity',
        state?.identity_shared !== true
          ? 'Partager mon identité Twitch'
          : state?.emotes?.twitch_connected
            ? 'Emotes déjà autorisées'
            : 'Autoriser mes emotes Twitch',
      )
      : null;
    if (identityAction) {
      identityAction.type = 'button';
      identityAction.disabled = Boolean(state?.emotes?.twitch_connected);
      identityAction.addEventListener('click', () => {
        if (state?.emotes?.twitch_connected) return;
        beginEmoteAuthorization(card);
      });
    }

    const remember = el('label', 'jdm-tour__remember');
    const rememberInput = document.createElement('input');
    rememberInput.type = 'checkbox';
    rememberInput.checked = tutorialDisabled;
    rememberInput.addEventListener('change', () => {
      tutorialDisabled = rememberInput.checked;
      writeTutorialDisabled(tutorial, tutorialDisabled);
    });
    remember.append(rememberInput, el('span', null, 'Ne plus afficher au lancement'));

    const dots = el('div', 'jdm-tour__dots');
    dots.setAttribute('aria-hidden', 'true');
    for (let dot = 0; dot < tutorial.steps.length; dot += 1) {
      const marker = el('span', 'jdm-tour__dot');
      if (dot === index) marker.classList.add('is-active');
      dots.append(marker);
    }

    const controls = el('div', 'jdm-tour__controls');
    const previous = el('button', 'jdm-btn', 'Précédent');
    previous.type = 'button';
    previous.disabled = index === 0;
    previous.addEventListener('click', () => {
      tutorialStep = Math.max(0, index - 1);
      render();
    });
    const last = index === tutorial.steps.length - 1;
    const next = el('button', 'jdm-btn jdm-btn--primary', last ? 'Terminer' : 'Suivant');
    next.type = 'button';
      next.addEventListener('click', () => {
      if (last) {
        tutorialOpen = false;
        tutorialStep = 0;
      } else {
        tutorialStep = index + 1;
      }
      render();
    });
    controls.append(previous, next);
    card.append(top, heading, copy);
    if (highlights.childElementCount) card.append(highlights);
    if (command) card.append(command);
    if (identityAction) card.append(identityAction);
    card.append(dots, remember, controls);
    overlay.append(card);
    overlay.addEventListener('click', (event) => {
      if (event.target !== overlay) return;
      tutorialOpen = false;
      render();
    });
    return overlay;
  }

  function historyCost(row) {
    if (row?.cost == null || !Number.isFinite(Number(row.cost))) return '';
    const units = {
      channelpoints: 'PDC',
      jetons: 'jetons',
    };
    const unit = units[row.currency] || String(row.currency || 'unités');
    return `${fmt(row.cost)} ${unit}`;
  }

  function historyIdentity(row) {
    const login = String(row?.login ?? '').trim().replace(/^@+/, '');
    const viewer = String(state?.viewer_login ?? '').trim().replace(/^@+/, '');
    if (!login || (viewer && login.toLowerCase() === viewer.toLowerCase())) return '';
    return `@${login} · `;
  }

  function historyActionIcon(action) {
    return ({ tts: '💬', soundboard: '🔊', bonk: '🔨' })[String(action || '').toLowerCase()] || '✦';
  }

  function historyQuantity(row) {
    const quantity = Number(row?.quantity ?? row?.count);
    return Number.isFinite(quantity) && quantity > 1 ? ` ×${fmt(quantity)}` : '';
  }

  function personalHistory() {
    const section = el('section', 'jdm-history');
    section.setAttribute('aria-label', 'Mes actions');
    const head = el('div', 'jdm-history__head');
    head.append(el('strong', 'jdm-history__title', 'Mes actions'));
    section.append(head);
    const receipts = Array.isArray(state?.action_receipts) ? state.action_receipts : [];
    const receiptIds = new Set(receipts.map((row) => String(row.id || '')));
    const playedHistory = (Array.isArray(state?.recent_activity) ? state.recent_activity : [])
      .filter((row) => !receiptIds.has(String(row.id || '')))
      .map((row) => ({ ...row, status: 'played' }));
    const rows = [...receipts, ...playedHistory]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    if (!rows.length) {
      section.append(el('p', 'jdm-hint', 'Aucune interaction enregistrée pour le moment.'));
      return section;
    }
    const labels = { tts: 'TTS', soundboard: 'Soundboard', bonk: 'Bonk' };
    const statusLabels = {
      queued: 'En file · en attente de SAMMI',
      processing: 'Transmis à SAMMI',
      accepted: 'Acceptée · en attente du bridge',
      dispatched: 'Transmise à SAMMI',
      executed: 'Exécutée',
      enabled: 'Activé',
      disabled: 'Désactivé',
      failed: 'Échec d’exécution',
      timeout: 'Délai dépassé · exécution non confirmée',
      uncertain: 'Exécution non confirmée',
      no_active: 'Aucun TTS actif',
      played: 'Joué',
      refunded: 'Remboursé',
      refund_pending: 'Remboursement en cours',
      failed_no_charge: 'Échec — aucun jeton perdu',
      credit_restored: 'Crédit restauré — réessaie',
      review: 'Vérification nécessaire',
    };
    const statusShortLabels = {
      queued: 'En file',
      processing: 'Envoi',
      accepted: 'Acceptée',
      dispatched: 'Transmise',
      executed: 'Exécutée',
      enabled: 'Activé',
      disabled: 'Désactivé',
      failed: 'Échec',
      timeout: 'Délai',
      uncertain: 'Incertain',
      no_active: 'Aucun actif',
      played: 'Joué',
      refunded: 'Remboursé',
      refund_pending: 'Rembours.',
      failed_no_charge: 'Échec · 0 perdu',
      credit_restored: 'Crédit restauré',
      review: 'Vérif.',
    };
    const list = el('ol', 'jdm-history__list');
    for (const row of rows.slice(0, 20)) {
      const status = statusLabels[row.status] ? row.status : 'review';
      const item = el('li', `jdm-history__item is-${status}`);
      const actionId = String(row.action || '').toLowerCase();
      const action = labels[actionId] || row.label || 'Interaction';
      const detail = row.action === 'tts' || row.action === 'TTS'
        ? ''
        : String(row.detail || '').trim();
      const identity = historyIdentity(row);
      const quantity = historyQuantity(row);
      const targetLogin = String(row.target_login ?? '').trim().replace(/^@+/, '');
      const target = targetLogin ? ` → @${targetLogin}` : '';
      const cost = historyCost(row);
      const date = new Date(row.created_at || 0);
      const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const summary = `${identity}${detail || action}${quantity}${target}`;
      const icon = el('span', 'jdm-history__icon', historyActionIcon(actionId));
      icon.setAttribute('aria-hidden', 'true');
      const actionNode = el('strong', 'jdm-history__action', summary);
      const statusNode = el('span', 'jdm-history__status', statusShortLabels[status]);
      statusNode.title = statusLabels[status];
      statusNode.setAttribute('aria-label', statusLabels[status]);
      const timeNode = el('time', 'jdm-history__when', when);
      if (when) timeNode.dateTime = date.toISOString();
      item.setAttribute('aria-label', [summary, cost, statusLabels[status], when].filter(Boolean).join(' · '));
      item.title = item.getAttribute('aria-label');
      item.append(icon, actionNode);
      if (cost) item.append(el('span', 'jdm-history__cost', cost));
      item.append(statusNode, timeNode);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  const moderationHistoryStatusLabels = Object.freeze({
    queued: 'En file · en attente de SAMMI',
    processing: 'Transmis à SAMMI',
    accepted: 'Acceptée · en attente du bridge',
    dispatched: 'Transmise à SAMMI',
    executed: 'Exécutée',
    enabled: 'Activé',
    disabled: 'Désactivé',
    failed: 'Échec d’exécution',
    timeout: 'Délai dépassé · exécution non confirmée',
    uncertain: 'Exécution non confirmée',
    no_active: 'Aucun TTS actif',
    played: 'Joué',
    refunded: 'Remboursé',
    refund_pending: 'Remboursement en cours',
    failed_no_charge: 'Échec — aucun jeton perdu',
    credit_restored: 'Crédit restauré — réessaie',
    review: 'Vérification nécessaire',
  });
  const moderationHistoryStatusShortLabels = Object.freeze({
    queued: 'En file',
    processing: 'Envoi',
    accepted: 'Acceptée',
    dispatched: 'Transmise',
    executed: 'Exécutée',
    enabled: 'Activé',
    disabled: 'Désactivé',
    failed: 'Échec',
    timeout: 'Délai',
    uncertain: 'Incertain',
    no_active: 'Aucun actif',
    played: 'Joué',
    refunded: 'Remboursé',
    refund_pending: 'Rembours.',
    failed_no_charge: 'Échec · 0 perdu',
    credit_restored: 'Crédit restauré',
    review: 'Vérif.',
  });

  function moderationHistoryRow(row, fallbackStatus = 'played') {
    const requestedStatus = String(row?.status || fallbackStatus).trim().toLowerCase();
    const status = moderationHistoryStatusLabels[requestedStatus] ? requestedStatus : fallbackStatus;
    const actionId = String(row?.action || '').trim().toLowerCase();
    const actionLabel = String(row?.label || ({
      tts: 'TTS',
      soundboard: 'Soundboard',
      bonk: 'Bonk',
    })[actionId] || 'Interaction');
    const login = String(row?.login || '').trim().replace(/^@+/, '');
    const identity = login ? `@${login}` : '';
    const detail = actionId === 'tts' ? '' : String(row?.detail || '').trim();
    const targetLogin = String(row?.target_login || '').trim().replace(/^@+/, '');
    const quantity = historyQuantity(row);
    const summaryParts = [identity, actionLabel, detail].filter(Boolean);
    let summary = summaryParts.join(' · ') || 'Interaction';
    if (quantity) summary += quantity;
    if (targetLogin) summary += ` → @${targetLogin}`;
    const cost = historyCost(row);
    const statusLabel = moderationHistoryStatusLabels[status];
    const date = new Date(row?.created_at || 0);
    const when = Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const item = el('li', `jdm-history__item is-${status}`);
    const icon = el('span', 'jdm-history__icon', historyActionIcon(actionId));
    icon.setAttribute('aria-hidden', 'true');
    const copy = el('span', 'jdm-history__copy');
    copy.append(el('strong', 'jdm-history__action', summary));
    const statusNode = el('span', 'jdm-history__status', moderationHistoryStatusShortLabels[status]);
    statusNode.title = statusLabel;
    statusNode.setAttribute('aria-label', statusLabel);
    const timeNode = el('time', 'jdm-history__when', when);
    if (when) timeNode.dateTime = date.toISOString();
    const accessibleSummary = [summary, cost, statusLabel, when].filter(Boolean).join(' · ');
    item.setAttribute('aria-label', accessibleSummary);
    item.title = accessibleSummary;
    item.append(icon, copy);
    if (cost) item.append(el('span', 'jdm-history__cost', cost));
    item.append(statusNode, timeNode);
    return item;
  }

  function moderatorActivityHistory() {
    const activity = state?.moderation?.activity;
    if (!activity?.can_view) return null;
    const rows = Array.isArray(activity.items) ? activity.items : [];
    const details = el('details', 'jdm-mod-history');
    details.open = true;
    const summary = el('summary', 'jdm-mod-history__summary', `Historique du stream · modération${rows.length ? ` · ${rows.length}` : ''}`);
    details.append(summary);
    if (!rows.length) {
      details.append(el('p', 'jdm-hint', 'Aucune interaction globale enregistrée.'));
      return details;
    }
    const list = el('ol', 'jdm-history__list jdm-mod-history__list');
    list.setAttribute('aria-label', 'Historique du stream');
    for (const row of rows.slice(0, 20)) list.append(moderationHistoryRow(row));
    details.append(list);
    return details;
  }

  function moderationHistoryPanel() {
    const history = state?.moderation?.history ?? state?.moderation?.activity;
    if (!history?.can_view) return null;
    const details = el('details', 'jdm-mod-history jdm-mod-history--panel');
    details.open = true;
    const rows = Array.isArray(history.items) ? history.items : [];
    details.setAttribute('aria-label', 'Historique de modération');
    details.append(el('summary', 'jdm-mod-history__summary', `Historique${rows.length ? ` · ${rows.length}` : ''}`));
    const filters = el('div', 'jdm-mod-history__filters');
    filters.setAttribute('role', 'search');
    filters.setAttribute('aria-label', 'Filtres de l’historique');
    const query = el('input', 'jdm-input jdm-mod-history__query');
    query.type = 'search';
    query.placeholder = 'Viewer / cible';
    query.value = moderationHistoryQuery;
    query.dataset.draftKey = 'moderation-history-query';
    query.addEventListener('input', () => {
      moderationHistoryQuery = query.value;
    });
    query.setAttribute('aria-label', 'Rechercher dans l’historique');
    const module = document.createElement('select');
    module.className = 'jdm-input jdm-mod-history__select';
    module.setAttribute('aria-label', 'Filtrer par module');
    for (const option of [['', 'Tous les modules'], ['tts', 'TTS'], ['soundboard', 'Soundboard'], ['bonk', 'Bonk']]) {
      const node = document.createElement('option');
      node.value = option[0];
      node.textContent = option[1];
      node.selected = moderationHistoryModule === option[0];
      module.append(node);
    }
    const status = document.createElement('select');
    status.className = 'jdm-input jdm-mod-history__select';
    status.setAttribute('aria-label', 'Filtrer par statut');
    for (const option of [['', 'Tous les statuts'], ['accepted', 'Acceptée'], ['queued', 'En file'], ['dispatched', 'Transmise'], ['processing', 'En traitement'], ['executed', 'Exécutée'], ['no_active', 'Aucun TTS actif'], ['failed', 'Échec'], ['timeout', 'Délai dépassé'], ['uncertain', 'Non confirmée'], ['played', 'Joué'], ['refund_pending', 'Remboursement en cours'], ['refunded', 'Remboursé'], ['failed_no_charge', 'Échec sans débit'], ['credit_restored', 'Crédit restauré'], ['review', 'Vérification nécessaire']]) {
      const node = document.createElement('option');
      node.value = option[0];
      node.textContent = option[1];
      node.selected = moderationHistoryStatus === option[0];
      status.append(node);
    }
    module.addEventListener('change', () => {
      moderationHistoryModule = module.value;
    });
    status.addEventListener('change', () => {
      moderationHistoryStatus = status.value;
    });
    const reload = el('button', 'jdm-btn', 'Filtrer');
    reload.type = 'button';
    reload.addEventListener('click', () => {
      moderationHistoryQuery = query.value;
      moderationHistoryModule = module.value;
      moderationHistoryStatus = status.value;
      run(details, () => client.moderationHistory?.({
        query: moderationHistoryQuery.trim(),
        module_id: moderationHistoryModule,
        status: moderationHistoryStatus,
      }) ?? Promise.resolve(history), {
        success: '',
        onSuccess: (result) => {
          if (result?.items) {
            state.moderation.history = result;
          }
        },
      });
    });
    filters.append(query, module, status, reload);
    details.append(filters);
    const filtered = rows.filter((row) => {
      const wanted = moderationHistoryQuery.trim().toLowerCase();
      const text = [row.login, row.target_login, row.action, row.detail].join(' ').toLowerCase();
      return (!wanted || text.includes(wanted))
        && (!moderationHistoryModule || row.action === moderationHistoryModule)
        && (!moderationHistoryStatus || row.status === moderationHistoryStatus);
    });
    if (!filtered.length) {
      details.append(el('p', 'jdm-hint', 'Aucune interaction pour ces filtres.'));
      return details;
    }
    const list = el('ol', 'jdm-history__list jdm-mod-history__list');
    list.setAttribute('aria-label', 'Historique de modération');
    for (const row of filtered.slice(0, 50)) list.append(moderationHistoryRow(row));
    details.append(list);
    return details;
  }

  function moderationUserHistoryRows(selected) {
    const profileRows = Array.isArray(selected?.audit)
      ? selected.audit
      : Array.isArray(selected?.history)
        ? selected.history
        : null;
    if (profileRows?.length) return profileRows;

    const selectedId = String(selected?.twitch_user_id || '');
    const selectedLogin = String(selected?.login || '').trim().toLowerCase();
    return (state?.moderation?.history?.items ?? []).filter((row) => (
      (selectedId && String(row?.twitch_user_id || '') === selectedId)
        || (selectedLogin && String(row?.login || '').trim().toLowerCase() === selectedLogin)
    ));
  }

  function moderationUserHistoryPanel(selected) {
    const login = String(selected?.login || selected?.twitch_user_id || '').trim();
    const panel = el('aside', 'jdm-mod-user-history');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `Historique de @${login}`);
    const head = el('div', 'jdm-mod-user-history__head');
    head.append(el('strong', 'jdm-mod-user-history__title', `Historique · @${login}`));
    const close = el('button', 'jdm-btn jdm-mod-user-history__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer l’historique utilisateur');
    close.title = 'Fermer l’historique utilisateur';
    close.addEventListener('click', () => {
      moderationUserHistoryOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-mod-user-history-toggle')?.focus({ preventScroll: true }));
    });
    head.append(close);
    panel.append(head);

    const rows = moderationUserHistoryRows(selected);
    if (!rows.length) {
      panel.append(el('p', 'jdm-mod-user-history__empty', 'Aucune interaction enregistrée pour cet utilisateur.'));
      return panel;
    }
    const list = el('ol', 'jdm-history__list jdm-mod-user-history__list');
    list.dataset.scrollKey = 'moderation-user-history';
    list.setAttribute('aria-label', `Historique de @${login}`);
    for (const row of rows.slice(0, 30)) list.append(moderationHistoryRow(row));
    panel.append(list);
    return panel;
  }

  function moderationModulesForUser(selected) {
    const source = Array.isArray(selected?.suspendable_modules)
      ? selected.suspendable_modules
      : Array.isArray(state?.moderation?.suspendable_modules)
        ? state.moderation.suspendable_modules
        : (state?.modules ?? []);
    const seen = new Set();
    return source
      .map((module) => ({
        id: String(module?.id || '').trim(),
        label: String(module?.label || module?.id || '').trim(),
        icon: String(module?.icon || '').trim(),
      }))
      .filter((module) => module.id && module.label && !seen.has(module.id) && seen.add(module.id));
  }

  function moderationSuspensionsForUser(selected) {
    if (Array.isArray(selected?.suspensions)) return selected.suspensions.filter(Boolean);
    return selected?.suspension ? [selected.suspension] : [];
  }

  function moderationSuspensionForModule(moduleId, rows) {
    return rows.find((row) => String(row?.module_id || '') === String(moduleId))
      ?? rows.find((row) => !row?.module_id || row.module_id === '*')
      ?? null;
  }

  function moderationSuspensionExpiryLabel(row) {
    if (!row) return '';
    const raw = row.expires_at;
    if (raw === null || raw === undefined || raw === '') return 'indéfini';
    const timestamp = typeof raw === 'number' || /^\d+$/.test(String(raw))
      ? Number(raw)
      : Date.parse(String(raw));
    if (!Number.isFinite(timestamp)) return 'expiration inconnue';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'expiration inconnue';
    return `jusqu’à ${date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  function moderationCustomDurationSelection(value, unit) {
    const rawValue = String(value ?? '').trim();
    const multiplier = new Map([
      ['seconds', 1000],
      ['minutes', 60_000],
      ['hours', 3_600_000],
      ['days', 86_400_000],
    ]).get(String(unit));
    if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(Number(rawValue)) || !multiplier) return null;
    const amount = Number(rawValue);
    const durationMs = amount * multiplier;
    if (!Number.isSafeInteger(durationMs)
      || durationMs < moderationCustomDurationMinMs
      || durationMs > moderationCustomDurationMaxMs) return null;
    const unitLabel = moderationSuspensionDurationUnits.find(([candidate]) => candidate === String(unit))?.[1];
    const singular = {
      seconds: 'seconde',
      minutes: 'minute',
      hours: 'heure',
      days: 'jour',
    }[String(unit)];
    return {
      durationMs,
      label: `${amount} ${amount === 1 ? singular : unitLabel}`,
    };
  }

  function moderationSuspensionDurationSelection(value, customValue, customUnit) {
    const normalized = String(value);
    if (normalized === '') return { durationMs: null, label: 'Indéfinie' };
    if (normalized === 'custom') return moderationCustomDurationSelection(customValue, customUnit);
    const preset = moderationSuspensionDurationOptions.find(([candidate]) => candidate === normalized);
    if (!preset) return null;
    return { durationMs: Number(preset[0]), label: preset[1] };
  }

  function moderationSuspensionDurationLabel(value, customValue, customUnit) {
    return moderationSuspensionDurationSelection(value, customValue, customUnit)?.label
      ?? 'durée personnalisée';
  }

  function moderationModuleLabels(moduleIds, modules) {
    const labels = new Map(modules.map((module) => [module.id, module.label]));
    return moduleIds.map((moduleId) => labels.get(moduleId) || moduleId);
  }

  async function refreshModerationUserProfile(userId) {
    if (typeof client?.moderationUserProfile !== 'function') return null;
    try {
      const result = await client.moderationUserProfile(userId);
      if (!result?.user) return null;
      moderationSelectedUser = result.user;
      state.moderation ??= {};
      state.moderation.selected_user = result.user;
      return result.user;
    } catch {
      // L'action est déjà confirmée. Le prochain polling ou l'ouverture de la
      // fiche reprendra la source serveur sans transformer ce succès en erreur.
      return null;
    }
  }

  function moderationUsersPanel() {
    const panel = el('section', 'jdm-mod-users');
    panel.setAttribute('aria-label', 'Gestion des utilisateurs');
    const searchRow = el('div', 'jdm-mod-history__filters jdm-mod-users__search');
    searchRow.setAttribute('role', 'search');
    searchRow.setAttribute('aria-label', 'Rechercher un utilisateur');
    const query = el('input', 'jdm-input');
    query.type = 'search';
    query.placeholder = 'Login / ID Twitch';
    query.value = moderationUsersQuery;
    query.dataset.draftKey = 'moderation-users-query';
    query.addEventListener('input', () => {
      moderationUsersQuery = query.value;
    });
    query.setAttribute('aria-label', 'Rechercher un utilisateur');
    const search = el('button', 'jdm-btn jdm-mod-users__search-button', 'Rechercher');
    search.type = 'button';
    search.setAttribute('aria-label', 'Rechercher cet utilisateur');
    search.addEventListener('click', () => run(panel, () => moderationAction('moderationUsers', query.value.trim()), {
      success: '',
      onSuccess: (result) => {
        moderationUsersQuery = query.value;
        moderationUsers = Array.isArray(result?.items) ? result.items : [];
        state.moderation.users = moderationUsers;
      },
    }));
    searchRow.append(query, search);
    panel.append(searchRow);
    const users = Array.isArray(moderationUsers)
      ? moderationUsers
      : (state?.moderation?.users ?? []);
    const selected = moderationSelectedUser ?? state?.moderation?.selected_user;
    const list = el('div', 'jdm-mod-users__list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Résultats utilisateurs');
    if (!users.length) {
      list.append(el('p', 'jdm-mod-users__empty', moderationUsersQuery.trim()
        ? 'Aucun utilisateur trouvé.'
        : 'Saisis un login ou un ID Twitch.'));
    }
    for (const user of users.slice(0, 20)) {
      const label = `@${user.login || user.twitch_user_id}`;
      const button = el('button', 'jdm-btn jdm-mod-users__user', label);
      button.type = 'button';
      button.classList.toggle('is-selected', String(selected?.twitch_user_id || '') === String(user.twitch_user_id || ''));
      button.setAttribute('aria-label', `Ouvrir le profil de ${label}`);
      button.title = `Ouvrir le profil de ${label}`;
      button.addEventListener('click', () => run(panel, () => moderationAction('moderationUserProfile', user.twitch_user_id), {
        success: '',
        onSuccess: (result) => {
          moderationSelectedUser = result?.user ?? user;
          state.moderation.selected_user = moderationSelectedUser;
          moderationUserHistoryOpen = false;
        },
      }));
      list.append(button);
    }
    panel.append(list);
    const selectedId = String(selected?.twitch_user_id || '');
    if (selectedId !== moderationSuspensionSelectionUserId) {
      moderationSuspensionSelectionUserId = selectedId;
      moderationSuspendSelection.clear();
      moderationUnsuspendSelection.clear();
    }
    const availableModules = moderationModulesForUser(selected);
    const availableModuleIds = new Set(availableModules.map((module) => module.id));
    for (const moduleId of moderationSuspendSelection) {
      if (!availableModuleIds.has(moduleId)) moderationSuspendSelection.delete(moduleId);
    }
    const suspensionRows = moderationSuspensionsForUser(selected);
    const activeModules = availableModules.filter((module) => moderationSuspensionForModule(module.id, suspensionRows));
    const activeModuleIds = new Set(activeModules.map((module) => module.id));
    for (const moduleId of moderationUnsuspendSelection) {
      if (!activeModuleIds.has(moduleId)) moderationUnsuspendSelection.delete(moduleId);
    }
    if (selected) {
      const card = el('div', 'jdm-mod-user-card');
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', `Actions pour @${selected.login || selected.twitch_user_id}`);
      const balance = Number(selected.credits?.soundboard || 0);
      const suspensionLabel = activeModules.length
        ? `${activeModules.length} module${activeModules.length > 1 ? 's' : ''} suspendu${activeModules.length > 1 ? 's' : ''}`
        : 'Aucune suspension active';
      const identity = el('div', 'jdm-mod-user-card__identity');
      identity.append(
        el('span', 'jdm-mod-user-card__avatar', '👤'),
        el('strong', 'jdm-mod-user-card__login', `@${selected.login || selected.twitch_user_id}`),
      );
      const statusNode = el('span', 'jdm-hint jdm-mod-user-card__status', suspensionLabel);
      statusNode.dataset.state = activeModules.length ? 'suspended' : 'active';
      card.append(
        identity,
        el('span', 'jdm-hint', `${balance} crédit${balance > 1 ? 's' : ''} Soundboard`),
        statusNode,
      );
      if (selected.tts_banned) {
        const banStatus = el('span', 'jdm-hint jdm-mod-user-card__tts-ban', 'TTS bloqué');
        banStatus.dataset.state = 'banned';
        const unban = el('button', 'jdm-btn jdm-btn--secondary jdm-mod-user-card__unban', 'Débloquer le TTS');
        unban.type = 'button';
        unban.setAttribute('aria-label', `Débloquer le TTS pour @${selected.login || selected.twitch_user_id}`);
        unban.addEventListener('click', () => {
          if (typeof client?.unbanTtsViewer !== 'function') return;
          return run(card, () => client.unbanTtsViewer(selected.twitch_user_id), {
            success: `TTS débloqué pour @${selected.login || selected.twitch_user_id} ✓`,
            onSuccess: async () => {
              selected.tts_banned = false;
              await refreshModerationUserProfile(selected.twitch_user_id);
            },
          });
        });
        card.append(banStatus, unban);
      }
      const delta = el('input', 'jdm-input');
      delta.type = 'number';
      delta.min = '1';
      delta.value = '1';
      delta.step = '1';
      delta.setAttribute('aria-label', 'Nombre de crédits Soundboard à ajuster');
      const adjustmentAmount = () => {
        const amount = Math.trunc(Number(delta.value));
        if (!Number.isFinite(amount) || amount < 1) {
          flash(card, 'Indique au moins 1 crédit.', 'error');
          return null;
        }
        return amount;
      };
      const suspensionDuration = document.createElement('select');
      suspensionDuration.className = 'jdm-input';
      suspensionDuration.setAttribute('aria-label', 'Durée de la suspension');
      for (const option of moderationSuspensionDurationOptions) {
        const node = document.createElement('option');
        node.value = option[0];
        node.textContent = option[1];
        node.selected = option[0] === moderationSuspensionDuration;
        suspensionDuration.append(node);
      }
      suspensionDuration.value = moderationSuspensionDuration;
      const customDurationValue = document.createElement('input');
      customDurationValue.className = 'jdm-input';
      customDurationValue.type = 'number';
      customDurationValue.min = '1';
      customDurationValue.step = '1';
      customDurationValue.inputMode = 'numeric';
      customDurationValue.value = moderationSuspensionCustomValue;
      customDurationValue.setAttribute('aria-label', 'Valeur de la durée personnalisée');
      const customDurationUnit = document.createElement('select');
      customDurationUnit.className = 'jdm-input';
      customDurationUnit.setAttribute('aria-label', 'Unité de la durée personnalisée');
      for (const option of moderationSuspensionDurationUnits) {
        const node = document.createElement('option');
        node.value = option[0];
        node.textContent = option[1];
        node.selected = option[0] === moderationSuspensionCustomUnit;
        customDurationUnit.append(node);
      }
      customDurationUnit.value = moderationSuspensionCustomUnit;
      const customDurationFields = el('div', 'jdm-mod-user-card__custom-duration');
      customDurationFields.append(customDurationValue, customDurationUnit);
      const suspensionDurationControls = el('div', 'jdm-mod-user-card__duration-controls');
      suspensionDurationControls.append(suspensionDuration, customDurationFields);
      const syncDurationControls = () => {
        const isCustom = suspensionDuration.value === 'custom';
        const multiplier = new Map([
          ['seconds', 1000],
          ['minutes', 60_000],
          ['hours', 3_600_000],
          ['days', 86_400_000],
        ]).get(customDurationUnit.value) || 60_000;
        customDurationValue.min = String(Math.ceil(moderationCustomDurationMinMs / multiplier));
        customDurationValue.max = String(Math.floor(moderationCustomDurationMaxMs / multiplier));
        customDurationFields.hidden = !isCustom;
        customDurationFields.setAttribute('aria-hidden', String(!isCustom));
        customDurationValue.disabled = !isCustom;
        customDurationUnit.disabled = !isCustom;
      };
      suspensionDuration.addEventListener('change', () => {
        moderationSuspensionDuration = suspensionDuration.value;
        syncDurationControls();
      });
      customDurationValue.addEventListener('input', () => {
        moderationSuspensionCustomValue = customDurationValue.value;
      });
      customDurationUnit.addEventListener('change', () => {
        moderationSuspensionCustomUnit = customDurationUnit.value;
        syncDurationControls();
      });
      syncDurationControls();
      const confirmWrite = (message) => typeof window.confirm !== 'function' || window.confirm(message);
      const add = el('button', 'jdm-btn jdm-mod-user-card__credit-button', '+');
      add.type = 'button';
      add.setAttribute('aria-label', 'Ajouter des crédits Soundboard');
      add.title = 'Ajouter des crédits Soundboard';
      add.addEventListener('click', () => {
        if (!confirmWrite('Ajouter ces crédits Soundboard à cet utilisateur ?')) return;
        const amount = adjustmentAmount();
        if (amount === null) return;
        return run(card, () => moderationAction('adjustSoundboardCredits', {
          twitch_user_id: selected.twitch_user_id,
          delta: amount,
          reason: 'Ajustement depuis la console',
        }), {
          onSuccess: async (result) => {
            selected.credits = { ...(selected.credits || {}), soundboard: Number(result?.balance ?? balance) };
            await refreshModerationUserProfile(selected.twitch_user_id);
          },
        });
      });
      const remove = el('button', 'jdm-btn jdm-mod-user-card__credit-button', '−');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Retirer des crédits Soundboard');
      remove.title = 'Retirer des crédits Soundboard';
      remove.addEventListener('click', () => {
        if (!confirmWrite('Retirer ces crédits Soundboard à cet utilisateur ?')) return;
        const amount = adjustmentAmount();
        if (amount === null) return;
        return run(card, () => moderationAction('adjustSoundboardCredits', {
          twitch_user_id: selected.twitch_user_id,
          delta: -amount,
          reason: 'Ajustement depuis la console',
        }), {
          onSuccess: async (result) => {
            selected.credits = { ...(selected.credits || {}), soundboard: Number(result?.balance ?? balance) };
            await refreshModerationUserProfile(selected.twitch_user_id);
          },
        });
      });
      const historyToggle = el('button', 'jdm-btn jdm-mod-user-history-toggle', 'Historique');
      historyToggle.type = 'button';
      historyToggle.setAttribute('aria-expanded', String(moderationUserHistoryOpen));
      historyToggle.setAttribute('aria-label', `Afficher l’historique de @${selected.login || selected.twitch_user_id}`);
      historyToggle.addEventListener('click', () => {
        moderationUserHistoryOpen = !moderationUserHistoryOpen;
        renderPreservingViewport();
      });
      const creditsGroup = el('div', 'jdm-mod-user-card__group jdm-mod-user-card__group--credits');
      creditsGroup.setAttribute('role', 'group');
      creditsGroup.setAttribute('aria-label', 'Crédits Soundboard');
      creditsGroup.append(
        el('span', 'jdm-mod-user-card__group-label', 'Crédits'),
        el('strong', 'jdm-mod-user-card__balance', String(balance)),
        remove,
        delta,
        add,
      );
      const suspensionGroup = el('div', 'jdm-mod-user-card__group jdm-mod-user-card__group--suspension');
      suspensionGroup.setAttribute('role', 'group');
      suspensionGroup.setAttribute('aria-label', 'Suspension Extension');
      suspensionGroup.append(el('span', 'jdm-mod-user-card__group-label', 'Accès'), historyToggle);
      const suspensionStatusList = el('ul', 'jdm-mod-user-card__suspensions');
      suspensionStatusList.setAttribute('aria-label', 'État des suspensions par module');
      for (const module of availableModules) {
        const row = moderationSuspensionForModule(module.id, suspensionRows);
        const status = row ? `Suspendu · ${moderationSuspensionExpiryLabel(row)}` : 'Actif';
        const item = el('li', 'jdm-mod-user-card__suspension');
        item.dataset.moduleId = module.id;
        item.dataset.state = row ? 'suspended' : 'active';
        item.setAttribute('aria-label', `${module.label} — ${status}`);
        item.append(
          el('span', 'jdm-mod-user-card__suspension-module', `${module.icon ? `${module.icon} ` : ''}${module.label}`),
          el('span', 'jdm-mod-user-card__suspension-state', status),
        );
        suspensionStatusList.append(item);
      }
      suspensionGroup.append(suspensionStatusList);

      const createModulePicker = ({
        legendText,
        options,
        selection,
        actionText,
        actionClass,
        actionLabel,
        extraControl = null,
        onAction,
      }) => {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'jdm-mod-user-card__module-picker';
        const legend = el('legend', 'jdm-mod-user-card__module-picker-legend', legendText);
        const optionList = el('div', 'jdm-mod-user-card__module-options');
        optionList.setAttribute('role', 'group');
        optionList.setAttribute('aria-label', legendText);
        const inputs = [];
        const optionIds = new Set(options.map((module) => module.id));
        for (const module of options) {
          const inputId = `moderation-${selectedId}-${module.id}-${actionText.toLowerCase()}`;
          const optionLabel = el('label', 'jdm-mod-user-card__module-option');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = module.id;
          input.checked = selection.has(module.id);
          input.setAttribute('id', inputId);
          input.setAttribute('data-module-id', module.id);
          input.setAttribute('aria-label', `${module.label} · ${actionText}`);
          input.addEventListener('change', () => {
            if (input.checked) selection.add(module.id);
            else selection.delete(module.id);
            sync();
          });
          optionLabel.htmlFor = inputId;
          optionLabel.append(input, el('span', 'jdm-mod-user-card__module-option-label', `${module.icon ? `${module.icon} ` : ''}${module.label}`));
          optionList.append(optionLabel);
          inputs.push(input);
        }
        const selectAllLabel = el('label', 'jdm-mod-user-card__module-option jdm-mod-user-card__module-option--all');
        const selectAll = document.createElement('input');
        selectAll.type = 'checkbox';
        selectAll.setAttribute('aria-label', `${actionText} sur tous les modules`);
        selectAllLabel.append(selectAll, el('span', 'jdm-mod-user-card__module-option-label', 'Tout sélectionner'));
        const actionRow = el('div', 'jdm-mod-user-card__suspension-actions');
        if (extraControl) actionRow.append(extraControl);
        const action = el('button', actionClass, actionText);
        action.type = 'button';
        action.disabled = true;
        action.setAttribute('aria-label', actionLabel);
        actionRow.append(action);
        const sync = () => {
          const selectedIds = [...selection].filter((moduleId) => optionIds.has(moduleId));
          selectAll.checked = options.length > 0 && selectedIds.length === options.length;
          selectAll.indeterminate = selectedIds.length > 0 && selectedIds.length < options.length;
          selectAll.setAttribute('aria-checked', selectAll.indeterminate ? 'mixed' : String(selectAll.checked));
          action.disabled = selectedIds.length === 0;
          for (const input of inputs) input.checked = selection.has(input.value);
        };
        selectAll.addEventListener('change', () => {
          if (selectAll.checked) {
            for (const module of options) selection.add(module.id);
          } else {
            for (const module of options) selection.delete(module.id);
          }
          sync();
        });
        action.addEventListener('click', () => {
          const selectedIds = [...selection].filter((moduleId) => optionIds.has(moduleId));
          if (!selectedIds.length) return;
          return onAction(selectedIds, moderationModuleLabels(selectedIds, options));
        });
        fieldset.append(legend, optionList, selectAllLabel, actionRow);
        sync();
        return fieldset;
      };

      const suspendPicker = createModulePicker({
        legendText: 'Suspendre sur les modules',
        options: availableModules,
        selection: moderationSuspendSelection,
        actionText: 'Suspendre',
        actionClass: 'jdm-btn jdm-btn--danger jdm-mod-user-card__suspension-button',
        actionLabel: `Suspendre @${selected.login || selected.twitch_user_id} sur les modules sélectionnés`,
        extraControl: suspensionDurationControls,
        onAction: (moduleIds, labels) => {
          const duration = moderationSuspensionDurationSelection(
            suspensionDuration.value,
            customDurationValue.value,
            customDurationUnit.value,
          );
          if (!duration) {
            flash(card, 'La durée personnalisée doit être un entier d’au moins 1 minute et ne pas dépasser 365 jours.', 'error');
            return;
          }
          const durationMs = duration.durationMs;
          const durationLabel = moderationSuspensionDurationLabel(
            suspensionDuration.value,
            customDurationValue.value,
            customDurationUnit.value,
          ).toLowerCase();
          if (!confirmWrite(`Suspendre @${selected.login || selected.twitch_user_id} pendant ${durationLabel} sur : ${labels.join(', ')} ?`)) return;
          return run(card, async () => {
            const result = await moderationAction('suspendUser', {
              twitch_user_id: selected.twitch_user_id,
              module_ids: moduleIds,
              duration_ms: durationMs,
              login: selected.login,
              reason: 'Suspension depuis la console',
            });
            if (Array.isArray(result?.errors) && result.errors.length) {
              throw Object.assign(new Error('moderation_batch_partial_failure'), { code: 'moderation_batch_partial_failure' });
            }
            if (result?.scope !== 'modules' || !Array.isArray(result?.suspensions)) {
              throw Object.assign(new Error('moderation_batch_unavailable'), { code: 'moderation_batch_unavailable' });
            }
            return result;
          }, {
            success: () => `@${selected.login || selected.twitch_user_id} suspendu sur ${labels.join(' et ')} pendant ${durationLabel}.`,
            onSuccess: async (result) => {
              selected.suspensions = result.suspensions;
              selected.suspension = result.suspensions.find((row) => !row?.module_id || row.module_id === '*')
                ?? result.suspensions[0]
                ?? null;
              moderationSuspendSelection.clear();
              moderationUnsuspendSelection.clear();
              await refreshModerationUserProfile(selected.twitch_user_id);
            },
          });
        },
      });
      suspensionGroup.append(suspendPicker);

      if (activeModules.length) {
        const restorePicker = createModulePicker({
          legendText: 'Réactiver sur les modules suspendus',
          options: activeModules,
          selection: moderationUnsuspendSelection,
          actionText: 'Réactiver',
          actionClass: 'jdm-btn jdm-btn--secondary jdm-mod-user-card__suspension-button',
          actionLabel: `Réactiver @${selected.login || selected.twitch_user_id} sur les modules sélectionnés`,
          onAction: (moduleIds, labels) => {
            if (!confirmWrite(`Réactiver @${selected.login || selected.twitch_user_id} sur : ${labels.join(', ')} ?`)) return;
            return run(card, async () => {
              const result = await moderationAction('unsuspendUser', {
                twitch_user_id: selected.twitch_user_id,
                module_ids: moduleIds,
              });
              if (Array.isArray(result?.errors) && result.errors.length) {
                throw Object.assign(new Error('moderation_batch_partial_failure'), { code: 'moderation_batch_partial_failure' });
              }
              if (result?.scope !== 'modules' || !Array.isArray(result?.remaining_suspensions)) {
                throw Object.assign(new Error('moderation_batch_unavailable'), { code: 'moderation_batch_unavailable' });
              }
              return result;
            }, {
              success: () => `@${selected.login || selected.twitch_user_id} réactivé sur ${labels.join(' et ')}.`,
              onSuccess: async (result) => {
                selected.suspensions = result.remaining_suspensions;
                selected.suspension = result.remaining_suspensions.find((row) => !row?.module_id || row.module_id === '*')
                  ?? result.remaining_suspensions[0]
                  ?? null;
                moderationUnsuspendSelection.clear();
                await refreshModerationUserProfile(selected.twitch_user_id);
              },
            });
          },
        });
        suspensionGroup.append(restorePicker);
      }
      card.append(creditsGroup, suspensionGroup);
      panel.append(card);
      if (moderationUserHistoryOpen) panel.append(moderationUserHistoryPanel(selected));
    }
    return panel;
  }

  function moderationModulesPanel() {
    const panel = el('details', 'jdm-mod-modules');
    panel.open = true;
    panel.setAttribute('aria-label', 'États des modules');
    panel.append(el('summary', 'jdm-mod-history__summary', 'Modules'));
    const states = state?.moderation?.modules ?? state?.module_states ?? {};
    const list = el('div', 'jdm-mod-modules__list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Contrôles des modules');
    for (const mod of state?.modules ?? []) {
      const enabled = states[mod.id]?.enabled !== false;
      const button = el('button', `jdm-btn${enabled ? '' : ' jdm-btn--danger'}`, `${mod.icon} ${mod.label} · ${enabled ? 'Actif' : 'Coupé'}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', `${mod.label} · ${enabled ? 'Actif' : 'Coupé'}. Cliquer pour ${enabled ? 'couper' : 'activer'} le module.`);
      button.title = `${mod.label} · ${enabled ? 'Actif' : 'Coupé'}`;
      button.addEventListener('click', () => run(panel, () => moderationAction('setModuleControl', mod.id, !enabled), {
        onSuccess: () => {
          state.module_states ??= {};
          state.module_states[mod.id] = { ...(state.module_states[mod.id] || {}), enabled: !enabled };
          state.moderation ??= {};
          state.moderation.modules ??= {};
          state.moderation.modules[mod.id] = { ...(state.moderation.modules[mod.id] || {}), enabled: !enabled };
        },
      }));
      list.append(button);
    }
    panel.append(list);
    return panel;
  }

  const FORMS = { tts: ttsForm, soundboard: soundboardForm, bonk: bonkForm, raffle_join: raffleForm };

  // --- rendu ---------------------------------------------------------------

  function notificationRelativeTime(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
    if (minutes < 1) return 'À l’instant';
    if (minutes < 60) return `Il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Il y a ${hours} h`;
    return `Il y a ${Math.floor(hours / 24)} j`;
  }

  function notificationModuleLabel(moduleId) {
    if (!moduleId || moduleId === 'global') return 'Général';
    return modulePresentation(moduleId).shortLabel || moduleId;
  }

  function syncViewerPreferenceIdentity(next = state) {
    const key = next?.identity_shared === true
      ? `${String(next.channel_id || '')}:${String(next.twitch_user_id || '')}`
      : 'anonymous';
    if (key === viewerPreferenceIdentity) return;
    viewerPreferenceIdentity = key;
    viewerPreferenceLoaded = false;
    viewerPreferenceLoading = false;
    viewerPreferenceSaving = false;
    viewerPreferenceValue = false;
    viewerPreferenceError = false;
    viewerPreferenceRequest += 1;
  }

  function loadViewerPreference() {
    syncViewerPreferenceIdentity();
    if (!viewerPreferencesOpen
      || state?.identity_shared !== true
      || viewerPreferenceLoaded
      || viewerPreferenceLoading) return;
    if (typeof client?.getViewerPreference !== 'function') {
      viewerPreferenceLoaded = true;
      viewerPreferenceError = true;
      return;
    }
    viewerPreferenceLoading = true;
    viewerPreferenceError = false;
    const requestId = ++viewerPreferenceRequest;
    void Promise.resolve()
      .then(() => client.getViewerPreference())
      .then((response) => {
        if (requestId !== viewerPreferenceRequest) return;
        viewerPreferenceValue = response?.level_up_sfx_opt_in === true;
        viewerPreferenceLoaded = true;
        viewerPreferenceLoading = false;
        viewerPreferenceError = false;
        if (viewerPreferencesOpen) renderPreservingViewport();
      })
      .catch(() => {
        if (requestId !== viewerPreferenceRequest) return;
        // Lecture en échec = OFF. Le panneau reste utilisable et n'affiche
        // qu'un signal discret, sans jamais activer le son par défaut.
        viewerPreferenceValue = false;
        viewerPreferenceLoaded = true;
        viewerPreferenceLoading = false;
        viewerPreferenceError = true;
        if (viewerPreferencesOpen) renderPreservingViewport();
      });
  }

  function saveViewerPreference(nextValue) {
    if (viewerPreferenceSaving || typeof client?.setViewerPreference !== 'function') return;
    const previousValue = viewerPreferenceValue;
    viewerPreferenceValue = nextValue === true;
    viewerPreferenceSaving = true;
    viewerPreferenceError = false;
    const requestId = ++viewerPreferenceRequest;
    renderPreservingViewport();
    void Promise.resolve()
      .then(() => client.setViewerPreference(viewerPreferenceValue))
      .then((response) => {
        if (requestId !== viewerPreferenceRequest) return;
        viewerPreferenceValue = response?.level_up_sfx_opt_in === true;
        viewerPreferenceLoaded = true;
        viewerPreferenceSaving = false;
        viewerPreferenceError = false;
        if (viewerPreferencesOpen) renderPreservingViewport();
      })
      .catch(() => {
        if (requestId !== viewerPreferenceRequest) return;
        viewerPreferenceValue = previousValue;
        viewerPreferenceLoaded = true;
        viewerPreferenceSaving = false;
        viewerPreferenceError = true;
        if (viewerPreferencesOpen) renderPreservingViewport();
      });
  }

  function viewerPreferencesPanel() {
    syncViewerPreferenceIdentity();
    loadViewerPreference();
    const panel = el('section', 'jdm-viewer-preferences');
    panel.id = 'jdm-viewer-preferences';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'jdm-viewer-preferences-title');

    const heading = el('strong', 'jdm-viewer-preferences__title', 'Préférences');
    heading.id = 'jdm-viewer-preferences-title';
    const close = el('button', 'jdm-viewer-preferences__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer les préférences');
    close.title = 'Fermer';
    close.addEventListener('click', () => {
      viewerPreferencesOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-viewer-preferences-toggle')?.focus({ preventScroll: true }));
    });
    const header = el('header', 'jdm-viewer-preferences__head');
    header.append(heading, close);

    const option = el('div', 'jdm-viewer-preferences__option');
    const label = el('label', 'jdm-viewer-preferences__label', 'Annoncer mes Level Up sur le stream');
    const input = el('input', 'jdm-viewer-preferences__control');
    input.type = 'checkbox';
    input.id = 'jdm-level-up-sfx-preference';
    input.checked = viewerPreferenceValue;
    input.setAttribute('aria-label', 'Annoncer mes Level Up sur le stream');
    label.htmlFor = input.id;
    const canEdit = state?.identity_shared === true
      && typeof client?.getViewerPreference === 'function'
      && typeof client?.setViewerPreference === 'function';
    input.disabled = !canEdit || viewerPreferenceLoading || viewerPreferenceSaving;
    input.title = !canEdit && state?.identity_shared !== true
      ? 'Partage ton identité Twitch pour modifier ce réglage.'
      : viewerPreferenceLoading
        ? 'Chargement…'
        : viewerPreferenceError
          ? 'Réglage indisponible. Réessaie en ouvrant les préférences.'
          : 'Annoncer mes Level Up sur le stream';
    input.addEventListener('change', () => saveViewerPreference(input.checked));
    option.append(label, input);
    if (viewerPreferenceError && state?.identity_shared === true) {
      const status = el('span', 'jdm-viewer-preferences__status', 'Indisponible');
      status.setAttribute('role', 'status');
      option.append(status);
    }
    const refreshAction = el('button', 'jdm-viewer-preferences__refresh', '↻ Actualiser');
    refreshAction.type = 'button';
    refreshAction.addEventListener('click', async () => {
      refreshAction.disabled = true;
      try { await onRefresh?.(); } catch { /* le polling reprendra */ }
      refreshAction.disabled = false;
    });
    panel.append(header, option, refreshAction);
    return panel;
  }

  function notificationCenterDrawer() {
    const drawer = el('section', 'jdm-notification-center');
    drawer.id = 'jdm-notification-center';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'false');
    drawer.setAttribute('aria-labelledby', 'jdm-notification-center-title');

    const heading = el('strong', 'jdm-notification-center__title', 'Notifications');
    heading.id = 'jdm-notification-center-title';
    const close = el('button', 'jdm-notification-center__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer les notifications');
    close.title = 'Fermer';
    close.addEventListener('click', () => {
      notificationCenterOpen = false;
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-notification-toggle')?.focus({ preventScroll: true }));
    });
    const header = el('header', 'jdm-notification-center__head');
    header.append(heading, close);

    const tools = el('div', 'jdm-notification-center__tools');
    const unread = unreadNotificationCount();
    tools.append(el('span', 'jdm-notification-center__summary', unread ? `${unread} non lue${unread > 1 ? 's' : ''}` : 'Tout est lu'));
    const markAll = el('button', 'jdm-notification-center__mark-all', 'Tout marquer comme lu');
    markAll.type = 'button';
    markAll.disabled = unread === 0;
    markAll.addEventListener('click', () => {
      markAllNotificationsRead();
      onNotificationChange?.();
      renderPreservingViewport();
      queueMicrotask(() => root.querySelector('.jdm-notification-center__mark-all')?.focus({ preventScroll: true }));
    });
    tools.append(markAll);

    const list = el('div', 'jdm-notification-center__list');
    list.dataset.scrollKey = 'notification-center-list';
    list.setAttribute('role', 'region');
    list.setAttribute('aria-label', 'Liste des notifications');
    list.setAttribute('tabindex', '0');
    const notifications = getNotifications();
    if (!notifications.length) {
      list.append(el('p', 'jdm-notification-center__empty', 'Aucune notification.'));
    } else {
      for (const notification of notifications) {
        const item = el('article', `jdm-notification${notification.read ? '' : ' is-unread'}`);
        item.dataset.notificationId = notification.id;
        const type = el('span', `jdm-notification__type jdm-notification__type--${notification.type}`,
          notification.type === 'error' ? '!' : notification.type === 'warning' ? '⚠' : notification.type === 'success' ? '✓' : '•');
        type.setAttribute('aria-hidden', 'true');
        const module = el('span', 'jdm-notification__module', notificationModuleLabel(notification.module));
        const when = el('time', 'jdm-notification__time', notificationRelativeTime(notification.created_at));
        when.dateTime = notification.created_at;
        const meta = el('div', 'jdm-notification__meta');
        meta.append(type, module, when);
        const copy = el('div', 'jdm-notification__copy');
        copy.append(el('strong', 'jdm-notification__title', notification.title));
        if (notification.message) copy.append(el('p', 'jdm-notification__message', notification.message));
        const actions = el('div', 'jdm-notification__actions');
        const actionTarget = notification.action?.module && moduleById(notification.action.module)
          ? notification.action.module
          : null;
        if (actionTarget) {
          const open = el('button', 'jdm-notification__action', notification.action.label);
          open.type = 'button';
          open.addEventListener('click', () => {
            markNotificationRead(notification.id, true);
            onNotificationChange?.();
            notificationCenterOpen = false;
            navigateTo(actionTarget);
          });
          actions.append(open);
        }
        const read = el('button', 'jdm-notification__read', notification.read ? 'Marquer non lue' : 'Marquer comme lue');
        read.type = 'button';
        read.dataset.notificationId = notification.id;
        read.addEventListener('click', () => {
          markNotificationRead(notification.id, !notification.read);
          onNotificationChange?.();
          renderPreservingViewport();
          queueMicrotask(() => [...root.querySelectorAll('.jdm-notification__read')]
            .find((button) => button.dataset.notificationId === notification.id)
            ?.focus({ preventScroll: true }));
        });
        actions.append(read);
        item.append(meta, copy, actions);
        item.setAttribute('aria-label', [notificationModuleLabel(notification.module), notification.title, notification.message, notification.read ? 'Lue' : 'Non lue'].filter(Boolean).join(' · '));
        list.append(item);
      }
    }
    drawer.append(header, tools, list);
    return drawer;
  }

  function render() {
    hubCarousel?.destroy();
    hubCarousel = null;
    soundboardDragCancel?.();
    soundboardDragCancel = null;
    clearInterval(soundboardCooldownTimer);
    soundboardCooldownTimer = null;
    root.replaceChildren();
    // Les callbacks pointent toujours vers le Soundboard actuellement rendu.
    // Un rerender d’état ne doit jamais conserver un listener vers une vue
    // démontée.
    soundboardVolumeSync = null;
    soundboardSearchClose = null;
    soundboardDeselect = null;
    soundboardVolumeHeaderButton = null;
    paymentWalletSync = null;
    root.dataset.view = loadError ? 'error' : state ? (openModule ? 'module' : 'home') : 'loading';
    if (loadError) {
      const retry = el('button', 'jdm-btn jdm-btn--primary', 'Réessayer');
      retry.type = 'button';
      retry.addEventListener('click', () => retryLoad?.());
      root.append(el('div', 'jdm-empty', loadError), retry);
      return;
    }
    if (!state) {
      root.append(el('p', 'jdm-hint', 'Chargement…'));
      return;
    }

    syncNotificationCenter(state);

    const experience = resolveExperience(state);
    root.dataset.theme = experience.theme.id;
    if (!tutorialAutoOpened && (state.identity_shared || isStudioPreview)) {
      tutorialAutoOpened = true;
      tutorialDisabled = readTutorialDisabled(experience.tutorial);
      // Le studio garde sa vue de travail immédiatement disponible. En vrai
      // composant Twitch, le tutoriel s’ouvre une fois par ouverture tant que
      // le viewer n’a pas coché « Ne plus afficher ».
      if (shouldAutoOpenTutorial({
        isStudioPreview,
        tutorialDisabled,
        openModule,
        modules: state.modules ?? [],
      })) tutorialOpen = true;
    }

    if (!state.identity_shared) {
      const cta = el('button', 'jdm-btn jdm-ui-action jdm-btn--primary', 'Activer mes actions');
      cta.type = 'button';
      cta.setAttribute('aria-describedby', 'jdm-identity-help');
      cta.addEventListener('click', () => {
        const requestIdShare = window.Twitch?.ext?.actions?.requestIdShare;
        if (typeof requestIdShare !== 'function') {
          flash(root, 'La demande Twitch est indisponible dans cet aperçu. Teste ce bouton depuis l’extension Twitch.', 'error');
          return;
        }
        try {
          requestIdShare();
          flash(root, 'Confirme la fenêtre Twitch pour activer tes actions.', 'ok');
        } catch {
          flash(root, 'Twitch n’a pas pu ouvrir la demande. Rouvre l’extension puis réessaie.', 'error');
        }
      });
      const help = el('p', 'jdm-hint jdm-identity-help', 'Une fenêtre Twitch va s’ouvrir : valide le partage, puis l’extension se recharge automatiquement.');
      help.id = 'jdm-identity-help';
      root.append(
        el('p', 'jdm-identity-title', 'Active tes actions Twitch'),
        el('p', 'jdm-hint', 'Les emotes publiques restent disponibles. Partage ton identité Twitch pour débloquer tes actions payées, tes jetons et tes emotes personnelles.'),
        help,
        cta,
      );
    }

    // solde jetons
    const wallet = state.wallet ?? {};
    const soundboardView = openModule === 'soundboard'
      && (state.modules ?? []).some((candidate) => candidate.id === 'soundboard');
    const moderationView = openModule === MODERATION_MODULE.id && canModerate();
    const ttsView = openModule === 'tts';
    const raffleView = openModule === 'raffle_join';
    const paymentView = soundboardView || ttsView;
    const hubView = !openModule;
    const historyView = openModule === ACTIONS_MODULE.id;
    const consultView = hubView || historyView;
    const informativeView = !paymentView && !consultView && !moderationView;
    const updatedWalletView = paymentView || raffleView;
    let changeWalletMethod = null;
    const headerSwitch = paymentView || consultView || informativeView
      ? createCurrencySwitch({
        variant: 'balance',
        className: 'rl-cswitch--header',
        ariaLabel: consultView ? 'Soldes' : informativeView ? 'Solde de jetons' : 'Monnaie de paiement',
        onChange: () => changeWalletMethod?.(),
      })
      : null;
    const walletRow = headerSwitch
      ? headerSwitch.node
      : el('div', updatedWalletView
        ? 'jdm-wallet-stack'
        : 'jdm-wallet jdm-ui-wallet jdm-wallet--informative');
    if (!headerSwitch) {
      walletRow.setAttribute('role', 'group');
    }
    if (soundboardView && !headerSwitch) walletRow.classList.add('jdm-soundboard-wallet');
    // Une récompense TTS en attente = une utilisation, comme dans ttsForm.
    // Sans liste API, aucun zéro/solde fictif n'est présenté.
    const creditsKnown = Array.isArray(state.pending_actions);
    // Hub : total des crédits de tous les modules ; ils restent propres à chaque module.
    const creditRows = Array.isArray(state.pending_actions) ? state.pending_actions : [];
    const hubCreditsByModule = new Map();
    for (const row of creditRows) {
      const amount = Math.max(0, Number(row.credits_remaining ?? 1));
      hubCreditsByModule.set(row.module_id, (hubCreditsByModule.get(row.module_id) ?? 0) + amount);
    }
    const moduleCredits = consultView
      ? [...hubCreditsByModule.values()].reduce((sum, value) => sum + value, 0)
      : ttsView ? pendingFor('tts').length : soundboardCreditBalance();
    const creditModule = ttsView ? 'TTS' : 'Soundboard';
    const creditWord = `crédit${moduleCredits > 1 ? 's' : ''}`;
    const exactCreditValue = creditsKnown ? formatWalletExactValue(moduleCredits) : 'Solde indisponible';
    const exactTokenValue = wallet.unavailable
      ? 'Solde de jetons indisponible'
      : formatWalletExactValue(wallet.available);
    const tokenView = createWalletFace({
      currency: 'tokens',
      value: wallet.available,
      unavailable: wallet.unavailable,
      hold: wallet.reserved,
    });
    const creditView = createWalletFace({
      currency: 'credits',
      value: moduleCredits,
      unavailable: !creditsKnown,
    });
    if (!headerSwitch) walletRow.append(tokenView, creditView);
    const syncWalletView = (methods = [], onMethodChange = null) => {
      const mode = soundboardView ? selectedPaymentMethod : ttsView ? ttsPaymentMethod : consultView ? hubWalletMethod : 'tokens';
      const showingCredits = mode === 'credits';
      tokenView.classList.toggle('is-active', !showingCredits);
      creditView.classList.toggle('is-active', showingCredits);
      tokenView.setAttribute('aria-hidden', String(showingCredits));
      creditView.setAttribute('aria-hidden', String(!showingCredits));
      walletRow.dataset.walletMode = mode;
      walletRow.dataset.walletExactValue = showingCredits ? exactCreditValue : exactTokenValue;
      const balanceLabel = showingCredits
        ? `${exactCreditValue} ${creditWord} ${creditModule}`
        : `${wallet.unavailable ? exactTokenValue : `${exactTokenValue} jetons`}`;
      const next = methods.find((candidate) => candidate !== mode);
      const canSwitch = (paymentView || consultView) && Boolean(next);
      walletRow.dataset.payment = mode;
      walletRow.dataset.canSwitch = String(canSwitch);
      const switchLabel = next === 'credits' ? `Afficher les crédits ${creditModule}` : 'Afficher les jetons';
      const holdLabel = Number(wallet.reserved) > 0 ? ` · ${formatWalletExactValue(wallet.reserved)} jetons réservés` : '';
      if (!headerSwitch) {
        walletRow.setAttribute('aria-label', `${balanceLabel}${holdLabel}${canSwitch ? `. ${switchLabel}.` : ''}`);
        walletRow.title = `${balanceLabel}${holdLabel}${canSwitch ? ` · ${switchLabel}` : ''}`;
      }
      if (headerSwitch) {
        headerSwitch.sync({
          method: mode,
          methods: methods.length ? methods : [mode],
          amounts: {
            tokens: wallet.unavailable ? null : wallet.available,
            credits: creditsKnown ? moduleCredits : null,
          },
          details: {
            tokens: Number(wallet.reserved) > 0 ? `${formatWalletExactValue(wallet.reserved)} jetons réservés` : '',
            credits: consultView && hubCreditsByModule.size
              ? `${[...hubCreditsByModule].map(([id, amount]) => `${visibleModuleLabel((state.modules ?? []).find((m) => m.id === id) ?? { label: id })} ${formatWalletExactValue(amount)}`).join(' · ')} — propres à chaque module`
              : '',
          },
        });
      } else if (paymentView) {
        walletRow.setAttribute('aria-disabled', String(!canSwitch));
        tokenView.hidden = !methods.includes('tokens') && mode !== 'tokens';
        creditView.hidden = !methods.includes('credits') && mode !== 'credits';
      } else {
        // Les vues informatives (dont Tombola) restent jetons-only : elles
        // réutilisent la même pile de wallet sans exposer une face crédits
        // qui ne correspond à aucune capacité de paiement du module.
        tokenView.hidden = false;
        creditView.hidden = true;
      }
      // Callback vers le formulaire actif ; le wallet ne possède aucune monnaie.
      changeWalletMethod = canSwitch ? () => onMethodChange?.(next) : null;
    };
    syncWalletView();
    if (informativeView) syncWalletView(['tokens']);
    if (consultView) {
      const syncHubWallet = () => syncWalletView(['tokens', 'credits'], (nextMethod) => {
        hubWalletMethod = nextMethod;
        syncHubWallet();
      });
      syncHubWallet();
    }
    if (paymentView) paymentWalletSync = syncWalletView;
    if (!moderationView) {
      if (successMessage) {
        root.append(el('p', 'jdm-flash jdm-flash--ok', successMessage));
        successMessage = null;
      }
      if (actionError) {
        root.append(el('p', 'jdm-flash jdm-flash--error', actionError));
      }
    }

    // Les crédits PDC disponibles sont un état runtime, jamais une
    // notification persistante ni un badge d’attention.
    if (!moderationView) {
      const pending = Array.isArray(state.pending_actions) ? state.pending_actions : [];
      const availableCredits = pending.reduce((sum, row) => sum + Math.max(0, Number(row.credits_remaining ?? 1)), 0);
      if (availableCredits && openModule) {
        root.append(el('p', 'jdm-queue-hint',
          `${availableCredits} crédit${availableCredits > 1 ? 's' : ''} PDC disponible${availableCredits > 1 ? 's' : ''}`));
      }
    }

    const modules = [...(state.modules ?? [])]
      .filter((mod) => mod.id !== MODERATION_MODULE.id);
    if (state.identity_shared && !modules.some((mod) => mod.id === ACTIONS_MODULE.id)) modules.push(ACTIONS_MODULE);
    if (canModerate() && !modules.some((mod) => mod.id === MODERATION_MODULE.id)) {
      modules.push(MODERATION_MODULE);
    }
    if (openModule && !modules.some((mod) => mod.id === openModule)) openModule = null;
    root.dataset.view = openModule ? 'module' : 'home';

    const moduleNotices = (mod) => notificationCount(state, mod.id);

    const openTutorial = () => {
      tutorialStep = 0;
      tutorialOpen = true;
      renderPreservingViewport();
    };

    if (!openModule) {
      const hub = el('section', 'rh-hub');
      hub.setAttribute('aria-label', 'Interactions disponibles');
      const top = el('header', 'rh-top');
      const brand = el('div', 'rh-brand');
      const mark = el('span', 'rh-mark', 'R');
      mark.setAttribute('aria-hidden', 'true');
      const brandCopy = el('span', 'rh-brand__copy');
      brandCopy.append(el('small', '', 'Raptoru Live'), el('strong', '', 'Interactions'));
      brand.append(mark, brandCopy);
      const notificationToggle = el('button', 'jdm-notification-toggle');
      notificationToggle.type = 'button';
      notificationToggle.setAttribute('aria-label', 'Ouvrir les notifications');
      notificationToggle.setAttribute('aria-haspopup', 'dialog');
      notificationToggle.setAttribute('aria-controls', 'jdm-notification-center');
      notificationToggle.setAttribute('aria-expanded', String(notificationCenterOpen));
      notificationToggle.title = 'Notifications';
      const unread = unreadNotificationCount();
      notificationToggle.append(createNotificationBellIcon());
      if (unread) notificationToggle.append(el('span', 'jdm-notification-toggle__count', String(unread)));
      notificationToggle.addEventListener('click', () => {
        notificationCenterOpen = !notificationCenterOpen;
        viewerPreferencesOpen = false;
        renderPreservingViewport();
        if (notificationCenterOpen) {
          queueMicrotask(() => root.querySelector('.jdm-notification-center__close')?.focus({ preventScroll: true }));
        }
      });
      const preferencesToggle = el('button', 'jdm-viewer-preferences-toggle');
      preferencesToggle.type = 'button';
      preferencesToggle.setAttribute('aria-label', 'Ouvrir les préférences');
      preferencesToggle.setAttribute('aria-haspopup', 'dialog');
      preferencesToggle.setAttribute('aria-controls', 'jdm-viewer-preferences');
      preferencesToggle.setAttribute('aria-expanded', String(viewerPreferencesOpen));
      preferencesToggle.title = 'Préférences';
      const preferencesIcon = el('span', 'jdm-viewer-preferences-toggle__icon', '⚙');
      preferencesIcon.setAttribute('aria-hidden', 'true');
      preferencesToggle.append(preferencesIcon);
      preferencesToggle.addEventListener('click', () => {
        viewerPreferencesOpen = !viewerPreferencesOpen;
        notificationCenterOpen = false;
        renderPreservingViewport();
        if (viewerPreferencesOpen) {
          queueMicrotask(() => root.querySelector('.jdm-viewer-preferences__close')?.focus({ preventScroll: true }));
        }
      });
      top.append(brand, notificationToggle, preferencesToggle, walletRow);

      // Modules du carousel : les vrais modules (Historique reste un accès secondaire).
      const raffleOpen = raffleIsActive(state?.raffle ?? {});
      const hubModules = modules
        .filter((candidate) => candidate.id !== ACTIONS_MODULE.id)
        .map((mod) => {
          const style = HUB_MODULE_STYLES[mod.id] ?? HUB_DEFAULT_STYLE;
          const off = state?.module_states?.[mod.id]?.enabled === false;
          const chip = off
            ? { text: 'En pause', tone: 'neutral' }
            : mod.id === 'raffle_join' && raffleOpen
              ? { text: 'Ouverte', tone: 'live' }
              : mod.id === 'tts' && state?.moderation?.tts?.paused
                ? { text: 'En pause', tone: 'neutral' }
                : mod.id === MODERATION_MODULE.id
                  ? { text: 'Modérateurs', tone: 'staff' }
                  : null;
          return {
            id: mod.id,
            label: visibleModuleLabel(mod),
            description: mod.id === MODERATION_MODULE.id ? 'Outils du stream' : homeModuleDescription(mod),
            icon: style.icon,
            color: style.color,
            color2: style.color2,
            chip,
            off,
            badge: moduleNotices(mod),
          };
        });
      const stage = el('div', 'rh-stage');
      const dock = el('div', 'rh-dock');
      const rail = el('div', 'rh-rail');
      const allModules = el('div', 'rh-all');
      allModules.setAttribute('role', 'dialog');
      allModules.setAttribute('aria-label', 'Tous les modules');
      // Navigation secondaire : Historique · grille (lanceur) · Classement ; Tutoriel au bord droit.
      const util = el('nav', 'rh-util');
      util.setAttribute('aria-label', 'Navigation secondaire');
      const utilLeft = el('div', 'rh-util__side rh-util__side--left');
      const launcherHost = el('div', 'rh-util__center');
      const utilRight = el('div', 'rh-util__side rh-util__side--right');
      if (modules.some((mod) => mod.id === ACTIONS_MODULE.id)) {
        const history = el('button', 'rh-util-btn');
        history.type = 'button';
        history.append(hubIcon(document, 'clock'), el('span', '', 'Historique'));
        const historyNotices = moduleNotices(ACTIONS_MODULE);
        if (historyNotices) history.append(el('span', 'rh-util-btn__count', String(historyNotices)));
        history.setAttribute('aria-label', historyNotices ? `Historique · ${historyNotices} non lue${historyNotices > 1 ? 's' : ''}` : 'Historique');
        history.addEventListener('click', () => navigateTo(ACTIONS_MODULE.id));
        utilLeft.append(history);
      }
      if (state.site_url) {
        const ranking = el('a', 'rh-util-btn');
        ranking.href = state.site_url;
        ranking.target = '_blank';
        ranking.rel = 'noopener noreferrer';
        ranking.append(hubIcon(document, 'trophy'), el('span', '', 'Classement'));
        ranking.setAttribute('aria-label', 'Classement (nouvel onglet)');
        utilRight.append(ranking);
      }
      const tutorial = el('button', 'rh-tuto');
      tutorial.type = 'button';
      tutorial.setAttribute('aria-label', 'Ouvrir le tutoriel');
      tutorial.setAttribute('aria-haspopup', 'dialog');
      tutorial.title = 'Tutoriel';
      tutorial.append(el('span', 'rh-tuto__q', '?'));
      tutorial.addEventListener('click', openTutorial);
      util.append(utilLeft, launcherHost, utilRight, tutorial);
      dock.append(rail, util);
      hub.append(top, stage, dock, allModules);
      if (notificationCenterOpen) hub.append(notificationCenterDrawer());
      if (viewerPreferencesOpen) hub.append(viewerPreferencesPanel());
      root.append(hub);
      if (hubModules.length) {
        if (!hubModules.some((mod) => mod.id === hubSelectedId)) hubSelectedId = hubModules[0].id;
        hubCarousel = createHubCarousel({
          document,
          stage,
          rail,
          popover: allModules,
          launcherHost,
          modules: hubModules,
          selectedId: hubSelectedId,
          onSelect: (id) => { hubSelectedId = id; },
          onOpen: (id) => navigateTo(id),
        });
      }
      // Hauteur disponible sous le haut du Hub : rien ne déborde de la surface Twitch.
      hub.classList.toggle('is-narrow', hub.clientWidth <= 340);
      requestAnimationFrame(() => {
        if (!hub.isConnected) return;
        hub.classList.toggle('is-narrow', hub.clientWidth <= 340);
        const page = document.scrollingElement;
        const topOffset = hub.getBoundingClientRect().top + (page?.scrollTop ?? 0);
        hub.style.setProperty('--rh-top', `${Math.max(0, Math.round(topOffset))}px`);
        const overflow = page ? page.scrollHeight - page.clientHeight : 0;
        if (overflow > 0) hub.style.setProperty('--rh-bottom', `${8 + overflow}px`);
      });
    } else {
      const mod = modules.find((candidate) => candidate.id === openModule);
      const screen = el('section', 'jdm-module-screen');
      const isSoundboard = mod.id === 'soundboard';
      const isBonk = mod.id === 'bonk';
      const isRaffle = mod.id === 'raffle_join';
      const isModeration = mod.id === MODERATION_MODULE.id;
      const head = el('header', `jdm-ui-header jdm-module__screen-head${isSoundboard ? ' jdm-module__screen-head--soundboard' : ''}${isBonk ? ' jdm-module__screen-head--bonk' : ''}${isRaffle ? ' jdm-module__screen-head--raffle' : ''}${isModeration ? ' jdm-module__screen-head--moderation' : ''}`);
      head.setAttribute('aria-label', visibleModuleLabel(mod));
      const headLeft = el('div', 'jdm-module__screen-side jdm-module__screen-side--left');
      const headRight = el('div', 'jdm-module__screen-side jdm-module__screen-side--right');
      const back = el('button', 'jdm-back');
      back.type = 'button';
      back.setAttribute('aria-label', 'Retour à l’accueil des modules');
      back.title = 'Retour à l’accueil';
      const backIcon = el('span', 'jdm-back__icon', '←');
      backIcon.setAttribute('aria-hidden', 'true');
      back.append(backIcon, el('span', 'jdm-back__label', 'Retour'));
      back.addEventListener('click', () => navigateTo(null));
      headLeft.append(back);
      if (isRaffle) {
        const raffleHeader = state?.raffle ?? {};
        const raffleOpen = raffleIsActive(raffleHeader);
        const status = el('span', `jdm-raffle-header-status ${raffleOpen ? 'is-open' : 'is-closed'}`);
        status.dataset.raffleStatus = raffleOpen ? 'open' : 'closed';
        status.setAttribute('aria-label', raffleOpen ? 'Tombola ouverte' : 'Tombola fermée');
        const dot = el('span', 'jdm-raffle-header-status__dot', '●');
        dot.setAttribute('aria-hidden', 'true');
        status.append(dot, el('span', 'jdm-raffle-header-status__label', raffleOpen ? 'Ouverte' : 'Fermée'));
        headLeft.append(status);
      }
      const heading = el('div', 'jdm-module__screen-title');
      const screenIcon = isSoundboard
        ? el('button', 'sbx-vol-trigger')
        : el('span', 'jdm-module__screen-icon', mod.icon);
      screenIcon.setAttribute('aria-hidden', 'true');
      if (isSoundboard) {
        screenIcon.type = 'button';
        screenIcon.removeAttribute('aria-hidden');
        screenIcon.setAttribute('aria-label', 'Ouvrir le volume des aperçus Soundboard');
        screenIcon.title = 'Volume des aperçus Soundboard';
        soundboardVolumeHeaderButton = screenIcon;
      }
      if (!isModeration) heading.append(screenIcon);
      heading.append(el('strong', 'jdm-module__screen-name', visibleModuleLabel(mod)));
      head.append(headLeft, heading, headRight);
      if (!isModeration && !walletRow.classList.contains('rl-cswitch')) {
        walletRow.classList.add('jdm-wallet--shell-header');
        if (isBonk) {
          walletRow.classList.add('jdm-wallet--bonk-header');
        }
      }

      if (!isModeration) headRight.append(walletRow);

      const item = el('section', 'jdm-module');
      item.dataset.module = mod.id;
      item.classList.add('is-open');
      const body = el('div', 'jdm-module__body');
      if (!isModeration) body.dataset.scrollKey = `module-${mod.id}`;
      if (!isSoundboard && !isModeration) {
        const intro = el('div', 'jdm-module__intro');
        intro.append(
          el('strong', 'jdm-module__intro-title', mod.label),
          el('span', 'jdm-module__intro-copy', mod.description),
        );
        body.append(intro);
      }
      if (mod.id === ACTIONS_MODULE.id) {
        body.append(personalHistory());
      } else if (mod.id === MODERATION_MODULE.id) {
        const moderation = moderationForm();
        if (moderation) {
          if (successMessage) {
            moderation.prepend(el('p', 'jdm-flash jdm-flash--ok', successMessage));
            successMessage = null;
          }
          if (actionError) moderation.prepend(el('p', 'jdm-flash jdm-flash--error', actionError));
          body.append(moderation);
        }
      } else {
        FORMS[mod.id]?.(mod, body);
      }
      item.append(body);
      if (isSoundboard) (body.querySelector('.sbx-toast-slot') ?? item).append(createSoundboardFeedbackOverlay());
      screen.append(head, item);
      root.append(screen);
      if (isSoundboard) syncSoundboardPreviewButtons();
    }

    if (tutorialOpen && !openModule) root.append(tutorialDialog(experience.tutorial));
  }

  return {
    setState(next) {
      updateState(next);
    },
    setError(message, retry) {
      // Après la première session, garder l'interface et les brouillons
      // utilisables pendant une panne de polling. Un simple refresh ne doit
      // jamais transformer un panneau fonctionnel en écran vide.
      if (state) {
        actionError = message;
        retryLoad = retry;
        renderPreservingViewport();
        return;
      }
      loadError = message;
      retryLoad = retry;
      render();
    },
    get state() { return state; },
    collapse() { captureScrollPositions(); },
  };
}

export { fmt };
