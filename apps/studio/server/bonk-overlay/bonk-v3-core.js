export const BONK_V3_EVENT = 'raptoru_bonk_v3';
export const BONK_V3_PROTOCOL = 'RAPTORU_EXT_BONK_V3';
export const BONK_V3_RENDERER = 'bonk-v3';
export const BONK_V3_ENGINE = 'bonk-v3-core';
export const BONK_V3_WIDTH = 1920;
export const BONK_V3_HEIGHT = 1080;

const GRAVITY = 3800;
const TARGET_SPEED = 2600;
const STEP = 0.016;
const OFFSCREEN_MARGIN = 220;
const FLOOR_MARGIN = 18;
const DEFAULT_CAMERA = Object.freeze({ x: 760, y: 160, w: 480, h: 300 });
const MIN_TOTAL_DURATION = 2.6;
const MIN_GROUND_HOLD = 0.72;
const MAX_GROUND_HOLD = 0.98;
const EXIT_TIME_MARGIN = 0.32;
const SHRINK_GROW_TIME = 0.12;
const SHRINK_EXIT_TIME = 0.42;
const EMOJI_SEGMENTER = typeof Intl?.Segmenter === 'function'
  ? new Intl.Segmenter('fr', { granularity: 'grapheme' })
  : null;

// Le premier poids est la probabilité de rester sur le son principal. Les
// poids des entrées suivantes sont relatifs entre variantes secondaires. Cette
// représentation conserve exactement la sélection historique tout en
// permettant d'ajouter un impact avec une seule entrée fichier + poids.
export const BONK_V3_IMPACT_POOL = Object.freeze([
  Object.freeze({ file: 'Bonk Sound Effect.mp3', weight: 0.6 }),
  Object.freeze({ file: 'Punch 2.mp3', weight: 1 }),
  Object.freeze({ file: 'Punch 3.mp3', weight: 1 }),
  Object.freeze({ file: 'Punch 4.mp3', weight: 1 }),
  Object.freeze({ file: 'Punch 5.mp3', weight: 1 }),
  Object.freeze({ file: 'Punch 6.mp3', weight: 1 }),
  Object.freeze({ file: 'Minecraft Oof.mp3', weight: 1 }),
]);

export const BONK_V3_SOUND_FILES = Object.freeze(
  BONK_V3_IMPACT_POOL.map(({ file }) => file),
);

export const BONK_COMBO_WINDOW_MS = 5000;
export const BONK_COMBO_WINDOWS_MS = Object.freeze([5000, 4000, 3500, 3000, 2500, 2000]);
export const BONK_GIGA_MIN_UNIQUE_BONKERS = 2;
export const BONK_GIGA_MAX_SCALE = 4.8;
export const BONK_GIGA_MAX_SIZE = 620;
export const BONK_GIGA_MIN_HOLD_MS = 1800;
export const BONK_GIGA_MAX_HOLD_MS = 3000;

export function seedFromReference(value = '') {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}

