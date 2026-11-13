// LAB ONLY — end-to-end check of Mini-jeux / Random Ban in a real browser (docs/mini-jeux/LIVRAISON_V4.md § 3).
//   npm run mini-jeux:check -w @raptoru/core-api          (screenshots: MINI_JEUX_SHOTS=<dir>, default the OS temp dir)
// Starts its own demo (scripts/mini-jeux-demo.ts, port 4496: an in-memory Core, a FAKE Twitch, fictional Jetons) and
// plays the main paths in Chromium, asserting what the player sees against what the Core decided:
// catalog → game · a double click never pays · one purchase debits once · the machine stops on the Core's target ·
// a refresh never replays a draw · moderation pause / personal delay said before the click · a Sniper hit pays once ·
// reduced motion · the three usual extension sizes. Nothing leaves the machine.
import { spawn } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
/* global fetch, document -- Node's fetch; `document` only inside the browser callbacks of page.evaluate */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const { chromium } = createRequire(
  join(ROOT, 'apps/studio/server/package.json'),
)('@playwright/test');
const PORT = 4496;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.MINI_JEUX_SHOTS ?? join(tmpdir(), 'mini-jeux-check');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok ' : '  KO '} ${what}`);
  if (!ok) failures++;
};
const api = async (path, body) =>
  (
    await fetch(
      `${BASE}${path}`,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    )
  ).json();

