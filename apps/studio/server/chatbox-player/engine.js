// Chatbox Raptoru — the message engine (docs/CHATBOX.md § 5.4), pure functions shared by the OBS page, Studio's preview
// and the tests. Ported from the StreamElements widgets of 03/09/2026 (Antoni's code): third-party emotes by name, 7TV
// zero-width emotes stacked over the previous emote (an orphan zero-width stays visible and becomes the base), Unicode
// emojis as Twemoji images by grapheme, emote-only messages and their sizes. The Twitch emotes now come as fragments
// (EventSub), not as character ranges.

/** @typedef {{ code: string, url: string, provider: string, zw?: boolean, animated?: boolean, fallbackUrl?: string }} Emote */

export function buildCatalog(list = []) {
  const map = new Map();
  for (const e of list) if (e && e.code && e.url) map.set(e.code, e);
  return map;
}

export function twitchEmote(id, text) {
  const enc = encodeURIComponent(id);
  return {
    code: text,
    url: `https://static-cdn.jtvnw.net/emoticons/v2/${enc}/default/dark/3.0`,
    fallbackUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${enc}/static/dark/3.0`,
    provider: 'twitch',
    zw: false,
  };
}

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function isUnicodeEmoji(value) {
  return (
    /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator})/u.test(
      value,
    ) && !/[\p{Letter}\p{Number}]/u.test(value)
  );
}

export function unicodeEmoji(value) {
  const code = [...value]
    .map((c) => c.codePointAt(0))
    .filter((cp) => cp !== 0xfe0e && cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join('-');
  return {
    code: value,
    url: `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${code}.svg`,
    provider: 'unicode',
    zw: false,
  };
}

function appendText(tokens, value) {
  if (!value) return;
  const prev = tokens.at(-1);
  if (prev?.type === 'text') prev.value += value;
  else tokens.push({ type: 'text', value });
}

function tokenizeText(value, catalog, tokens) {
  for (const part of value.split(/(\s+)/u)) {
    if (!part) continue;
    if (/^\s+$/u.test(part)) {
      appendText(tokens, part);
      continue;
    }
    const emote = catalog.get(part);
    if (emote) {
      tokens.push({ type: 'emote', emote });
      continue;
    }
    const graphemes = segmenter
      ? [...segmenter.segment(part)].map((s) => s.segment)
      : [part];
    for (const g of graphemes) {
      if (isUnicodeEmoji(g))
        tokens.push({ type: 'emote', emote: unicodeEmoji(g) });
      else appendText(tokens, g);
    }
  }
}

/** Message fragments (text, Twitch emote, mention, cheer, GIF) → tokens. */
export function tokenize(fragments, catalog) {
  const tokens = [];
  for (const f of fragments ?? []) {
    if (f.t === 'emote')
      tokens.push({ type: 'emote', emote: twitchEmote(f.id, f.text) });
    else if (f.t === 'gif')
      tokens.push({ type: 'gif', media: { url: f.url, placeholder: f.text } });
    else if (f.t === 'mention') tokens.push({ type: 'mention', value: f.text });
    else tokenizeText(String(f.text ?? ''), catalog, tokens);
  }
  return tokens;
}

function appendNodeText(nodes, value) {
  if (!value) return;
  const prev = nodes.at(-1);
  if (prev?.type === 'text') prev.value += value;
  else nodes.push({ type: 'text', value });
}

/** Zero-width emotes join the previous emote's stack (whitespace between them disappears). */
export function composeStacks(tokens) {
  const nodes = [];
  let candidate = null;
  let pending = '';
  const flush = () => {
    appendNodeText(nodes, pending);
    pending = '';
  };
  for (const token of tokens) {
    if (token.type === 'gif' || token.type === 'mention') {
      flush();
      nodes.push(
        token.type === 'gif'
          ? { type: 'gif', media: token.media }
          : { type: 'mention', value: token.value },
      );
      candidate = null;
      continue;
    }
    if (token.type === 'text') {
      if (/^\s+$/u.test(token.value) && candidate) pending += token.value;
      else {
        flush();
        appendNodeText(nodes, token.value);
        if (/\S/u.test(token.value)) candidate = null;
      }
      continue;
    }
    if (token.emote.zw) {
      if (candidate) {
        candidate.overlays.push(token.emote);
        pending = '';
      } else {
        flush();
        // Kept from the widgets: an orphan zero-width stays visible and becomes the base of the next ones.
        candidate = {
          type: 'stack',
          base: token.emote,
          overlays: [],
          orphan: true,
        };
        nodes.push(candidate);
      }
      continue;
    }
    flush();
    candidate = {
      type: 'stack',
      base: token.emote,
      overlays: [],
      orphan: false,
    };
    nodes.push(candidate);
  }
  flush();
  return nodes;
}

/** Emote-only: at least one emote or GIF and no visible text; a zero-width stack counts as one emote. */
export function analyze(nodes) {
  const stacks = nodes.filter((n) => n.type === 'stack').length;
  const visual = stacks + nodes.filter((n) => n.type === 'gif').length;
  const hasText = nodes.some(
    (n) => n.type === 'mention' || (n.type === 'text' && /\S/u.test(n.value)),
  );
  return { emoteOnly: visual > 0 && !hasText, units: stacks };
}

/** The size of an emote-only message of `units` emotes: the profile's list, its last value repeating. */
export function soloSize(units, sizes) {
  const list = Array.isArray(sizes) && sizes.length ? sizes : [60];
  return list[Math.min(Math.max(units, 1) - 1, list.length - 1)];
}

export function parse(message, catalog) {
  const nodes = composeStacks(tokenize(message.fragments, catalog));
  return { nodes, ...analyze(nodes) };
}

const FALLBACK = [
  '#ff7f50',
  '#8a9cff',
  '#32cd8f',
  '#ff69b4',
  '#c792ea',
  '#4fc3f7',
  '#f6c85f',
  '#ff8a80',
];

/** The viewer's Twitch colour; without one, the widgets' palette picked from the login. */
export function nameColor(login, color) {
  if (/^#[0-9a-f]{6}$/i.test(color ?? '')) return color;
  let h = 0;
  for (const c of String(login ?? '')) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

const lum = ([r, g, b]) => {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

/** A very dark colour lifted toward white just enough to be read on a dark card (the hue stays the viewer's). */
export function liftColor(hex, min = 0.16) {
  const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  if (rgb.some(Number.isNaN) || lum(rgb) >= min) return hex;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const mixed = rgb.map((v) => Math.round(v + (255 - v) * t));
    if (lum(mixed) >= min)
      return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return '#ffffff';
}

const ACCENTS = {
  blue: '#4fa3ff',
  green: '#34d399',
  orange: '#f5a524',
  purple: '#b48cff',
};
/** A Twitch announcement's colour, toned for the stream; « primary » takes the profile's accent. */
export const accentColor = (accent, fallback) => ACCENTS[accent] ?? fallback;