export function createSeededRandom(seed) {
  let state = Number(seed) >>> 0 || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(random, min, max) {
  return min + random() * (max - min);
}

function randomChoice(random, values) {
  return values[Math.floor(random() * values.length)];
}

export function bonkComboWindowMs(count) {
  const index = Math.max(0, Math.min(BONK_COMBO_WINDOWS_MS.length - 1, Number(count) - 1));
  return BONK_COMBO_WINDOWS_MS[index] ?? BONK_COMBO_WINDOW_MS;
}

export function shouldPopBonkComboCounter(previousCount, nextCount) {
  const count = Number(nextCount);
  if (!Number.isFinite(count) || count < 2) return false;
  if (previousCount === null || previousCount === undefined) return true;
  return Number(previousCount) !== count;
}

export function shouldStartGigaBonk(uniqueBonkers) {
  return Number(uniqueBonkers) >= BONK_GIGA_MIN_UNIQUE_BONKERS;
}

export function bonkGigaScale(uniqueBonkers) {
  const count = Math.max(0, Math.trunc(Number(uniqueBonkers) || 0));
  if (count < BONK_GIGA_MIN_UNIQUE_BONKERS) return 1;
  const steps = [0, 0, 1.5, 2, 2.6, 3.3, 4];
  if (count < steps.length) return steps[count];
  return Math.min(BONK_GIGA_MAX_SCALE, 4 + Math.sqrt(count - 6) * .38);
}

export function bonkGigaHoldMs(uniqueBonkers) {
  const count = Math.max(0, Math.trunc(Number(uniqueBonkers) || 0));
  return Math.round(Math.min(
    BONK_GIGA_MAX_HOLD_MS,
    Math.max(BONK_GIGA_MIN_HOLD_MS, BONK_GIGA_MIN_HOLD_MS + Math.max(0, count - 2) * 180),
  ));
}

export function bonkGigaIntensity(uniqueBonkers) {
  const count = Math.max(0, Math.trunc(Number(uniqueBonkers) || 0));
  return Math.min(1.6, 1 + Math.max(0, count - 2) * .075);
}

export function unwrapBonkPayload(raw = {}) {
  let data = raw && typeof raw === 'object' ? raw : {};
  const visited = new Set();
  for (let depth = 0; depth < 6 && data && typeof data === 'object'; depth += 1) {
    if (visited.has(data)) break;
    visited.add(data);
    const nested = data.event_data ?? data.eventData ?? data.requestData ?? data.detail;
    if (!nested || typeof nested !== 'object' || nested === data) break;
    data = nested;
  }
  return data;
}

function normalizeNativeTwitchEmoteValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return String(value).trim();
}

export function normalizeBonkViewerId(value) {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) ? id : '';
}

export function bonkEmoteIdentity({ message = '', image = '', emoteId = '', emotes = '', emoteSource = '' } = {}) {
  const source = String(emoteSource || '').trim().toLowerCase() || 'unknown';
  const identifier = String(emoteId || '').trim()
    || String(emotes || '').trim()
    || normalizeBonkEmoteToken(message)
    || String(image || '').trim();
  return identifier ? `${source}:${identifier}` : '';
}

export function normalizeBonkPayload(raw = {}) {
  const data = unwrapBonkPayload(raw);
  const x = finite(data.x, DEFAULT_CAMERA.x);
  const y = finite(data.y, DEFAULT_CAMERA.y);
  const w = Math.max(1, finite(data.w ?? data.width, DEFAULT_CAMERA.w));
  const h = Math.max(1, finite(data.h ?? data.height, DEFAULT_CAMERA.h));
  const normalized = {
    x,
    y,
    w,
    h,
    impactX: finite(data.impactX, x + w * 0.45),
    impactY: finite(data.impactY, y + h * 0.47),
    message: String(data.message ?? data.emoji ?? data.item ?? '').trim(),
    image: String(data.image ?? data.img ?? data.emote_url ?? '').trim(),
    emoteId: normalizeNativeTwitchEmoteValue(data.emote_id ?? data.emoteId ?? ''),
    emotes: normalizeNativeTwitchEmoteValue(data.emotes ?? data.emote_list ?? data.emoteList ?? ''),
    emoteSource: String(data.emote_source ?? data.emoteSource ?? '').trim().toLowerCase(),
    channel: String(data.channel ?? data.channel_login ?? '').trim().toLowerCase(),
    viewerLogin: String(data.viewer_login ?? data.viewerLogin ?? '').trim(),
    viewerId: normalizeBonkViewerId(
      data.viewer_id ?? data.viewerId ?? data.twitch_user_id ?? data.twitchUserId,
    ),
    referenceId: String(data.reference_id ?? data.referenceId ?? '').trim(),
  };
  return { ...normalized, emoteKey: bonkEmoteIdentity(normalized) };
}

