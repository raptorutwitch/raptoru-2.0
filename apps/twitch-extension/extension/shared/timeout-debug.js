import { RUNTIME } from './runtime-config.js';

const BUILD_ID = String(RUNTIME.buildId || '');
const ENABLED = /(?:^|[-_.])timeout-debug(?:[-_.]|$)/i.test(BUILD_ID);
const PREFIX = '[RAPTORU TIMEOUT DEBUG]';
const STORAGE_KEY = 'raptoru.timeout-debug.v1';
const MAX_ENTRIES = 240;
const CONTEXT_FIELDS = Object.freeze([
  'arePlayerControlsVisible',
  'bitrate',
  'bufferSize',
  'displayResolution',
  'game',
  'hlsLatencyBroadcaster',
  'isFullScreen',
  'isMuted',
  'isPaused',
  'isTheatreMode',
  'language',
  'mode',
  'playbackMode',
  'theme',
  'videoResolution',
  'volume',
]);
const SENSITIVE_KEYS = /^(?:token|access_token|helix_token|authorization|auth|secret|sessiontoken)$/i;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g;
const BOOT_ID = globalThis.crypto?.randomUUID?.()
  || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const BOOT_TIME = globalThis.performance?.now?.() ?? Date.now();
let sequence = 0;
const memoryEntries = [];

function redactText(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(JWT_PATTERN, '[JWT redacted]')
    .replace(/([?&](?:token|access_token|jwt)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 320);
}

function sanitize(value, key = '', depth = 0) {
  if (SENSITIVE_KEYS.test(key)) return '[redacted]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitize(item, '', depth + 1));
  if (typeof value !== 'object' || depth >= 3) return undefined;
  return Object.fromEntries(Object.entries(value)
    .slice(0, 40)
    .filter(([childKey]) => !SENSITIVE_KEYS.test(childKey))
    .map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey, depth + 1)])
    .filter(([, childValue]) => childValue !== undefined));
}

function savedEntries() {
  try {
    const parsed = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function timeoutDebugEnabled() {
  return ENABLED;
}

export function timeoutDebugMetadata() {
  return { build_id: BUILD_ID || null, boot_id: BOOT_ID };
}

export function readTimeoutDebugTrace() {
  return { ...timeoutDebugMetadata(), entries: savedEntries() };
}

export function traceTimeoutDebug(event, details = {}) {
  if (!ENABLED) return null;
  const now = globalThis.performance?.now?.() ?? Date.now();
  const entry = {
    sequence: ++sequence,
    timestamp_utc: new Date().toISOString(),
    page_elapsed_ms: Math.max(0, Math.round(now - BOOT_TIME)),
    ...timeoutDebugMetadata(),
    event: redactText(event),
    ...sanitize(details),
  };
  memoryEntries.push(entry);
  if (memoryEntries.length > MAX_ENTRIES) memoryEntries.splice(0, memoryEntries.length - MAX_ENTRIES);
  try {
    const entries = [...savedEntries(), entry].slice(-MAX_ENTRIES);
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Console logging still works when storage is unavailable in the iframe.
  }
  globalThis.console?.info?.(PREFIX, entry);
  return entry;
}

export function summarizeTimeoutJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || typeof globalThis.atob !== 'function') return { parseable: false };
  try {
    const segment = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(globalThis.atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, '=')));
    return {
      parseable: true,
      channel_id: payload.channel_id == null ? null : String(payload.channel_id),
      user_id: payload.user_id == null ? null : String(payload.user_id),
      opaque_user_id: payload.opaque_user_id == null ? null : String(payload.opaque_user_id),
      role: payload.role == null ? null : String(payload.role),
      exp: Number.isFinite(Number(payload.exp)) ? Number(payload.exp) : null,
    };
  } catch {
    return { parseable: false };
  }
}

