// TTS V2 — single shared source of the characters, their voice profiles and their UI calibration.
// Read by the extension (preview, shuffle, reveal, cast info) and by the Studio TTS player (stage,
// Web Speech). Core owns the cast decision; its catalog (ids, weights, categories) is checked
// against this file by a Core test. Values ported unchanged from the validated prototypes:
// `prototypes/tts-v2-player/characters.js` (profiles, stage, bubble, timings — legacy TTS_System.html)
// and `prototypes/tts-v2-extension-ux` D3 (portrait boxes, final calibration of 2026-09-30).

export const TTS_ASSET_DIR = 'assets/tts';

// Legacy timings: introLead 600 (capped at 550), outroHold 250, bubbleDelay 120, mouth closed after
// 350 ms without a word (800 for the Golem).
const T = { introLeadMs: 550, outroHoldMs: 250, bubbleDelayMs: 120, mouthHoldMs: 350 };

/** @type {Record<string, {id:string, engine:'webspeech', label:string, lang:string, match:string[], rate:number, pitch:number, variationRate:number, variationPitch:number, strict?:boolean}>} */
export const VOICE_PROFILES = {};
const voice = (id, label, lang, match, rate, pitch, variationRate, variationPitch, extra) => {
  VOICE_PROFILES[id] = { id, engine: 'webspeech', label, lang, match, rate, pitch, variationRate, variationPitch, ...(extra || {}) };
};
voice('mikasa.julie', 'Julie', 'fr-FR', ['julie'], 0.94, 0.78, 0.04, 0.05);
voice('mikasa.hortense', 'Hortense', 'fr-FR', ['hortense'], 0.94, 0.78, 0.04, 0.05);
voice('mikasa.caroline', 'Caroline', 'fr-FR', ['caroline'], 0.94, 0.78, 0.04, 0.05);
voice('mikasa.haruka', 'Haruka (JP)', 'ja-JP', ['haruka'], 0.94, 0.78, 0.04, 0.05);
voice('mikasa.ayumi', 'Ayumi (JP)', 'ja-JP', ['ayumi'], 0.94, 0.78, 0.04, 0.05);
voice('mikasa.sayaka', 'Sayaka (JP)', 'ja-JP', ['sayaka'], 0.94, 0.78, 0.04, 0.05);
voice('c21.julie', 'Julie', 'fr-FR', ['julie'], 1.12, 1.28, 0.06, 0.08);
voice('c21.hortense', 'Hortense', 'fr-FR', ['hortense'], 1.12, 1.28, 0.06, 0.08);
voice('c21.nathalie', 'Nathalie', 'fr-FR', ['nathalie'], 1.12, 1.28, 0.06, 0.08);
voice('c21.sayaka', 'Sayaka (JP)', 'ja-JP', ['sayaka'], 1.12, 1.28, 0.06, 0.08);
voice('c21.ayumi', 'Ayumi (JP)', 'ja-JP', ['ayumi'], 1.12, 1.28, 0.06, 0.08);
voice('c21.haruka', 'Haruka (JP)', 'ja-JP', ['haruka'], 1.12, 1.28, 0.06, 0.08);
voice('zote.paul', 'Paul', 'fr-FR', ['microsoft paul', 'paul'], 0.85, 0.68, 0.04, 0.06);
voice('zote.fr-male', 'Voix FR (repli)', 'fr-FR', ['fr-fr', 'french', 'francais', 'homme', 'male'], 0.85, 0.68, 0.04, 0.06);
voice('andras.paul', 'Paul', 'fr-FR', ['microsoft paul', 'paul'], 1.0, 1.0, 0, 0);
voice('andras.fr-male', 'Voix FR (repli)', 'fr-FR', ['fr-fr', 'french', 'francais', 'homme', 'male'], 1.0, 1.0, 0, 0);
voice('golem.claude', 'Claude (CA)', 'fr-CA', ['claude'], 0.76, 0.5, 0.025, 0.05);
voice('golem.paul', 'Paul', 'fr-CA', ['paul'], 0.76, 0.5, 0.025, 0.05);
voice('variant.bourre', 'Bourré (Claude CA)', 'fr-CA', ['microsoft claude', 'claude'], 0.35, 0.6, 0.05, 0.2, { strict: true });

