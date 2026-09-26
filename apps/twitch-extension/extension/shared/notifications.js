// Source de vérité frontend pour les notifications persistantes.
// Les files d'actions, soldes et états de modules restent des états runtime.

export const NOTIFICATION_SCHEMA_VERSION = 1;
export const NOTIFICATION_LIMIT = 80;
export const NOTIFICATION_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTIFICATION_TYPES = Object.freeze([
  'info',
  'success',
  'warning',
  'error',
  'action_required',
]);

export const NOTIFICATION_STORAGE_KEY = 'raptoru-live:notification-center:v1';

const DEFAULT_SCOPE = 'default';
const LEGACY_BACKEND_NOTIFICATION_KEY = 'runtime:global:backend';
const KIND_TO_TYPE = Object.freeze({
  error: 'error',
  failure: 'error',
  warning: 'warning',
  attention: 'warning',
  action_required: 'action_required',
  action_ready: 'action_required',
  success: 'success',
});

function getDefaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function cleanString(value, fallback = '', limit = 240) {
  return String(value ?? fallback).trim().slice(0, limit);
}

function timestamp(value, now) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(now()).toISOString();
}

function typeFor(raw) {
  const requested = cleanString(raw?.type ?? raw?.severity, '').toLowerCase();
  if (NOTIFICATION_TYPES.includes(requested)) return requested;
  return KIND_TO_TYPE[cleanString(raw?.kind, '').toLowerCase()] ?? 'info';
}

export function normalizeNotification(raw, { now = Date.now, index = 0 } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.active === false || raw.dismissed === true) return null;

  const type = typeFor(raw);
  const createdAt = timestamp(raw.created_at ?? raw.createdAt, now);
  let expiresAt = raw.expires_at ?? raw.expiresAt ?? null;
  if (expiresAt) expiresAt = timestamp(expiresAt, now);
  else if (type === 'info' || type === 'success') {
    expiresAt = new Date(Date.parse(createdAt) + NOTIFICATION_DEFAULT_TTL_MS).toISOString();
  }

  const action = raw.action && typeof raw.action === 'object'
    ? (() => {
      const module = cleanString(raw.action.module ?? raw.action.module_id, '', 80) || null;
      return {
        label: cleanString(raw.action.label, 'Ouvrir', 80),
        module: module === 'global' ? null : module,
      };
    })()
    : null;

  return {
    id: cleanString(raw.id, `notification-${index}`, 160),
    type,
    severity: cleanString(raw.severity, type, 40),
    module: cleanString(raw.module ?? raw.module_id, 'global', 80) || 'global',
    title: cleanString(raw.title, 'Notification', 120),
    message: cleanString(raw.message ?? raw.body, '', 400),
    created_at: createdAt,
    read: raw.read === true,
    dedupe_key: cleanString(raw.dedupe_key ?? raw.dedupeKey, '', 160) || null,
    expires_at: expiresAt,
    action,
  };
}

function isExpired(notification, now) {
  return Boolean(notification?.expires_at) && Date.parse(notification.expires_at) <= now();
}

function scopedStorageKey(baseKey, scope) {
  return `${baseKey}:${encodeURIComponent(scope || DEFAULT_SCOPE)}`;
}

function validPersistedState(value) {
  return value && typeof value === 'object' && value.version === NOTIFICATION_SCHEMA_VERSION;
}

