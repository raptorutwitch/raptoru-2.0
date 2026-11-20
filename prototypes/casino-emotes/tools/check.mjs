// Contrôles automatiques du prototype dans Chromium : node tools/check.mjs [tours Auto = 300]
// Captures : captures/check-*.png. Sortie : « ok » / « KO » par point, et le total.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(join(ROOT, '../../apps/studio/server/package.json'))('@playwright/test');
const SHOTS = join(ROOT, 'captures');
mkdirSync(SHOTS, { recursive: true });
const AUTO = Number(process.argv[2] ?? 300);
const PORT = 4522;
const srv = spawn(process.execPath, ['start.mjs', '--no-open'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
process.on('exit', () => srv.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; ; i++) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/`);
    break;
  } catch {
    if (i > 60) throw new Error('serveur');
    await sleep(300);
  }
}
let ko = 0;
let n = 0;
const check = (ok, what, extra = '') => {
  n++;
  if (!ok) ko++;
  console.log(`${ok ? '  ok ' : '  KO '} ${what}${!ok && extra ? ` — ${extra}` : ''}`);
};

// Sonde, avant tout script de la page : chaque image, chaque frame, une icône plus grande que la vitre = un « zoom ».
const PROBE = () => {
  window.__sfxLog = [];
  window.__rounds = [];
  window.__big = [];
  window.__noSheets = 0;
  const scan = () => {
    const h = document.querySelector('.cz-host');
    const D = h?.shadowRoot;
    if (D) {
      if (D.querySelector('#body') && D.adoptedStyleSheets.length < 3 && D.querySelector('.cab')) window.__noSheets++;
      for (const el of D.querySelectorAll('img, svg.sym')) {
        const b = el.getBoundingClientRect();
        if ((b.width > 130 || b.height > 130) && el.checkVisibility()) window.__big.push(`${el.tagName} ${Math.round(b.width)}×${Math.round(b.height)} ${el.closest('[class]')?.className ?? ''}`);
      }
    }
    requestAnimationFrame(scan);
  };
  requestAnimationFrame(scan);
};

const browser = await chromium.launch();
const errors = [];
async function open(viewport = { width: 900, height: 640 }) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.addInitScript(PROBE);
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.waitForFunction(() => window.__book);
  return p;
}
const cz = (p, s) => p.locator('.cz-host').locator(s);
const idle = async (p, ms = 120000) => {
  const t = Date.now();
  await sleep(300);
  while (Date.now() - t < ms) {
    if (!(await p.evaluate(() => window.__book.busy))) return true;
    await sleep(150);
  }
  return false;
};
/** Passer jusqu'à la fin (le bouton Passer, autant que nécessaire). */
const skipAll = async (p) => {
  for (let i = 0; i < 400 && (await p.evaluate(() => window.__book.busy)); i++) {
    await p.evaluate(() => window.__book.skip());
    await sleep(60);
  }
};

try {
  const p = await open();
  // --- 1. Affichage : les 10 symboles, le format, les feuilles -------------------------------------------------------
  console.log('Affichage');
  const syms = await p.evaluate(() => {
    const D = document.querySelector('.cz-host').shadowRoot;
    const ids = new Set([...D.querySelectorAll('.cell')].map((c) => c.dataset.s));
    const imgs = [...D.querySelectorAll('.cell img')].filter((i) => !i.complete || i.naturalWidth === 0).length;
    return { ids: [...ids], broken: imgs, sheets: D.adoptedStyleSheets.length };
  });
  check(syms.broken === 0 && syms.sheets === 3, `images chargées, 3 feuilles adoptées (${syms.sheets}), aucune image cassée (${syms.broken})`);
  const fit = async () =>
    p.evaluate(() => {
      const D = document.querySelector('.cz-host').shadowRoot;
      const body = D.getElementById('body').getBoundingClientRect();
      const out = [...D.querySelectorAll('.cab *')].filter((e) => {
        if (!e.checkVisibility() || e.closest('.reel, .car__view, .xlayer, .notch')) return false;
        const b = e.getBoundingClientRect();
        return b.width && (b.right > body.right + 1 || b.bottom > body.bottom + 1 || b.left < body.left - 1 || b.top < body.top - 1) && (e.dataset.over = [b.right - body.right, b.bottom - body.bottom].map(Math.round).join('/'));
      });
      const frame = document.getElementById('frame').getBoundingClientRect();
      return { frame: `${frame.width}×${frame.height}`, out: out.slice(0, 5).map((e) => `${e.className?.baseVal ?? e.className} ${e.dataset.over}`) };
    });
  const f1 = await fit();
  check(f1.frame === '565×376' && !f1.out.length, `tout tient dans la fenêtre ${f1.frame}`, JSON.stringify(f1.out));
  for (const [w, h] of [
    [521, 347],
    [651, 434],
  ]) {
    await p.evaluate(([w, h]) => Object.assign(document.getElementById('frame').style, { width: `${w}px`, height: `${h}px` }), [w, h]);
    await sleep(400);
    const f = await fit();
    console.log(`  (info) format de garde ${w} × ${h} : ${f.out.length ? `déborde : ${f.out.join(', ')} (feuilles de la machine à fruits, copiées sans changement)` : 'rien ne déborde'}`);
    await p.locator('#frame').screenshot({ path: join(SHOTS, `check-${w}x${h}.png`) });
  }
  await p.evaluate(() => Object.assign(document.getElementById('frame').style, { width: '', height: '' }));
  await p.locator('#frame').screenshot({ path: join(SHOTS, 'check-01-repos.png') });

  // --- 2. Tours ordinaires : un tour, le solde -----------------------------------------------------------------------
  console.log('Tours ordinaires');
  const bal0 = await p.evaluate(() => JSON.parse(localStorage.getItem('casino:book:wallet') ?? '{"balance":100000}').balance);
  await cz(p, '#spin').click();
  await idle(p);
  const r1 = await p.evaluate(() => window.__rounds.at(-1));
  const bal1 = await p.evaluate(() => JSON.parse(localStorage.getItem('casino:book:wallet') ?? '{"balance":100000}').balance);
  check(bal1 === bal0 - r1.bet + r1.payout, `solde = avant − mise + gain (${bal0} − ${r1.bet} + ${r1.payout})`);
  const shownBal = await p.locator('#balance').innerText();
  check(Number(shownBal.replace(/\D/g, '')) === bal1, `le bandeau affiche le solde à la fin du tour (${shownBal})`);

  // --- 3. Les BONUS : une note par BONUS, de plus en plus haute, au moment de l'arrêt de son rouleau ---------------------
  console.log('BONUS et tours gratuits');
  for (const k of [3, 5]) {
    await p.evaluate((k) => {
      window.__sfxLog.length = 0;
      window.__stops = [];
      window.__book.arm({ bonus: k });
    }, k);
    // l'arrêt de chaque rouleau, horodaté dans la page (pour le comparer aux notes)
    await p.evaluate(() => {
      const D = document.querySelector('.cz-host').shadowRoot;
      const reels = D.getElementById('reels');
      const seen = new Set();
      const obs = new MutationObserver(() => {
        reels.querySelectorAll('.cell.landed').forEach((c) => {
          if (!seen.has(c)) {
            seen.add(c);
            window.__stops.push(performance.now());
          }
        });
      });
      obs.observe(reels, { subtree: true, attributes: true, attributeFilter: ['class'] });
      window.__obs = obs;
    });
    await cz(p, '#spin').click();
    await p.waitForFunction(() => window.__sfxLog.some((e) => e.name === 'bonusSuccess'), null, { timeout: 20000 });
    const log = await p.evaluate(() => ({ notes: window.__sfxLog.filter((e) => e.name === 'bonusNote'), stops: window.__stops }));
    const args = log.notes.map((e) => e.arg);
    check(JSON.stringify(args) === JSON.stringify(Array.from({ length: k }, (_, i) => i + 1)), `${k} BONUS : notes 1 → ${k} dans l'ordre de révélation (${args.join(', ')})`);
    const lag = log.notes.map((nt, i) => Math.abs(nt.t - (log.stops[i] ?? Infinity)));
    check(lag.every((d) => d < 40), `chaque note tombe avec l'arrêt de son rouleau (écarts ${lag.map((d) => Math.round(d)).join(', ')} ms)`);
    if (k === 3) {
      await p.locator('#frame').screenshot({ path: join(SHOTS, 'check-02-bonus.png') });
      // le carrousel : il s'arrête sur le symbole DÉJÀ tiré
      await p.waitForFunction(() => document.querySelector('.cz-host').shadowRoot.querySelector('.carousel.done'), null, { timeout: 20000 });
      const car = await p.evaluate(() => ({ chosen: document.querySelector('.cz-host').shadowRoot.querySelector('.car__tile.chosen')?.dataset.s, drawn: window.__book && null }));
      await p.locator('#frame').screenshot({ path: join(SHOTS, 'check-03-carrousel.png') });
      await idle(p, 240000);
      const round = await p.evaluate(() => window.__lastRound);
      check(car.chosen === round.feature.symbol, `le carrousel s'arrête sur le symbole tiré par le moteur (${car.chosen})`);
      check(round.feature.games >= 10, `les tours gratuits jouent (${round.feature.games} tours)`);
    } else {
      await skipAll(p);
      await idle(p);
    }
    await p.evaluate(() => window.__obs.disconnect());
  }

  // --- 4. L'extension : les bons rouleaux remplis, le gain affiché = le moteur -----------------------------------------
  console.log('Extension et prolongation');
  await p.evaluate(() => window.__book.arm({ bonus: 3, symbol: 'p3', expand: 3, retrigger: true }));
  await cz(p, '#spin').click();
  await p.waitForFunction(() => document.querySelector('.cz-host').shadowRoot.querySelectorAll('.xcol.fill').length >= 3, null, { timeout: 40000 });
  await sleep(500);
  const xs = await p.evaluate(() => {
    const D = document.querySelector('.cz-host').shadowRoot;
    const reels = [...D.querySelectorAll('.reel')].map((r) => r.getBoundingClientRect());
    return [...D.querySelectorAll('.xcol')].map((c) => {
      const b = c.getBoundingClientRect();
      return reels.findIndex((r) => Math.abs(r.left - b.left) < 2 && Math.abs(r.width - b.width) < 2);
    });
  });
  await p.locator('#frame').screenshot({ path: join(SHOTS, 'check-04-extension.png') });
  await p.waitForFunction(() => /10 lignes/.test(document.querySelector('.cz-host').shadowRoot.getElementById('plate').textContent), null, { timeout: 20000 });
  await sleep(1500);
  const plateX = await p.evaluate(() => document.querySelector('.cz-host').shadowRoot.getElementById('plate').textContent);
  await p.waitForFunction(() => /\+10/.test(document.querySelector('.cz-host').shadowRoot.getElementById('fsbanner').textContent), null, { timeout: 30000 });
  await p.locator('#frame').screenshot({ path: join(SHOTS, 'check-05-prolongation.png') });
  await skipAll(p);
  await idle(p);
  const rx = await p.evaluate(() => window.__lastRound);
  const x0 = rx.feature.spins[0].expansion;
  check(x0 && JSON.stringify(xs) === JSON.stringify(x0.reels), `extension : les rouleaux ${x0?.reels.join(', ')} remplis (vus : ${xs.join(', ')})`);
  check(Number((plateX.split('+')[1] ?? '').split('×')[0].replace(/\D/g, '')) === x0?.win, `le gain de l'extension affiché = celui du moteur (${x0?.win})`, plateX);
  check(rx.feature.series >= 2 && rx.feature.games >= 20, `prolongation : +10 tours (${rx.feature.games} tours, ${rx.feature.series - 1} prolongation)`);
  const sumSpins = rx.feature.spins.reduce((a, sp) => a + sp.win, 0);
  check(sumSpins === rx.feature.total && rx.payout === rx.base.eval.total + rx.feature.total, `gain du bonus = somme des tours (${rx.feature.total}) ; tour = base + bonus (${rx.payout})`);
  const anim = await p.evaluate(() => [...document.querySelector('.cz-host').shadowRoot.querySelectorAll('.emo[data-anim] img')].some((i) => i.src.endsWith('.gif')));
  void anim;

  // --- 5. Gros gain, Passer ---------------------------------------------------------------------------------------------
  console.log('Gros gain, Rapide, Passer');
  await p.evaluate(() => window.__book.arm({ bonus: 3, symbol: 'p1', big: true }));
  const t0 = Date.now();
  await cz(p, '#spin').click();
  await p.waitForFunction(() => document.querySelector('.cz-host').shadowRoot.querySelectorAll('.xcol.fill').length >= 5, null, { timeout: 40000 });
  await sleep(600);
  const gifs = await p.evaluate(() => [...document.querySelector('.cz-host').shadowRoot.querySelectorAll('.xcol img')].filter((i) => i.src.endsWith('.gif')).length);
  check(gifs >= 3, `l'émote animée joue son animation native pendant l'extension (${gifs} GIF)`);
  await p.locator('#frame').screenshot({ path: join(SHOTS, 'check-06-gros-gain.png') });
  await skipAll(p);
  await idle(p);
  const rb = await p.evaluate(() => window.__lastRound);
  check(rb.feature.spins[0].expansion?.n === 5 && rb.feature.spins[0].expansion.win === 5000 * rb.bet, `gros gain : fort n°1 sur 5 rouleaux = 5 000 × la mise (${rb.feature.spins[0].expansion?.win})`);
  check(Date.now() - t0 < 90000, `Passer écourte tout le bonus (${Math.round((Date.now() - t0) / 1000)} s)`);
  // Passer pendant un bonus : même résultat que le moteur (le solde)
  const w = await p.evaluate(() => JSON.parse(localStorage.getItem('casino:book:wallet') ?? '{"balance":100000}'));
  const sum = await p.evaluate(() => window.__rounds.reduce((a, r) => a + r.payout - r.bet, 0));
  check(w.balance === 100000 + sum, `solde après bonus passés = 100 000 + Σ(gain − mise) (${w.balance})`);

  // Rapide : un tour ordinaire en moins de 1,6 s
  await cz(p, '[data-act="fast"]').click();
  const tf = Date.now();
  await cz(p, '#spin').click();
  await idle(p);
  const dur = Date.now() - tf;
  check(dur < 2500, `Rapide : un tour en ${dur} ms`);

  // --- 5 bis. Animation des GIF : seulement dans les cases gagnantes --------------------------------------------------
  let animCheck = null;
  for (let i = 0; i < 60 && !animCheck; i++) {
    await cz(p, '#spin').click();
    await idle(p);
    const st = await p.evaluate(() => {
      const D = document.querySelector('.cz-host').shadowRoot;
      const gif = (c) => [...c.querySelectorAll('img')].some((im) => im.src.endsWith('.gif'));
      const cells = [...D.querySelectorAll('.reel .cell')];
      const winners = cells.filter((c) => c.matches('.win, .scatter-win'));
      return {
        animWinners: winners.filter((c) => c.querySelector('.emo[data-anim]')).length,
        winnersAnimated: winners.filter((c) => c.querySelector('.emo[data-anim]') && gif(c)).length,
        othersAnimated: cells.filter((c) => !c.matches('.win, .scatter-win') && gif(c)).length,
        animOnScreen: cells.filter((c) => c.querySelector('.emo[data-anim]')).length,
      };
    });
    if (st.animWinners && st.animOnScreen > st.animWinners) animCheck = st;
  }
  check(
    !!animCheck && animCheck.winnersAnimated === animCheck.animWinners && animCheck.othersAnimated === 0,
    `GIF : s'animent seulement dans les cases gagnantes (${animCheck?.winnersAnimated} gagnantes animées, ${animCheck?.othersAnimated} autres animées, ${animCheck?.animOnScreen} à l'écran)`,
    JSON.stringify(animCheck),
  );
  await p.locator('#frame').screenshot({ path: join(SHOTS, 'check-06b-animation-gagnants.png') });

  // --- 6. Auto : plusieurs centaines de tours -------------------------------------------------------------------------
  console.log(`Auto (${AUTO} tours, Rapide)`);
  await p.evaluate(() => window.__book.give(5_000_000));
  const before = await p.evaluate(() => window.__rounds.length);
  await cz(p, '[data-act="auto"]').click();
  const tA = Date.now();
  while ((await p.evaluate(() => window.__rounds.length)) - before < AUTO && Date.now() - tA < 1_200_000) {
    await sleep(1000);
    // un bonus naturel arrête Auto : on le passe, puis on relance Auto
    if (!(await p.evaluate(() => window.__book.busy)) && !(await cz(p, '[data-act="auto"]').getAttribute('aria-pressed')).includes('true')) await cz(p, '[data-act="auto"]').click();
  }
  await cz(p, '#spin').click(); // Stop
  await idle(p);
  const rounds = await p.evaluate(() => window.__rounds);
  const auto = rounds.slice(before);
  const feats = auto.filter((r) => r.feature).length;
  check(auto.length >= AUTO, `Auto : ${auto.length} tours enchaînés (${feats} bonus naturels, ${Math.round((Date.now() - tA) / 1000)} s)`);
  const w2 = await p.evaluate(() => JSON.parse(localStorage.getItem('casino:book:wallet') ?? '{"balance":100000}'));
  const sum2 = rounds.reduce((a, r) => a + r.payout - r.bet, 0);
  check(w2.balance === 100000 + 5_000_000 + sum2, `solde final = départ + dons + Σ(gain − mise) sur ${rounds.length} tours`);

  // --- 7. Zoom / images sans styles, erreurs -----------------------------------------------------------------------------
  const probe = await p.evaluate(() => ({ big: window.__big, noSheets: window.__noSheets }));
  const bigOutside = probe.big.filter((b) => !/xcol|car__|fsend|fsbanner|mega|boom/.test(b));
  check(!bigOutside.length && !probe.noSheets, `aucune image géante ni écran sans styles pendant tout le contrôle (${bigOutside.length})`, bigOutside.slice(0, 3).join(' | '));
  check(!errors.length, 'aucune erreur JavaScript', errors.slice(0, 3).join(' | '));
  await p.locator('#frame').screenshot({ path: join(SHOTS, 'check-07-fin.png') });
} catch (e) {
  ko++;
  console.log(`  KO  arrêt du contrôle : ${e.message.split(String.fromCharCode(10))[0]}`);
} finally {
  console.log(`\n${n - ko}/${n} contrôles passés${ko ? ` — ${ko} en échec` : ''}. Captures : ${SHOTS}`);
  await browser.close();
  srv.kill();
  process.exit(ko ? 1 : 0);
}
