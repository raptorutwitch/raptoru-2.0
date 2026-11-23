// Composition check of the Casino IN THE REAL EXTENSION FRAME (21/11, Antoni: « un rendu réussi n'est pas un rendu
// qui ne déborde pas »). For each real format (width AND height of the frame Twitch gives the extension) and each game,
// the extension's real page runs in demo mode against the casino demo's local Core (casino-demo/local-core.js) and is
// PLAYED through a short scenario (bet, spin, split, bonus…). At each step it measures, inside the game's area:
//   - coverage  : the share of the area taken by the elements that matter (reels, mat, cards, controls…)
//   - void      : the tallest empty horizontal band between them (or against the top/bottom edge), % of the height
//   - reach     : the distance from the game (reels, mat, my hand) to its main control (Lancer, PRÊT, the actions)
//   - targets   : on touch formats, the visible controls under 30 px or 32 × 32 px of area (a finger needs more; an edge tab 30 × 84 passes)
//   - overflow  : an element that matters drawn outside the game's area
// and saves a screenshot. The thresholds flag what to LOOK at; the screenshots are the verdict (out/casino-compose/).
//   node test/responsive/casino-compose.mjs [--only=blackjack,slot] [--sizes=mobile]
// No network: the local Core plays with fictitious Jetons; nothing is written outside test/responsive/out/.
/* global document, window, getComputedStyle */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { startServer } from './server.mjs';
import { buildDemoCore } from './casino-demo/build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out', 'casino-compose');
const { chromium } = createRequire(join(HERE, '../../../../package.json'))(
  '@playwright/test',
);
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ONLY = arg('only')?.split(',');
const SURF = arg('sizes')?.split(',');
const DIMS = arg('dims')?.split(','); // e.g. --dims=563x376,393x484

const PAGES = {
  video: 'video_component.html?anchor=component',
  panel: 'panel.html?anchor=panel',
  mobile: 'mobile.html?anchor=panel&platform=mobile',
};
// [surface, w, h, label]
const SIZES = [
  ['video', 563, 376, 'lecteur Twitch normal, 65 % (défaut)'],
  ['video', 651, 434, 'vidéo 75 % (référence)'],
  ['video', 452, 301, 'vidéo zoom 125 %'],
  ['video', 490, 326, 'petit lecteur'],
  ['video', 390, 260, 'très petit lecteur'],
  ['video', 823, 549, 'grande fenêtre / théâtre'],
  ['video', 1053, 702, 'vidéo plein écran 1080p'],
  ['panel', 318, 496, 'panneau'],
  // Twitch app, portrait: the extension only gets the area under the video (23/11), not the whole screen.
  ['mobile', 393, 484, 'Android courant, sous la vidéo'],
  ['mobile', 360, 409, 'petit Android, sous la vidéo'],
  ['mobile', 412, 515, 'grand Android, sous la vidéo'],
  ['mobile', 844, 390, 'téléphone paysage'],
].filter(
  ([s, w, h]) =>
    (!SURF || SURF.includes(s)) && (!DIMS || DIMS.includes(`${w}x${h}`)),
);

// The elements that matter, per game: [selector, role]. role: 'game' (the play area), 'control' (the main action),
// 'part' (another element that matters). The first visible match of each selector is measured.
const KEYS = {
  slot: [
    ['.cab .window', 'game'],
    ['.cab .betbar', 'part'],
    ['.cab .spin', 'control'],
    ['.cab .toggles', 'part'],
    ['.cab .board', 'part'],
    ['.cof__vault', 'game'],
    ['.cof .spin', 'control'],
  ],
  book: [
    ['.cab .window', 'game'],
    ['.cab .betbar', 'part'],
    ['.cab .spin', 'control'],
    ['.cab .toggles', 'part'],
    ['.cab .board', 'part'],
  ],
  roulette: [
    ['.plateau', 'game'],
    ['.chips', 'part'],
    ['#spin', 'control'],
    ['.tray', 'part'],
    ['.histrow', 'part'],
    ['.wover .wheel', 'game'],
  ],
  blackjack: [
    ['.dealer', 'part'],
    ['.sides', 'part'],
    ['.spot', 'part'],
    ['.seats', 'part'],
    ['.myseat .seat', 'game'],
    ['.seat.me', 'game'],
    ['.bar', 'control'],
    ['.lobby', 'game'],
    ['.felt.hist-open .hist', 'part'],
    ['.bj.rules-open .rules', 'part'],
  ],
};

