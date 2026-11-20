// LAB ONLY — the Casino's spectators, end to end in real browsers (docs/CASINO.md § 6).
//   npm run casino:watch-check -w @raptoru/core-api      (screenshots: CASINO_SHOTS=<dir>, default the OS temp dir)
// Starts its own demo (scripts/casino-demo.ts on port 4499: an in-memory Core, the Lab test wallet, the REAL extension)
// and drives three independent browser contexts at 565 × 376: Alice plays, Bob follows her, Carla joins later. Every
// claim is checked against what the Core decided and what each browser received on the wire:
//  1 Bob follows Alice before her first spin · 2 her spin plays at Bob's (the same reels, animated) · 3 an immediate
//  second spin follows · 4 ten spins in a row, ten at Bob's · 5 a Coffre, respin by respin, waiting for her · 6 Rapide,
//  Auto, Passer · 7 the roulette: her chips while she places them, the wheel, the same number · 8 Carla joins a spin
//  in progress · 9 Bob refreshes in the middle of a Coffre · 10 Bob loses his connection · 11 two spectators · 12 Bob
//  clicks everything: nothing sent, nothing paid · 13 Alice leaves the game · 14 no result before Alice's screen showed
//  it (every watch answer timed against her progress) · 15 the « parties en direct » band updates by itself.
import { spawn } from 'node:child_process';
import console from 'node:console';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
/* global fetch, document, window, performance, requestAnimationFrame, MutationObserver, getComputedStyle, innerWidth -- Node's fetch; `document` only inside page callbacks */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const { chromium } = createRequire(
  join(ROOT, 'apps/studio/server/package.json'),
)('@playwright/test');
const PORT = Number(process.env.CASINO_WATCH_PORT ?? 4499);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.CASINO_SHOTS ?? join(tmpdir(), 'casino-watch-check');
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
process.on('exit', () => demo.kill());
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
// --- The wire: Alice's progress (when her screen showed a stage), what every spectator received and sent ------------
const received = []; // { who, t, ev } — every event a spectator received
const sentBy = { bob: [], carla: [] }; // the casino writes a spectator's browser made
async function viewer(as) {
  const ctx = await browser.newContext({
    viewport: { width: 565, height: 376 },
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) =>
    errors.push(
      `${as}: ${e.message} (${
        String(e.stack ?? '')
          .split('\n')[1]
          ?.trim() ?? ''
      })`,
    ),
  );
  p.on('request', (r) => {
    if (!r.url().endsWith('/api/ext')) return;
    let b;
    try {
      b = JSON.parse(r.postData() ?? 'null');
    } catch {
      return;
    }
    const path = String(b?.path ?? '');
    if (sentBy[as] && b.method === 'POST' && path.startsWith('/casino/'))
      sentBy[as].push(path);
  });
  p.on('response', async (r) => {
    if (!r.url().endsWith('/api/ext') || as === 'alice') return;
    let b;
    try {
      b = JSON.parse(r.request().postData() ?? 'null');
    } catch {
      return;
    }
    if (!String(b?.path).startsWith('/casino/watch')) return;
    const t = Date.now();
    try {
      for (const ev of (await r.json()).events ?? [])
        received.push({ who: as, t, ev });
    } catch {
      /* an aborted long-poll (offline): nothing received */
    }
  });
  await p.addInitScript(RECORD);
  await p.goto(`${BASE}/ext/video_component.html?anchor=component&as=${as}`);
  await openMiniGames(p);
  return { p, ctx };
}
async function openMiniGames(p) {
  await p.waitForSelector('.rh-all-toggle', { timeout: 15000 });
  await p.click('.rh-all-toggle');
  await p.click('.rh-all__item:has-text("Mini-jeux")');
  await p.waitForSelector('.mg', { timeout: 10000 });
}
/**
 * In every page, before the extension loads: the start and landing of every animation on screen (wall clock: the
 * three pages share the OS clock) and the flash probe — the casino screen detached by a redraw, frames drawn without
 * its styles.
 */
