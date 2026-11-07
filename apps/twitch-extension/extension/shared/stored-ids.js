// Lists of ids a viewer keeps on this device (favourites, recents, personal order): localStorage, optional — a
// blocked storage only means nothing is remembered. Shared by Soundboard and Bonk (moved from ui.js).

export function readStoredIds(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export function writeStoredIds(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage facultatif */ }
}

export function rememberStoredId(key, id, limit = 12) {
  const value = [String(id), ...readStoredIds(key).filter((candidate) => candidate !== String(id))];
  writeStoredIds(key, value.slice(0, limit));
}
