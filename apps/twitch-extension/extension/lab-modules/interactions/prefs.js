// LAB ONLY — préférences du viewer pour Interactions › Chaos : favoris, ordre personnel, derniers réglages par effet.
// Même stockage que la Soundboard (shared/stored-ids.js : localStorage facultatif, un stockage bloqué n'oublie que
// les préférences) et mêmes règles d'ordre (shared/soundboard-model.js : un effet nouveau s'ajoute à la fin, un effet
// retiré disparaît, un réordonnancement dans un filtre ne touche que les effets visibles). Isolé du faux Core : à terme,
// le compte viewer côté Core pourra prendre le relais (docs/chaos/EXTENSION_INTERACTIONS.md § 6).
import { readStoredIds, writeStoredIds } from '../../shared/stored-ids.js';
import { moveSoundboardItem, normalizeSoundboardOrder, reorderSoundboardVisibleSubset } from '../../shared/soundboard-model.js';

export const FAVORITES_KEY = 'raptoru-live:interactions-favorites';
export const ORDER_KEY = 'raptoru-live:interactions-order';
export const CHOICES_KEY = 'raptoru-live:interactions-choices';
export const TIP_KEY = 'raptoru-live:interactions-tip-seen';

function readObject(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writeValue(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* stockage facultatif */
  }
}

export function createPrefs(catalogIds) {
  const ids = catalogIds.map(String);
  let order = normalizeSoundboardOrder(readStoredIds(ORDER_KEY), ids);
  let favorites = readStoredIds(FAVORITES_KEY).filter((id) => ids.includes(id));
  const choices = readObject(CHOICES_KEY);
  return {
    order: () => [...order],
    isFavorite: (id) => favorites.includes(String(id)),
    favoriteCount: () => favorites.length,
    toggleFavorite(id) {
      const k = String(id);
      favorites = favorites.includes(k) ? favorites.filter((x) => x !== k) : [...favorites, k];
      writeStoredIds(FAVORITES_KEY, favorites);
      return favorites.includes(k);
    },
    /** Déplace un effet dans la liste visible (insertion, jamais d'échange) ; les effets masqués gardent leur place. */
    move(visibleIds, from, to) {
      const next = moveSoundboardItem(visibleIds, from, to);
      order = reorderSoundboardVisibleSubset(order, visibleIds, next);
      writeStoredIds(ORDER_KEY, order);
      return next;
    },
    choice: (id) => choices[id] ?? null,
    saveChoice(id, c) {
      choices[id] = c;
      writeValue(CHOICES_KEY, choices);
    },
    tipSeen: () => {
      try {
        return localStorage.getItem(TIP_KEY) === '1';
      } catch {
        return false;
      }
    },
    markTipSeen: () => writeValue(TIP_KEY, '1'),
    reset() {
      order = [...ids];
      favorites = [];
      for (const k of Object.keys(choices)) delete choices[k];
      for (const key of [ORDER_KEY, FAVORITES_KEY, CHOICES_KEY, TIP_KEY]) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* stockage facultatif */
        }
      }
    },
  };
}