const RECORD = () => {
  window.__t = [];
  window.__flash = { detach: 0, unstyled: 0, why: [], restarts: [], gaps: [] };
  document.addEventListener(
    'jdm:host-redraw',
    () => (window.__flash.redrawAt = Date.now()),
    true,
  );
  window.__net = [];
  const fetch0 = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    const sent = Date.now();
    const res = await fetch0(url, init);
    try {
      const path = JSON.parse(init?.body ?? 'null')?.path ?? '';
      if (
        String(url).endsWith('/api/ext') &&
        (path.endsWith('/spin') ||
          path.startsWith('/casino/watch') ||
          path === '/casino/progress')
      )
        res
          .clone()
          .json()
          .then((j) => {
            const t = Date.now();
            if (j.round)
              window.__net.push({ k: 'own', id: j.round.round_id, t, sent });
            if (path === '/casino/progress') {
              const b = JSON.parse(init.body).body ?? {};
              window.__net.push({
                k: `post:${b.stage}`,
                id: b.round_id,
                t,
                sent,
              });
            }
            for (const e of j.events ?? []) {
              if (e.kind === 'result')
                window.__net.push({ k: 'result', id: e.round_id, t });
              window.__net.push({
                k: `ev:${e.kind}`,
                id: e.round_id,
                t,
                at: Date.parse(e.at),
                sent,
              });
            }
          })
          .catch(() => {});
    } catch {
      /* not a casino call */
    }
    return res;
  };
  const seen = new WeakSet();
  const holdsCasino = (n) =>
    n.nodeType === 1 &&
    (n.matches?.('.cz-host') || n.querySelector?.('.cz-host'));
  new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.removedNodes)
        if (holdsCasino(n)) {
          window.__flash.detach++;
          // why: a header redraw (its title / ‹ changed) or a new state read
          window.__flash.why.push(
            `${Date.now() - (window.__flash.redrawAt ?? 0) < 50 ? 'en-tête' : 'état'} ${new Date().toISOString().slice(11, 23)}`,
          );
        }
      for (const n of m.addedNodes)
        if (holdsCasino(n)) {
          // a RE-attachment only (the screen shown before): its first appearance starts its animations, rightly
          const host = n.matches?.('.cz-host')
            ? n
            : n.querySelector('.cz-host');
          if (seen.has(host)) window.__flash.attachAt = performance.now();
          seen.add(host);
        }
    }
  }).observe(document, { childList: true, subtree: true });
  let watched = null;
  let lastFrame = 0;
  const frame = () => {
    // a page that stops drawing (frames held back by the machine) freezes its animation: noted, with when
    const nowF = Date.now();
    if (lastFrame && nowF - lastFrame > 250)
      window.__flash.gaps.push([lastFrame, nowF - lastFrame]);
    lastFrame = nowF;
    const h = document.querySelector('.cz-host');
    if (h && h !== watched) {
      watched = h;
      new MutationObserver((ms) => {
        for (const m of ms) {
          const v = m.target.getAttribute(m.attributeName);
          if (!v) continue;
          const what = m.target.classList.contains('reels')
            ? 'reels'
            : m.target.classList.contains('cof')
              ? 'respin'
              : 'wheel';
          window.__t.push({
            what,
            k: m.attributeName,
            t: Number(String(v).split(':').pop()),
            id: `${m.target.dataset.round ?? ''}${String(v).includes(':') ? `:${String(v).split(':')[0]}` : ''}`,
          });
        }
      }).observe(h.shadowRoot, {
        attributes: true,
        subtree: true,
        attributeFilter: ['data-start-at', 'data-land-at', 'data-respin-at'],
      });
    }
    const b = h?.isConnected && h.shadowRoot?.getElementById('body');
    if (b && b.className.includes('-body')) {
      const bg = getComputedStyle(b).backgroundImage;
      if (!bg || bg === 'none') window.__flash.unstyled++;
      // Just after a move: an animation that was well under way the frame before and is now back at its start (a pop,
      // a badge, a glow replayed) is a visible flash. A new one starting at that moment (the round's end) is not.
      const now = new Map();
      for (const a of h.shadowRoot.getAnimations())
        if (a.animationName)
          now.set(a, {
            key: a.effect?.target,
            name: a.animationName,
            t: a.currentTime ?? 0,
            loop: a.effect?.getComputedTiming?.().iterations === Infinity,
          });
      const at = window.__flash.attachAt;
      if (at && performance.now() - at < 80) {
        for (const x of now.values()) {
          const was = (window.__flash.prev ?? []).find(
            (y) => y.key === x.key && y.name === x.name,
          );
          if (was && was.t > 120 && x.t < 40)
            window.__flash.restarts.push(x.loop ? `${x.name} ∞` : x.name);
        }
        window.__flash.attachAt = 0;
      }
      window.__flash.prev = [...now.values()];
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};
/** The marks recorded since the last call (and cleared). */
const marks = (p) => p.evaluate(() => window.__t.splice(0));
/**
 * Bob − Alice (ms) for each animation both played (matched by its round, and its respin). An animation during which
 * either page stopped drawing for a while (`held`: frames held back by a loaded machine — the page itself freezes, and
 * its marks with it) measures the machine, not the casino: it is set aside, and counted.
 */
const gaps = (a, b, what, k, held = []) => {
  const of = (l, kk) =>
    new Map(
      l
        .filter((x) => x.what === what && x.k === kk && x.id)
        .map((x) => [x.id, x.t]),
    );
  const A = of(a, k);
  const Bm = of(b, k);
  const ends = [of(a, 'data-land-at'), of(b, 'data-land-at')];
  const starts = [of(a, 'data-start-at'), of(b, 'data-start-at')];
  let skipped = 0;
  const out = [];
  for (const [id, t] of A) {
    if (!Bm.has(id)) continue;
    const from =
      Math.min(starts[0].get(id) ?? t, starts[1].get(id) ?? Bm.get(id)) - 50;
    const to = Math.max(
      ends[0].get(id) ?? t + 3000,
      ends[1].get(id) ?? Bm.get(id) + 3000,
    );
    if (held.some(([t0, d]) => t0 < to && t0 + d > from)) skipped += 1;
    else out.push(Bm.get(id) - t);
  }
  return Object.assign(out, { skipped });
};
/** The frames the pages held back so far ([start, ms]): a page that did not draw for more than 250 ms. */
const heldOf = async (pages) =>
  (
    await Promise.all(pages.map((p) => p.evaluate(() => window.__flash.gaps)))
  ).flat();
const worst = (g) => (g.length ? Math.max(...g.map(Math.abs)) : Infinity);
const median = (g) => {
  const s = g.map(Math.abs).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : Infinity;
};
/** In sync: a median under 500 ms and 90 % of the gaps under one second (a frame frozen by another program on a shared
 *  PC must not hide the trend — the max is always printed). */
const inSync = (g) =>
  g.length > 0 &&
  median(g) < 500 &&
  g.filter((x) => Math.abs(x) < 1000).length >= Math.ceil(g.length * 0.9);
/**
 * A timing check: every animation measured (both pages drawing) must be in sync. One set aside because a page did not
 * draw (a loaded machine) is said, never counted as a failure — and none measured at all says « non mesurable ».
 */
const syncCheck = (g, label) => {
  if (!g.length)
    return console.log(
      `  (info) ${label} — non mesurable cette fois (machine chargée)`,
    );
  check(inSync(g), label);
};
const showGaps = (g) =>
  `${g.length} fois, médiane ${median(g)} ms, max ${worst(g)} ms (${g.join(', ')})${g.skipped ? ` — ${g.skipped} écartée(s) : une page n’a pas dessiné pendant l’animation (machine chargée)` : ''}`;
const timings = [];
const shot = (p, name) => p.screenshot({ path: join(SHOTS, `${name}.png`) });
const cz = (p, sel) => p.locator(`.cz-host >> ${sel}`);
const host = (p) =>
  p.evaluate(() => ({
    ...(document.querySelector('.cz-host')?.dataset ?? {}),
  }));
const until = (p, fn, arg, t = 20000) =>
  p.waitForFunction(fn, arg, { timeout: t, polling: 100 });
const ends = async (p) => Number((await host(p)).ends ?? 0);
const waitEnds = (p, n, t = 30000) =>
  until(
    p,
    (k) => Number(document.querySelector('.cz-host')?.dataset.ends ?? 0) >= k,
    n,
    t,
  );
const balanceOf = async (as) => (await api(`/api/wallet?as=${as}`)).tokens;
/** The 15 symbols on screen (reel by reel). */
const grid = (p) =>
  p.evaluate(() =>
    [
      ...document
        .querySelector('.cz-host')
        .shadowRoot.querySelectorAll('.reels .tape'),
    ].map((t) =>
      [1, 2, 3].map((i) => t.children[i]?.dataset.s ?? '?').join(','),
    ),
  );
const slotIdle = (p, t = 30000) =>
  until(
    p,
    () =>
      document.querySelector('.cz-host')?.shadowRoot?.querySelector('#spin')
        ?.dataset.state === 'play',
    null,
    t,
  );
const bobAnimates = (p, t = 8000) =>
  until(
    p,
    () =>
      !!document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.tape.blur'),
    null,
    t,
  );
/** Everything stays inside the 565 × 376 window. */
const fits = (p) =>
  p.evaluate(() => {
    const h = document.querySelector('.cz-host');
    if (!h) return { out: ['no casino'] };
    const box = h.getBoundingClientRect();
    const out = [];
    for (const el of h.shadowRoot.querySelectorAll('#body *')) {
      const cs = getComputedStyle(el);
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        el.closest('[hidden]')
      )
        continue;
      const r = el.getBoundingClientRect();
      if (
        !r.width ||
        !r.height ||
        el.closest('.notch') ||
        el.closest('.tape') ||
        el.closest('.ctape') ||
        el.closest('.wheel svg') || // a rotating wheel's box is larger than the wheel
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
      scroll: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
/** The spectator's card (19/11): its texts, and the player's controls still visible on a spectator's screen. */
const cardOf = (p, sel = '#wcard') =>
  p.evaluate((sel) => {
    const D = document.querySelector('.cz-host')?.shadowRoot;
    const c = D?.querySelector(sel);
    const t = (k) => c?.querySelector(`[data-wc="${k}"]`)?.textContent ?? null;
    const seen = (el) =>
      !!el &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden';
    return {
      shown: seen(c),
      text: c?.textContent ?? '',
      st: t('st'),
      bet: t('bet'),
      win: t('win'),
      winPos: !!c?.querySelector('[data-wc="win"].is-pos'),
      betColor: c
        ? getComputedStyle(c.querySelector('[data-wc="bet"]')).color
        : null,
      controls: [
        ...D.querySelectorAll(
          '.betbar, .toggles, .board, #spin, .rstrip, .chips, .tray, .fastsw, .launch, [data-act="auto"], [data-act="fast"]',
        ),
      ]
        .filter(seen)
        .map((e) => e.className || e.id),
    };
  }, sel);
const digits = (t) => Number(String(t ?? '').replace(/\D/g, '') || 0);
/** Alice spins and the machine is idle again (a natural Coffre on the way is played to its end). */
const aliceSpin = async (alice) => {
  await cz(alice, '#spin').click();
  await sleep(200);
  for (let i = 0; i < 240; i++) {
    const st = await alice.evaluate(() => {
      const D = document.querySelector('.cz-host')?.shadowRoot;
      if (!D?.querySelector('.cof'))
        return D?.querySelector('#spin')?.dataset.state === 'play'
          ? 'idle'
          : 'busy';
      return D.querySelector('.cof [data-cof="go"]')?.dataset.state ?? 'busy';
    });
    if (st === 'idle') return;
    if (st === 'go' || st === 'done')
      await cz(alice, '.cof [data-cof="go"]')
        .click()
        .catch(() => {});
    await sleep(250);
  }
  await slotIdle(alice);
};

try {
  const { p: alice } = await viewer('alice');
  const { p: carla } = await viewer('carla');
  const { p: bob, ctx: bobCtx } = await viewer('bob');
  const bobBefore = await balanceOf('bob');

  // --- 15 (part 1) + 1: the band, then Bob follows Alice before her first spin ----------------------------------
  console.log('Bandeau et suivi');
  await until(
    bob,
    () => !!document.querySelector('.mg__band:not([hidden])'),
    null,
    10000,
  );
  const empty = await bob.locator('.mg__band').innerText();
  check(
    /Personne ne joue/.test(empty),
    'bandeau : personne ne joue (état discret)',
    empty,
  );
  await shot(bob, 'w01-bandeau-vide');
  await alice.click('.mg__tile[data-game="casino_slot"]');
  await slotIdle(alice);
  await until(
    bob,
    () =>
      /1 viewer/.test(document.querySelector('.mg__band')?.textContent ?? ''),
    null,
    15000,
  );
  check(true, 'bandeau : Alice apparaît d’elle-même (sans recharger)');
  await shot(bob, 'w02-bandeau-alice');
  const tiles = await bob.locator('.mg__tile').count();
  check(
    tiles === 3,
    `trois jeux en cartes, le direct à part (${tiles} cartes)`,
  );
  await bob.click('.mg__av');
  await until(
    bob,
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.slot-body.is-watch'),
    null,
    15000,
  );
  const wait1 = await cardOf(bob);
  check(
    wait1.shown &&
      /Alice/.test(wait1.text) &&
      /EN DIRECT/.test(wait1.text) &&
      /attend/.test(wait1.st) &&
      wait1.bet === '—' &&
      wait1.win === '—',
    `Bob suit Alice avant son premier tour : son panneau la nomme, en direct, en attente (« ${wait1.st} »)`,
    JSON.stringify(wait1),
  );
  check(
    !wait1.controls.length,
    'spectateur : aucune commande du joueur à l’écran (ni Rapide, Auto, Lancer, mise, Derniers gains)',
    wait1.controls.join(', '),
  );
  const f1 = await fits(bob);
  check(
    !f1.out.length && !f1.scroll,
    'spectateur : tout tient dans 565 × 376',
    JSON.stringify(f1),
  );
  await shot(bob, 'w03-bob-attend');

  // --- 2, 3: a spin, then an immediate second one ----------------------------------------------------------------
  console.log('Machine à sous');
  const bobMoves0 = await bob.evaluate(() => window.__flash.detach);
  await marks(alice);
  await marks(bob);
  const e0 = await ends(bob);
  const anim = bobAnimates(bob, 9000).then(
    () => true,
    () => false,
  );
  const during = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const c = await cardOf(bob).catch(() => null);
      const running = await bob
        .evaluate(() => {
          const r = document
            .querySelector('.cz-host')
            ?.shadowRoot?.querySelector('#reels');
          return (
            !!r &&
            Number(r.dataset.startAt ?? 0) > Number(r.dataset.landAt ?? 0)
          );
        })
        .catch(() => false);
      if (c && running) during.push(c);
      await sleep(80);
    }
  })();
  await aliceSpin(alice);
  check(await anim, 'le spin d’Alice s’anime chez Bob (rouleaux qui défilent)');
  await waitEnds(bob, e0 + 1);
  sampling = false;
  await sampler;
  await sleep(300);
  {
    const r0 = (await api('/api/admin')).recent[0];
    const c = await cardOf(bob);
    check(
      during.length > 0 &&
        during.every((x) => x.win === '…' && digits(x.bet) === r0.bet),
      `pendant le tour : la mise d’Alice (${r0.bet}) affichée, le gain caché (« … » sur ${during.length} relevés)`,
      JSON.stringify(during.map((x) => [x.bet, x.win])),
    );
    check(
      digits(c.win) === r0.payout &&
        c.winPos === r0.payout > 0 &&
        digits(c.bet) === r0.bet &&
        /terminé/.test(c.st),
      `fin du tour : le gain montré est celui du Core (${r0.payout}), ${r0.payout ? 'en vert' : 'neutre'} ; mise en or (${c.betColor})`,
      JSON.stringify(c),
    );
  }
  check(
    JSON.stringify(await grid(bob)) === JSON.stringify(await grid(alice)),
    'Bob voit exactement les rouleaux d’Alice',
  );
  await shot(bob, 'w04-bob-meme-grille');
  await aliceSpin(alice);
  await waitEnds(bob, e0 + 2);
  check(
    JSON.stringify(await grid(bob)) === JSON.stringify(await grid(alice)),
    'Alice relance tout de suite : Bob suit, sans cliquer',
  );

  // --- 4 + 6 (Auto): ten spins in a row ---------------------------------------------------------------------------
  const e1 = await ends(bob);
  const before10 = (await api('/api/admin')).recent.length;
  await cz(alice, '[data-act="auto"]').click();
  for (let i = 0; i < 120; i++) {
    const n = (await api('/api/admin')).recent.length - before10;
    if (n >= 10) break;
    await sleep(500);
  }
  await cz(alice, '#spin').click(); // Stop Auto
  await slotIdle(alice);
  const played = (await api('/api/admin')).recent.length - before10;
  await waitEnds(bob, e1 + played, 60000);
  check(
    (await ends(bob)) === e1 + played,
    `Auto : ${played} tours d’Alice, ${(await ends(bob)) - e1} chez Bob, dans l’ordre`,
  );
  check(
    JSON.stringify(await grid(bob)) === JSON.stringify(await grid(alice)),
    'après la série, la même grille',
  );

  {
    const ta = await marks(alice);
    const tb = await marks(bob);
    const st = gaps(
      ta,
      tb,
      'reels',
      'data-start-at',
      await heldOf([alice, bob]),
    );
    const ld = gaps(
      ta,
      tb,
      'reels',
      'data-land-at',
      await heldOf([alice, bob]),
    );
    timings.push(['machine, début', st], ['machine, arrêt', ld]);
    if (process.env.CASINO_MARKS)
      writeFileSync(
        join(SHOTS, 'marks-machine.json'),
        JSON.stringify(
          {
            alice: ta,
            bob: tb,
            aliceNet: await alice.evaluate(() => window.__net),
            bobNet: await bob.evaluate(() => window.__net),
            aliceGaps: await alice.evaluate(() => window.__flash.gaps),
            bobGaps: await bob.evaluate(() => window.__flash.gaps),
          },
          null,
          1,
        ),
      );
    syncCheck(st, `les rouleaux démarrent ensemble : ${showGaps(st)}`);
    syncCheck(ld, `les rouleaux s’arrêtent ensemble : ${showGaps(ld)}`);
  }

  // --- 6: Rapide and Passer ---------------------------------------------------------------------------------------
  const e2 = await ends(bob);
  await cz(alice, '[data-act="fast"]').click();
  await aliceSpin(alice);
  await cz(alice, '[data-act="fast"]').click();
  await cz(alice, '#spin').click();
  await sleep(250);
  await cz(alice, '#spin').click(); // Passer
  await slotIdle(alice);
  await waitEnds(bob, e2 + 2);
  check(
    JSON.stringify(await grid(bob)) === JSON.stringify(await grid(alice)),
    'Rapide puis Passer : Bob suit, même résultat',
  );
  const fastSeen = received.some(
    (x) => x.who === 'bob' && x.ev.kind === 'result' && x.ev.fast,
  );
  check(fastSeen, 'le rythme d’Alice (Rapide / Passer) est transmis à Bob');
  {
    const ta = await marks(alice);
    const tb = await marks(bob);
    const ld = gaps(
      ta,
      tb,
      'reels',
      'data-land-at',
      await heldOf([alice, bob]),
    );
    timings.push(['Rapide puis Passer, arrêt', ld]);
    syncCheck(
      ld,
      `Rapide et Passer : les rouleaux s’arrêtent ensemble (${showGaps(ld)})`,
    );
  }

  // --- 5 + 9: a Coffre, respin by respin; Bob refreshes in the middle ----------------------------------------------
  console.log('Coffre');
  await api('/api/force', { bonus: 3 });
  await cz(alice, '#spin').click();
  await until(
    alice,
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.cof [data-cof="go"][data-state="go"]'),
    null,
    30000,
  );
  await until(
    bob,
    () => document.querySelector('.cz-host')?.shadowRoot?.querySelector('.cof'),
    null,
    20000,
  );
  check(true, 'le Coffre d’Alice s’ouvre chez Bob');
  const filled = (p) =>
    p.evaluate(
      () =>
        document
          .querySelector('.cz-host')
          .shadowRoot.querySelector('.cof .filled b')?.textContent ?? '',
    );
  const sameFilled = async (p) => {
    await until(
      p,
      (want) =>
        document
          .querySelector('.cz-host')
          ?.shadowRoot?.querySelector('.cof .filled b')?.textContent === want,
      await filled(alice),
      15000,
    ).catch(() => {});
    return (await filled(p)) === (await filled(alice));
  };
  check(
    await sameFilled(bob),
    `pièces de départ identiques (${await filled(alice)})`,
  );
  await sleep(4000); // Alice réfléchit : rien n'avance seul
  check(
    (await filled(bob)) === (await filled(alice)) &&
      !!(await cz(bob, '.cof').count()),
    'mode manuel : Bob attend la relance d’Alice',
  );
  await shot(bob, 'w05-coffre-attente');
  let relaunches = 0;
  const relaunch = async () => {
    await cz(alice, '.cof [data-cof="go"]').click();
    await until(
      alice,
      () =>
        /^(go|done)$/.test(
          document
            .querySelector('.cz-host')
            ?.shadowRoot?.querySelector('.cof [data-cof="go"]')?.dataset
            .state ?? '',
        ),
      null,
      20000,
    );
    relaunches++;
  };
  await relaunch();
  check(
    await sameFilled(bob),
    `relance ${relaunches} : Bob voit la même grille (${await filled(alice)})`,
  );
  await relaunch();
  {
    const ta = await marks(alice);
    const tb = await marks(bob);
    const rs = gaps(
      ta,
      tb,
      'respin',
      'data-respin-at',
      await heldOf([alice, bob]),
    );
    timings.push(['Coffre, relance', rs]);
    syncCheck(
      rs,
      `chaque relance du Coffre démarre en même temps : ${showGaps(rs)}`,
    );
  }
  const bobMoves =
    (await bob.evaluate(() => window.__flash.detach)) - bobMoves0;
  const bobWhy = await bob.evaluate(() => window.__flash.why);
  // 9: Bob refreshes in the middle of the Coffre: he comes back to Alice, at the same respin
  const bobNetBefore = await bob.evaluate(() => window.__net); // (a reload clears the page's log)
  await bob.reload();
  await openMiniGames(bob);
  await until(
    bob,
    () => document.querySelector('.cz-host')?.shadowRoot?.querySelector('.cof'),
    null,
    20000,
  );
  check(
    await sameFilled(bob),
    `rafraîchissement au milieu du Coffre : Bob revient à la même relance (${await filled(bob)})`,
  );
  await shot(bob, 'w06-bob-rafraichi-coffre');
  for (let i = 0; i < 40; i++) {
    const st = await alice.evaluate(
      () =>
        document
          .querySelector('.cz-host')
          .shadowRoot.querySelector('.cof [data-cof="go"]')?.dataset.state,
    );
    if (st === 'done' || !st) break;
    await relaunch();
  }
  const eC = await ends(bob);
  await until(
    bob,
    () =>
      !document.querySelector('.cz-host')?.shadowRoot?.querySelector('.cof'),
    null,
    40000,
  ).catch(() => {});
  await sleep(500);
  check(
    (await ends(bob)) >= eC && !(await cz(bob, '.cof').count()),
    `fin du Coffre : Bob revient aux rouleaux (${relaunches} relances suivies)`,
  );
  if (await cz(alice, '.cof [data-cof="go"]').count())
    await cz(alice, '.cof [data-cof="go"]').click();
  await slotIdle(alice);

  // --- 11: Carla follows too ---------------------------------------------------------------------------------------
  console.log('Deux spectateurs, connexion perdue');
  await carla.click('.mg__av');
  await until(
    carla,
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.slot-body.is-watch'),
    null,
    15000,
  );
  const cB = await ends(bob);
  const cC = await ends(carla);
  await aliceSpin(alice);
  await Promise.all([waitEnds(bob, cB + 1), waitEnds(carla, cC + 1)]);
  check(
    JSON.stringify(await grid(carla)) === JSON.stringify(await grid(bob)),
    'deux spectateurs : Bob et Carla voient le même tour',
  );

  // --- 10: Bob loses his connection ---------------------------------------------------------------------------------
  const oB = await ends(bob);
  await bobCtx.setOffline(true);
  await aliceSpin(alice);
  await aliceSpin(alice);
  await sleep(1500);
  await bobCtx.setOffline(false);
  await waitEnds(bob, oB + 2, 40000);
  await sleep(800);
  check(
    (await ends(bob)) === oB + 2,
    `connexion perdue puis revenue : Bob rattrape les 2 tours, une fois chacun (${(await ends(bob)) - oB})`,
  );
  check(
    JSON.stringify(await grid(bob)) === JSON.stringify(await grid(alice)),
    'après la coupure, la même grille',
  );

  // --- 12: Bob clicks everything ------------------------------------------------------------------------------------
  const sentBefore = sentBy.bob.length;
  const spinsBefore = (await api('/api/admin')).recent.length;
  await bob.evaluate(() => {
    const D = document.querySelector('.cz-host').shadowRoot;
    for (const el of D.querySelectorAll(
      'button, input, [data-act], [data-bet], .window, .reels',
    ))
      el.click?.();
  });
  await bob.keyboard.press('Space');
  await bob.keyboard.press('Escape');
  await sleep(1500);
  await bob.keyboard.press('Escape');
  check(
    sentBy.bob.length === sentBefore,
    `Bob clique sur toutes les commandes : aucune action envoyée (${sentBy.bob.slice(sentBefore).join(', ') || 'rien'})`,
  );
  check(
    (await api('/api/admin')).recent.length === spinsBefore &&
      (await balanceOf('bob')) === bobBefore,
    'aucun tour joué, aucun Jeton de Bob touché',
  );
  check(
    !!(await bob.evaluate(() =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.slot-body.is-watch'),
    )),
    'Bob suit toujours Alice',
  );

  // --- 7 + 8: the roulette; Alice changes game, Bob follows; Carla joins a spin in progress -------------------------
  console.log('Roulette');
  await alice.click('.jdm-back').catch(() => {});
  await alice.waitForSelector('.mg__tile[data-game="casino_roulette"]', {
    timeout: 10000,
  });
  await alice.click('.mg__tile[data-game="casino_roulette"]');
  await until(
    alice,
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.roulette-body #mat'),
    null,
    15000,
  );
  await until(
    bob,
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.roulette-body.is-watch'),
    null,
    15000,
  );
  check(true, 'Alice passe à la roulette : Bob la suit tout seul');
  await carla.close();
  const aBal = await balanceOf('alice');
  await cz(alice, '[data-spot="red"]').click();
  await cz(alice, '[data-spot="n17"]').click();
  await until(
    bob,
    () =>
      !!document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.stack[data-for="n17"]'),
    null,
    10000,
  );
  check(
    true,
    'Bob voit les jetons d’Alice pendant qu’elle mise (provisoire, rien débité)',
  );
  await shot(bob, 'w07-roulette-mises');
  await cz(alice, '[data-spot="n17"]').click({ button: 'right' });
  await until(
    bob,
    () =>
      !document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.stack[data-for="n17"]'),
    null,
    10000,
  );
  check(true, 'Alice retire un jeton : il disparaît chez Bob');
  check(
    aBal === (await balanceOf('alice')),
    'les mises en préparation ne débitent rien',
  );
  await marks(alice);
  await marks(bob);
  await api('/api/force', { game: 'roulette', number: 17 });
  await cz(alice, '[data-spot="n17"]').click();
  await cz(alice, '#spin').click();
  // 8: Carla arrives while the ball runs
  const { p: carla2 } = await viewer('carla');
  await until(carla2, () => !!document.querySelector('.mg__av'), null, 15000);
  await carla2.click('.mg__av');
  await until(
    carla2,
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('.roulette-body.is-watch'),
    null,
    15000,
  );
  await until(
    bob,
    () =>
      !document.querySelector('.cz-host')?.shadowRoot?.querySelector('#stagew')
        ?.hidden,
    null,
    20000,
  );
  await sleep(1500);
  await shot(bob, 'w08-roulette-roue');
  const ballCard = await cardOf(bob, '#wcard2');
  await until(
    bob,
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('#wres:not([hidden]) .n')?.textContent ===
      '17',
    null,
    25000,
  );
  check(
    true,
    'la roue tourne chez Bob et s’arrête sur le 17, le numéro du Core',
  );
  {
    const r0 = (await api('/api/admin')).recent[0];
    await sleep(200);
    const [under, beside] = [await cardOf(bob), await cardOf(bob, '#wcard2')];
    check(
      ballCard.shown && ballCard.win === '…' && digits(ballCard.bet) === r0.bet,
      `roulette : pendant que la bille tourne, le panneau de Bob montre la mise (${r0.bet}), le gain caché`,
      JSON.stringify(ballCard),
    );
    check(
      digits(beside.win) === r0.payout &&
        digits(under.win) === r0.payout &&
        /17/.test(under.st ?? ''),
      `roulette : la bille arrêtée, le gain du Core (${r0.payout}) apparaît, le 17 dans l’état`,
      JSON.stringify([under, beside]),
    );
    check(
      !under.controls.length,
      'roulette : aucune commande du joueur chez le spectateur',
      under.controls.join(', '),
    );
    await shot(bob, 'w08b-roulette-panneau');
  }
  {
    await sleep(300);
    const ta = await marks(alice);
    const tb = await marks(bob);
    const st = gaps(
      ta,
      tb,
      'wheel',
      'data-start-at',
      await heldOf([alice, bob]),
    );
    const ld = gaps(
      ta,
      tb,
      'wheel',
      'data-land-at',
      await heldOf([alice, bob]),
    );
    timings.push(['roulette, début', st], ['roulette, arrêt', ld]);
    syncCheck(st, `la roue démarre en même temps : ${showGaps(st)}`);
    syncCheck(ld, `la bille se pose en même temps : ${showGaps(ld)}`);
  }
  await until(
    carla2,
    () =>
      document
        .querySelector('.cz-host')
        ?.shadowRoot?.querySelector('[data-n="17"].hit'),
    null,
    30000,
  );
  check(
    true,
    'Carla, arrivée pendant le lancer, voit le même résultat sur le tapis',
  );
  const fR = await fits(bob);
  check(
    !fR.out.length && !fR.scroll,
    'roulette spectateur : tout tient dans 565 × 376',
    JSON.stringify(fR),
  );
  await shot(bob, 'w09-roulette-resultat');

  // --- 13 + 15 (part 2): Alice leaves ------------------------------------------------------------------------------
  console.log('Départ, chronologie');
  await sleep(2500);
  await alice.click('.jdm-back').catch(() => {});
  await until(
    bob,
    () =>
      /quitté/.test(
        document.querySelector('.cz-host')?.shadowRoot?.querySelector('#wcard')
          ?.textContent ?? '',
      ),
    null,
    15000,
  );
  check(true, 'Alice quitte le jeu : Bob le voit (pas de jeu figé)');
  await shot(bob, 'w10-alice-partie');
  await carla2.click('.jdm-back').catch(() => {});
  await carla2.click('.jdm-back').catch(() => {});
  await until(
    carla2,
    () =>
      /Personne ne joue/.test(
        document.querySelector('.mg__band')?.textContent ?? '',
      ),
    null,
    20000,
  ).then(
    () =>
      check(true, 'bandeau : Alice disparaît d’elle-même quand elle quitte'),
    async () =>
      check(
        false,
        'bandeau : Alice disparaît d’elle-même quand elle quitte',
        await carla2
          .locator('.mg')
          .innerText()
          .catch(() => ''),
      ),
  );

  // --- Flashes: no redraw moves the spectator's screen, no frame is drawn without the casino's styles ------------
  {
    const fa = await alice.evaluate(() => window.__flash);
    const fb = await bob.evaluate(() => window.__flash);
    check(
      bobMoves === 0,
      `pendant le jeu (machine, Auto, Rapide, Passer, Coffre), l’écran du spectateur n’est jamais déplacé (${bobMoves})`,
      bobWhy.join(' · '),
    );
    check(
      fa.unstyled === 0 && fb.unstyled === 0,
      `aucune image sans les styles du Casino (Alice ${fa.unstyled}, Bob ${fb.unstyled})`,
    );
    const restarts = [...fa.restarts, ...fb.restarts];
    const oneShot = restarts.filter((x) => !x.endsWith('∞'));
    check(
      !oneShot.length,
      `après chaque redessin, aucune animation ponctuelle (pop, badge, entrée) ne se rejoue (Alice déplacée ${fa.detach} fois, Bob ${fb.detach})`,
      oneShot.slice(0, 8).join(', '),
    );
    if (restarts.length > oneShot.length)
      console.log(
        `  (info) boucles douces reprises à leur début après un redessin : ${restarts.filter((x) => x.endsWith('∞')).join(', ')}`,
      );
    console.log(
      `  (info) écran d’Alice déplacé ${fa.detach} fois (une par changement de solde), sans effet visible`,
    );
  }

  // --- 14: never a result before Alice's screen showed it ------------------------------------------------------------
  // Alice's client receives each result (her spin's answer) before any spectator does — measured in the pages.
  const own = new Map(
    (await alice.evaluate(() => window.__net))
      .filter((x) => x.k === 'own')
      .map((x) => [x.id, x.t]),
  );
  const seen = [
    ...bobNetBefore,
    ...(await bob.evaluate(() => window.__net)),
    ...(await carla2.evaluate(() => window.__net).catch(() => [])),
  ].filter((x) => x.k === 'result' && own.has(x.id));
  const early = seen.filter((x) => x.t < own.get(x.id));
  check(
    seen.length > 10 && !early.length,
    `aucun résultat reçu par un spectateur avant le client d’Alice (${seen.length} résultats, ${early.length} en avance)`,
    JSON.stringify(early.slice(0, 2)),
  );
  const leak = received.some(
    (x) =>
      x.ev.kind === 'start' &&
      JSON.stringify(x.ev.data).match(/stops|payout|pocket|number/),
  );
  check(!leak, 'le lancement ne transmet que la mise (jamais le tirage)');
  const dup = new Set();
  let twice = 0;
  for (const x of received.filter((y) => y.who === 'bob' && y.ev.round_id)) {
    const k = `${x.ev.round_id}:${x.ev.pos}`;
    if (dup.has(k) && x.ev.kind !== 'start') twice++;
    dup.add(k);
  }
  check(
    (await balanceOf('bob')) === bobBefore,
    'regarder ne touche jamais aux Jetons du spectateur',
  );
  console.log(
    `  (info) étapes reçues deux fois par Bob et ignorées : ${twice} (rattrapage après rafraîchissement)`,
  );
} catch (e) {
  check(false, `exception : ${e.message}`);
}
for (const [what, g] of timings)
  console.log(`  (mesure) ${what} : Bob − Alice = ${g.join(', ')} ms`);
check(
  !errors.length,
  'aucune erreur JavaScript',
  errors.slice(0, 3).join(' | '),
);
await browser.close();
demo.kill();
console.log(
  failures
    ? `\n${failures} point(s) en échec. Captures : ${SHOTS}`
    : `\nTout est bon. Captures : ${SHOTS}`,
);
process.exit(failures ? 1 : 0);
