// Responsive matrix of the extension (plan § 11): every surface × size × view, measured by audit.mjs.
//   npm run test:responsive -w @raptoru/twitch-extension -- [--surface video|panel|mobile] [--views hub,tts]
//        [--quick] [--shell legacy|v2] [--tag name] [--shots]
// Writes test/responsive/out/<tag>.json and <tag>.md (gitignored); exits 1 when an action control is cut.
// Data: calibration fixtures (moderator, local, no network). Chromium; dpr ≠ 1 sizes emulate a browser zoom
// (CSS viewport = iframe / zoom), which is what a zoomed page gives an iframe — not a real zoom.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { audit } from './audit.mjs';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, '../../../../package.json'));
const { chromium } = require('@playwright/test');

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : (process.argv[i + 1] ?? true);
};
const flag = (name) => process.argv.includes(`--${name}`);

// [label, width, height, dpr]
export const VIDEO = [
  ['zoom 150 %', 377, 251, 1.5],
  ['zoom 125 %', 452, 301, 1.25],
  ['zoom 110 %', 514, 342, 1.1],
  ['60 %', 521, 347, 1],
  ['65 % (réglage)', 565, 376, 1],
  ['ancien Lab', 600, 432, 1],
  ['75 % (référence)', 651, 434, 1],
  ['3:2', 750, 500, 1],
  ['théâtre 1080p', 867, 578, 1],
  ['plein écran 1080p', 1053, 702, 1],
  ['portrait', 400, 500, 1],
];
export const PANEL = [
  ['panel', 318, 496, 1],
  ['panel court', 318, 300, 1],
  ['pop-out', 400, 700, 1],
  ['pop-out large', 800, 900, 1],
];
export const MOBILE = [
  ['petit', 360, 780, 2],
  ['standard', 390, 844, 3],
  ['grand', 430, 932, 3],
  ['paysage', 844, 390, 3],
];
const QUICK = { video: [377, 452, 521, 565, 651, 1053], panel: [318], mobile: [360, 844] };
const SURFACES = [
  ['video', 'video_component.html?anchor=component', VIDEO],
  ['panel', 'panel.html?anchor=panel', PANEL],
  ['mobile', 'mobile.html?anchor=panel&platform=mobile', MOBILE],
];
const VIEWS = (arg('views') || 'hub,tts,soundboard,bonk,raffle_join,moderation,actions').split(',');

export async function openView(browser, base, surface, page0, [w, h, dpr], view, { notour = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: dpr,
    isMobile: surface === 'mobile' && w < 600, hasTouch: surface === 'mobile',
  });
  if (notour) await ctx.addInitScript(() => { try { localStorage.setItem('raptoru-live:tutorial-disabled:bonk:v1', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/twitch\.tv|raptoru\.fr/, (r) => r.abort());
  await page.goto(`${base}/${page0}${view === 'hub' ? '' : `&demoModule=${view}`}`);
  await page.waitForFunction(() => document.querySelector('#panel')?.children.length > 0, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}

async function main() {
  const server = await startServer(Number(process.env.PORT || 4471));
  const shell = arg('shell');
  const base = `http://127.0.0.1:${server.address().port}/calib${shell ? `-${shell}` : ''}`;
  const tag = arg('tag') || `matrix${shell ? '-' + shell : ''}`;
  const only = arg('surface');
  const out = join(HERE, 'out');
  mkdirSync(join(out, 'shots', tag), { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  for (const [surface, page0, sizes] of SURFACES) {
    if (only && only !== surface) continue;
    for (const [label, w, h, dpr] of sizes) {
      if (flag('quick') && !QUICK[surface].includes(w)) continue;
      for (const view of VIEWS) {
        const { ctx, page, errors } = await openView(browser, base, surface, page0, [w, h, dpr], view);
        const r = await page.evaluate(audit);
        Object.assign(r, { surface, label, size: `${w}x${h}`, dpr, req: view, errors });
        if (flag('shots')) await page.screenshot({ path: join(out, 'shots', tag, `${surface}-${w}x${h}@${dpr}-${view}.png`) });
        results.push(r);
        process.stdout.write(`${surface} ${w}x${h}@${dpr} ${view}: cut=${r.cutInteractive.length} off=${r.offInteractive.length} cutTxt=${r.cutText.length} minFont=${r.minFont} hscroll=${r.doc.sw > r.doc.cw} err=${errors.length}\n`);
        await ctx.close();
      }
    }
  }
  await browser.close();
  server.close();
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(results, null, 1));
  const cell = (r) => {
    const bad = r.cutInteractive.length + r.offInteractive.length;
    const s = bad ? `**✗ ${bad} ctl**` : r.cutText.length ? `⚠ ${r.cutText.length} txt` : 'ok';
    return `${s} · f${r.minFont} · t${r.minTarget}${r.errors.length ? ' · ERR' : ''}${r.doc.sw > r.doc.cw ? ' · H-SCROLL' : ''}`;
  };
  let md = `# Matrice responsive — ${tag}\n\n✗ = contrôle coupé ou hors champ · ⚠ = texte coupé · f = plus petite police · t = plus petite cible\n`;
  for (const [surface] of SURFACES) {
    const rows = results.filter((r) => r.surface === surface);
    if (!rows.length) continue;
    md += `\n## ${surface}\n\n| taille | ${VIEWS.join(' | ')} |\n|---|${VIEWS.map(() => '---').join('|')}|\n`;
    for (const size of [...new Set(rows.map((r) => `${r.size}@${r.dpr}|${r.label}`))]) {
      const [sz, label] = size.split('|');
      md += `| ${sz} ${label} | ${VIEWS.map((v) => { const r = rows.find((x) => `${x.size}@${x.dpr}` === sz && x.req === v); return r ? cell(r) : '—'; }).join(' | ')} |\n`;
    }
  }
  const cuts = results.filter((r) => r.cutInteractive.length + r.offInteractive.length);
  md += `\n${cuts.length} cas avec contrôle coupé.\n`;
  for (const r of cuts) md += `- ${r.surface} ${r.size}@${r.dpr} ${r.req}: ${[...r.cutInteractive, ...r.offInteractive].slice(0, 3).join(' ; ')}\n`;
  writeFileSync(join(out, `${tag}.md`), md);
  console.log(`\n${results.length} mesures, ${cuts.length} avec contrôle coupé → ${join(out, tag + '.md')}`);
  process.exitCode = cuts.length ? 1 : 0;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) await main();