// portrait: head box (fractions of the frame) — base of the « portrait » calibration.
// calibration: final values chosen in the calibration tool (x, y in fractions of the box; scale; degrees).
export const CHARACTERS = [
  {
    id: 'mikasa', displayName: 'Mikasa', accent: '#e0555c', renderMode: 'layered',
    assets: { idle: 'Mikasa Blabla.webm', mouth: 'Mikasa Bouche.webm' },
    frame: { width: 1920, height: 1080 },
    silhouette: { x: 0.416, y: 0.476, w: 0.321, h: 0.524 },
    portrait: { x: 0.43, y: 0.455, w: 0.13, h: 0.205 },
    calibration: { portrait: { x: -0.415, y: -0.175, scale: 0.96, rotation: 0.5 }, card: { x: 0, y: 0.005, scale: 1.07, rotation: 0 } },
    preview: { asset: 'idle', timeS: 0.5 },
    stage: { scale: 0.78, offsetX: -400, offsetY: 7 },
    bubble: { left: '57%', bottom: 32, width: 760, subtitleChars: 68 },
    talkMotion: { preset: 'bounce', amplitudePx: 7 },
    timing: { ...T },
    voicePool: [
      { voiceProfileId: 'mikasa.julie', weight: 4, category: 'normal' },
      { voiceProfileId: 'mikasa.hortense', weight: 2, category: 'normal' },
      { voiceProfileId: 'mikasa.caroline', weight: 1, category: 'normal' },
      { voiceProfileId: 'mikasa.haruka', weight: 1, category: 'japanese' },
      { voiceProfileId: 'mikasa.ayumi', weight: 1, category: 'japanese' },
      { voiceProfileId: 'mikasa.sayaka', weight: 1, category: 'japanese' },
    ],
  },
  {
    id: 'c21', displayName: 'C21', accent: '#e89bd4', renderMode: 'swap',
    assets: { idle: 'C21 Fixe Clean.webm', talking: 'C21 Blabla clean.webm' },
    frame: { width: 1920, height: 1080 },
    silhouette: { x: 0.657, y: 0.506, w: 0.23, h: 0.494 },
    portrait: { x: 0.695, y: 0.575, w: 0.105, h: 0.19 },
    calibration: { portrait: { x: -0.175, y: -0.145, scale: 0.84, rotation: 0 }, card: { x: 0, y: 0, scale: 1, rotation: 0 } },
    preview: { asset: 'idle', timeS: 0.5 },
    stage: { scale: 0.72, offsetX: 225, offsetY: 0 },
    bubble: { left: '54%', bottom: 48, width: 780, subtitleChars: 68 },
    talkMotion: { preset: 'none', amplitudePx: 0 },
    timing: { ...T },
    voicePool: [
      { voiceProfileId: 'c21.julie', weight: 4, category: 'normal' },
      { voiceProfileId: 'c21.hortense', weight: 2, category: 'normal' },
      { voiceProfileId: 'c21.nathalie', weight: 1, category: 'normal' },
      { voiceProfileId: 'c21.sayaka', weight: 1, category: 'japanese' },
      { voiceProfileId: 'c21.ayumi', weight: 1, category: 'japanese' },
      { voiceProfileId: 'c21.haruka', weight: 1, category: 'japanese' },
    ],
  },
  {
    id: 'zote', displayName: 'Zote', accent: '#9be8a0', renderMode: 'swap',
    assets: { idle: 'Zote Fixe.png', talking: 'Zote blabla.webm' },
    frame: { width: 1920, height: 1080 },
    silhouette: { x: 0.186, y: 0.558, w: 0.133, h: 0.442 },
    portrait: { x: 0.19, y: 0.6, w: 0.13, h: 0.24 },
    calibration: { portrait: { x: -0.03, y: -0.385, scale: 1, rotation: 0 }, card: { x: 0, y: 0.04, scale: 0.92, rotation: 0 } },
    preview: { asset: 'idle', timeS: 0 },
    stage: { scale: 1, offsetX: -50, offsetY: 6 },
    bubble: { left: '48%', bottom: 54, width: 780, subtitleChars: 68 },
    talkMotion: { preset: 'bounce', amplitudePx: 6 },
    timing: { ...T },
    voicePool: [
      { voiceProfileId: 'zote.paul', weight: 7, category: 'normal' },
      { voiceProfileId: 'zote.fr-male', weight: 3, category: 'normal' },
      { voiceProfileId: 'variant.bourre', weight: 1, category: 'variant' },
    ],
  },
  {
    id: 'andras', displayName: 'Andras Arato', accent: '#cccccc', renderMode: 'swap',
    assets: { idle: 'andras arato Fixe.png', talking: 'Andras Arato Gif.webm' },
    frame: { width: 1920, height: 1080 },
    silhouette: { x: 0.059, y: 0.534, w: 0.334, h: 0.466 },
    portrait: { x: 0.17, y: 0.54, w: 0.12, h: 0.205 },
    calibration: { portrait: { x: -0.16, y: -0.145, scale: 0.84, rotation: 0 }, card: { x: -0.03, y: 0.01, scale: 1, rotation: 0 } },
    preview: { asset: 'idle', timeS: 0 },
    stage: { scale: 0.7, offsetX: 0, offsetY: 0 },
    bubble: { left: '56%', bottom: 54, width: 780, subtitleChars: 68 },
    talkMotion: { preset: 'none', amplitudePx: 0 },
    timing: { ...T },
    voicePool: [
      { voiceProfileId: 'andras.paul', weight: 10, category: 'normal' },
      { voiceProfileId: 'andras.fr-male', weight: 1, category: 'normal' },
      { voiceProfileId: 'variant.bourre', weight: 1, category: 'variant' },
    ],
  },
  {
    id: 'golem', displayName: 'Golem de Neige', accent: '#aee3ff', renderMode: 'swap',
    assets: { idle: 'Golem de neige Fixe.webm', talking: 'Golem de Neige blabla.webm' },
    frame: { width: 640, height: 360 },
    silhouette: { x: 0.064, y: 0.492, w: 0.205, h: 0.508 },
    portrait: { x: 0.09, y: 0.48, w: 0.15, h: 0.2 },
    calibration: { portrait: { x: -0.005, y: -0.09, scale: 0.99, rotation: 0 }, card: { x: 0, y: 0, scale: 0.8, rotation: 0 } },
    preview: { asset: 'idle', timeS: 0.5 },
    stage: { scale: 0.6, offsetX: -50, offsetY: 0 },
    bubble: { left: '50%', bottom: 54, width: 760, subtitleChars: 68 },
    talkMotion: { preset: 'none', amplitudePx: 0 },
    timing: { ...T, mouthHoldMs: 800 },
    voicePool: [
      { voiceProfileId: 'golem.claude', weight: 6, category: 'normal' },
      { voiceProfileId: 'golem.paul', weight: 4, category: 'normal' },
      { voiceProfileId: 'variant.bourre', weight: 1, category: 'variant' },
    ],
  },
];