export function distinctBonkEmotePool(items = []) {
  const pool = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.emoteKey || bonkEmoteIdentity(item) || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pool.push(item);
  }
  return pool;
}

export function selectBonkGigaEmote(items = [], random = Math.random) {
  const pool = distinctBonkEmotePool(items);
  if (!pool.length) return null;
  const sample = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
  return pool[Math.floor(sample * pool.length)] || pool[0];
}

/**
 * Le bouton chat doit transmettre une seule emote, jamais une phrase ou le
 * nom d'une autre emote trouvé dans le même message.
 */
export function normalizeBonkEmoteToken(value) {
  let source = String(value ?? '').trim();
  source = source.replace(/^!bonk(?:\s+|$)/i, '').trim();
  if (!source || /\s/u.test(source)) return '';
  return source;
}

/**
 * Chat et extension passent par le même échantillonnage : la largeur caméra
 * ajuste légèrement le gabarit, sans transformer une emote en plein écran.
 */
export function sampleBonkSize(random = Math.random, cameraWidth = DEFAULT_CAMERA.w) {
  const width = clamp(finite(cameraWidth, DEFAULT_CAMERA.w), 320, BONK_V3_WIDTH);
  const base = clamp(126 + (width - DEFAULT_CAMERA.w) * 0.018, 118, 145);
  const sample = clamp(finite(random(), 0.5), 0, 1);
  const centered = sample < 0.5
    ? Math.sqrt(sample / 2)
    : 1 - Math.sqrt((1 - sample) / 2);
  return base * (0.45 + centered * 1.1);
}

export function isSingleUnicodeEmoji(value) {
  const source = String(value ?? '').trim();
  if (!source || source.length > 32) return false;
  const graphemes = EMOJI_SEGMENTER
    ? [...EMOJI_SEGMENTER.segment(source)]
    : [...source];
  return graphemes.length === 1
    && /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u.test(source);
}

/**
 * Les catalogues sont indexés sur le nom exact. Une entrée null/ambiguous est
 * volontairement bloquante : deux fournisseurs ne doivent jamais entraîner
 * le choix silencieux de l'une des deux images.
 */
export function resolveExactBonkCatalogImage(token, { channel = null, global = null } = {}) {
  const key = normalizeBonkEmoteToken(token);
  if (!key) return '';

  const lookup = (catalog) => {
    if (!(catalog instanceof Map) || !catalog.has(key)) return undefined;
    const entry = catalog.get(key);
    if (!entry || entry.ambiguous) return null;
    return typeof entry === 'object' ? String(entry.url || '') : String(entry);
  };

  const channelImage = lookup(channel);
  if (channelImage !== undefined) return channelImage;
  const globalImage = lookup(global);
  return globalImage === undefined ? '' : globalImage;
}

export function createOnceGate(callback) {
  let fired = false;
  return (...args) => {
    if (fired) return false;
    fired = true;
    callback(...args);
    return true;
  };
}

export function createBonkImpactGate({ onVisual = () => {}, onAudio = () => {}, onCombo = () => {} } = {}) {
  return createOnceGate(() => {
    onVisual();
    onAudio();
    onCombo();
  });
}

export function selectBonkImpactSound(random) {
  const [primary, ...variants] = BONK_V3_IMPACT_POOL;
  let selected = primary;
  if (!(random() < Number(primary?.weight)) && variants.length) {
    const totalWeight = variants.reduce((sum, variant) => sum + Number(variant.weight), 0);
    let target = random() * totalWeight;
    selected = variants.find((variant) => {
      target -= Number(variant.weight);
      return target < 0;
    }) || variants.at(-1);
  }
  return {
    file: selected.file,
    playbackRate: .94 + random() * .12,
  };
}

