// Reference requests (plan § 10 F2): every paying or moderation action emits the SAME request before and
// after a migration (method, path, body, Idempotency-Key, Authorization).
//   node test/responsive/requests.mjs [--shell v2] [--root <copy of apps/twitch-extension>] [--out file.json]
//        [--only id,id] [--compare reference.json]
// The extension runs in its real connected client ('test' mode) against a FAKE Core on core.bench.invalid,
// answered here by the calibration fixtures (GET) and a recorded refusal (writes): nothing leaves the machine, no
// real Core, Jeton or chat is reached. A fake Twitch helper authorizes a viewer token (the fixtures' session is a
// moderator's: Modération D4 is offered). Scenarios drive the real UI, one intention each.
// Idempotency-Keys are recorded as K1, K2… in order of appearance: « K1, K1 » = one intent sent twice with the same key
// (a retry the Core applies once), « K1, K2 » = two intents.
// --compare: exits 1 when a scenario's writes differ from the reference file.
/* global localStorage -- evaluated in the page (Playwright) */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, '../../../../package.json'))(
  '@playwright/test',
);
const opt = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? d : process.argv[i + 1];
};
const ROOT = opt('root') || process.env.BENCH_ROOT || dirname(dirname(HERE));
const shell = opt('shell');
const only = opt('only')?.split(',');
const { createCalibrationSource } = await import(
  pathToFileURL(join(ROOT, 'calibration', 'adapter.js')).href
);

const server = await startServer(Number(process.env.PORT || 4476));
const base = `http://127.0.0.1:${server.address().port}/live${shell ? `-${shell}` : ''}`;
const CORE = 'https://core.bench.invalid/v1/ext';

const FAKE_HELPER = `(() => {
  const handlers = {};
  const token = 'bench.' + btoa(JSON.stringify({ user_id: '424242', opaque_user_id: 'U424242', role: 'viewer', channel_id: '83603689', exp: 4102444800 })) + '.sig';
  window.Twitch = { ext: {
    version: 'bench', environment: 'production',
    onAuthorized(cb) { setTimeout(() => cb({ token, userId: 'U424242', channelId: '83603689', clientId: 'bench' }), 30); },
    onContext() {}, onError() {}, onHighlightChanged() {}, onVisibilityChanged() {},
    listen() {}, unlisten() {}, send() {},
    actions: { minimize() {}, requestIdShare() {}, followChannel() {} },
    configuration: { onChanged(cb) { setTimeout(cb, 0); }, broadcaster: null, global: null, set() {} },
    viewer: { opaqueId: 'U424242', id: '424242', role: 'viewer', isLinked: true },
    features: { isChatEnabled: true },
  } };
})();`;

const VIDEO = 'video_component.html?anchor=component';
const ttsText = (p) =>
  p.locator('.ttsv2 textarea[data-msg]').fill('Message de référence');
/** Opens the viewer card of the first row of the moderation queue (its name). */
const openViewer = async (p) => {
  await p.locator('.modv2 .row .who').first().click();
  await p.waitForTimeout(700);
};
/** Its « Wallet admin » drawer (viewer menu ›). */
const openWallet = async (p) => {
  await openViewer(p);
  await p.locator('.modv2 [data-act="viewer-more"]').first().click();
  await p.locator('.menu [data-act="wallet"]').first().click();
  await p.waitForTimeout(500);
};
const menuItem = (p, refund) =>
  p
    .locator(`.menu [data-act="remove"][data-refund="${refund}"]`)
    .first()
    .click();

// [id, page, demoModule, scenario(page), options] — each scenario performs ONE intention.
// options.failFirstWrite: the fake Core loses the first write (network error), the viewer tries again.
// options.patch(path, body): the fake Core's answer to a read, changed for this scenario (the calibration fixtures have
// no channel-point credits and give the moderator no « Admin Wallet » grant).
const withCredits = (path, body) =>
  path === '/session' || path === '/state'
    ? {
        ...body,
        pending_actions: [
          {
            redemption_id: 'red-bench-tts',
            module_id: 'tts',
            reward_key: 'tts',
            cost: 1000,
          },
          {
            redemption_id: 'red-bench-sound',
            module_id: 'soundboard',
            reward_key: 'sound',
            cost: 1000,
            credits_remaining: 3,
          },
        ],
        credits: { tts: 1, soundboard: 3 },
      }
    : body;
