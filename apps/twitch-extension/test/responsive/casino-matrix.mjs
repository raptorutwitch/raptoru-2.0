// Responsive matrix of the Casino (Lot B § 8-9): every game × state × size, screenshotted and audited for a cut or
// off-screen control — the shared audit.mjs stops at the light DOM (document.body.querySelectorAll), and every Casino
// screen lives in a Shadow DOM (casino.js), so this script carries its own small shadow-aware check instead of
// touching the shared tool (used, calibrated, by the whole matrix — no reason to risk it for one module).
//   npm run test:casino-responsive -- [--tag name] [--shots] [--games blackjack,slot] [--quick]
// Writes test/responsive/out/<tag>.json and <tag>.md (gitignored); exits 1 when a control is cut or off-screen.
/* global document, window, getComputedStyle, Element -- evaluated in the page (Playwright) */
import console from 'node:console';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, '../../../../package.json'));
const { chromium } = require('@playwright/test');

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : (process.argv[i + 1] ?? true);
};
const flag = (name) => process.argv.includes(`--${name}`);

const BJ_OPEN_STATES = ['several:rules', 'several:hist', 'several:histmine'];
const GAMES = {
  blackjack: [
    'empty',
    'several',
    'full',
    'myTurn',
    'blackjackHand',
    'split2',
    'splitMixed',
    'dealerBlackjack',
    'spectator',
    ...BJ_OPEN_STATES,
  ],
  slot: ['resting', 'lineWin', 'bigWin', 'loss', 'error'],
  book: ['resting', 'lineWin', 'bigWin', 'loss', 'error'],
  roulette: ['red7', 'black22', 'loss'],
};
// [label, w, h] — the Lot B mandate's explicit minimum (§ 9): very small, compact, standard, large, fullscreen,
// portrait/landscape, mobile-realistic. Shares its numbers with test/responsive/matrix.mjs and casino-bench.js.
const SIZES = [
  ['zoom 150 %', 377, 251],
  ['zoom 125 %', 452, 301],
  ['panel court', 318, 300],
  ['panel', 318, 496],
  ['référence', 651, 434],
  ['3:2', 750, 500],
  ['théâtre 1080p', 867, 578],
  ['plein écran 1080p', 1053, 702],
  ['portrait', 400, 500],
  ['mobile petit', 360, 780],
  ['mobile standard', 390, 844],
  ['mobile paysage', 844, 390],
  ['paysage bas', 844, 300],
  // Zone de l'extension sous la vidéo dans l'application Twitch (estimations : la taille exacte dépend du téléphone).
  ['app Twitch portrait (est.)', 360, 480],
  ['app Twitch compact (est.)', 300, 340],
];
/** Phone-sized rows run as a touch device (pointer: coarse), like the real app. */
const TOUCH = (label) => label.startsWith('mobile') || label.startsWith('app ');
const QUICK_W = [377, 651, 1053, 318, 360];

/** In-page, shadow-aware: is any visible interactive control (inside the Casino's Shadow DOM) cut or off-screen by
 * an ancestor's overflow (incl. the light-DOM host's), and is any text node's box cut. No shared code: see header. */