const until = (cond, ms = 45000) =>
  `new Promise((r) => { const t = Date.now(); const f = () => { const R = document.querySelector('.cz-host')?.shadowRoot; const b = R?.querySelector('.bj'); if ((${cond}) || Date.now() - t > ${ms}) return r(true); setTimeout(f, 200); }; f(); })`;
// Each scenario: steps of { click, js, wait, shot: name }. A shot measures and saves.
const SCENARIOS = {
  slot: [
    { js: 'window.__casinoDemo.next("slot","wild")' },
    { wait: 300, shot: 'repos' },
    { click: '#spin', wait: 6500, shot: 'gain-ligne' },
    { js: 'window.__casinoDemo.next("slot","bonus")' },
    { click: '#spin', wait: 13000, shot: 'coffre' },
  ],
  book: [
    { js: 'window.__casinoDemo.next("book","wild")' },
    { wait: 300, shot: 'repos' },
    { click: '#spin', wait: 6500, shot: 'gain-ligne' },
  ],
  roulette: [
    { js: 'window.__casinoDemo.next("roulette","17")' },
    { click: '[data-spot=n17]', wait: 150 },
    { click: '[data-spot=red]', wait: 150 },
    { click: '[data-spot=d2]', wait: 400, shot: 'mises' },
    { click: '#spin', wait: 2200, shot: 'roue' },
    {
      js: until('R?.querySelector(".banner.show")', 15000),
      wait: 300,
      shot: 'roue-resultat',
    },
    { wait: 4000, shot: 'resultat' },
  ],
  blackjack: [
    {
      js: 'window.__casinoDemo.bots(4); window.__casinoDemo.next("blackjack","pair")',
    },
    { wait: 300, shot: 'salon' },
    { click: '[data-join]', wait: 1500 },
    // (la proposition d'annoncer la table n'apparaît que si le Core la propose : casino.bj_announce)
    {
      js: 'document.querySelector(".cz-host")?.shadowRoot?.querySelector("[data-ann=no]")?.click()',
      wait: 400,
    },
    { click: '[data-chip="100"]', wait: 150 },
    { click: '.seat.me [data-main]', wait: 150 },
    { click: '.seat.me [data-main]', wait: 150 },
    { click: '[data-side="20"]', wait: 600, shot: 'mises' },
    { click: '[data-rx-open]', wait: 500, shot: 'reactions' },
    { click: '[data-rx-open]', wait: 300 },
    { click: '[data-ready]', wait: 700, shot: 'distribution' },
    {
      js: until('b?.classList.contains("my-turn")'),
      wait: 900,
      shot: 'mon-tour',
    },
    { click: '[data-act=split]', wait: 1800, shot: 'split' },
    { click: '[data-act=stand]', wait: 900 },
    { click: '[data-act=stand]', wait: 900 },
    {
      js: until('b?.dataset.phase === "settled"'),
      wait: 1500,
      shot: 'resultat',
    },
    { click: '.rtab', wait: 600, shot: 'regles' },
    { click: '.rules [data-rules]', wait: 400 },
    { click: '.htab', wait: 500 },
    { click: '[data-htab="mine"]', wait: 900, shot: 'historique' },
  ],
};