export function createNotificationCenter({
  storage = getDefaultStorage(),
  storageKey = NOTIFICATION_STORAGE_KEY,
  now = Date.now,
} = {}) {
  let scope = DEFAULT_SCOPE;
  let notifications = [];
  let readIds = new Set();
  let dismissedIds = new Set();
  let activeDedupeKeys = new Set();
  let serverDedupeKeys = new Set();
  let localDedupeKeys = new Set();

  const clearMemory = () => {
    notifications = [];
    readIds = new Set();
    dismissedIds = new Set();
    activeDedupeKeys = new Set();
    serverDedupeKeys = new Set();
    localDedupeKeys = new Set();
  };

  const persist = () => {
    if (!storage?.setItem) return;
    try {
      storage.setItem(storageKeyForScope(), JSON.stringify({
        version: NOTIFICATION_SCHEMA_VERSION,
        notifications: notifications.slice(0, NOTIFICATION_LIMIT),
        readIds: [...readIds].slice(-NOTIFICATION_LIMIT),
        dismissedIds: [...dismissedIds].slice(-NOTIFICATION_LIMIT),
        activeDedupeKeys: [...activeDedupeKeys].slice(-NOTIFICATION_LIMIT),
        serverDedupeKeys: [...serverDedupeKeys].slice(-NOTIFICATION_LIMIT),
        localDedupeKeys: [...localDedupeKeys].slice(-NOTIFICATION_LIMIT),
      }));
    } catch { /* localStorage est facultatif */ }
  };

  const storageKeyForScope = () => scopedStorageKey(storageKey, scope);

  const load = () => {
    clearMemory();
    if (!storage?.getItem) return;
    try {
      const parsed = JSON.parse(storage.getItem(storageKeyForScope()) || 'null');
      if (!validPersistedState(parsed)) {
        if (parsed !== null) {
          try { storage.removeItem?.(storageKeyForScope()); } catch { /* noop */ }
        }
        return;
      }
      const loadedNotifications = (Array.isArray(parsed.notifications) ? parsed.notifications : [])
        .map((item, index) => normalizeNotification(item, { now, index }))
        .filter(Boolean);
      const legacyNotificationIds = new Set(loadedNotifications
        .filter((item) => item.dedupe_key === LEGACY_BACKEND_NOTIFICATION_KEY)
        .map((item) => item.id));
      notifications = loadedNotifications.filter((item) => (
        item.dedupe_key !== LEGACY_BACKEND_NOTIFICATION_KEY
      ));
      readIds = new Set((Array.isArray(parsed.readIds) ? parsed.readIds.map(String) : [])
        .filter((id) => !legacyNotificationIds.has(id)));
      for (const item of notifications) {
        if (item.read) readIds.add(item.id);
      }
      dismissedIds = new Set(Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds.map(String) : []);
      activeDedupeKeys = new Set(Array.isArray(parsed.activeDedupeKeys) ? parsed.activeDedupeKeys.map(String) : []);
      serverDedupeKeys = new Set(Array.isArray(parsed.serverDedupeKeys) ? parsed.serverDedupeKeys.map(String) : []);
      localDedupeKeys = new Set(Array.isArray(parsed.localDedupeKeys)
        ? parsed.localDedupeKeys.map(String)
        : [...activeDedupeKeys].filter((key) => !serverDedupeKeys.has(key)));
      const legacyDedupeWasActive = activeDedupeKeys.has(LEGACY_BACKEND_NOTIFICATION_KEY)
        || serverDedupeKeys.has(LEGACY_BACKEND_NOTIFICATION_KEY)
        || localDedupeKeys.has(LEGACY_BACKEND_NOTIFICATION_KEY);
      activeDedupeKeys.delete(LEGACY_BACKEND_NOTIFICATION_KEY);
      serverDedupeKeys.delete(LEGACY_BACKEND_NOTIFICATION_KEY);
      localDedupeKeys.delete(LEGACY_BACKEND_NOTIFICATION_KEY);
      activeDedupeKeys = new Set([...activeDedupeKeys, ...serverDedupeKeys, ...localDedupeKeys]);
      if (legacyNotificationIds.size || legacyDedupeWasActive) {
        prune();
        persist();
      }
    } catch {
      // Une corruption ne doit ni casser le Hub ni conserver un état douteux.
      clearMemory();
      try { storage.removeItem?.(storageKeyForScope()); } catch { /* noop */ }
    }
  };

  const prune = () => {
    notifications = notifications
      .filter((item) => !dismissedIds.has(item.id) && !isExpired(item, now))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, NOTIFICATION_LIMIT);
    const ids = new Set(notifications.map((item) => item.id));
    readIds = new Set([...readIds].filter((id) => ids.has(id)));
  };

  const snapshot = (moduleId = null) => {
    prune();
    return notifications
      .filter((item) => !moduleId || item.module === moduleId)
      .map((item) => ({ ...item, read: readIds.has(item.id) }));
  };

  const replaceOrAppend = (next, { dedupeActive = false } = {}) => {
    const dedupeKey = next.dedupe_key;
    if (dedupeKey && (dedupeActive || activeDedupeKeys.has(dedupeKey))) {
      const index = notifications.findIndex((item) => item.dedupe_key === dedupeKey);
      if (index !== -1) {
        const previous = notifications[index];
        notifications[index] = { ...next, id: previous.id, created_at: previous.created_at };
        if (previous.read || readIds.has(previous.id)) readIds.add(previous.id);
        return;
      }
    }
    const existingIndex = notifications.findIndex((item) => item.id === next.id);
    if (existingIndex === -1) notifications.push(next);
    else notifications[existingIndex] = { ...notifications[existingIndex], ...next };
  };

  load();

  return {
    setScope(nextScope = DEFAULT_SCOPE) {
      const next = cleanString(nextScope, DEFAULT_SCOPE, 180) || DEFAULT_SCOPE;
      if (next === scope) return this;
      persist();
      scope = next;
      load();
      return this;
    },

    hydrate(rawNotifications = []) {
      const incoming = Array.isArray(rawNotifications) ? rawNotifications : [];
      // Une clé absente du nouveau snapshot correspond à une résolution de
      // l’épisode courant ; son prochain retour pourra donc créer un nouvel
      // avis avec la même dedupe_key.
      const incomingDedupeKeys = new Set();
      for (const [index, raw] of incoming.entries()) {
        const next = normalizeNotification(raw, { now, index });
        if (!next) {
          const resolvedKey = cleanString(raw?.dedupe_key ?? raw?.dedupeKey, '', 160);
          if (resolvedKey) {
            serverDedupeKeys.delete(resolvedKey);
            activeDedupeKeys.delete(resolvedKey);
            if (localDedupeKeys.has(resolvedKey)) activeDedupeKeys.add(resolvedKey);
          }
          continue;
        }
        if (isExpired(next, now) || dismissedIds.has(next.id)) continue;
        const wasAlreadyIncoming = next.dedupe_key && incomingDedupeKeys.has(next.dedupe_key);
        const isKnownActive = next.dedupe_key && activeDedupeKeys.has(next.dedupe_key);
        replaceOrAppend(next, { dedupeActive: Boolean(wasAlreadyIncoming || isKnownActive) });
        if (next.dedupe_key) incomingDedupeKeys.add(next.dedupe_key);
        if (next.read) readIds.add(next.id);
      }
      for (const key of serverDedupeKeys) {
        if (!incomingDedupeKeys.has(key)) {
          activeDedupeKeys.delete(key);
          serverDedupeKeys.delete(key);
          if (localDedupeKeys.has(key)) activeDedupeKeys.add(key);
        }
      }
      for (const key of incomingDedupeKeys) {
        activeDedupeKeys.add(key);
        serverDedupeKeys.add(key);
      }
      prune();
      persist();
      return snapshot();
    },

    notify(raw) {
      const next = normalizeNotification({ ...raw, created_at: raw?.created_at ?? new Date(now()).toISOString() }, { now });
      if (!next || isExpired(next, now) || dismissedIds.has(next.id)) return null;
      replaceOrAppend(next);
      if (next.dedupe_key) {
        activeDedupeKeys.add(next.dedupe_key);
        localDedupeKeys.add(next.dedupe_key);
      }
      prune();
      persist();
      return snapshot().find((item) => item.id === next.id
        || (next.dedupe_key && item.dedupe_key === next.dedupe_key)) ?? null;
    },

    resolve(dedupeKey) {
      const key = cleanString(dedupeKey, '', 160);
      if (!key) return snapshot();
      activeDedupeKeys.delete(key);
      serverDedupeKeys.delete(key);
      localDedupeKeys.delete(key);
      persist();
      return snapshot();
    },

    markRead(id, read = true) {
      const key = String(id);
      if (read) readIds.add(key);
      else readIds.delete(key);
      notifications = notifications.map((item) => item.id === key ? { ...item, read } : item);
      persist();
      return snapshot();
    },

    markAllRead() {
      for (const item of notifications) readIds.add(item.id);
      notifications = notifications.map((item) => ({ ...item, read: true }));
      persist();
      return snapshot();
    },

    dismiss(id) {
      const key = String(id);
      dismissedIds.add(key);
      notifications = notifications.filter((item) => item.id !== key);
      readIds.delete(key);
      persist();
      return snapshot();
    },

    get(moduleId = null) { return snapshot(moduleId); },
    unreadCount(moduleId = null) {
      return Math.min(99, snapshot(moduleId).filter((item) => !item.read).length);
    },
    clearForTests() {
      clearMemory();
      try { storage?.removeItem?.(storageKeyForScope()); } catch { /* noop */ }
    },
  };
}