export function resolveBonkAudioUrl(file, { audioBase = '', documentBase = '' } = {}) {
  const name = String(file || '').trim();
  if (!name) return '';
  const base = String(audioBase || '').trim();
  const root = String(documentBase || '').trim();
  try {
    const documentUrl = root ? new URL(root) : null;
    const audioRoot = base ? new URL(base, documentUrl || undefined) : documentUrl;
    return audioRoot ? new URL(name, audioRoot).href : name;
  } catch {
    return name;
  }
}

export function createBonkComboController({
  windowMs = BONK_COMBO_WINDOW_MS,
  windowForCount = bonkComboWindowMs,
  now = () => Date.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  onUpdate = () => {},
  onFinish = () => {},
} = {}) {
  let entries = [];
  let expiresAt = null;
  let timer = null;
  let generation = 0;
  let windowSequence = 0;
  let activeWindowId = null;

  const snapshot = () => {
    const items = entries.filter((entry) => entry.impacted).map((entry) => entry.item);
    const uniqueBonkers = [...new Set(items
      .map((item) => normalizeBonkViewerId(item?.viewerId ?? item?.viewer_id ?? item?.twitch_user_id))
      .filter(Boolean))];
    const emotePool = distinctBonkEmotePool(items);
    return {
      windowId: activeWindowId,
      count: items.length,
      hitCount: items.length,
      hit_count: items.length,
      items,
      candidateCount: entries.length,
      uniqueBonkers: uniqueBonkers.length,
      unique_bonkers: uniqueBonkers.length,
      uniqueBonkerIds: uniqueBonkers,
      emotePool,
      emote_pool: emotePool,
      expiresAt,
    };
  };
  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    generation += 1;
  };
  const finish = () => {
    if (!entries.length) return null;
    const completed = snapshot();
    entries = [];
    expiresAt = null;
    activeWindowId = null;
    clearTimer();
    onFinish(completed);
    return completed;
  };
  const add = (item, { deferImpact = false } = {}) => {
    const timestamp = Number(now());
    if (expiresAt !== null && timestamp >= expiresAt) finish();
    if (!entries.length) activeWindowId = ++windowSequence;
    entries.push({ item, impacted: !deferImpact });
    const selectedWindow = Number(windowForCount(entries.length));
    expiresAt = timestamp + Math.max(0, Number.isFinite(selectedWindow) ? selectedWindow : BONK_COMBO_WINDOW_MS);
    clearTimer();
    const token = generation;
    timer = schedule(() => {
      if (token === generation) finish();
    }, Math.max(0, expiresAt - timestamp));
    const current = snapshot();
    onUpdate(current);
    return current;
  };

  const impact = (referenceId) => {
    const key = String(referenceId || '').trim();
    const entry = entries.find((candidate) => !candidate.impacted
      && (!key || String(candidate.item?.referenceId || '').trim() === key));
    if (!entry) return false;
    entry.impacted = true;
    onUpdate(snapshot());
    return true;
  };

  return {
    add,
    impact,
    finish,
    reset() {
      entries = [];
      expiresAt = null;
      activeWindowId = null;
      clearTimer();
    },
    getState: snapshot,
  };
}

export function firstTwitchEmoteId(tag) {
  const source = String(tag || '').trim();
  if (/^\d+$/.test(source)) return source;
  let best = '';
  let bestPosition = Number.POSITIVE_INFINITY;
  for (const part of source.split('/')) {
    const separator = part.indexOf(':');
    if (separator < 1) continue;
    const id = part.slice(0, separator);
    for (const range of part.slice(separator + 1).split(',')) {
      const position = Number.parseInt(range.split('-')[0], 10);
      if (/^\d+$/.test(id) && Number.isFinite(position) && position < bestPosition) {
        best = id;
        bestPosition = position;
      }
    }
  }
  return best;
}

