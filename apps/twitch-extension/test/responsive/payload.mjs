// Initial payload per surface and shell (plan § 10 P1): bytes of JS and CSS loaded until the Hub is shown and the
// network is idle, number of files, time to the Hub; then the same after opening each module (lazy loading).
//   node test/responsive/payload.mjs
// Uncompressed bytes as served (Twitch's CDN compresses; the ratio between shells is what matters).
/* global document, window, performance, MutationObserver -- evaluated in the page (Playwright) */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, '../../../../package.json'))('@playwright/test');
const server = await startServer(Number(process.env.PORT || 4483));
const port = server.address().port;
const browser = await chromium.launch();
const rows = [];
const kb = (n) => `${Math.round(n / 1024)} Ko`;

for (const shell of ['legacy', 'v2']) {
  for (const [surface, page0, w, h] of [
    ['video', 'video_component.html?anchor=component', 565, 376],
    ['panel', 'panel.html?anchor=panel', 318, 496],
    ['mobile', 'mobile.html?anchor=panel&platform=mobile', 390, 844],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    // The instant the Hub is first in the DOM (performance clock), recorded in the page.
    await ctx.addInitScript(() => {
      new MutationObserver((_, mo) => {
        if (document.querySelector('.rh-hub')) { window.__hubAt = performance.now(); mo.disconnect(); }
      }).observe(document, { childList: true, subtree: true });
    });
    const page = await ctx.newPage();
    const got = [];
    page.on('response', async (r) => {
      const url = r.url();
      if (!/\.(js|css)(\?|$)/.test(url)) return;
      try { got.push({ url, bytes: (await r.body()).length, t: Date.now() }); } catch { /* aborted */ }
    });
    await page.route(/twitch\.tv|raptoru\.fr/, (r) => r.abort());
    await page.goto(`http://127.0.0.1:${port}/calib-${shell}/${page0}`);
    await page.waitForSelector('.rh-hub', { timeout: 10000 });
    const hubAt = await page.evaluate(() => window.__hubAt);
    const hubMs = Math.round(hubAt);
    const started = await page.evaluate((at) => performance.getEntriesByType('resource')
      .filter((e) => e.startTime <= at).map((e) => e.name), hubAt);
    const atHub = got.filter((g) => started.includes(g.url));
    const sum = (list, re) => list.filter((g) => re.test(g.url)).reduce((n, g) => n + g.bytes, 0);
    if (process.argv.includes('--list')) for (const g of atHub.sort((a, b) => b.bytes - a.bytes).slice(0, 14)) console.log(`   ${kb(g.bytes).padStart(7)} ${g.url.split('/calib-')[1]}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000); // v2 prefetches the Hub's modules when idle
    const row = {
      shell, surface, hubMs,
      hubJs: sum(atHub, /\.js/), hubCss: sum(atHub, /\.css/), hubFiles: atHub.length,
      idleJs: sum(got, /\.js/), idleCss: sum(got, /\.css/), idleFiles: got.length,
      timers: await page.evaluate(() => performance.getEntriesByType('resource').length),
    };
    rows.push(row);
    console.log(`${shell.padEnd(6)} ${surface.padEnd(6)} Hub en ${hubMs} ms : JS ${kb(row.hubJs)} + CSS ${kb(row.hubCss)} = ${kb(row.hubJs + row.hubCss)} (${row.hubFiles} fichiers) · après inactivité : ${kb(row.idleJs + row.idleCss)} (${row.idleFiles} fichiers)`);
    await ctx.close();
  }
}
await browser.close();
server.close();
mkdirSync(join(HERE, 'out'), { recursive: true });
writeFileSync(join(HERE, 'out', 'payload.json'), JSON.stringify(rows, null, 1));