/** Measured in the page: the game's area, the elements that matter, the voids, the touch targets. */
function measure({ keys, touch }) {
  const host = document.querySelector('.cz-host');
  const R = host?.shadowRoot;
  const body = R?.getElementById('body');
  if (!body) return { error: 'no casino body' };
  const B = body.getBoundingClientRect();
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let e = el; e && e !== body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      // (an element caught at the start of its fade-in — the centre redrawn when a player becomes ready — is there)
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        (Number(cs.opacity) === 0 && !e.getAnimations?.().length)
      )
        return false;
    }
    return true;
  };
  const found = [];
  for (const [sel, role] of keys) {
    const el = [...R.querySelectorAll(sel)].find(visible);
    if (!el) continue;
    // A drawer over the game hides it: not measured as « an element that matters » then.
    const r = el.getBoundingClientRect();
    found.push({
      sel,
      role,
      top: r.top - B.top,
      bottom: r.bottom - B.top,
      left: r.left - B.left,
      right: r.right - B.left,
      w: r.width,
      h: r.height,
    });
  }
  // Coverage: the union of the rectangles, on a 4 px grid (overlaps counted once).
  const cell = 4;
  const cols = Math.ceil(B.width / cell);
  const rows = Math.ceil(B.height / cell);
  const grid = new Uint8Array(cols * rows);
  for (const f of found)
    for (
      let y = Math.max(0, Math.floor(f.top / cell));
      y < Math.min(rows, Math.ceil(f.bottom / cell));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(f.left / cell));
        x < Math.min(cols, Math.ceil(f.right / cell));
        x++
      )
        grid[y * cols + x] = 1;
  const covered = grid.reduce((a, v) => a + v, 0) / grid.length;
  // The tallest empty horizontal band: rows of the grid where nothing that matters is drawn.
  let run = 0;
  let worst = 0;
  let worstAt = 0;
  for (let y = 0; y < rows; y++) {
    let any = false;
    for (let x = 0; x < cols && !any; x++) any = grid[y * cols + x] === 1;
    run = any ? 0 : run + 1;
    if (run > worst) {
      worst = run;
      worstAt = (y - run + 1) * cell;
    }
  }
  const game = found
    .filter((f) => f.role === 'game')
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const control = found.find((f) => f.role === 'control');
  const reach =
    game && control
      ? Math.max(0, control.top - game.bottom, game.top - control.bottom)
      : null;
  const overflow = found
    .filter(
      (f) =>
        f.top < -2 ||
        f.left < -2 ||
        f.bottom > B.height + 2 ||
        f.right > B.width + 2,
    )
    .map((f) => f.sel);
  // Touch targets: every visible button of the game (not inside a closed drawer), its smaller side.
  const small = [];
  if (touch)
    for (const b of R.querySelectorAll('button, [role="radio"], summary')) {
      if (!visible(b) || b.disabled) continue; // a disabled control is not a target (closed bets)
      const r = b.getBoundingClientRect();
      if (
        r.bottom < B.top ||
        r.top > B.bottom ||
        r.right < B.left ||
        r.left > B.right
      )
        continue;
      if (Math.min(r.width, r.height) < 30 || r.width * r.height < 32 * 32)
        small.push(
          `${b.className || b.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)}`,
        );
    }
  return {
    area: `${Math.round(B.width)}×${Math.round(B.height)}`,
    frame: `${window.innerWidth}×${window.innerHeight}`,
    header: Math.round(B.top),
    coverage: Math.round(covered * 100),
    void: Math.round(((worst * cell) / B.height) * 100),
    voidPx: worst * cell,
    voidAt: worstAt,
    gameShare: game
      ? Math.round(((game.w * game.h) / (B.width * B.height)) * 100)
      : null,
    reach: reach === null ? null : Math.round((reach / B.height) * 100),
    overflow,
    small: [...new Set(small)].slice(0, 12),
    smallCount: small.length,
  };
}

const LIMITS = { void: 22, reach: 22, coverageMin: 45 };
function verdict(m) {
  const flags = [];
  if (m.error) return [m.error];
  if (m.void > LIMITS.void)
    flags.push(`vide ${m.void} % (${m.voidPx} px à y=${m.voidAt})`);
  if (m.reach !== null && m.reach > LIMITS.reach)
    flags.push(`commande loin du jeu (${m.reach} %)`);
  if (m.coverage < LIMITS.coverageMin) flags.push(`occupation ${m.coverage} %`);
  if (m.overflow.length) flags.push(`déborde : ${m.overflow.join(', ')}`);
  if (m.smallCount) flags.push(`${m.smallCount} cible(s) trop petite(s)`);
  return flags;
}

