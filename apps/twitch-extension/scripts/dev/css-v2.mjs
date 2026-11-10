// One-shot generator of the v2 sheets (plan § 3, § 7.1). After the run, the outputs are hand-edited sources:
// re-running it overwrites them (only before the first hand edit). Supersedes css-alive.mjs (same dead-rule test;
// the list of removed rules is scripts/dev/css-dead-*.txt).
//   node scripts/dev/css-v2.mjs
// Input: the legacy sheets (never modified: legacy shell + rollback). Output:
//   app/css/shell-{base,video,panel}.css  ← base/overlay/mobile.css, provably dead rules removed (css-alive.mjs rule)
//   app/css/{picker,currency-switch}.css, modules/<id>/<id>.css ← the module sheets (all rules kept)
//   app/css/tokens.css (font tokens part), app/mq.js (box media queries)
// Transform (text based: comments, order and formatting kept):
//   1. Geometry px (width/height/min/max, padding, margin, gap, inset, radius, flex, grid tracks) > 2 px
//      → calc(N * var(--g)), --g = --kg × 1px. 1–2 px lines, borders, shadows, transforms, backgrounds untouched.
//   2. font-size: Npx → var(--fs-N) (or var(--fsm-N) for micro-labels): max(role floor, N × --kt).
//      line-height: Npx → calc(N * var(--t)), --t = --kt × 1px. Other px inside font-size → × --kt.
//   3. Viewport @media on width/height/orientation → the same conditions evaluated by app/layout.js on the
//      COMPOSITION BOX (W/kg × H/kg): rules prefixed with :where(:root[data-mq~="mN"]) (zero specificity added,
//      cascade unchanged). Other media (hover, pointer, reduced motion) kept as @media.
//   At --kg = --kt = 1 and floors at 0, every computed style equals the legacy one (checked by styles.mjs).
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EXT, parseRules, selectorDead } from './css-owners.mjs';

const JOBS = [
  // [source, destination, alive-only?]
  ['base.css', 'app/css/shell-base.css', true],
  ['overlay.css', 'app/css/shell-video.css', true],
  ['mobile.css', 'app/css/shell-panel.css', true],
  ['picker.css', 'app/css/picker.css', false],
  ['currency-switch.css', 'app/css/currency-switch.css', false],
  ['hub.css', 'modules/hub/hub.css', false],
  ['tts-v2.css', 'modules/tts/tts.css', false],
  ['tombola-v2.css', 'modules/tombola/tombola.css', false],
  ['soundboard.css', 'modules/soundboard/soundboard.css', false],
  ['bonk-chargeur.css', 'modules/bonk/bonk-chargeur.css', false],
  ['events-shop.css', 'modules/events/events.css', false],
  ['moderation-v2.css', 'modules/moderation/moderation.css', false],
  ['commands-v2.css', 'modules/commands/commands.css', false],
];

// --- 0. alive-only source text (same rule as css-alive.mjs; comments of dropped rules go with them) ---------------
function aliveText(css) {
  // Re-serialize only when a rule is dropped: walk the text, cut the dropped rule spans.
  const dead = new Set(
    parseRules(css)
      .filter(
        (r) =>
          !r.at &&
          r.head
            .split(',')
            .map((s) => s.trim())
            .every(selectorDead),
      )
      .map((r) => norm(r.head)),
  );
  return walk(css, {
    onRule: (head) => (dead.has(norm(head)) ? null : undefined),
  });
}
const norm = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();

// --- generic text walker ----------------------------------------------------------------------------------------
// walk(css, hooks) re-emits css; hooks.onRule(head, body, ctx) may return null (drop) or {head, body} (replace).
// hooks.onAt(head, body, ctx) may return {unwrap?, head?, body?, ctx?}. Comments and whitespace are copied.
function matchBrace(s, open) {
  let depth = 0;
  for (let j = open; j < s.length; j += 1) {
    const c = s[j];
    if (c === '/' && s[j + 1] === '*') {
      j = s.indexOf('*/', j + 2) + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      j = s.indexOf(c, j + 1);
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return j;
  }
  throw new Error('unbalanced braces');
}
function walk(css, hooks, ctx = { prefixes: [] }) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const ws = /^\s*/.exec(css.slice(i))[0];
    out += ws;
    i += ws.length;
    if (i >= css.length) break;
    if (css.startsWith('/*', i)) {
      const e = css.indexOf('*/', i) + 2;
      out += css.slice(i, e);
      i = e;
      continue;
    }
    // head up to '{' or ';'
    let j = i;
    while (j < css.length && css[j] !== '{' && css[j] !== ';') {
      if (css.startsWith('/*', j)) j = css.indexOf('*/', j) + 2;
      else j += 1;
    }
    if (css[j] === ';' || j >= css.length) {
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const head = css.slice(i, j);
    const close = matchBrace(css, j);
    const body = css.slice(j + 1, close);
    const h = head.trim();
    if (h.startsWith('@')) {
      if (
        /^@(keyframes|-webkit-keyframes|font-face|property|counter-style)\b/.test(
          h,
        )
      )
        out += css.slice(i, close + 1);
      else {
        const r = hooks.onAt?.(h, body, ctx) ?? {};
        const inner = walk(body, hooks, r.ctx ?? ctx);
        out += r.unwrap ? inner.trim() : `${r.head ?? head}{${inner}}`;
      }
    } else {
      const r = hooks.onRule?.(head, body, ctx);
      if (r === null) {
        out = out.replace(/\s*$/, '');
      } else out += `${r?.head ?? head}{${r?.body ?? body}}`;
    }
    i = close + 1;
  }
  return out;
}

