// Soundboard — the viewer's catalogue rules, without any DOM (moved from ui.js): personal order, search, sort,
// local names (aliases) and the keys of what this device remembers. Core stays the authority on the sounds.

import { normalizeSearchQuery } from './ui-primitives.js';

export const SOUNDBOARD_FAVORITES_KEY = 'raptoru-live:soundboard-favorites';
export const SOUNDBOARD_RECENTS_KEY = 'raptoru-live:soundboard-recents';
export const SOUNDBOARD_ORDER_KEY = 'raptoru-live:soundboard-order';
export const SOUNDBOARD_ALIASES_KEY = 'raptoru-live:soundboard-aliases';
export const SOUNDBOARD_ALIAS_MAX_LENGTH = 32;

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

/** Insertion stricte : l'élément `from` prend la place `to`, seuls ceux d'entre les deux se décalent d'un rang. */
export function moveSoundboardItem(ids, from, to) {
  const next = Array.isArray(ids) ? [...ids] : [];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Destination d'un glisser, lue sur les positions relevées au début du geste (jamais sur des cartes en
 * mouvement). Le pointeur doit entrer franchement dans un emplacement (marge de 12 %) pour le choisir ; dans un
 * interstice ou hors de la grille, la destination courante est gardée : pas d'aller-retour autour d'une frontière.
 */
export function soundboardDropSlot(slots, x, y, current) {
  const hit = (Array.isArray(slots) ? slots : []).findIndex((slot) => (
    x >= slot.left + slot.width * 0.12 && x <= slot.left + slot.width * 0.88
    && y >= slot.top + slot.height * 0.12 && y <= slot.top + slot.height * 0.88
  ));
  return hit >= 0 ? hit : current;
}

export function normalizeSoundboardAlias(value, maxLength = SOUNDBOARD_ALIAS_MAX_LENGTH) {
  const limit = Math.max(1, Number(maxLength) || SOUNDBOARD_ALIAS_MAX_LENGTH);
  return Array.from(String(value ?? '')
    // eslint-disable-next-line no-control-regex -- control characters are stripped on purpose
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim())
    .slice(0, limit)
    .join('');
}

export function aliasValue(aliases, soundId) {
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

export function readStoredAliases(key, soundIds) {
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

export function writeStoredAliases(key, aliases) {
  try { localStorage.setItem(key, JSON.stringify(aliases)); } catch { /* stockage facultatif */ }
}