const demo = spawn(
  process.execPath,
  ['--import', 'tsx', 'scripts/mini-jeux-demo.ts'],
  {
    cwd: join(ROOT, 'apps/core-api'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
demo.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(d));
const stop = () => demo.kill();
process.on('exit', stop);

try {
  for (let i = 0; i < 60; i++) {
    if (
      await fetch(`${BASE}/api/wallet`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await sleep(500);
  }
  const browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
  });

  async function open(opts = {}) {
    const ctx = await browser.newContext({
      viewport: { width: 1500, height: 950 },
      ...opts,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/`);
    await sleep(3000);
    const fr = page.frames().find((x) => x.url().includes('video_component'));
    await fr.locator('.rh-nav--prev').click();
    await sleep(600);
    await fr.locator('.rh-nav--prev').click();
    await sleep(800);
    await fr.locator('.rh-card.is-active').click({ force: true });
    await sleep(1500);
    return { ctx, page, fr, errors };
  }
  const tokens = async () => (await api('/api/wallet')).tokens;
  const history = async () => (await api('/api/history')).requests;
  async function buy(fr) {
    await fr.locator('.rb__go').click();
    await sleep(450);
    await fr.locator('.rb__go').click();
  }
  async function settle(fr) {
    for (let i = 0; i < 60; i++) {
      await sleep(400);
      const mode = await fr.locator('.rbm').getAttribute('data-mode');
      const status = await fr.locator('.rbm__status').textContent();
      if (mode === 'result' && !/cours|Tirage/.test(status)) return;
    }
  }

  console.log('Mini-jeux — parcours');
  let { ctx, page, fr, errors } = await open();
  check(
    await fr.locator('.mg__tile').isVisible(),
    'le catalogue Mini-jeux s’ouvre, avec Random Ban',
  );
  await fr.locator('.mg__tile').click();
  await sleep(2000);
  check(
    (await fr.locator('.rb__go').textContent()).includes('25'),
    'le bouton dit le prix (25K)',
  );
  check(
    (await fr.locator('.rbg__next').textContent()).includes('normal'),
    'la jauge dit le tarif normal',
  );
  await page.locator('#ext').screenshot({ path: join(SHOTS, '1-game.png') });

  const before = await tokens();
  await fr.locator('.rb__go').dblclick();
  await sleep(600);
  check(
    (await tokens()) === before && (await history()).length === 0,
    'un double-clic arme, il ne paie jamais',
  );
  await sleep(5200); // the arming expires
  await fr.locator('.rb__input').fill('@kiwi');
  await buy(fr);
  await sleep(800);
  check(
    (await tokens()) === before - 25_000,
    'un achat débite une seule fois (25 000)',
  );
  await settle(fr);
  const first = (await history())[0];
  const shown = await fr.locator('.rbm__name').textContent();
  check(
    !!first.target && shown === first.target.name,
    `la machine s’arrête sur la cible du Core (${shown})`,
  );
  check(
    (await fr.locator('.rbg__next').textContent()).startsWith('↓'),
    'la jauge descend après l’achat (palier 2)',
  );
  await page.locator('#ext').screenshot({ path: join(SHOTS, '2-result.png') });

  await page.reload();
  await sleep(3500);
  fr = page.frames().find((x) => x.url().includes('video_component'));
  if (await fr.locator('.rh-card.is-active').count()) {
    await fr.locator('.rh-nav--prev').click();
    await sleep(600);
    await fr.locator('.rh-nav--prev').click();
    await sleep(800);
    await fr.locator('.rh-card.is-active').click({ force: true });
    await sleep(1500);
  }
  let replayed = false;
  for (let i = 0; i < 8; i++) {
    if ((await fr.locator('.rbm').getAttribute('data-mode')) === 'reel')
      replayed = true;
    await sleep(250);
  }
  check(!replayed, 'un rafraîchissement ne rejoue pas un tirage déjà vu');

  await api('/api/mod', { action: 'pause', reason: 'check' });
  await sleep(4500);
  check(
    /pause/.test(await fr.locator('.rbm__info').textContent()) &&
      (await fr.locator('.rb__go').isDisabled()),
    'pause de modération dite avant le clic, bouton fermé',
  );
  await api('/api/mod', { action: 'resume', reason: 'check' });
  await api('/api/lab-mod', {
    action: 'set_cooldown',
    viewer_id: '9001',
    module: 'random_ban',
    delay_s: 900,
    span: 3600,
    reason: 'check',
  });
  await sleep(4500);
  check(
    /Délai fixé par la modération/.test(
      await fr.locator('.rbm__info').textContent(),
    ),
    'délai de modération distinct du prix, avec son compte à rebours',
  );
  await page
    .locator('#ext')
    .screenshot({ path: join(SHOTS, '3-cooldown.png') });
  await api('/api/lab-mod', {
    action: 'clear_cooldown',
    viewer_id: '9001',
    module: 'random_ban',
    reason: 'check',
  });
  await sleep(4500);
  check(
    !(await fr.locator('.rb__go').isDisabled()),
    'délai levé : on peut rejouer',
  );

  await api('/api/small-chat', {});
  let hit = false;
  for (let t = 0; t < 10 && !hit; t++) {
    const w0 = await tokens();
    await fr.locator('.rb__input').fill('@pika');
    await buy(fr);
    for (let i = 0; i < 40 && !hit; i++) {
      await sleep(400);
      hit = (await fr.locator('.rbm').getAttribute('class')).includes(
        'is-sniped',
      );
    }
    if (hit) {
      await sleep(1500);
      const last = (await history())[0];
      check(
        last.sniper === 'hit' &&
          (await tokens()) === w0 - last.price_paid + 2_000,
        'Sniper réussi : verrou vert, prime de 2 000 versée une fois',
      );
      check(
        (await fr.locator('.rbm__badge').textContent()).includes('2'),
        'la prime est affichée sur la machine',
      );
      await page
        .locator('#ext')
        .screenshot({ path: join(SHOTS, '4-sniper.png') });
    } else await settle(fr);
  }
  check(hit, 'un Sniper réussi a été vu (chat réduit à Pika)');
  await api('/api/small-chat', {});
  check(
    errors.length === 0,
    `aucune erreur de page (${errors.slice(0, 2).join(' | ')})`,
  );
  await ctx.close();

  console.log('Animations réduites et tailles');
  ({ ctx, page, fr } = await open({ reducedMotion: 'reduce' }));
  if (await fr.locator('.mg__tile').count())
    await fr.locator('.mg__tile').click();
  await sleep(6000);
  await buy(fr);
  let reel = false;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    if ((await fr.locator('.rbm').getAttribute('data-mode')) === 'reel')
      reel = true;
  }
  check(!reel, 'animations réduites : le résultat sans défilement');
  for (const [w, h] of [
    [651, 434],
    [480, 320],
    [318, 496],
  ]) {
    await page.evaluate(
      ([w, h]) => {
        const e = document.getElementById('ext');
        e.width = w;
        e.height = h;
      },
      [w, h],
    );
    await sleep(1200);
    const overflow = await fr.evaluate(
      () =>
        document.querySelector('.rb')?.scrollWidth >
        document.querySelector('.rb')?.clientWidth + 1,
    );
    check(!overflow, `${w}×${h} : rien ne déborde en largeur`);
    await page
      .locator('#ext')
      .screenshot({ path: join(SHOTS, `5-${w}x${h}.png`) });
  }
  await ctx.close();
  await browser.close();
} finally {
  stop();
}
console.log(
  failures
    ? `\n${failures} échec(s) — captures : ${SHOTS}`
    : `\nTout est bon — captures : ${SHOTS}`,
);
process.exit(failures ? 1 : 0);