export function singleTwitchEmoteId(tag) {
  const ids = [];
  const visit = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'number' && Number.isInteger(value)) {
      ids.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      for (const key of ['id', 'emote_id', 'emoteId', 'twitch_id', 'twitchId']) {
        if (value[key] !== undefined) visit(value[key]);
      }
      for (const key of ['emotes', 'emote_list', 'emoteList']) {
        if (value[key] !== undefined) visit(value[key]);
      }
      for (const key of Object.keys(value)) {
        if (/^\d+$/.test(key)) ids.push(key);
      }
      return;
    }
    const source = String(value).trim();
    if (!source) return;
    if ((source.startsWith('{') || source.startsWith('['))) {
      try { visit(JSON.parse(source)); return; } catch { /* continue with native text */ }
    }
    for (const part of source.split('/')) {
      const direct = part.match(/^twitch:(\d+)$/i);
      if (direct) ids.push(direct[1]);
      const native = part.match(/^(\d+)(?::\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)?$/);
      if (native) ids.push(native[1]);
      const named = part.match(/^(?:id|emote[_-]?id)[:=](\d+)$/i);
      if (named) ids.push(named[1]);
    }
  };
  visit(tag);
  const unique = [...new Set(ids)];
  if (unique.length === 1) return unique[0];
  const source = String(tag || '').trim();
  if (/^\d+$/.test(source)) return source;
  return '';
}

export function maximizeEmoteImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.hostname === 'static-cdn.jtvnw.net') {
      url.pathname = url.pathname.replace(/\/(?:1|2)\.0$/, '/3.0');
    } else if (url.hostname === 'cdn.7tv.app') {
      url.pathname = url.pathname.replace(/\/[123]x\.(?:webp|avif|png)$/i, '/4x.webp');
    } else if (url.hostname === 'cdn.betterttv.net') {
      url.pathname = url.pathname.replace(/\/[12]x$/i, '/3x');
    }
    return url.href;
  } catch {
    return '';
  }
}

/**
 * Twitch IRC ne fournit que l'identifiant et les positions de l'emote, pas son
 * format média. Le format historique `default` laisse Twitch choisir la bonne
 * représentation (animée pour une emote animée), puis les formats explicites
 * servent de replis. Le renderer choisit la première qui se charge.
 */
export function twitchEmoteImageCandidates(emoteId) {
  const id = String(emoteId || '').trim();
  if (!/^\d+$/.test(id)) return [];
  const encoded = encodeURIComponent(id);
  return [
    `https://static-cdn.jtvnw.net/emoticons/v2/${encoded}/default/dark/3.0`,
    `https://static-cdn.jtvnw.net/emoticons/v2/${encoded}/animated/dark/3.0`,
    `https://static-cdn.jtvnw.net/emoticons/v2/${encoded}/static/dark/3.0`,
  ];
}

