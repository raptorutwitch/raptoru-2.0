// Dev analysis: alive rules of the legacy sheets grouped by class family (prefix), bytes per family.
// A rule is "provably dead" when one class of each of its selectors appears nowhere in extension JS/HTML.
import console from 'node:console';
import process from 'node:process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const EXT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'extension');
const walk = (d) => readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? (n === 'assets' ? [] : walk(f)) : [f]; });
export const CODE = walk(EXT).filter((f) => /\.(js|html)$/.test(f) && !/unicode-emojis/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
const prefixes = new Set([...CODE.matchAll(/([A-Za-z][\w-]*-)\$\{/g), ...CODE.matchAll(/['"`]([A-Za-z][\w-]*-)['"`]\s*\+/g)].map((m) => m[1]));
const aliveCache = new Map();
export const isAlive = (tok) => {
  if (aliveCache.has(tok)) return aliveCache.get(tok);
  // The class must appear as a whole token (not inside a longer name) somewhere in the JS/HTML.
  let ok = new RegExp(`(^|[^\\w-])${tok.replace(/-/g, '\\-')}($|[^\\w-])`).test(CODE);
  if (!ok) for (const p of prefixes) if (tok.startsWith(p)) { ok = true; break; }
  aliveCache.set(tok, ok); return ok;
};
/** Top-level rules with their at-rule wrapper chain: { wrappers: ['@media …'], head, body, text }. */
export function parseRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const parse = (from, to, wrappers) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf('{', i); if (open < 0 || open >= to) return;
      const semi = css.indexOf(';', i);
      if (semi >= 0 && semi < open && /^\s*@(import|charset|layer)\b/.test(css.slice(i, semi))) { out.push({ wrappers, head: css.slice(i, semi).trim(), body: null, at: true }); i = semi + 1; continue; }
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      if (/^@(media|supports|container|layer)/.test(head)) parse(open + 1, j - 1, [...wrappers, head]);
      else out.push({ wrappers, head, body: css.slice(open + 1, j - 1).trim(), at: head.startsWith('@') });
      i = j;
    }
  };
  parse(0, css.length, []);
  return out;
}
export const classesOf = (sel) => [...sel.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
export const selectorDead = (sel) => classesOf(sel).some((c) => !isAlive(c)) || [...sel.matchAll(/#([A-Za-z_][\w-]*)/g)].some((m) => !isAlive(m[1]));
export const family = (cls) => (/^jdm-/.test(cls) ? cls.split(/__|--/)[0].split('-').slice(0, 2).join('-') : (/^(rl|rh|bkc|sbx|tmbx|ttsv2|modv2|cmdx|evx|m|drawer|dock)[-_]/.exec(cls)?.[1] ?? cls.split(/[-_]/)[0]));
if (process.argv[1]?.endsWith('css-owners.mjs')) {
  for (const name of ['base.css', 'overlay.css', 'mobile.css']) {
    const rules = parseRules(readFileSync(join(EXT, name), 'utf8'));
    const fam = new Map(); let dead = 0, total = 0;
    for (const r of rules) {
      const bytes = (r.head.length + (r.body?.length ?? 0) + 2);
      total += bytes;
      if (r.at) { fam.set(r.head.split(/\s/)[0], (fam.get(r.head.split(/\s/)[0]) ?? 0) + bytes); continue; }
      const sels = r.head.split(',').map((s) => s.trim()).filter((s) => !selectorDead(s));
      if (!sels.length) { dead += bytes; continue; }
      const fams = new Set(sels.flatMap((s) => classesOf(s).map(family)));
      const key = fams.size ? [...fams].sort().slice(0, 3).join('+') : '(no class)';
      fam.set(key, (fam.get(key) ?? 0) + bytes);
    }
    console.log(`\n${name}: ${(total / 1024).toFixed(0)} KB, provably dead ${(dead / 1024).toFixed(0)} KB, alive ${((total - dead) / 1024).toFixed(0)} KB`);
    console.log([...fam].sort((a, b) => b[1] - a[1]).slice(0, 28).map(([k, v]) => `  ${(v / 1024).toFixed(1).padStart(6)} KB  ${k}`).join('\n'));
  }
}