// --- 1-2. declarations ----------------------------------------------------------------------------------------
const GEOMETRY =
  /^(width|height|min-width|min-height|max-width|max-height|padding(-[a-z-]+)?|margin(-[a-z-]+)?|gap|row-gap|column-gap|top|right|bottom|left|inset(-[a-z-]+)?|border(-[a-z]+)*-radius|flex|flex-basis|grid-template-columns|grid-template-rows|grid-auto-columns|grid-auto-rows|scroll-padding(-[a-z-]+)?|scroll-margin(-[a-z-]+)?)$/;
const MICRO =
  /(count|badge|chip|pill|(^|[-_])tag($|[-_])|kbd|dot|(^|[-_])num|(^|[-_])nb|__q\b|unit|sup\b|eyebrow|kicker|counter|bubble|flag|tick|step)/i;
export const fontSizes = new Map(); // px -> Set('fs'|'fsm')
const fmt = (n) => String(Number(n));
function splitTop(s, sep) {
  const parts = [];
  let depth = 0,
    cur = '',
    q = null;
  for (let k = 0; k < s.length; k += 1) {
    const c = s[k];
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (c === sep && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}
function transformDecls(body, head) {
  if (/\/\*/.test(body) && !/:/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')))
    return body;
  return splitTop(body, ';')
    .map((decl) => {
      const m =
        /^(\s*(?:\/\*[\s\S]*?\*\/\s*)*)([a-z-]+)(\s*:\s*)([\s\S]*?)(\s*)$/i.exec(
          decl,
        );
      if (!m) return decl;
      const [, lead, prop, colon, value0, trail] = m;
      const p = prop.toLowerCase();
      if (p.startsWith('--')) return decl;
      let value = value0;
      if (p === 'font-size') {
        const single = /^(\d*\.?\d+)px(\s*!important)?$/.exec(value.trim());
        // Under 8 px: decorative glyphs (dots, carets), not text: untouched.
        if (single && Number(single[1]) < 8) return decl;
        if (single) {
          const last = splitTop(head, ',')
            .map((s) =>
              s
                .trim()
                .split(/[\s>+~]+/)
                .pop(),
            )
            .join(' ');
          const kind =
            Number(single[1]) < 12 && MICRO.test(last) ? 'fsm' : 'fs';
          if (!fontSizes.has(single[1])) fontSizes.set(single[1], new Set());
          fontSizes.get(single[1]).add(kind);
          value = `var(--${kind}-${fmt(single[1]).replace('.', '_')})${single[2] ?? ''}`;
        } else
          value = value.replace(
            /(-?\d*\.?\d+)px/g,
            (_, n) => `calc(${fmt(n)}px * var(--kt))`,
          );
      } else if (p === 'line-height') {
        value = value.replace(
          /(-?\d*\.?\d+)px/g,
          (_, n) => `calc(${fmt(n)} * var(--t))`,
        );
      } else if (GEOMETRY.test(p)) {
        value = value.replace(/(-?\d*\.?\d+)px/g, (all, n) =>
          Math.abs(Number(n)) > 2 ? `calc(${fmt(n)} * var(--g))` : all,
        );
      }
      return `${lead}${prop}${colon}${value}${trail}`;
    })
    .join(';');
}

// --- 3. box media queries -------------------------------------------------------------------------------------
export const mediaTokens = new Map(); // condition -> token
const SIZE_FEATURE =
  /^\(\s*(min-|max-)?(width|height|aspect-ratio)\s*:|^\(\s*orientation\s*:/;
function splitMedia(cond) {
  const parts = splitTop(cond, ',').map((p) => p.trim());
  const feats = parts.map((p) => p.split(/\s+and\s+/i).map((f) => f.trim()));
  const isSize = (f) => SIZE_FEATURE.test(f);
  if (feats.every((fs) => fs.every((f) => !isSize(f))))
    return { size: null, other: cond };
  if (
    feats.every((fs) =>
      fs.every((f) => isSize(f) || /^(screen|all|only screen)$/i.test(f)),
    )
  )
    return {
      size: feats.map((fs) => fs.filter(isSize).join(' and ')).join(', '),
      other: null,
    };
  if (parts.length === 1)
    return {
      size: feats[0].filter(isSize).join(' and '),
      other: feats[0].filter((f) => !isSize(f)).join(' and '),
    };
  throw new Error(`mixed media query to convert by hand: ${cond}`);
}
function prefixSelector(sel, tokens) {
  const cond = tokens.map((t) => `[data-mq~="${t}"]`).join('');
  return splitTop(sel, ',')
    .map((s) => {
      const lead = /^\s*/.exec(s)[0];
      const t = s.trim();
      if (/^html\b/.test(t)) return `${lead}html:where(${cond})${t.slice(4)}`;
      if (/^:root\b/.test(t)) return `${lead}:root:where(${cond})${t.slice(5)}`;
      return `${lead}:where(:root${cond}) ${t}`;
    })
    .join(',');
}

function transform(css) {
  return walk(css, {
    onAt(head, _body, ctx) {
      const m = /^@media\s+([\s\S]*)$/i.exec(head);
      if (!m) return {};
      const { size, other } = splitMedia(m[1].trim());
      if (!size) return {};
      const key = size.replace(/\s+/g, ' ');
      if (!mediaTokens.has(key)) mediaTokens.set(key, `m${mediaTokens.size}`);
      const next = { prefixes: [...ctx.prefixes, mediaTokens.get(key)] };
      return other
        ? { head: `@media ${other} `, ctx: next }
        : { unwrap: true, ctx: next };
    },
    onRule(head, body, ctx) {
      const h = ctx.prefixes.length ? prefixSelector(head, ctx.prefixes) : head;
      return { head: h, body: transformDecls(body, head) };
    },
  });
}

// --- run ------------------------------------------------------------------------------------------------------
for (const [src, dst, aliveOnly] of JOBS) {
  let css = readFileSync(join(EXT, src), 'utf8').replace(/\r\n/g, '\n');
  const before = Buffer.byteLength(css);
  if (aliveOnly) css = aliveText(css);
  const out = `/* Socle v2 — généré une fois par scripts/dev/css-v2.mjs depuis extension/${src}${aliveOnly ? ' (règles prouvées mortes retirées)' : ''},
   puis édité à la main. Échelles : --g (géométrie), var(--fs-N) (texte avec plancher), data-mq (requêtes sur la boîte
   de composition, app/mq.js). La feuille d'origine reste inchangée pour le shell legacy. */\n${transform(css)}`;
  mkdirSync(join(EXT, dirname(dst)), { recursive: true });
  writeFileSync(join(EXT, dst), out);
  console.log(
    `${src} → ${dst}: ${(before / 1024).toFixed(0)} → ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`,
  );
}

// tokens (fonts) and media table
const floorOf = (n, kind) =>
  kind === 'fsm'
    ? 'var(--fl-micro)'
    : n >= 14
      ? 'var(--fl-strong)'
      : n >= 12
        ? 'var(--fl-body)'
        : 'var(--fl-small)';
const sizes = [...fontSizes.keys()].map(Number).sort((a, b) => a - b);
let tokens =
  '/* Tailles de texte générées (scripts/dev/css-v2.mjs) : max(plancher du rôle, taille de la V1 × --kt). */\n:root {\n';
for (const n of sizes)
  for (const kind of [
    ...(fontSizes.get(String(n)) ?? fontSizes.get(fmt(n))),
  ].sort())
    tokens += `  --${kind}-${fmt(n).replace('.', '_')}: max(${floorOf(n, kind)}, calc(${fmt(n)}px * var(--kt)));\n`;
tokens += '}\n';
writeFileSync(join(EXT, 'app/css/tokens-fonts.css'), tokens);
writeFileSync(
  join(EXT, 'app/mq.js'),
  `// Viewport media queries of the legacy sheets, re-evaluated by app/layout.js on the composition box
// (W/kg × H/kg) and exposed as <html data-mq="m0 m3 …">. Generated by scripts/dev/css-v2.mjs.
export const MEDIA = Object.freeze(${JSON.stringify(
    [...mediaTokens].map(([cond, token]) => [token, cond]),
    null,
    2,
  )});
`,
);
console.log(
  `${sizes.length} font sizes, ${mediaTokens.size} box media queries`,
);