function shadowAudit() {
  const INTERACTIVE =
    'button, a[href], input:not([type=hidden]), select, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])';
  const vw = window.innerWidth,
    vh = window.innerHeight;
  const deep = (root, out = []) => {
    for (const el of root.querySelectorAll('*')) {
      out.push(el);
      if (el.shadowRoot) deep(el.shadowRoot, out);
    }
    return out;
  };
  const ancestorsOf = (el) => {
    const out = [];
    let node = el;
    for (;;) {
      const p = node.parentElement;
      if (p) {
        out.push(p);
        node = p;
        continue;
      }
      const root = node.getRootNode?.();
      if (root && root.host) {
        out.push(root.host);
        node = root.host;
        continue;
      }
      break;
    }
    return out;
  };
  const clips = (cs) =>
    /hidden|clip|scroll|auto/.test(`${cs.overflowX}${cs.overflowY}`);
  // A list or strip that scrolls (Mes manches, the roulette's chips on a phone): what it hides is reached by
  // scrolling, not lost.
  const scrolls = (a, cs) =>
    (/auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) ||
    (/auto|scroll/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1);
  // Tabs that stick out of their panel on purpose (« Gains », « Paiements », « Mise rapide » : validated prototype).
  const INTENTIONAL = '.notch';
  const visibleWindow = (el) => {
    let box = { left: 0, top: 0, right: vw, bottom: vh };
    for (const a of ancestorsOf(el)) {
      const cs = getComputedStyle(a);
      if (!clips(cs) || scrolls(a, cs)) continue;
      const r = a.getBoundingClientRect();
      box = {
        left: Math.max(box.left, r.left),
        top: Math.max(box.top, r.top),
        right: Math.min(box.right, r.right),
        bottom: Math.min(box.bottom, r.bottom),
      };
    }
    return box;
  };
  const desc = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''}`;
  // A closed slide-in drawer (the Règles/Historique panels: transform: translateX(±101%)) sits, on purpose, entirely
  // outside the viewport; its own content would otherwise be reported as "off", which is not a responsive bug.
  const parkedOffscreen = (el) => {
    const slack = 10; // a closed drawer's translateX(101%) can leave a few residual px inside the viewport
    for (const a of ancestorsOf(el)) {
      const r = a.getBoundingClientRect();
      const out =
        r.right <= slack ||
        r.left >= vw - slack ||
        r.bottom <= slack ||
        r.top >= vh - slack;
      if (out && getComputedStyle(a).transform !== 'none') return true;
    }
    return false;
  };
  const els = deep(document.body).filter((el) => {
    if (!(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0.5 || r.height <= 0.5) return false;
    const cs = getComputedStyle(el);
    if (
      cs.display === 'none' ||
      cs.visibility === 'hidden' ||
      cs.opacity === '0'
    )
      return false;
    return !parkedOffscreen(el);
  });
  const cutInteractive = [];
  const offInteractive = [];
  const cutText = [];
  for (const el of els) {
    if (el.matches(INTENTIONAL)) continue;
    // Inside a list or strip that scrolls, a control is one swipe away: what must be visible is the list itself.
    const probe =
      ancestorsOf(el).find((a) => scrolls(a, getComputedStyle(a))) ?? el;
    const r = probe.getBoundingClientRect();
    const box = visibleWindow(probe);
    const fullyOut =
      r.right <= box.left ||
      r.left >= box.right ||
      r.bottom <= box.top ||
      r.top >= box.bottom;
    const partlyOut =
      r.left < box.left - 0.5 ||
      r.top < box.top - 0.5 ||
      r.right > box.right + 0.5 ||
      r.bottom > box.bottom + 0.5;
    const isCtl = el.matches(INTERACTIVE);
    if (isCtl && fullyOut) offInteractive.push(desc(el));
    else if (isCtl && partlyOut) cutInteractive.push(desc(el));
    else if (
      !isCtl &&
      partlyOut &&
      [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim(),
      ) &&
      !el.closest('[aria-hidden="true"]')
    )
      cutText.push(desc(el));
  }
  const hostR = document.querySelector('.cz-host')?.getBoundingClientRect();
  return {
    cutInteractive: [...new Set(cutInteractive)].slice(0, 20),
    offInteractive: [...new Set(offInteractive)].slice(0, 20),
    cutText: [...new Set(cutText)].slice(0, 20),
    hscroll:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    hostFits: hostR ? hostR.width <= vw + 1 && hostR.height <= vh + 1 : null,
  };
}

async function main() {
  const filePath = (name) => join(HERE, name);
  const server = await startServer(Number(process.env.PORT || 4473), {
    pages: {
      // Under /demo/ (not the root): the harness's CSS <link>s are relative to its own document, as in production.
      '/demo/casino-harness.html': filePath('casino-harness.html'),
      '/demo/casino-harness.js': filePath('casino-harness.js'),
      '/demo/casino-fixtures.js': filePath('casino-fixtures.js'),
      '/demo/casino-fixture-client.js': filePath('casino-fixture-client.js'),
    },
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const tag = arg('tag') || 'casino';
  const onlyGames = arg('games')?.split(',');
  const out = join(HERE, 'out');
  mkdirSync(join(out, 'shots', tag), { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  for (const [game, states] of Object.entries(GAMES)) {
    if (onlyGames && !onlyGames.includes(game)) continue;
    for (const [label, w, h] of SIZES) {
      if (flag('quick') && !QUICK_W.includes(w)) continue;
      for (const state of states) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: h },
          ...(TOUCH(label) ? { hasTouch: true, isMobile: true } : {}),
        });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const [realState, open] = state.includes(':')
          ? state.split(':')
          : [state, null];
        await page.goto(
          `${base}/demo/casino-harness.html?game=${game}&state=${realState}${open ? `&open=${open}` : ''}`,
        );
        await page
          .waitForFunction(() => document.body.dataset.ready === '1', null, {
            timeout: 5000,
          })
          .catch(() => errors.push('never ready'));
        await page.waitForTimeout(250);
        const r = await page.evaluate(shadowAudit);
        Object.assign(r, { game, state, label, size: `${w}x${h}`, errors });
        if (flag('shots'))
          await page.screenshot({
            // never a « : » in the name (several:rules): on NTFS it becomes an alternate data stream, not a file
            path: join(
              out,
              'shots',
              tag,
              `${game}-${state.replace(':', '+')}-${w}x${h}.png`,
            ),
          });
        results.push(r);
        process.stdout.write(
          `${game} ${state} ${w}x${h}: cut=${r.cutInteractive.length} off=${r.offInteractive.length} cutTxt=${r.cutText.length} hscroll=${r.hscroll} fits=${r.hostFits} err=${errors.length}\n`,
        );
        await ctx.close();
      }
    }
  }
  await browser.close();
  server.close();
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(results, null, 1));
  const bad = results.filter(
    (r) => r.cutInteractive.length + r.offInteractive.length || r.errors.length,
  );
  let md = `# Matrice responsive — Casino (${tag})\n\n${results.length} mesures, ${bad.length} avec un contrôle coupé/hors champ ou une erreur JS.\n\n`;
  for (const [game] of Object.entries(GAMES)) {
    const rows = results.filter((r) => r.game === game);
    if (!rows.length) continue;
    md += `\n## ${game}\n\n| état | ${SIZES.map(([l]) => l).join(' | ')} |\n|---|${SIZES.map(() => '---').join('|')}|\n`;
    for (const state of GAMES[game]) {
      md += `| ${state} | ${SIZES.map(([, w, h]) => {
        const r = rows.find((x) => x.state === state && x.size === `${w}x${h}`);
        if (!r) return '—';
        const n = r.cutInteractive.length + r.offInteractive.length;
        return n
          ? `**✗ ${n}**`
          : r.cutText.length
            ? `⚠ ${r.cutText.length}`
            : r.errors.length
              ? 'ERR'
              : 'ok';
      }).join(' | ')} |\n`;
    }
  }
  md += `\n## Détail des cas en défaut\n\n`;
  for (const r of bad)
    md += `- ${r.game} ${r.state} ${r.size}: coupé=${[...r.cutInteractive, ...r.offInteractive].slice(0, 4).join(' ; ')}${r.errors.length ? ` · erreurs: ${r.errors.join(' ; ')}` : ''}\n`;
  const textOnly = results.filter((r) => !bad.includes(r) && r.cutText.length);
  if (textOnly.length) md += `\n## Texte coupé (avertissements ⚠)\n\n`;
  for (const r of textOnly)
    md += `- ${r.game} ${r.state} ${r.size}: ${r.cutText.slice(0, 4).join(' ; ')}\n`;
  writeFileSync(join(out, `${tag}.md`), md);
  console.log(
    `\n${results.length} mesures, ${bad.length} en défaut → ${join(out, tag + '.md')}`,
  );
  process.exitCode = bad.length ? 1 : 0;
}

if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
)
  await main();
