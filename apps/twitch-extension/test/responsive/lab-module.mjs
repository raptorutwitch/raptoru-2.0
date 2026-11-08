// Socle v2 — proof that an independent module plugs in and leaves cleanly (extension/lab-modules/demo, Lab only), and
// that leaving ANY module leaves no timer behind.
//   node test/responsive/lab-module.mjs        (bench data, Chromium, nothing leaves the machine; exits 1 on a failure)
// Checks: not loaded without ?labModules=1 nor in the legacy shell; entry only at first paint (view + sheet on
// opening); navigation, start, state kept across host refreshes, live session updates absorbed; destroy on leaving
// (its clock stops); removal while open: the host closes it, the Hub gets back exactly its other cards, the other
// modules still open; every module of the Hub: open → back → same number of live intervals as before.
/* global window -- evaluated in the page (Playwright) */
import console from 'node:console';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, '../../../../package.json'))('@playwright/test');
const server = await startServer(Number(process.env.PORT || 4477));
const root = `http://127.0.0.1:${server.address().port}`;
const PAGE = 'video_component.html?anchor=component';

// Live intervals of the page (setInterval minus clearInterval): a view that forgets its timer shows here.
const COUNT_INTERVALS = () => {
  const live = new Set();
  const set = window.setInterval;
  const clear = window.clearInterval;
  window.setInterval = function (...args) { const id = set.apply(this, args); live.add(id); return id; };
  window.clearInterval = function (id) { live.delete(id); return clear.call(this, id); };
  window.__liveIntervals = () => live.size;
};

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch();
async function open(path) {
  const ctx = await browser.newContext({ viewport: { width: 651, height: 434 } });
  await ctx.addInitScript(COUNT_INTERVALS);
  // The Bonk tour opens on a first visit (a dialog over the module): seen already.
  await ctx.addInitScript(() => { try { window.localStorage.setItem('raptoru-live:tutorial-disabled:bonk:v1', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.route(/twitch\.tv|raptoru\.fr/, (r) => r.abort());
  await page.goto(`${root}${path}`);
  await page.waitForSelector('.rh-hub', { timeout: 8000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errors, requests };
}
const hubCards = (page) => page.$$eval('.rh-card', (cards) => cards.map((c) => c.dataset.module));
const labFiles = (requests) => requests.filter((p) => p.includes('/lab-modules/')).map((p) => p.split('/lab-modules/')[1]);
async function openModule(page, id) {
  const i = await page.$eval(`.rh-card[data-module="${id}"]`, (c) => Number(c.dataset.i));
  await page.click('.rh-all-toggle');
  await page.locator('.rh-all__item').nth(i).click();
}
// The host's back button, or the module's own (Tombola, Modération draw their header).
const back = (page) => page.locator('[aria-label="Retour au Hub"]:visible').first().click();
const trace = (page) => page.evaluate(() => window.__raptoruLabDemo?.events ?? []);
const text = (page, k) => page.$eval(`.labdemo [data-k="${k}"]`, (n) => n.textContent);

try {
  // 1. Without the page's request, or in the legacy shell: nothing of the Lab module.
  const plain = await open(`/calib-v2/${PAGE}`);
  const baseline = await hubCards(plain.page);
  check(!baseline.includes('lab_demo') && !labFiles(plain.requests).length, 'v2 sans ?labModules=1 : aucun fichier ni carte du module Lab', baseline.join(' '));
  await plain.ctx.close();
  const legacy = await open(`/calib-legacy/${PAGE}&labModules=1`);
  check(!labFiles(legacy.requests).length && !(await hubCards(legacy.page)).includes('lab_demo'), 'shell legacy avec ?labModules=1 : rien du module Lab');
  await legacy.ctx.close();

  // 2. With it: its card, only its entry at first paint (the view comes on opening, even after the idle prefetch).
  const { ctx, page, errors, requests } = await open(`/calib-v2/${PAGE}&labModules=1`);
  await page.waitForTimeout(4500); // the Hub's idle prefetch of the other modules has run
  const withLab = await hubCards(page);
  // Session modules come before Modération (host order): the Lab module takes its place among them.
  check(JSON.stringify(withLab.filter((id) => id !== 'lab_demo')) === JSON.stringify(baseline) && withLab.includes('lab_demo'),
    'Hub : les cartes habituelles, dans le même ordre, plus « Démo Lab »', withLab.join(' '));
  check(JSON.stringify(labFiles(requests)) === JSON.stringify(['demo/module.js']), 'avant ouverture : seule l’entrée du module est chargée', labFiles(requests).join(' '));
  const intervalsHub = await page.evaluate(() => window.__liveIntervals());

  // 3. Navigation, loading on demand, start, state.
  await openModule(page, 'lab_demo');
  await page.waitForSelector('.labdemo', { timeout: 5000 });
  check(['demo/module.js', 'demo/view.js', 'demo/demo.css'].every((f) => labFiles(requests).includes(f)), 'à l’ouverture : vue et feuille chargées', labFiles(requests).join(' '));
  check(await page.$eval('.jdm-module__screen-name', (n) => n.textContent) === 'Démo Lab', 'en-tête du module (titre, retour, solde) fourni par l’hôte');
  check(JSON.stringify((await trace(page)).slice(-2)) === '["view","start"]', 'initialisation : view puis start');
  for (let i = 0; i < 3; i += 1) await page.click('.labdemo [data-act="plus"]');
  await page.waitForTimeout(2300);
  const seconds = parseInt(await text(page, 'seconds'), 10);
  check(seconds >= 2, 'horloge partagée du socle', `${seconds} s`);
  await page.click('.labdemo [data-act="refresh"]');
  await page.waitForTimeout(800);
  check(await text(page, 'count') === '3' && parseInt(await text(page, 'updates'), 10) >= 1, 'mise à jour de session absorbée, état conservé (compteur 3)', `mises à jour ${await text(page, 'updates')}`);
  check((await trace(page)).filter((e) => e === 'view').length === 1, 'la vue n’est pas recréée par les rafraîchissements de l’hôte');

  // 4. Leaving: destroy, its clock stops, no interval left.
  await back(page);
  await page.waitForSelector('.rh-hub');
  await page.waitForTimeout(600);
  check((await trace(page)).at(-1) === 'destroy' && !(await page.$('.labdemo')), 'retour au Hub : destroy, plus rien du module dans la page');
  const intervalsBack = await page.evaluate(() => window.__liveIntervals());
  check(intervalsBack === intervalsHub, 'aucun minuteur laissé', `${intervalsHub} → ${intervalsBack}`);

  // 5. Reopened: a new view (its state starts again), then removed while open.
  await openModule(page, 'lab_demo');
  await page.waitForSelector('.labdemo');
  check(await text(page, 'count') === '0', 'réouverture : nouvelle vue, état neuf');
  await page.click('.labdemo [data-act="remove"]');
  await page.waitForSelector('.rh-hub', { timeout: 8000 });
  await page.waitForTimeout(600);
  check((await trace(page)).at(-1) === 'destroy', 'retrait pendant l’ouverture : l’hôte ferme le module (destroy)');
  const after = await hubCards(page);
  check(JSON.stringify(after) === JSON.stringify(baseline), 'après retrait : exactement les cartes d’avant', after.join(' '));
  check(await page.evaluate(() => window.__liveIntervals()) === intervalsHub, 'après retrait : aucun minuteur laissé');
  await openModule(page, 'soundboard');
  await page.waitForSelector('.sbx-card', { timeout: 8000 });
  check(true, 'les autres modules s’ouvrent toujours (Soundboard)');
  await back(page);
  check(!errors.length, 'aucune erreur JavaScript', errors.join(' | '));
  await ctx.close();

  // 6. Every module of the Hub: open → back leaves the same number of live intervals.
  for (const id of baseline) try {
    const s = await open(`/calib-v2/${PAGE}`);
    await s.page.waitForTimeout(3000);
    const before = await s.page.evaluate(() => window.__liveIntervals());
    await openModule(s.page, id);
    await s.page.waitForSelector('#panel[data-view="module"]', { timeout: 8000 });
    await s.page.waitForTimeout(2000);
    const during = await s.page.evaluate(() => window.__liveIntervals());
    await back(s.page);
    await s.page.waitForSelector('.rh-hub');
    await s.page.waitForTimeout(800);
    const leftAfter = await s.page.evaluate(() => window.__liveIntervals());
    check(leftAfter === before && !s.errors.length, `cycle de vie ${id} : ouvert → retour, minuteurs ${before} → ${during} → ${leftAfter}`, s.errors.join(' | '));
    await s.ctx.close();
  } catch (e) {
    check(false, `cycle de vie ${id}`, e.message.split(/\r?\n/)[0]);
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est conforme.');
process.exitCode = failures.length ? 1 : 0;
