/* global document, innerWidth -- evaluated in the page (Playwright) */
// Music Hub — the view never moves by itself, and the final design's rules hold (retour du 08/11, design final F3):
// over the module's readings (every 4 s, calibration data) an open explanation, the focused result, the chosen version,
// the scroll and the evening history stay as the viewer left them; « en cours » is the list's first row; the band's
// sections explain themselves inside the module; a toast never pushes the list; 318 → 651 px without overflow.
// Real Chromium, calibration fixtures (no network, nothing written). The readings' count is checked against the real
// Lab by the Studio E2E (e2e/music-hub.e2e.ts).
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

async function open(role, size = [565, 376]) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  await page.goto(
    `http://127.0.0.1:${port}/calib-v2/video_component.html?anchor=component&demoModule=music&calibRole=${role}`,
  );
  await page.locator('.mh').waitFor();
  await page.waitForTimeout(1_200);
  return page;
}
const list = (page) => page.locator('.mh-scroll');
const firstRowTop = (page) => page.evaluate(() => Math.round(document.querySelector('.mh-row')?.getBoundingClientRect().top ?? -1));

try {
  // A short frame (400 × 300): the list has room to scroll.
  const page = await open('viewer', [400, 300]);
  // 0. One list: « en cours » first (the player confirms it), then the queue; no floating widget.
  check(
    await page.evaluate(() => document.querySelector('.mh-now').getBoundingClientRect().top < document.querySelector('.mh-row').getBoundingClientRect().top),
    '« EN COURS » en tête de liste, avant la file',
  );
  check(!(await page.locator('.mh-next').count()), 'un titre confirmé en lecture : pas d’étiquette « Prochaine musique »');
  // 1. An open explanation stays open across a reading, inside the module.
  await page.locator('.mh-seg--quota').click();
  await page.waitForTimeout(READING);
  check(await page.locator('.mh-tip').isVisible(), 'l’explication du quota reste ouverte après un relevé');
  check(/Tu peux encore demander 1 musique/.test(await page.locator('.mh-tip').innerText()), 'quota : les vraies règles (1 / 3)');
  const tip = await page.locator('.mh-tip').boundingBox();
  check(tip.x >= 0 && tip.x + tip.width <= 400 && tip.y + tip.height <= 300, 'l’explication tient dans le module');
  await page.keyboard.press('Escape');
  check(!(await page.locator('.mh-tip').count()), 'Échap ferme l’explication');
  // 2. The list's scroll stays.
  await list(page).evaluate((s) => (s.scrollTop = 40));
  await page.waitForTimeout(READING);
  check((await list(page).evaluate((s) => s.scrollTop)) === 40, 'la liste ne défile pas toute seule');
  // 3. Curtain: the focused result keeps the focus, the chosen version stays, the list underneath does not move.
  const y0 = await firstRowTop(page);
  await page.locator('.mh input[type="search"]').fill('neon sauv');
  await page.waitForTimeout(900);
  check(await page.locator('.mh-curtain.is-open').isVisible(), 'le rideau s’ouvre pendant la frappe');
  await page.locator('[data-pick="2"]').click();
  await page.locator('[data-pick="5"]').focus();
  await page.locator('.mh-results').evaluate((s) => (s.scrollTop = 80));
  await page.waitForTimeout(READING);
  check((await page.evaluate(() => document.activeElement?.dataset?.pick)) === '5', 'le résultat focalisé garde le focus après un relevé');
  check((await page.locator('.mh-results').evaluate((s) => s.scrollTop)) === 80, 'les résultats ne défilent pas tout seuls');
  check((await page.locator('.mh-hit.is-sel[data-pick="2"]').count()) === 1 && (await page.locator('.mh-buy').isVisible()), 'la version choisie reste choisie');
  check((await firstRowTop(page)) === y0, 'la liste ne bouge pas sous le rideau');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  check(!(await page.locator('.mh-curtain.is-open').count()) && (await page.locator('.mh input[type="search"]').inputValue()) === 'neon sauv', 'Échap replie le rideau et garde la saisie');
  // 3 bis. « En cours » alive: the bar and the time move with the clock between two readings, the list is not rebuilt.
  const bar = () => page.evaluate(() => ({
    t: document.querySelector('.mh-now [data-k="prog"]')?.style.transform ?? '',
    time: document.querySelector('.mh-now [data-k="ptime"]')?.textContent ?? '',
    html: document.querySelector('.mh [data-k="body"]')?.dataset.html ?? '',
  }));
  const b0 = await bar();
  await page.waitForTimeout(2_100);
  const b1 = await bar();
  const scale = (t) => Number(/scaleX\(([\d.]+)\)/.exec(t)?.[1] ?? -1);
  check(scale(b1.t) > scale(b0.t) && b1.time !== b0.time && /^\d+:\d\d \/ \d+:\d\d$/.test(b1.time), '« en cours » : la barre et le temps avancent seuls');
  check(b1.html === b0.html, '« en cours » : la liste n’est pas reconstruite pour la barre');
  // 4. The evening history: loaded when asked, kept on return.
  await list(page).evaluate((s) => (s.scrollTop = 30));
  await page.locator('.mh-clock').click();
  await page.waitForTimeout(600);
  check((await page.locator('.mh-hrow').count()) === 20, 'Musiques de la soirée : 20 premiers titres');
  await list(page).evaluate((s) => (s.scrollTop = s.scrollHeight));
  await page.waitForTimeout(800);
  check((await page.locator('.mh-hrow').count()) === 26, 'la suite se charge en défilant (26)');
  // 09/11 (SMTC_STUDIO.md): every track of the lives — a request carries its viewer, the broadcaster's none; how it
  // left, discreetly; the previous live apart.
  const rows = await page.locator('.mh-hrow').evaluateAll((els) => els.map((e) => e.innerText));
  check(/En cours/.test(rows[0]), 'historique : le premier titre est « en cours »');
  check(rows.some((r) => /Skippé/.test(r)) && rows.some((r) => /Interrompu/.test(r)), 'historique : « Skippé » et « Interrompu » discrets');
  check(rows.filter((r) => !/@|toi/.test(r)).length > 0 && rows.filter((r) => /@Viewer_/.test(r)).length > 0, 'historique : musiques du streamer (sans pseudo) et demandes (avec pseudo)');
  check((await page.locator('.mh-hsess').count()) === 1, 'historique : le live précédent séparé');
  await page.waitForTimeout(READING);
  check((await page.locator('.mh-hrow').count()) === 26, 'l’historique ne se recharge pas tout seul');
  await page.locator('.mh-back').click();
  await page.waitForTimeout(200);
  check((await list(page).evaluate((s) => s.scrollTop)) === 30, 'retour : la liste retrouve sa position');
  await page.close();

  // 5. A message (toast) never moves the list: a moderator's removal refused (calibration) shows one; when it goes
  // away 4.5 s later, nothing jumps.
  const mod = await open('moderator');
  const yA = await firstRowTop(mod);
  await mod.locator('.mh-row [data-act="menu"]').first().click();
  await mod.getByRole('menuitem', { name: 'Retirer et rembourser' }).click();
  await mod.locator('.mh-toast.is-on').waitFor();
  check((await firstRowTop(mod)) === yA, 'un message ne pousse pas la liste');
  await mod.locator('.mh-toast:not(.is-on)').waitFor({ state: 'attached', timeout: 8_000 });
  await mod.waitForTimeout(200);
  check((await firstRowTop(mod)) === yA, 'un message qui disparaît ne fait pas sauter la liste');
  check(!(await mod.locator('[data-act="sup"]').count()), 'un modérateur n’a pas le lecteur (supermods)');
  await mod.close();

  // 6. Responsive 318 → 651 px, for each role: nothing overflows, nothing is cut.
  for (const size of [[318, 496], [318, 300], [400, 300], [521, 347], [565, 376], [651, 434]]) {
    for (const role of ['viewer', 'supermod']) {
      const p = await open(role, size);
      if (role === 'supermod') await p.locator('.mh-now [data-act="sup"]').click();
      const bad = await p.evaluate(() => {
        const mh = document.querySelector('.mh').getBoundingClientRect();
        const out = [...document.querySelectorAll('.mh-top, .mh-band, .mh-band > *, .mh-now, .mh-row, .mh-sup')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width && (r.left < mh.left - 0.5 || r.right > mh.right + 0.5);
        });
        return [document.documentElement.scrollWidth > innerWidth, out.map((e) => e.className)];
      });
      check(!bad[0] && !bad[1].length, `${size.join('×')} ${role} : rien ne déborde ${bad[1].join(',')}`);
      await p.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`${failures.length} règle(s) non tenue(s).`);
  process.exit(1);
}
console.log('Music Hub : la vue reste stable et tient dans le module.');