export function summarizeTimeoutContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const summary = Object.fromEntries(CONTEXT_FIELDS
    .filter((key) => context[key] !== undefined && context[key] !== null)
    .map((key) => [key, sanitize(context[key], key)]));
  if (context.hostingInfo && typeof context.hostingInfo === 'object') {
    summary.hostingInfo = {
      hostedChannelId: context.hostingInfo.hostedChannelId == null
        ? null : String(context.hostingInfo.hostedChannelId),
      hostingChannelId: context.hostingInfo.hostingChannelId == null
        ? null : String(context.hostingInfo.hostingChannelId),
    };
  }
  return summary;
}

function elementSnapshot(element) {
  if (!element) return { present: false };
  const rect = element.getBoundingClientRect();
  let style;
  try {
    const computed = getComputedStyle(element);
    style = {
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
    };
  } catch {
    style = { unavailable: true };
  }
  return {
    present: true,
    tag: element.tagName?.toLowerCase() || null,
    id: element.id || null,
    class_name: typeof element.className === 'string' ? element.className.slice(0, 180) : null,
    hidden: Boolean(element.hidden),
    ...style,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

export function installTimeoutDebugLifecycle({ isComponentView = false, getOpen = () => null } = {}) {
  if (!ENABLED || typeof document === 'undefined' || typeof window === 'undefined') return () => {};

  const snapshot = (reason) => {
    let frameElement = null;
    try {
      frameElement = window.frameElement;
    } catch {
      // Cross-origin parent boundaries may make this unavailable.
    }
    return {
      reason,
      document_visibility: document.visibilityState,
      ready_state: document.readyState,
      is_component_view: Boolean(isComponentView),
      app_open: getOpen(),
      body_classes: document.body?.className || '',
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        device_pixel_ratio: window.devicePixelRatio || 1,
      },
      frame_element_accessible: Boolean(frameElement),
      frame: elementSnapshot(frameElement),
      elements: {
        document: elementSnapshot(document.documentElement),
        body: elementSnapshot(document.body),
        root: elementSnapshot(document.getElementById('panel')),
        drawer: elementSnapshot(document.getElementById('drawer')),
        dock: elementSnapshot(document.querySelector('.dock')),
      },
    };
  };
  const traceDom = (reason = 'manual') => traceTimeoutDebug('dom.snapshot', snapshot(reason));
  const traceLifecycle = (event, extra = {}) => {
    traceTimeoutDebug(`lifecycle.${event}`, { ...extra, ...snapshot(event) });
  };

  const listeners = [
    [document, 'DOMContentLoaded', () => traceLifecycle('DOMContentLoaded')],
    [window, 'load', () => traceLifecycle('load')],
    [document, 'visibilitychange', () => traceLifecycle('visibilitychange')],
    [window, 'pagehide', (event) => traceLifecycle('pagehide', { persisted: Boolean(event.persisted) })],
    [window, 'pageshow', (event) => traceLifecycle('pageshow', { persisted: Boolean(event.persisted) })],
    [window, 'beforeunload', () => traceLifecycle('beforeunload')],
    [window, 'unload', () => traceLifecycle('unload')],
    [window, 'error', (event) => traceTimeoutDebug('runtime.window.error', {
      message: redactText(event.message || ''),
      source_path: (() => { try { return new URL(event.filename).pathname; } catch { return null; } })(),
      line: Number(event.lineno) || null,
      column: Number(event.colno) || null,
      resource_error: !event.message,
    })],
    [window, 'unhandledrejection', (event) => traceTimeoutDebug('runtime.unhandledrejection', {
      reason_name: event.reason?.name ? String(event.reason.name) : null,
      reason_message: redactText(event.reason?.message ?? event.reason ?? ''),
    })],
  ];
  for (const [target, name, callback] of listeners) target.addEventListener(name, callback, true);

  globalThis.__RAPTORU_TIMEOUT_DEBUG__ = Object.freeze({
    ...timeoutDebugMetadata(),
    read: readTimeoutDebugTrace,
    snapshot: traceDom,
  });
  traceLifecycle('boot');
  const sampleTimer = window.setInterval(() => traceDom('periodic'), 2_000);
  return () => {
    window.clearInterval(sampleTimer);
    for (const [target, name, callback] of listeners) target.removeEventListener(name, callback, true);
  };
}