await buildDemoCore();
mkdirSync(OUT, { recursive: true });
const server = await startServer(0);
const port = server.address().port;
const browser = await chromium.launch();
const rows = [];
const games = Object.keys(SCENARIOS).filter((g) => !ONLY || ONLY.includes(g));
const TILE = {
  blackjack: 'casino_blackjack',
  slot: 'casino_slot',
  book: 'casino_book',
  roulette: 'casino_roulette',
};

async function run(game, [surface, w, h, label]) {
  const touch = surface === 'mobile';
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: Number(arg('dpr') ?? 1),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    `http://127.0.0.1:${port}/casino-v2/${PAGES[surface]}&casinoGame=${TILE[game]}`,
  );
  await page
    .waitForFunction(
      () =>
        !!document
          .querySelector('.cz-host')
          ?.shadowRoot?.querySelector('#body:not(.is-loading)'),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1200);
  for (const st of SCENARIOS[game]) {
    try {
      if (st.click)
        await page.locator(st.click).first().click({ timeout: 5000 });
      if (st.js) await page.evaluate(st.js);
    } catch (e) {
      errors.push(`${st.click ?? 'js'} : ${e.message.split('\n')[0]}`);
    }
    if (st.wait) await page.waitForTimeout(st.wait);
    if (!st.shot) continue;
    const m = await page.evaluate(measure, { keys: KEYS[game], touch });
    const file = `${game}-${surface}-${w}x${h}-${st.shot}.png`;
    await page.screenshot({ path: join(OUT, file) });
    const flags = verdict(m);
    rows.push({
      game,
      surface,
      size: `${w}×${h}`,
      label,
      state: st.shot,
      ...m,
      flags,
      file,
    });
    console.log(
      `${flags.length ? '⚠' : '✓'} ${game.padEnd(9)} ${`${w}×${h}`.padEnd(9)} ${st.shot.padEnd(11)} occ ${String(m.coverage).padStart(3)} % · vide ${String(m.void).padStart(3)} % · jeu ${String(m.gameShare ?? '-').padStart(3)} % · portée ${m.reach ?? '-'} %${flags.length ? `  → ${flags.join(' ; ')}` : ''}`,
    );
  }
  if (errors.length) console.log(`   erreurs : ${errors.join(' | ')}`);
  await ctx.close();
}

const jobs = [];
for (const game of games) for (const size of SIZES) jobs.push([game, size]);
const POOL = 3;
let next = 0;
await Promise.all(
  Array.from({ length: POOL }, async () => {
    while (next < jobs.length) {
      const [game, size] = jobs[next++];
      await run(game, size);
    }
  }),
);
await browser.close();
server.close();

const flagged = rows.filter((r) => r.flags.length);
const md = [
  '# Casino — composition dans le cadre réel de l’extension',
  '',
  `${rows.length} états mesurés (${games.join(', ')} × ${SIZES.length} formats). Seuils : vide > ${LIMITS.void} % de la hauteur, commande à plus de ${LIMITS.reach} % de la hauteur du jeu, occupation < ${LIMITS.coverageMin} %, cible tactile < 30 px (ou < 32 × 32 px de surface). Les captures sont dans ce dossier.`,
  '',
  '| Jeu | Format | État | Zone de jeu | Occupation | Plus grand vide | Part du jeu | Portée | À regarder |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    (r) =>
      `| ${r.game} | ${r.size} ${r.label} | ${r.state} | ${r.area} (en-tête ${r.header} px) | ${r.coverage} % | ${r.void} % | ${r.gameShare ?? '–'} % | ${r.reach ?? '–'} % | ${r.flags.join(' ; ') || '–'} |`,
  ),
  '',
  flagged.length
    ? `## Cibles tactiles signalées\n\n${flagged
        .filter((r) => r.small.length)
        .map((r) => `- ${r.game} ${r.size} ${r.state} : ${r.small.join(', ')}`)
        .join('\n')}`
    : '',
].join('\n');
writeFileSync(join(OUT, 'RAPPORT.md'), md);
console.log(
  `\n${rows.length} états · ${flagged.length} à regarder · rapport : ${join(OUT, 'RAPPORT.md')}`,
);