/** Talking motions (bounce = legacy talkBounce). */
export const MOTION_PRESETS = {
  none: { label: 'Aucun' },
  'soft-bob': { label: 'Léger balancement', durationMs: 900, defaultAmplitudePx: 4 },
  bounce: { label: 'Sautillement (legacy)', durationMs: 280, defaultAmplitudePx: 8 },
};

export const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

/** Checks a pair decided by Core { character_id, voice_profile_id } (player, recovery). */
export function resolveCast(cast) {
  const character = CHARACTERS_BY_ID[cast?.character_id];
  if (!character) return { ok: false, error: 'unknown_character' };
  const entry = character.voicePool.find((v) => v.voiceProfileId === cast.voice_profile_id);
  const voiceProfile = entry && VOICE_PROFILES[entry.voiceProfileId];
  if (!voiceProfile) return { ok: false, error: 'voice_not_in_pool' };
  return { ok: true, character, voice: voiceProfile, category: entry.category };
}

// Presentation only: human reading of the Web Speech parameters (1 = neutral). No character named.
const LANGS = { 'fr-FR': null, 'fr-CA': 'Français (CA)', 'ja-JP': 'Japonais', 'en-US': 'Anglais' };
export function voiceTraits(voiceProfile, category) {
  const t = [];
  if (category === 'variant') t.push('Variante rare');
  const p = voiceProfile.pitch, r = voiceProfile.rate;
  if (p < 0.6) t.push('Très grave'); else if (p < 0.9) t.push('Grave'); else if (p > 1.4) t.push('Très aiguë'); else if (p > 1.1) t.push('Aiguë');
  if (r < 0.6) t.push('Très lente'); else if (r < 0.9) t.push('Lente'); else if (r > 1.3) t.push('Très rapide'); else if (r > 1.1) t.push('Rapide');
  const lang = voiceProfile.lang in LANGS ? LANGS[voiceProfile.lang] : voiceProfile.lang;
  if (lang) t.push(lang);
  if (voiceProfile.variationPitch >= 0.15) t.push('Intonation instable');
  return t.length ? t : ['Voix naturelle'];
}

/** Crop box (fractions of the frame): 'head' (portrait) or 'full' (silhouette). */
export function cropBox(character, kind) {
  const b = kind === 'portrait' ? character.portrait : character.silhouette;
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

/**
 * Placement of the full-frame media in a W×H box (same math for DOM and canvas).
 * portrait: covering, centred on the head; card: contained (94 %), standing at the bottom centre.
 */
export function layout(character, kind, W, H, cal = character.calibration[kind]) {
  const FW = character.frame.width, FH = character.frame.height;
  const b = cropBox(character, kind);
  const bw = b.w * FW, bh = b.h * FH;
  let k, bx, by, ax, ay;
  if (kind === 'portrait') {
    k = Math.max(W / bw, H / bh) * cal.scale;
    bx = (b.x + b.w / 2) * FW; by = (b.y + b.h / 2) * FH; ax = W / 2; ay = H / 2;
  } else {
    k = Math.min(W / bw, H / bh) * 0.94 * cal.scale;
    bx = (b.x + b.w / 2) * FW; by = (b.y + b.h) * FH; ax = W / 2; ay = H;
  }
  ax += cal.x * W; ay += cal.y * H;
  return { w: FW * k, h: FH * k, left: ax - bx * k, top: ay - by * k, ox: bx * k, oy: by * k, rot: cal.rotation || 0 };
}

/** Pagination of the subtitles (legacy decouperSousTitres, 68 characters per page). */
export function subtitlePages(text, max) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const pages = [];
  let page = '';
  for (const w of words) {
    const next = page ? `${page} ${w}` : w;
    if (next.length > max && page) { pages.push(page); page = w; } else page = next;
  }
  if (page) pages.push(page);
  return pages.length ? pages : [String(text || '')];
}

export const assetUrl = (base, file) => `${base.replace(/\/?$/, '/')}${TTS_ASSET_DIR}/${encodeURIComponent(file)}`;
