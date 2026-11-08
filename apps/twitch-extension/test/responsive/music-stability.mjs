/* global document -- evaluated in the page (Playwright) */
// Music Hub — the view never moves by itself (retour du 08/11): over the module's readings (every 4 s, calibration
// data), « Historique » stays open, the focused result keeps the focus, the scroll stays where the viewer left it, and
// a message (toast) never pushes the list. Real Chromium, calibration fixtures (no network, nothing written).
//   node test/responsive/music-stability.mjs        → exit 1 on the first broken rule
import console from 'node:console';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, '../../package.json'))('@playwright/test');
const server = await startServer(0);
const port = server.address().port;
const browser = await chromium.launch();
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
const READING = 4_600; // one reading of the module (4 s) and a margin

async function open(role) {
  const page = await browser.newPage({ viewport: { width: 565, height: 376 } });
  await page.goto(
    `http://127.0.0.1:${port}/calib-v2/video_component.html?anchor=component&demoModule=music&calibRole=${role}`,
  );
  await page.locator('.mh').waitFor();
  await page.waitForTimeout(1_200);
  return page;
}
const body = (page) => page.locator('.jdm-module__body');

try {
  const page = await open('viewer');
  // 1. « Historique » stays open across a reading.
  await page.locator('.mh-tab[data-tab="queue"]').click();
  await page.locator('.mh-recent summary').click();
  await page.waitForTimeout(READING);
  check(await page.locator('.mh-recent').evaluate((d) => d.open), 'Historique reste ouvert après un relevé');
  // 2. The queue's scroll stays.
  await body(page).evaluate((s) => (s.scrollTop = 60));
  await page.waitForTimeout(READING);
  check((await body(page).evaluate((s) => s.scrollTop)) === 60, 'la file ne défile pas toute seule');
  // 3. Results: the focused row keeps the focus, the scroll and the rows stay put.
  await page.locator('.mh-tab[data-tab="search"]').click();
  await page.locator('.mh input[type="search"]').fill('neon sauv');
  await page.waitForTimeout(900);
  await page.locator('[data-pick="5"]').focus();
  await body(page).evaluate((s) => (s.scrollTop = 140));
  const top = () => page.locator('[data-pick="6"]').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  const before = await top();
  await page.waitForTimeout(READING);
  check(
    (await page.evaluate(() => document.activeElement?.dataset?.pick)) === '5',
    'le résultat sélectionné garde le focus après un relevé',
  );
  check((await body(page).evaluate((s) => s.scrollTop)) === 140, 'les résultats ne défilent pas tout seuls');
  check((await top()) === before, 'les résultats ne bougent pas pendant les relevés');
  await page.close();

  // 4. A message (toast) never moves the list: scrolled to the bottom, a moderator's removal refused (calibration)
  // shows one; when it goes away 4.5 s later, nothing jumps (an in-flow message shortened the page, the browser then
  // clamped the scroll: the list moved by itself).
  const mod = await open('moderator');
  await mod.locator('.mh-tab[data-tab="queue"]').click();
  await mod.locator('.mh-recent summary').click();
  await body(mod).evaluate((s) => (s.scrollTop = s.scrollHeight));
  const first = () => mod.locator('.mh-list:not(.mh-list--mine) .mh-q').first().evaluate((e) => Math.round(e.getBoundingClientRect().top));
  await mod.locator('[aria-label="Modérer cette demande"]').first().evaluate((b) => b.click());
  await mod.getByRole('menuitem', { name: 'Retirer + rembourser' }).evaluate((b) => b.click());
  await mod.locator('.mh-toast:not(:empty)').waitFor();
  await mod.waitForTimeout(300);
  const y0 = await first();
  await mod.locator('.mh-toast:empty').waitFor({ state: 'attached', timeout: 8_000 });
  await mod.waitForTimeout(200);
  check((await first()) === y0, 'un message qui disparaît ne fait pas sauter la file');
  await mod.close();
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`${failures.length} règle(s) non tenue(s).`);
  process.exit(1);
}
console.log('Music Hub : la vue reste stable pendant les relevés.');