const withWalletGrant = (path, body) => {
  if (!path.startsWith('/moderation/')) return body;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const o = Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, walk(x)]),
    );
    if (
      Array.isArray(o.grants) &&
      o.role === 'moderator' &&
      !o.grants.includes('wallet')
    )
      o.grants = [...o.grants, 'wallet'];
    return o;
  };
  return walk(body);
};
const SCENARIOS = [
  [
    'tts-tokens',
    VIDEO,
    'tts',
    async (p) => {
      await ttsText(p);
      await p.locator('.ttsv2 [data-act="confirm"]').click();
    },
  ],
  [
    'tts-credits',
    VIDEO,
    'tts',
    async (p) => {
      await ttsText(p);
      await p
        .locator('.ttsv2 [data-act="cur-toggle"]')
        .click({ timeout: 5000 });
      await p.locator('.ttsv2 [data-act="confirm"]').click();
    },
    { patch: withCredits },
  ],
  [
    'tts-double-click',
    VIDEO,
    'tts',
    async (p) => {
      await ttsText(p);
      await p.locator('.ttsv2 [data-act="confirm"]').dblclick();
    },
  ],
  [
    'tts-retry-after-network-loss',
    VIDEO,
    'tts',
    async (p) => {
      await ttsText(p);
      await p.locator('.ttsv2 [data-act="confirm"]').click();
      await p.waitForTimeout(1200);
      await p.locator('.ttsv2 [data-act="confirm"]').click();
    },
    { failFirstWrite: true },
  ],
  [
    'raffle-join',
    VIDEO,
    'raffle_join',
    async (p) => {
      await p.locator('.tmbx [data-act="join"]').click();
    },
  ],
  [
    'soundboard-first',
    VIDEO,
    'soundboard',
    async (p) => {
      await p.locator('.sbx-grid > *').first().click();
      const buy = p
        .locator(
          '.sbx [data-act="buy"], .sbx-buy, button:has-text("Jouer"), button:has-text("Envoyer")',
        )
        .first();
      if (await buy.count()) await buy.click();
    },
  ],
  [
    'soundboard-credits',
    VIDEO,
    'soundboard',
    async (p) => {
      await p.locator('.rl-cswitch__chip').first().click();
      await p.locator('.sbx-grid > *').first().click();
      const buy = p
        .locator(
          '.sbx [data-act="buy"], .sbx-buy, button:has-text("Jouer"), button:has-text("Envoyer")',
        )
        .first();
      if (await buy.count()) await buy.click();
    },
    { patch: withCredits },
  ],
  [
    'bonk-salve',
    VIDEO,
    'bonk',
    async (p) => {
      await p.locator('.rl-picker__cell').first().click();
      await p.waitForTimeout(300);
      await p.locator('.bkc-cta').click();
    },
  ],
  [
    'mod-remove-refund',
    VIDEO,
    'moderation',
    async (p) => {
      await p
        .locator('.modv2 .rows .row [data-act="item-menu"]')
        .first()
        .click();
      await menuItem(p, '1');
    },
  ],
  [
    'mod-stop-no-refund',
    VIDEO,
    'moderation',
    async (p) => {
      await p.locator('.modv2 .btn--stop').first().click();
      await menuItem(p, '0');
    },
  ],
  [
    'mod-credit',
    VIDEO,
    'moderation',
    async (p) => {
      await openWallet(p);
      await p
        .locator('.modv2 [data-act="wallet-dialog"][data-sign="1"]')
        .first()
        .click();
      await p.locator('.modv2 [data-act="dlg-ok"]').click();
    },
    { patch: withWalletGrant },
  ],
  [
    'mod-debit-double-click',
    VIDEO,
    'moderation',
    async (p) => {
      await openWallet(p);
      await p
        .locator('.modv2 [data-act="wallet-dialog"][data-sign="-1"]')
        .first()
        .click();
      await p.locator('.modv2 [data-act="dlg-ok"]').dblclick();
    },
    { patch: withWalletGrant },
  ],
  [
    'mod-block',
    VIDEO,
    'moderation',
    async (p) => {
      await openViewer(p);
      await p.locator('.modv2 [data-act="block"]').first().click();
      await p.locator('.modv2 [data-act="dlg-ok"]').click();
    },
  ],
];