export const notificationCenter = createNotificationCenter();

export function notificationScope(session) {
  const mode = session?.demo_mode === true ? 'demo' : 'live';
  const channel = cleanString(session?.channel_id ?? session?.channel_login, 'channel', 100);
  const viewer = cleanString(
    session?.twitch_user_id ?? session?.user_login ?? session?.viewer_login,
    'viewer',
    100,
  );
  const scenario = mode === 'demo' ? cleanString(session?.demo_scenario, 'default', 100) : 'live';
  return `${mode}:${channel}:${viewer}:${scenario}`;
}

export function syncNotificationCenter(session) {
  notificationCenter.setScope(notificationScope(session));
  // Une réponse partielle de `/state` peut omettre le champ : son absence ne
  // constitue pas une résolution serveur et ne doit pas fermer un épisode.
  return Array.isArray(session?.notifications)
    ? notificationCenter.hydrate(session.notifications)
    : notificationCenter.get();
}

export const getNotifications = (moduleId = null) => notificationCenter.get(moduleId);
export const markNotificationRead = (id, read = true) => notificationCenter.markRead(id, read);
export const markAllNotificationsRead = () => notificationCenter.markAllRead();
export const dismissNotification = (id) => notificationCenter.dismiss(id);
export const notify = (raw) => notificationCenter.notify(raw);
export const resolveNotification = (dedupeKey) => notificationCenter.resolve(dedupeKey);
export const unreadNotificationCount = (moduleId = null) => notificationCenter.unreadCount(moduleId);
