// LAB ONLY — end-to-end check of Mini-jeux / Random Ban in a real browser (docs/mini-jeux/LIVRAISON_V5.md § 3).
//   npm run mini-jeux:check -w @raptoru/core-api          (screenshots: MINI_JEUX_SHOTS=<dir>, default the OS temp dir)
// Starts its own demo (scripts/mini-jeux-demo.ts, port 4496: an in-memory Core, a FAKE Twitch, fictional Jetons) and
// plays the main paths in Chromium, asserting what the player sees against what the Core decided:
// catalog → game · a double click never pays · one purchase debits once and uses one charge · the machine stops on the
// Core's target · a refresh never replays a draw · moderation pause / personal delay said before the click · charges
// shared with the channel points, none left = refused before anything · moderator refill · purchase in one click (a
// double click still pays once) · a Sniper hit pays once · reduced motion · the three usual extension sizes. Nothing
// leaves the machine.
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
    (await fr.locator('.rbg__next').isHidden()) &&
      (await fr.locator('.rbg__cell.is-full').count()) === 3 &&
      (await fr.locator('.rbg__tip').isHidden()),
    'la jauge montre 3 charges pleines, sans texte ni infobulle au repos',
  );
  check(
    /^\+1\s000$/.test(await fr.locator('.rb__snhint').textContent()),
    'le Sniper annonce une tentative primée (+1 000)',
  );
  await fr.locator('.rbg__btn').hover();
  await sleep(200);
  const tipShown = await fr.locator('.rbg__tip').isVisible();
  await fr.locator('.rb__title').hover();
  await sleep(200);
  check(
    tipShown && (await fr.locator('.rbg__tip').isHidden()),
    'survol : l’infobulle s’ouvre, quitter la zone la referme',
  );
  await fr.locator('.rbg__btn').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await sleep(150);
  const kbOpen = await fr.locator('.rbg__tip').isVisible();
  await page.keyboard.press('Escape');
  await sleep(150);
  check(
    kbOpen && (await fr.locator('.rbg__tip').isHidden()),
    'clavier : le focus ouvre l’infobulle, Échap la referme',
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
  // Anti-spoil: the stream's alert first (the extension still spinning), the extension's reveal a few seconds later
  // (the stream's latency), the timeout after the alert.
  const streamFr = page.frames().find((x) => x.url().includes('/stream'));
  let alertAt = 0;
  let modeAtAlert = '';
  let revealAt = 0;
  let confirmedAt = 0;
  for (let i = 0; i < 200 && !(revealAt && confirmedAt); i++) {
    await sleep(100);
    if (!alertAt && (await streamFr.locator('.card').count())) {
      alertAt = Date.now();
      modeAtAlert = await fr.locator('.rbm').getAttribute('data-mode');
    }
    if (
      !revealAt &&
      (await fr.locator('.rbm').getAttribute('data-mode')) === 'result'
    )
      revealAt = Date.now();
    if (!confirmedAt && (await history())[0]?.status === 'confirmed')
      confirmedAt = Date.now();
  }
  check(
    alertAt > 0 && modeAtAlert === 'spin',
    `anti-spoil : l’alerte du stream part pendant que la machine tourne encore (${modeAtAlert})`,
  );
  check(
    revealAt - alertAt >= 3_000 &&
      confirmedAt > alertAt &&
      confirmedAt >= revealAt,
    `révélation dans l’extension ${((revealAt - alertAt) / 1000).toFixed(1)} s après l’alerte, timeout ensuite (${((confirmedAt - alertAt) / 1000).toFixed(1)} s)`,
  );
  await settle(fr);
  const first = (await history())[0];
  const shown = await fr.locator('.rbm__name').textContent();
  check(
    !!first.target && shown === first.target.name,
    `la machine s’arrête sur la cible du Core (${shown})`,
  );
  check(
    /^\d+:\d\d$/.test((await fr.locator('.rbg__next').textContent()).trim()) &&
      (await fr.locator('.rbg__cell.is-full').count()) === 2,
    'une charge utilisée, la recharge compte à rebours (horloge m:ss, 2 pleines)',
  );
  check(
    (await fr.locator('.rb__snhint').textContent()) === 'pour la gloire',
    'après une tentative primée, le Sniper suivant est « pour la gloire »',
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

  // Charges shared with the channel points: 2 left → two redemptions, then nothing left.
  await api('/api/cp', {});
  await api('/api/cp', {});
  const refusedCp = await api('/api/cp', {});
  // The two accepted ones run first (each: the alert, the reveal, the timeout).
  for (
    let i = 0;
    i < 60 &&
    (await history()).some((h) =>
      ['queued', 'searching', 'timeout_requested'].includes(h.status),
    );
    i++
  )
    await sleep(500);
  await sleep(4500);
  check(
    refusedCp.refused === 'no_charge' &&
      (await fr.locator('.rb__go').isDisabled()) &&
      /Plus de charge/.test(await fr.locator('.rbm__info').textContent()),
    'plus de charge (points de chaîne compris) : refus, bouton fermé, attente affichée',
  );
  check(
    (await api('/api/replies'))[0]?.includes('Plus de charge'),
    'le chat reçoit un refus court',
  );
  await page.locator('#ext').screenshot({ path: join(SHOTS, '3b-empty.png') });
  const refill = () =>
    api('/api/mod', {
      action: 'refill_charges',
      viewer_id: '9001',
      reason: 'check',
    });
  await refill();
  await sleep(4500);
  check(
    !(await fr.locator('.rb__go').isDisabled()) &&
      (await fr.locator('.rbg__cell.is-full').count()) === 3,
    'recharge par la modération : 3 charges, on peut rejouer',
  );

  // Purchase in one click: the setting in « ? », one click pays, a double click still pays once.
  await fr.locator('.rb__info').click();
  await fr.locator('[data-k="oneclick"]').check();
  await fr.locator('.rb__sheet--info .rb__x').click();
  const w1 = await tokens();
  const h1 = (await history()).length;
  await fr.locator('.rb__go').dblclick();
  await sleep(1500);
  check(
    (await tokens()) === w1 - 25_000 && (await history()).length === h1 + 1,
    'achat en un clic : un clic paie, un double clic ne paie qu’une fois',
  );
  await settle(fr);
  await fr.locator('.rb__info').click();
  await fr.locator('[data-k="oneclick"]').uncheck();
  await fr.locator('.rb__sheet--info .rb__x').click();
  await refill();

  await api('/api/sniper-free', {}); // the demo's « always rewarded »: see a paid hit without waiting 30 min
  await api('/api/small-chat', {});
  let hit = false;
  for (let t = 0; t < 10 && !hit; t++) {
    await refill();
    await sleep(4500);
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
          (await tokens()) === w0 - last.price_paid + 1_000,
        'Sniper réussi : verrou vert, prime de 1 000 versée une fois',
      );
      check(
        (await fr.locator('.rbm__badge').textContent()).includes('1'),
        'la prime est affichée sur la machine',
      );
      await page
        .locator('#ext')
        .screenshot({ path: join(SHOTS, '4-sniper.png') });
    } else await settle(fr);
  }
  check(hit, 'un Sniper réussi a été vu (chat réduit à Pika)');
  await api('/api/small-chat', {});
  await api('/api/sniper-free', {});
  check(
    errors.length === 0,
    `aucune erreur de page (${errors.slice(0, 2).join(' | ')})`,
  );
  await ctx.close();

  console.log('Animations réduites et tailles');
  ({ ctx, page, fr } = await open({ reducedMotion: 'reduce' }));
  if (await fr.locator('.mg__tile').count())
    await fr.locator('.mg__tile').click();
  await refill();
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

  // Phone / touch: a tap opens the charges' details, a tap elsewhere or a second tap closes them, never past the edge.
  console.log('Tactile (mobile)');
  ({ ctx, page, fr } = await open({ hasTouch: true }));
  if (await fr.locator('.mg__tile').count())
    await fr.locator('.mg__tile').tap();
  await page.evaluate(() => {
    const e = document.getElementById('ext');
    e.width = 318;
    e.height = 496;
  });
  await refill();
  await sleep(4500);
  await fr.locator('.rbg__btn').tap();
  await sleep(200);
  const tapOpen = await fr.locator('.rbg__tip').isVisible();
  const inside = await fr.evaluate(() => {
    const r = document.querySelector('.rbg__tip').getBoundingClientRect();
    return r.left >= 0 && r.right <= globalThis.innerWidth;
  });
  await page
    .locator('#ext')
    .screenshot({ path: join(SHOTS, '6-touch-tip.png') });
  await fr.locator('.rb__recent').tap();
  await sleep(200);
  const outsideClosed = await fr.locator('.rbg__tip').isHidden();
  await fr.locator('.rbg__btn').tap();
  await sleep(150);
  await fr.locator('.rbg__btn').tap();
  await sleep(150);
  check(
    tapOpen &&
      inside &&
      outsideClosed &&
      (await fr.locator('.rbg__tip').isHidden()),
    'tactile : un appui ouvre, un appui ailleurs ou un second appui ferme, l’infobulle reste dans la fenêtre',
  );
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
