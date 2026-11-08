// F6 — « écran gris » guard: without the Twitch helper (blocker, browser shields) every surface shows a
// recoverable error instead of staying empty. Connected mode, no helper, every request aborted.
//   node test/responsive/grey-screen.mjs [--shell v2]
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, '../../../../package.json'))('@playwright/test');
const shellArg = process.argv.indexOf('--shell');
const shell = shellArg > 0 ? `-${process.argv[shellArg + 1]}` : '';

const server = await startServer(Number(process.env.PORT || 4473));
const base = `http://127.0.0.1:${server.address().port}/live${shell}`;
const browser = await chromium.launch();
let failures = 0;
for (const [surface, page0, w, h] of [
  ['video', 'video_component.html?anchor=component', 565, 376],
  ['panel', 'panel.html?anchor=panel', 318, 496],
  ['mobile', 'mobile.html?anchor=panel&platform=mobile', 390, 844],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const requests = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { requests.push(r.request().url()); return r.abort(); });
  const t0 = Date.now();
  await page.goto(`${base}/${page0}`);
  const ok = await page.waitForFunction(() => /Connexion à Twitch impossible/.test(document.body.innerText), null, { timeout: 3000 })
    .then(() => true, () => false);
  const retry = ok && await page.getByRole('button', { name: /réessayer|recharger/i }).count();
  console.log(`${surface}: ${ok ? `message en ${Date.now() - t0} ms` : 'AUCUN MESSAGE'}${ok ? `, bouton de reprise ${retry ? 'présent' : 'absent'}` : ''}, requêtes sortantes ${requests.length}`);
  if (!ok || requests.length) failures += 1;
  await page.close();
}
await browser.close();
server.close();
process.exitCode = failures ? 1 : 0;