export function buildBonkTrajectory({
  impactX,
  impactY,
  size = 150,
  referenceId = '',
  random: suppliedRandom,
  minimumGroundHoldMs = null,
  maxExitSeconds = 4.5,
} = {}) {
  const random = suppliedRandom || createSeededRandom(seedFromReference(referenceId || `${impactX}:${impactY}`));
  const targetX = finite(impactX, DEFAULT_CAMERA.x + DEFAULT_CAMERA.w * 0.45);
  const targetY = finite(impactY, DEFAULT_CAMERA.y + DEFAULT_CAMERA.h * 0.47);
  const objectRadius = clamp(finite(size, 150) * 0.46, 34, 320);
  const floorY = BONK_V3_HEIGHT - FLOOR_MARGIN - objectRadius;
  const side = randomChoice(random, ['top', 'top', 'left', 'right', 'topleft', 'topright']);
  let x0;
  let y0;
  if (side === 'top') {
    x0 = targetX + randomBetween(random, -380, 380);
    y0 = -OFFSCREEN_MARGIN;
  } else if (side === 'left') {
    x0 = -OFFSCREEN_MARGIN;
    y0 = targetY - randomBetween(random, 120, 440);
  } else if (side === 'right') {
    x0 = BONK_V3_WIDTH + OFFSCREEN_MARGIN;
    y0 = targetY - randomBetween(random, 120, 440);
  } else if (side === 'topleft') {
    x0 = -OFFSCREEN_MARGIN;
    y0 = -OFFSCREEN_MARGIN;
  } else {
    x0 = BONK_V3_WIDTH + OFFSCREEN_MARGIN;
    y0 = -OFFSCREEN_MARGIN;
  }

  const distance = Math.hypot(targetX - x0, targetY - y0);
  const impactTime = clamp(distance / TARGET_SPEED, 0.34, 0.85);
  const initialVx = (targetX - x0) / impactTime;
  const initialVy = (targetY - y0 - 0.5 * GRAVITY * impactTime ** 2) / impactTime;
  const impactVy = initialVy + GRAVITY * impactTime;
  let vx = initialVx * randomBetween(random, 0.7, 1.0);
  let vy = -randomBetween(random, 0.42, 0.82) * impactVy;
  const largeRotation = random() < 0.5;
  const rotationDirection = random() < 0.5 ? -1 : 1;
  const rotationSpeed = rotationDirection * randomBetween(
    random,
    largeRotation ? 250 : 35,
    largeRotation ? 620 : 145,
  );

  const points = [];
  for (let t = 0; t < impactTime - 1e-6; t += STEP) {
    points.push({
      t,
      x: x0 + initialVx * t,
      y: y0 + initialVy * t + 0.5 * GRAVITY * t ** 2,
      phase: 'approach',
    });
  }
  points.push({ t: impactTime, x: targetX, y: targetY, phase: 'impact' });

  let x = targetX;
  let y = targetY;
  let t = impactTime;
  let floorTime = null;
  let rollStart = null;
  let phase = 'camera-bounce';
  let groundedUntil = null;
  while (t < 3.25 && floorTime === null) {
    const step = Math.min(STEP, 3.25 - t);
    const previousY = y;
    x += vx * step;
    vy += GRAVITY * step;
    y += vy * step;
    t += step;
    if (x <= objectRadius && vx < 0) {
      x = objectRadius;
      vx = Math.abs(vx) * randomBetween(random, 0.58, 0.76);
    } else if (x >= BONK_V3_WIDTH - objectRadius && vx > 0) {
      x = BONK_V3_WIDTH - objectRadius;
      vx = -Math.abs(vx) * randomBetween(random, 0.58, 0.76);
    }
    if (y >= floorY && previousY < floorY && vy > 0) {
      y = floorY;
      vy = 0;
      floorTime = t;
      // Une pose courte et reproductible. La borne minimale garde une durée
      // visuelle suffisante même pour un impact caméra très précoce.
      const naturalHold = randomBetween(random, MIN_GROUND_HOLD, MAX_GROUND_HOLD);
      const requestedHold = Number.isFinite(Number(minimumGroundHoldMs))
        ? Math.max(MIN_GROUND_HOLD, Number(minimumGroundHoldMs) / 1000)
        : MIN_GROUND_HOLD;
      const minimumHold = Math.max(
        MIN_GROUND_HOLD,
        MIN_TOTAL_DURATION - floorTime - EXIT_TIME_MARGIN,
      );
      groundedUntil = floorTime + Math.max(naturalHold, minimumHold, requestedHold);
      vx *= randomBetween(random, 0.66, 0.82);
      phase = 'roll';
      rollStart = { t, x };
    }
    points.push({ t, x, y, phase });
  }

  if (floorTime !== null && groundedUntil !== null) {
    while (t < groundedUntil) {
      const step = Math.min(STEP, groundedUntil - t);
      x += vx * step;
      // Le sol est une contrainte, pas une nouvelle phase de chute : y reste
      // strictement égal à floorY pendant toute la pose.
      y = floorY;
      vx *= Math.exp(-1.6 * step);
      t += step;
      points.push({ t, x, y, phase: 'roll' });
    }
  }

  phase = 'exit';
  const exitMode = random() < 0.5 ? 'fall' : 'shrink';
  const exitDirection = Math.sign(vx || rotationDirection) || 1;
  const exitTarget = exitDirection > 0
    ? BONK_V3_WIDTH + OFFSCREEN_MARGIN + objectRadius
    : -OFFSCREEN_MARGIN - objectRadius;
  const exitVx = exitDirection * Math.max(520, Math.abs(vx));
  const exitStart = t;
  const exitLimit = Math.max(
    4.5,
    Number(maxExitSeconds) || 0,
    groundedUntil === null ? 0 : groundedUntil + 1.5,
  );
  if (exitMode === 'shrink') {
    const shrinkEnd = exitStart + SHRINK_GROW_TIME + SHRINK_EXIT_TIME;
    while (t < shrinkEnd) {
      const step = Math.min(STEP, shrinkEnd - t);
      x += exitVx * step;
      t += step;
      const elapsed = Math.max(0, t - exitStart);
      const shrinkProgress = clamp(
        (elapsed - SHRINK_GROW_TIME) / SHRINK_EXIT_TIME,
        0,
        1,
      );
      const exitScale = elapsed < SHRINK_GROW_TIME
        ? 1 + 0.08 * (elapsed / SHRINK_GROW_TIME)
        : 1.08 - 1.07 * shrinkProgress;
      points.push({ t, x, y: floorY, phase, exitScale });
    }
  } else while (t < exitLimit && (
    (exitDirection > 0 ? x < exitTarget : x > exitTarget)
    || y < BONK_V3_HEIGHT + OFFSCREEN_MARGIN
  )) {
    const step = Math.min(STEP, exitLimit - t);
    x += exitVx * step;
    t += step;
    const elapsed = Math.max(0, t - exitStart);
    // Le sol virtuel cesse d'exister à la fin de la pose ; la chute reprend
    // alors avec une vitesse verticale nulle et la gravité normale.
    y = floorY + 0.5 * GRAVITY * elapsed ** 2;
    points.push({ t, x, y, phase });
  }

  const durationSeconds = points.at(-1).t;
  let previousOffset = -1;
  const keyframes = points.map((point) => {
    let offset = point.t / durationSeconds;
    if (offset <= previousOffset) offset = previousOffset + 0.000001;
    offset = Math.min(1, offset);
    previousOffset = offset;
    const rotation = rollStart && point.t >= rollStart.t
      ? rotationSpeed * rollStart.t + ((point.x - rollStart.x) / objectRadius) * (180 / Math.PI)
      : rotationSpeed * point.t;
    let sx = 1;
    let sy = 1;
    const distanceFromImpact = Math.abs(point.t - impactTime);
    if (distanceFromImpact < 0.045) {
      const strength = 1 - distanceFromImpact / 0.045;
      sx = 1 + 0.16 * strength;
      sy = 1 - 0.16 * strength;
    }
    const exitScale = point.phase === 'exit' ? (point.exitScale ?? 1) : 1;
    sx *= exitScale;
    sy *= exitScale;
    return {
      offset,
      transform: `translate(-50%, -50%) translate(${(point.x - targetX).toFixed(1)}px, ${(point.y - targetY).toFixed(1)}px) rotate(${rotation.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`,
    };
  });
  keyframes.at(-1).offset = 1;

  return {
    side,
    points,
    keyframes,
    impactMs: Math.round(impactTime * 1000),
    floorMs: floorTime === null ? null : Math.round(floorTime * 1000),
    groundEndMs: groundedUntil === null ? null : Math.round(groundedUntil * 1000),
    exitMode,
    duration: Math.round(durationSeconds * 1000),
  };
}

export function createBonkReferenceGuard(limit = 500) {
  const seen = new Set();
  return {
    accept(referenceId) {
      const key = String(referenceId || '').trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > limit) seen.delete(seen.values().next().value);
      return true;
    },
    size() { return seen.size; },
  };
}
