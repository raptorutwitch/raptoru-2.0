// One-shot generator (plan § 7.1, conservative): the legacy sheets minus their PROVABLY DEAD rules.
//   node scripts/dev/css-alive.mjs
// A rule is dropped only when EVERY selector of its list names a class or id that appears nowhere in the
// extension's JS/HTML (dynamic prefixes like `foo-${…}` count as alive). A rule with one live selector is kept
// WHOLE (no partial pruning: removing an unsupported selector from a list could revive a rule the browser
// ignores today). At-rules (@keyframes, @font-face…) are always kept. Order and @media/@supports/@container
// wrappers are preserved. Output: extension/app/css/shell-{base,video,panel}.css + scripts/dev/css-dead-<sheet>.txt
// (the removed rules, joined to the lot report). The legacy sheets are not modified (legacy shell, rollback).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXT, parseRules, selectorDead } from './css-owners.mjs';

const OUT = join(EXT, 'app', 'css');
mkdirSync(OUT, { recursive: true });
const JOBS = [
  ['base.css', 'shell-base.css', 'toutes les surfaces (ancien base.css)'],
  ['overlay.css', 'shell-video.css', 'composant vidéo (ancien overlay.css)'],
  ['mobile.css', 'shell-panel.css', 'panel et mobile (ancien mobile.css)'],
];

const indent = (text, n) => text.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');
// Raw declarations, never split on ';' (data: URIs, strings); CRLF normalized.
const pretty = (body) => body.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `  ${l}`).join('\n');

for (const [src, dst, label] of JOBS) {
  const rules = parseRules(readFileSync(join(EXT, src), 'utf8'));
  const kept = [];
  const dead = [];
  for (const r of rules) {
    if (r.at || !r.head.split(',').map((s) => s.trim()).every(selectorDead)) kept.push(r);
    else dead.push(r);
  }
  // Re-nest consecutive rules that share the same wrapper chain.
  let css = `/* Socle v2 — ${label}, règles VIVANTES uniquement.
   Généré une fois par scripts/dev/css-alive.mjs depuis extension/${src} (commit de la refonte) : ${kept.length} règles
   gardées, ${dead.length} prouvées mortes retirées (scripts/dev/css-dead-${src.replace('.css', '')}.txt). Depuis, ce
   fichier est une source éditée à la main ; l'historique et les commentaires d'origine sont dans extension/${src}
   (shell legacy, inchangé). */\n`;
  let open = [];
  const close = (depth) => { while (open.length > depth) { open.pop(); css += `${' '.repeat(open.length * 2)}}\n`; } };
  for (const r of kept) {
    let common = 0;
    while (common < open.length && common < r.wrappers.length && open[common] === r.wrappers[common]) common += 1;
    close(common);
    for (const w of r.wrappers.slice(common)) { css += `${' '.repeat(open.length * 2)}${w} {\n`; open.push(w); }
    const block = r.body === null ? `${r.head};` : r.head.startsWith('@')
      ? `${r.head} {\n${indent(r.body, 2)}\n}`
      : `${r.head.replace(/\s*,\s*/g, ',\n')} {\n${pretty(r.body)}\n}`;
    css += `${indent(block, open.length * 2)}\n`;
  }
  close(0);
  writeFileSync(join(OUT, dst), css);
  writeFileSync(join(EXT, '..', 'scripts', 'dev', `css-dead-${src.replace('.css', '')}.txt`),
    dead.map((r) => `${r.wrappers.length ? r.wrappers.join(' › ') + ' › ' : ''}${r.head.replace(/\s+/g, ' ')}`).join('\n') + '\n');
  console.log(`${src} → app/css/${dst}: ${kept.length} kept, ${dead.length} dead, ${(Buffer.byteLength(css) / 1024).toFixed(0)} KB`);
}
