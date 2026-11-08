// Reference requests (plan § 10 F2): every paying or moderation action emits the SAME request before and
// after a migration (method, path, body, Idempotency-Key present or not, Authorization).
//   node test/responsive/requests.mjs [--shell v2] [--root <copy of apps/twitch-extension>] [--out file.json]
// The extension runs in its real connected client ('test' mode) against a FAKE Core on core.bench.invalid,
// answered here by the calibration fixtures (GET) and a recorded refusal (writes): nothing leaves the machine.
// A fake Twitch helper authorizes a viewer token. Scenarios drive the real UI.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, '../../../../package.json'))('@playwright/test');
const opt = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const ROOT = opt('root') || process.env.BENCH_ROOT || dirname(dirname(HERE));
const shell = opt('shell');
const { createCalibrationSource } = await import(pathToFileURL(join(ROOT, 'calibration', 'adapter.js')).href);

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

// [id, page, demoModule, scenario(page)] — each scenario performs ONE intention.
const SCENARIOS = [
  ['tts-tokens', 'video_component.html?anchor=component', 'tts', async (p) => {
    await p.locator('.ttsv2 textarea[data-msg]').fill('Message de référence');
    await p.locator('.ttsv2 [data-act="confirm"]').click();
  }],
  ['raffle-join', 'video_component.html?anchor=component', 'raffle_join', async (p) => {
    await p.locator('.tmbx [data-act="join"]').click();
  }],
  ['soundboard-first', 'video_component.html?anchor=component', 'soundboard', async (p) => {
    await p.locator('.sbx-grid > *').first().click();
    const buy = p.locator('.sbx [data-act="buy"], .sbx-buy, button:has-text("Jouer"), button:has-text("Envoyer")').first();
    if (await buy.count()) await buy.click();
  }],
  ['bonk-first', 'video_component.html?anchor=component', 'bonk', async (p) => {
    const emote = p.locator('.bonk [data-emote], .bonk-grid button, .emote-picker button').first();
    if (await emote.count()) await emote.click();
    const send = p.locator('button:has-text("Bonk"), button:has-text("Envoyer"), [data-act="send"]').first();
    if (await send.count()) await send.click();
  }],
];

const browser = await chromium.launch();
const results = {};
for (const [id, page0, view, scenario] of SCENARIOS) {
  const ctx = await browser.newContext({ viewport: { width: 651, height: 434 } });
  await ctx.addInitScript(FAKE_HELPER);
  await ctx.addInitScript(() => { try { localStorage.setItem('raptoru-live:tutorial-disabled:bonk:v1', '1'); } catch { /* */ } });
  const fixtures = createCalibrationSource();
  const writes = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const req = route.request();
    const url = req.url();
    if (!url.startsWith(CORE)) return route.abort();
    const path = url.slice(CORE.length);
    const headers = req.headers();
    if (req.method() === 'GET') {
      try {
        const body = await fixtures(req.method(), path);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      } catch (e) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: e.code || 'not_found' }) });
      }
    }
    let body = req.postData();
    try { body = JSON.parse(body); } catch { /* raw */ }
    writes.push({ method: req.method(), path, body, idempotencyKey: Boolean(headers['idempotency-key']), authorization: /^Bearer .+/.test(headers.authorization || '') });
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'bench_reference_capture' }) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/${page0}&demoModule=${view}`);
  await page.waitForTimeout(1800);
  let scenarioError = null;
  try { await scenario(page); await page.waitForTimeout(1200); } catch (e) { scenarioError = e.message.split('\n')[0]; }
  // GET-only preference sync etc. are not intentions: keep the writes.
  results[id] = { writes, errors, scenarioError };
  console.log(`${id}: ${writes.length ? writes.map((w) => `${w.method} ${w.path} ${JSON.stringify(w.body)} key=${w.idempotencyKey} auth=${w.authorization}`).join(' | ') : 'AUCUNE ÉCRITURE'}${scenarioError ? ` (scénario: ${scenarioError})` : ''}${errors.length ? ` errors=${errors.length}` : ''}`);
  await ctx.close();
}
await browser.close();
server.close();
// Volatile fields (time-based) are normalized so two runs compare.
const out = opt('out') || join(HERE, 'out', `requests${shell ? '-' + shell : ''}.json`);
writeFileSync(out, JSON.stringify(results, (k, v) => (/^(client_request_id|request_id|nonce)$/.test(k) ? '<volatile>' : v), 1));
console.log(`→ ${out}`);
