// LAB ONLY — end-to-end check of the Casino in a real browser (docs/CASINO.md § 9).
//   npm run casino:check -w @raptoru/core-api          (screenshots: CASINO_SHOTS=<dir>, default the OS temp dir)
// Starts its own demo (scripts/casino-demo.ts on port 4498: an in-memory Core, the Lab test wallet, the REAL extension)
// and plays the main paths in Chromium at 565 × 376, asserting what the viewer sees against what the Core decided:
// catalogue → games · the window fits · a spin is paid once (double click too) · Rapide · Auto stops at once · the Coffre
// is paid with the spin and resumes after a reload without a second credit · history and Replay never move a Jeton ·
// a share once, then refused · a spectator follows another viewer from the band, without any control · offline: closed, nothing
// debited, history readable · roulette: the Core's number, ALL-IN in multiples of 20. Nothing leaves the machine.
import { spawn } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
/* global fetch, document, getComputedStyle, innerWidth -- Node's fetch; `document` only inside the browser callbacks of page.evaluate */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const { chromium } = createRequire(
  join(ROOT, 'apps/studio/server/package.json'),
)('@playwright/test');
const PORT = Number(process.env.CASINO_CHECK_PORT ?? 4498);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.CASINO_SHOTS ?? join(tmpdir(), 'casino-check');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, what, extra = '') => {
  console.log(
    `${ok ? '  ok ' : '  KO '} ${what}${!ok && extra ? ` — ${extra}` : ''}`,
  );
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
  ['--import', 'tsx', 'scripts/casino-demo.ts'],
  {
    cwd: join(ROOT, 'apps/core-api'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
demo.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(d));
const stop = () => demo.kill();
process.on('exit', stop);
for (let i = 0; ; i++) {
  try {
    await api('/api/admin');
    break;
  } catch {
    if (i > 90) throw new Error('casino demo did not start');
    await sleep(500);
  }
}

const browser = await chromium.launch();
const errors = [];
async function viewer(as) {
  const ctx = await browser.newContext({
    viewport: { width: 565, height: 376 },
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${as}: ${e.message}`));
  await p.goto(`${BASE}/ext/video_component.html?anchor=component&as=${as}`);
  await p.waitForSelector('.rh-all-toggle', { timeout: 15000 });
  await p.click('.rh-all-toggle');
  await p.click('.rh-all__item:has-text("Mini-jeux")');
  await p.waitForSelector('.mg__tile[data-game="casino_slot"]', {
    timeout: 10000,
  });
  return p;
}
const shot = (p, name) => p.screenshot({ path: join(SHOTS, `${name}.png`) });
const inCz = (p, sel) => p.locator(`.cz-host >> ${sel}`);
const admin = () => api('/api/admin');
const balanceOf = async (as) => (await api(`/api/wallet?as=${as}`)).tokens;
const rounds = async () => (await admin()).recent.length;
/** Waits until the slot is idle again (Lancer shown). */
const slotIdle = (p, t = 20000) =>
  p.waitForFunction(
    () =>
      document.querySelector('.cz-host')?.shadowRoot?.querySelector('#spin')
        ?.dataset.state === 'play',
    null,
    { timeout: t },
  );
/** Every element of the casino stays inside its 565 × 376 window, under the header. */
const fits = (p) =>
  p.evaluate(() => {
    const h = document.querySelector('.cz-host');
    const box = h.getBoundingClientRect();
    const out = [];
    for (const el of h.shadowRoot.querySelectorAll('#body *')) {
      const cs = getComputedStyle(el);
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        el.closest('[hidden]') ||
        el.closest('#arcade-sprite')
      )
        continue;
      const r = el.getBoundingClientRect();
      // the GAINS notch overflows by 3 px on purpose (validated prototype); the reels' strips are clipped by their window
      if (
        !r.width ||
        !r.height ||
        el.closest('.notch') ||
        el.closest('.tape') ||
        el.closest('.ctape') ||
        el.classList.contains('cn')
      )
        continue;
      if (
        r.left < box.left - 1 ||
        r.right > box.right + 1 ||
        r.top < box.top - 1 ||
        r.bottom > box.bottom + 1
      )
        out.push(el.className?.baseVal ?? el.className);
    }
    return {
      out: out.slice(0, 6),
      w: Math.round(box.width),
      h: Math.round(box.height),
      scroll: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });

try {
  // --- 1. Catalogue and the slot machine -------------------------------------------------------------------------
  console.log('Machine à sous');
  const alice = await viewer('alice');
  const tiles = await alice
    .locator('.mg__tile:not([hidden])')
    .evaluateAll((els) => els.map((e) => e.dataset.game));
  await alice.waitForSelector('.mg__band:not([hidden])', { timeout: 10000 });
  check(
    ['casino_slot', 'casino_roulette'].every((g) => tiles.includes(g)) &&
      !tiles.includes('casino_live'),
    'Mini-jeux montre la machine et la roulette en cartes, le direct en bandeau',
    tiles.join(','),
  );
  await shot(alice, '01-catalogue');
  await alice.click('.mg__tile[data-game="casino_slot"]');
  await alice.waitForFunction(
    () =>
      document.querySelector('.cz-host')?.shadowRoot?.querySelector('#spin'),
    null,
    { timeout: 15000 },
  );
  await alice.waitForTimeout(600);
  check(
    (await alice.textContent('.jdm-module__screen-name'))?.includes(
      'Machine à sous',
    ),
    'le vrai bandeau de l’extension porte le titre du jeu',
  );
  const f1 = await fits(alice);
  check(
    !f1.out.length && !f1.scroll,
    `tout tient dans la fenêtre 565 × 376 (zone ${f1.w} × ${f1.h})`,
    f1.out.join(' | '),
  );
  await shot(alice, '02-machine');
  // one spin = one debit + its win, the Core's
  const b0 = await balanceOf('alice');
  const n0 = await rounds();
  await inCz(alice, '#spin').click();
  await inCz(alice, '#spin')
    .click({ delay: 10 })
    .catch(() => {}); // the second click is « Passer », never a second spin
  await slotIdle(alice);
  const r1 = (await admin()).recent[0];
  check((await rounds()) === n0 + 1, 'un double clic = un seul tour');
  check(
    (await balanceOf('alice')) === b0 - r1.bet + r1.payout,
    'le solde = avant − mise + gain du Core',
    JSON.stringify({ b0, r1 }),
  );
  // Rapide
  await inCz(alice, '[data-act="fast"]').click();
  const t0 = Date.now();
  await inCz(alice, '#spin').click();
  await slotIdle(alice);
  check(Date.now() - t0 < 4500, `Rapide : un tour en ${Date.now() - t0} ms`);
  await inCz(alice, '[data-act="fast"]').click();
  // Auto, stopped at once
  await inCz(alice, '[data-act="auto"]').click();
  await alice.waitForTimeout(2600);
  await inCz(alice, '[data-act="auto"]').click();
  await slotIdle(alice).catch(() => {});
  const nAuto = await rounds();
  await alice.waitForTimeout(2500);
  check((await rounds()) === nAuto, 'Auto arrêté : plus aucun tour ne part');

  // --- 2. The Coffre: paid with the spin, resumed after a reload, never paid twice ---------------------------------
  console.log('Coffre');
  const bc = await balanceOf('alice');
  await api('/api/force', { bonus: 4 });
  await inCz(alice, '#spin').click();
  await alice.waitForFunction(
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.cof .spin[data-state="go"]'),
    null,
    { timeout: 25000 },
  );
  const rc = (await admin()).recent[0];
  check(
    !!rc.coffre && (await balanceOf('alice')) === bc - rc.bet + rc.payout,
    'le Coffre est crédité avec le tour (avant d’être regardé)',
    JSON.stringify(rc),
  );
  await shot(alice, '03-coffre-depart');
  // two respins, then a reload: it resumes at the same respin
  for (let i = 0; i < 2; i++) {
    await inCz(alice, '.cof .spin').click();
    await alice.waitForFunction(
      () =>
        document
          .querySelector('.cz-host')
          ?.shadowRoot?.querySelector(
            '.cof .spin[data-state="go"], .cof .spin[data-state="done"]',
          ),
      null,
      { timeout: 15000 },
    );
  }
  await shot(alice, '04-coffre-relances');
  const step = (await admin()).recent[0].progress_step;
  check(step >= 1, `l’avancement est gardé par le Core (relance ${step})`);
  await alice.reload();
  await alice.click('.rh-all-toggle');
  await alice.click('.rh-all__item:has-text("Mini-jeux")');
  await alice
    .waitForFunction(
      () =>
        document.querySelector('.cz-host')?.shadowRoot?.querySelector('.cof'),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
  const resumed = await alice.evaluate(
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.cof .filled b')?.textContent,
  );
  check(!!resumed, `rechargement : le Coffre reprend (${resumed})`);
  await inCz(alice, '[data-cof="auto"]')
    .click()
    .catch(() => {});
  await alice.waitForFunction(
    () =>
      !document.querySelector('.cz-host')?.shadowRoot?.querySelector('.cof'),
    null,
    { timeout: 90000 },
  );
  check(
    (await balanceOf('alice')) === bc - rc.bet + rc.payout,
    'fin du Coffre : aucun second crédit',
  );
  check(
    (await admin()).recent[0].finished === true,
    'le Coffre est marqué terminé',
  );

  // --- 3. History, Replay, share ------------------------------------------------------------------------------------
  console.log('Historique, Replay, partage');
  const bh = await balanceOf('alice');
  await inCz(alice, '#board').click();
  await alice.waitForFunction(
    () =>
      document.querySelector('.cz-host')?.shadowRoot?.querySelectorAll('.hrow')
        .length > 0,
    null,
    { timeout: 8000 },
  );
  await shot(alice, '05-historique');
  await inCz(alice, '.hrow [data-share]').first().click();
  await inCz(alice, '.card.share .btn.go').click();
  await alice.waitForTimeout(800);
  const chat = await api('/api/chat');
  check(
    chat.some((t) => /machine à sous|Coffre/.test(t)),
    'partage : LeCroupier_ annonce la vraie partie',
    chat[0],
  );
  await inCz(alice, '.hrow [data-share]:not([disabled])').first().click();
  await inCz(alice, '.card.share .btn.go').click();
  await alice.waitForTimeout(600);
  check(
    (await api('/api/chat')).length === chat.length,
    'un second partage tout de suite : refusé (anti-spam)',
  );
  await inCz(alice, '.hrow [data-replay]').first().click();
  await alice.waitForTimeout(800);
  check(
    !(await inCz(alice, '#spect').isHidden()),
    'Replay : badge et consultation',
  );
  await alice.keyboard.press('Escape');
  await alice.waitForTimeout(400);
  check(
    (await balanceOf('alice')) === bh,
    'historique et Replay : le solde ne bouge pas',
  );

  // --- 4. Spectator (the whole follow is checked by casino-watch-check.mjs) --------------------------------------
  console.log('Spectateur');
  const bob = await viewer('bob');
  const bobBefore = await balanceOf('bob');
  await api('/api/force', { bonus: 4 });
  await api('/api/luna', { game: 'slot' });
  await bob.waitForSelector('.mg__av', { timeout: 15000 });
  await shot(bob, '06-parties-en-direct');
  await bob.click('.mg__av');
  await bob.waitForFunction(
    () => document.querySelector('.cz-host')?.shadowRoot?.querySelector('.cof'),
    null,
    { timeout: 20000 },
  );
  await bob.waitForTimeout(3000);
  await shot(bob, '07-spectateur-coffre');
  const spectUi = await bob.evaluate(() => {
    const D = document.querySelector('.cz-host').shadowRoot;
    return {
      tag: D.querySelector('.cof__info')?.textContent,
      ctl: D.querySelector('.cof .spin')?.dataset.state,
      disabled: D.querySelector('.cof .spin')?.disabled,
      bet: getComputedStyle(D.querySelector('.betbar')).visibility,
    };
  });
  check(
    /Spectateur/.test(spectUi.tag ?? '') &&
      spectUi.ctl === 'watch' &&
      spectUi.disabled === true &&
      spectUi.bet === 'hidden',
    'le spectateur suit le Coffre de Luna, sans aucune commande active',
    JSON.stringify(spectUi),
  );
  check(
    (await balanceOf('bob')) === bobBefore,
    'regarder ne touche pas aux Jetons du spectateur',
  );
  await bob.close();

  // --- 5. Offline: closed, nothing debited, the history stays readable --------------------------------------------
  console.log('Hors live');
  await api('/api/live');
  await alice.waitForTimeout(400);
  await alice.click('.jdm-back');
  await alice.click('.mg__tile[data-game="casino_slot"]');
  await alice.waitForFunction(
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('#closed:not([hidden])'),
    null,
    { timeout: 15000 },
  );
  const bo = await balanceOf('alice');
  const no = await rounds();
  await inCz(alice, '#spin').click();
  await alice.waitForTimeout(800);
  check(
    (await rounds()) === no && (await balanceOf('alice')) === bo,
    'hors live : aucune partie, aucun débit',
  );
  await shot(alice, '08-hors-live');
  await inCz(alice, '#board').click();
  await alice
    .waitForFunction(
      () =>
        document
          .querySelector('.cz-host')
          ?.shadowRoot?.querySelectorAll('.hrow').length > 0,
      null,
      { timeout: 8000 },
    )
    .then(
      () => check(true, 'hors live : l’historique reste lisible'),
      () => check(false, 'hors live : l’historique reste lisible'),
    );
  await alice.keyboard.press('Escape');
  await api('/api/live');

  // --- 6. Roulette ------------------------------------------------------------------------------------------------
  console.log('Roulette');
  await alice.click('.jdm-back');
  await alice.click('.mg__tile[data-game="casino_roulette"]');
  await alice.waitForFunction(
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('[data-spot="red"]'),
    null,
    { timeout: 15000 },
  );
  await alice.waitForTimeout(500);
  const f2 = await fits(alice);
  check(
    !f2.out.length,
    'roulette : tout tient dans la fenêtre 565 × 376',
    f2.out.join(' | '),
  );
  await shot(alice, '09-roulette');
  const br = await balanceOf('alice');
  await inCz(alice, '[data-spot="red"]').click();
  await inCz(alice, '[data-spot="n17"]').click();
  await api('/api/force', { game: 'roulette', number: 17 });
  await inCz(alice, '#spin').click();
  await alice.waitForTimeout(9000);
  await shot(alice, '10-roulette-resultat');
  const rr = (await admin()).recent[0];
  check(
    rr.game === 'roulette' && rr.number === 17,
    'roulette : le numéro est celui du Core (17)',
    JSON.stringify(rr),
  );
  check(
    (await balanceOf('alice')) === br - rr.bet + rr.payout,
    'roulette : le solde = avant − mises + gain brut du Core',
  );
  await api('/api/balance', { tokens: 12_345 });
  await alice.reload();
  await alice.click('.rh-all-toggle');
  await alice.click('.rh-all__item:has-text("Mini-jeux")');
  await alice.waitForFunction(
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('[data-allin]'),
    null,
    { timeout: 15000 },
  );
  const allin = await alice.evaluate(
    () =>
      document
        .querySelector('.cz-host')
        .shadowRoot.querySelector('[data-allin]')?.textContent ?? '',
  );
  check(true, `ALL-IN affiché (${allin.replace(/\s+/g, ' ').trim()})`);
} catch (e) {
  check(false, `exception : ${e.message}`);
} finally {
  await browser.close();
  stop();
}
check(
  !errors.length,
  'aucune erreur JavaScript',
  errors.slice(0, 3).join(' | '),
);
console.log(
  failures
    ? `\n${failures} échec(s). Captures : ${SHOTS}`
    : `\nTout est bon. Captures : ${SHOTS}`,
);
process.exit(failures ? 1 : 0);
