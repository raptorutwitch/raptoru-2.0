// Le choix des voix et le découpage de la lecture, partagés par le lecteur OBS et par l'aperçu de Studio : une seule façon de
// lire un TTS.
const CHUNK_CHARS = 180; // legacy TTS_SPEECH_CHUNK_CHARS
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function findVoice(voices, words) {
  for (const word of words || []) {
    const q = String(word).toLowerCase();
    const v = voices.find(
      (x) =>
        x.name.toLowerCase().includes(q) ||
        (x.lang && x.lang.toLowerCase().includes(q)),
    );
    if (v) return v;
  }
  return null;
}
/** Profile keywords → (strict: none) → exact lang → lang prefix → any French → first voice. */
export function voiceFor(voices, profile) {
  const match = findVoice(voices, profile.match);
  if (match) return match;
  if (profile.strict) return null;
  const lang = profile.lang.toLowerCase();
  return (
    voices.find((v) => v.lang && v.lang.toLowerCase() === lang) ||
    voices.find(
      (v) => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2)),
    ) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('fr')) ||
    voices[0] ||
    null
  );
}
export const narratorVoice = (voices) =>
  findVoice(voices, [
    'microsoft julie',
    'julie',
    'microsoft hortense',
    'hortense',
    'microsoft paul',
    'paul',
    'fr-fr',
    'french',
  ]) ||
  voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('fr')) ||
  voices[0] ||
  null;

/** Legacy splitSpeech: ≤ 180 code points, cut on a space / punctuation past 55 % of the chunk. */
export function splitSpeech(text, size = CHUNK_CHARS) {
  const chars = Array.from(text || '');
  const out = [];
  let from = 0;
  while (from < chars.length) {
    let to = Math.min(chars.length, from + size);
    if (to < chars.length) {
      const floor = from + Math.max(1, Math.floor(size * 0.55));
      for (let k = to - 1; k >= floor; k -= 1)
        if (/\s/u.test(chars[k]) || /[,.;:!?…)]/u.test(chars[k])) {
          to = k + 1;
          break;
        }
    }
    out.push(chars.slice(from, to).join(''));
    from = to;
  }
  return out;
}
/** Legacy doitForcerParoleContinue: repetitive texts keep the mouth moving without boundaries. */
export function continuousSpeech(text) {
  const s = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (s.length < 8) return false;
  if (/([aeiouy])\1{5,}/.test(s) || /(mdr|lol|ah|ha){3,}/.test(s)) return true;
  return new Set(s.split('')).size <= 3;
}
/** Legacy creerAleatoireStable: variation seeded by the interaction (same reading on retry). */
export function stableRandom(seed) {
  let h = 2166136261;
  for (const c of String(seed)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let v = h;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}
export const vary = (base, amp, min, max, random) =>
  clamp(base + (random() * 2 - 1) * (amp || 0), min, max);