const browser = await chromium.launch();
const results = {};
for (const [id, page0, view, scenario, options = {}] of SCENARIOS) {
  if (only && !only.includes(id)) continue;
  const ctx = await browser.newContext({
    viewport: { width: 651, height: 434 },
  });
  await ctx.addInitScript(FAKE_HELPER);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('raptoru-live:tutorial-disabled:bonk:v1', '1');
    } catch {
      /* */
    }
  });
  const fixtures = createCalibrationSource();
  const writes = [];
  const keys = new Map();
  let lost = 0;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const req = route.request();
    const url = req.url();
    if (!url.startsWith(CORE)) return route.abort();
    const path = url.slice(CORE.length);
    const headers = req.headers();
    if (req.method() === 'GET') {
      try {
        const body = (options.patch ?? ((_, b) => b))(
          path.split('?')[0],
          await fixtures(req.method(), path),
        );
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      } catch (e) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: e.code || 'not_found' }),
        });
      }
    }
    let body = req.postData();
    try {
      body = JSON.parse(body);
    } catch {
      /* raw */
    }
    const raw = headers['idempotency-key'];
    if (raw && !keys.has(raw)) keys.set(raw, `K${keys.size + 1}`);
    writes.push({
      method: req.method(),
      path,
      body,
      idempotencyKey: raw ? keys.get(raw) : null,
      authorization: /^Bearer .+/.test(headers.authorization || ''),
    });
    // A lost answer (network error): the Core may or may not have applied it — only the same key makes a retry safe.
    if (options.failFirstWrite && !lost && path !== '/emotes/refresh') {
      lost += 1;
      return route.abort('failed');
    }
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'bench_reference_capture' }),
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/${page0}&demoModule=${view}`);
  await page.waitForTimeout(1800);
  let scenarioError = null;
  try {
    await scenario(page);
    await page.waitForTimeout(1200);
  } catch (e) {
    scenarioError = e.message
      .split(/\r?\n/)
      .filter(
        (l, i) => !i || /intercepts|resolved to|waiting for locator/.test(l),
      )
      .slice(0, 4)
      .join(' ¦ ');
  }
  results[id] = { writes, errors, scenarioError };
  console.log(
    `${id}: ${writes.length ? writes.map((w) => `${w.method} ${w.path} ${JSON.stringify(w.body)} key=${w.idempotencyKey} auth=${w.authorization}`).join(' | ') : 'AUCUNE ÉCRITURE'}${scenarioError ? ` (scénario: ${scenarioError})` : ''}${errors.length ? ` errors=${errors.length}` : ''}`,
  );
  await ctx.close();
}
await browser.close();
server.close();
// Volatile fields (time-based, random) are normalized so two runs compare.
const VOLATILE = /^(client_request_id|request_id|nonce|idempotency_key)$/;
const normalized = JSON.parse(
  JSON.stringify(results, (k, v) => (VOLATILE.test(k) ? '<volatile>' : v)),
);
const out =
  opt('out') || join(HERE, 'out', `requests${shell ? '-' + shell : ''}.json`);
writeFileSync(out, JSON.stringify(normalized, null, 1));
console.log(`→ ${out}`);

const reference = opt('compare');
if (reference) {
  const ref = JSON.parse(readFileSync(reference, 'utf8'));
  let diff = 0;
  for (const [id, r] of Object.entries(normalized)) {
    if (!ref[id]) {
      console.log(`≠ ${id}: absent de la référence`);
      diff += 1;
      continue;
    }
    const same = JSON.stringify(r.writes) === JSON.stringify(ref[id].writes);
    if (!same) diff += 1;
    console.log(
      `${same ? '=' : '≠'} ${id}${same ? '' : `\n    référence : ${JSON.stringify(ref[id].writes)}\n    ici       : ${JSON.stringify(r.writes)}`}`,
    );
  }
  console.log(
    diff
      ? `${diff} scénario(s) différent(s) de ${reference}`
      : `Identique à ${reference}.`,
  );
  process.exitCode = diff ? 1 : 0;
}
