// LAB ONLY — « Mini-jeux / Random Ban » demonstration on this machine (docs/mini-jeux/PLAN_IMPLEMENTATION.md).
//   npx tsx scripts/mini-jeux-demo.ts          → http://127.0.0.1:4495
// Everything is local and fictional: an in-memory Postgres (PGlite), the REAL Core services (prices, Sniper, Viseur,
// moderation, refunds), the REAL bot executor against a FAKE Twitch (fictional chatters, `ban()` only logs), the REAL
// extension (its files, client and views) whose answers come from this Core, and a « stream » pane that plays what
// Studio's effects player would (the reel of reel.js; the ban video as a text card). No network call leaves the
// machine: no Twitch, no Production, no real Jeton. Stopping the script forgets everything.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  moduleFacade,
  RB_LAB_CHATTERS,
  type LabChatMessage,
} from '@raptoru/schemas';
import {
  createRandomBanExecutor,
  memoryRbJournal,
} from '../../twitch-bot/src/random-ban-executor.js';
import { labFakeTwitch } from '../../twitch-bot/src/rb-lab-twitch.js';
import { HelixError } from '../../twitch-bot/src/twitch/helix.js';
import { createCore } from '../src/app.js';
import { systemClock } from '../src/clock.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { internalLabCall } from '../src/ext/lab-internal.js';
import {
  refusalText,
  sayRefusal,
  type RbRefusal,
} from '../src/random-ban/refusal.js';
import { randomBanRoutes } from '../src/http/random-ban-routes.js';
import { modulesRoutes } from '../src/http/modules-routes.js';
import { chatRouter } from '../src/lab-chat/games.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { createTestDb } from '../test/helpers.js';

const PORT = Number(process.env.PORT || 4495);
const CH = '83603689';
const ME = { id: '9001', login: 'alice', display_name: 'Alice' };
const ROOT = fileURLToPath(new URL('../../', import.meta.url)); // apps/
const EXT = join(ROOT, 'twitch-extension', 'extension');
const CAL = join(ROOT, 'twitch-extension', 'calibration');
const FX = join(ROOT, 'studio', 'server', 'effects-player');

const db = await createTestDb();
const core = createCore(db, systemClock, new DevFakeCreditProvider());
const rb = core.randomBan;
// The fictional chat: the Lab's chatters and a few more (look-alike names for the Sniper's suggestions).
const DEMO_CHATTERS = [
  ...RB_LAB_CHATTERS,
  ...[
    'KiwiTV',
    'LunaBlue',
    'xXNoxXx',
    'Ir1s',
    'MokaChoco',
    'ZedLeRoux',
    'Pikachuu',
    'Baobab',
    'Raven',
    'Sushi',
  ].map((name, i) => ({
    id: String(990_101 + i),
    login: name.toLowerCase(),
    name,
  })),
];
// « Chat réduit » (demo button): only Pika and Alice are present — the honest way to see a Sniper hit (Alice has one
// chance in five), the draw stays the Core's own.
let smallChat = false;
const present = () =>
  smallChat ? DEMO_CHATTERS.filter((c) => c.name === 'Pika') : DEMO_CHATTERS;
rb.candidates = async () => present().map((c) => ({ ...c }));
// Pictures: the demo's own drawings (no Twitch); every 6th viewer has none (the initials fallback is shown).
const NO_PICTURE = new Set(
  DEMO_CHATTERS.filter((_, i) => i % 6 === 5).map((c) => c.id),
);
rb.avatarsOf = async (_q, ids) =>
  new Map(
    ids.filter((id) => !NO_PICTURE.has(id)).map((id) => [id, `/av/${id}.svg`]),
  );
// V5: fixed prices, 3 charges, one back every 10 min (RECHARGE_MIN to shorten it; the « Recharge rapide » button too).
const rechargeMin = Number(process.env.RECHARGE_MIN ?? 10);
let fastRecharge = rechargeMin === 1;
// The Sniper's real rule (one rewarded attempt every 30 min); « Sniper toujours primé » lifts it for the demo.
let sniperFree = false;
for (const [k, v] of [
  ['random_ban_ext.enabled', 1],
  // Anti-spoil: the stream's alert first, the extension reveals with the stream's latency, the timeout after.
  ['random_ban.recharge_min', rechargeMin],
  ['random_ban.sniper_window_min', 30],
] as const)
  await core.moduleSettings.set(CH, k, v, 'demo');
await editWallet(
  db,
  systemClock.now(),
  CH,
  ME.id,
  'set',
  { tokens: 1_000_000 },
  'demo',
);

// The bot's executor, with the fake Twitch (Alice is in the chat too: a CSC is possible).
const rbCall = internalLabCall(randomBanRoutes(rb));
let refuseNext = false;
const fake = labFakeTwitch();
const executor = createRandomBanExecutor({
  core: async (path, body) => {
    try {
      return { status: 200, body: await rbCall(path, body) };
    } catch (e) {
      const err = e as { status?: number; body?: unknown };
      return { status: err.status ?? 500, body: err.body ?? {} };
    }
  },
  channelId: CH,
  broadcasterId: '0',
  executorId: 'demo-executor',
  login: 'lecroupier_simule',
  botScopes: [
    'moderator:read:chatters',
    'moderator:read:followers',
    'moderator:manage:banned_users',
  ],
  broadcasterScopes: ['moderation:read', 'channel:read:subscriptions'],
  twitch: {
    ...fake,
    chattersPage: async () => ({
      chatters: [
        ...present().map((c) => ({ ...c })),
        { id: ME.id, login: ME.login, name: ME.display_name },
      ],
      cursor: null,
    }),
    ban: async (id, s, reason) => {
      if (refuseNext) {
        refuseNext = false;
        throw new HelixError(400, 'demo: Twitch a refusé ce timeout');
      }
      await fake.ban(id, s, reason);
    },
  },
  journal: memoryRbJournal(),
  log: (...a) => console.log(...a),
});
void executor.run();

const host = internalLabCall(modulesRoutes(core.modules));
// Blocks and personal cooldowns (module « random_ban »): the moderation's own commands, as Studio sends them.
const labMod = new LabModerationService(
  db,
  systemClock,
  core.ttsLab,
  core.soundLab,
  core.bonkLab,
  core.raffleLab,
  core.economy,
  core.spotify,
);
const router = chatRouter(core.raffleLab, core.chat.chatModules);
const studio = {
  id: 'demo',
  display_name: 'Modération (démo)',
  role: 'broadcaster' as const,
  via: 'studio' as const,
};
let n = 0;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
};
const body = async (req: IncomingMessage) => {
  let s = '';
  for await (const c of req) s += c;
  return s ? (JSON.parse(s) as Record<string, unknown>) : {};
};
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
async function file(res: ServerResponse, dir: string, rel: string) {
  const path = normalize(join(dir, decodeURIComponent(rel)));
  if (!path.startsWith(dir)) return json(res, 403, { error: 'forbidden' });
  try {
    let data: Buffer | string = await readFile(path);
    if (path.endsWith('.html'))
      data = data
        .toString('utf8')
        .replace(/<script[^>]*twitch-ext\.min\.js[^>]*><\/script>/g, '');
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not_found' });
  }
}

// The extension's runtime for this demo: the calibration fixtures for everything but the modules of the host (this
// Core) and the wallet (this Core's Lab wallet).
const RUNTIME = `import { calibrationCall } from '../calibration/adapter.js';
const demo = async (method, path, body, key) => {
  const r = await fetch('/api/ext', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, path, body, key }) });
  const out = await r.json();
  if (!r.ok || out.ok === false) throw Object.assign(new Error(out.error ?? 'error'), { code: out.error, status: r.status });
  return out;
};
const fixtureCall = async (method, path, body, key) => {
  if (path.startsWith('/modules/v3')) return demo(method, path, body, key);
  const out = await calibrationCall(method, path, body);
  if (path === '/session' || path === '/state') {
    const w = await (await fetch('/api/wallet')).json();
    return { ...out, wallet: { points: w.tokens, reserved: 0, available: w.tokens } };
  }
  return out;
};
export const RUNTIME = Object.freeze({ mode: 'demo', environment: 'calibration', apiBase: '', siteUrl: '', buildId: 'mini-jeux-demo', shell: 'v2', fixtureCall });
`;

const INDEX = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Mini-jeux — démo Lab</title>
<style>body{margin:0;font:14px system-ui,sans-serif;background:#120b18;color:#f6eef3}
header{padding:10px 16px;background:linear-gradient(90deg,#3a0f22,#2a0f33)}header b{color:#ffb3c1}
main{display:grid;grid-template-columns:auto 1fr;gap:16px;padding:16px;align-items:start}
iframe{border:0;border-radius:10px;background:#000;display:block}
.col{display:grid;gap:12px;align-content:start}.sizes{display:flex;gap:6px;margin-bottom:6px}
.box{background:#1d1225;border-radius:10px;padding:10px 12px}
.box h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;opacity:.7}
button{margin:2px 4px 2px 0;padding:5px 9px;border:0;border-radius:7px;background:#ff4d6d;color:#fff;font-weight:700;cursor:pointer}
button.g{background:#3a2a44}button.s{padding:3px 7px;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:12.5px}td{padding:4px 6px;border-bottom:1px solid #ffffff12;vertical-align:top}
.ok{color:#7dffb0}.bad{color:#ff9aa9}.w{color:#ffd27a}small{opacity:.7}
ul{margin:0;padding-left:18px;max-height:160px;overflow:auto}li{margin:2px 0}input{padding:5px;border-radius:6px;border:0;width:150px}</style></head><body>
<header><b>Mini-jeux · démo Lab</b> — tout est local et fictif : Core en mémoire, faux Twitch (aucun vrai timeout), Jetons fictifs. Tu es <b>Alice</b> (1 000 000 Jetons). Les autres viewers sont inventés. Sniper : une tentative primée toutes les 30 min (bouton « Sniper toujours primé » pour la démo).</header>
<main><div class="col"><div class="sizes"><button class="g s" data-size="651x434">Lecteur 651×434</button><button class="g s" data-size="480x320">Petit 480×320</button><button class="g s" data-size="318x496">Panneau 318×496</button></div>
<iframe id="ext" src="/ext/video_component.html?anchor=component" width="651" height="434"></iframe>
<div class="box"><h3>Le chat</h3><input id="t" value="!rb"> <button data-do="say">Alice écrit</button>
<button data-do="cp">Alice utilise la récompense (3 000 points)</button>
<button class="g" data-do="other">Un autre viewer lance !rb</button><button class="g" data-do="refill">Recharger les charges d’Alice</button><button class="g" data-do="fast">Recharge rapide (1 min) : oui/non</button> <b id="fast"></b><button class="g" data-do="sniper">Sniper toujours primé : oui/non</button> <b id="sniper"></b><button class="g" data-do="refuse">Twitch refusera le prochain timeout</button><button class="g" data-do="small">Chat réduit (Pika + Alice) : oui/non</button> <b id="small"></b></div>
<div class="box"><h3>Réponses de LeCroupier_</h3><ul id="replies"></ul></div></div>
<div class="col"><iframe src="/stream" width="640" height="360"></iframe>
<div class="box"><h3>Modération Random Ban (les mêmes commandes que Studio › Modération › Random Ban)</h3>
<div><button class="g s" data-mod="pause">Pause de la file</button><button class="g s" data-mod="resume">Reprise</button> <span id="paused"></span></div>
<table><tbody id="hist"></tbody></table></div></div></main>
<script>
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const mod = (cmd) => post('/api/mod', Object.assign({ reason: 'démo' }, cmd)).then((r) => { if (r.error) alert(r.error); tick(); });
const lab = (cmd) => post('/api/lab-mod', Object.assign({ reason: 'démo' }, cmd)).then((r) => { if (r.error) alert(r.error); tick(); });
let rows = [];
async function resolve(x) {
  const who = prompt('Quel compte « ' + x.wish.text + ' » visait-il ? (pseudo exact, vide = aucun)', x.wish.text);
  if (who === null) return;
  const chatters = await (await fetch('/api/chatters')).json();
  const w = who.trim().toLowerCase();
  const c = chatters.find((v) => v.name.toLowerCase() === w || v.login === w);
  if (w && !c) return alert('Aucun viewer « ' + who + ' »');
  mod({ action: 'resolve_sniper', request_id: x.request_id, viewer_id: c ? c.id : null });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.size) { const [w, h] = b.dataset.size.split('x'); const f = document.getElementById('ext'); f.width = w; f.height = h; }
  if (b.dataset.do === 'say') post('/api/chat', { text: document.getElementById('t').value });
  if (b.dataset.do === 'other') post('/api/chat-other', {});
  if (b.dataset.do === 'cp') post('/api/cp', {}).then(tick);
  if (b.dataset.do === 'refill') mod({ action: 'refill_charges', viewer_id: '9001' });
  if (b.dataset.do === 'fast') post('/api/fast').then((r) => { document.getElementById('fast').textContent = r.fast ? '1 charge / min' : ''; });
  if (b.dataset.do === 'sniper') post('/api/sniper-free').then((r) => { document.getElementById('sniper').textContent = r.free ? 'toujours primé' : ''; });
  if (b.dataset.do === 'refuse') post('/api/refuse-next');
  if (b.dataset.do === 'small') post('/api/small-chat').then((r) => { document.getElementById('small').textContent = r.small ? 'chat réduit' : ''; });
  if (b.dataset.mod) mod({ action: b.dataset.mod });
  const x = rows[Number(b.dataset.row)];
  if (!x) return;
  const v = x.buyer.id;
  const a = b.dataset.a;
  if (a === 'cancel' || a === 'refund_uncertain' || a === 'revoke_bonus') mod({ action: a, request_id: x.request_id });
  if (a === 'resolve') resolve(x);
  if (a === 'block') lab({ action: 'block_viewer', viewer_id: v, module: 'random_ban', duration_s: 300 });
  if (a === 'cooldown') lab({ action: 'set_cooldown', viewer_id: v, module: 'random_ban', delay_s: 600, span: 3600 });
  if (a === 'lift') { lab({ action: 'unblock_viewer', viewer_id: v, module: 'random_ban' }); lab({ action: 'clear_cooldown', viewer_id: v, module: 'random_ban' }); }
});
const RES = { queued: ['en file', 'w'], searching: ['tirage', 'w'], timeout_requested: ['sanction envoyée', 'w'], confirmed: ['sanction appliquée', 'ok'], failed: ['sans effet · remboursé', 'bad'], uncertain: ['à vérifier', 'bad'], canceled: ['annulé', 'bad'], flop: ['personne', ''], simulated: ['à blanc', ''] };
const SRC = { extension: 'extension', chat: '!rb', channel_points: 'points' };
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
const btn = (i, a, label, g) => '<button class="s' + (g ? ' g' : '') + '" data-row="' + i + '" data-a="' + a + '">' + label + '</button>';
async function tick() {
  const r = await (await fetch('/api/replies')).json();
  document.getElementById('replies').innerHTML = r.map((x) => '<li>' + esc(x) + '</li>').join('');
  const h = await (await fetch('/api/history')).json();
  document.getElementById('paused').innerHTML = h.paused ? '<b class="w">File en pause</b>' : '';
  rows = h.requests.slice(0, 10);
  document.getElementById('hist').innerHTML = rows.map((x, i) => {
    const res = RES[x.status] || [x.status, ''];
    const sn = x.wish ? '🎯 ' + esc(x.wish.name || '« ' + x.wish.text + ' »') + ' <small>' + x.sniper + '</small>' : '';
    return '<tr><td><b>' + esc(x.buyer.name) + '</b> → ' + esc(x.target ? x.target.name : '—') + '<br><small>' + (SRC[x.source] || x.source) + (x.price_paid ? ' · ' + x.price_paid.toLocaleString('fr-FR') + ' J' : '') + '</small></td>'
      + '<td class="' + res[1] + '">' + res[0] + '<br>' + sn + '</td><td>'
      + (x.status === 'queued' ? btn(i, 'cancel', 'Annuler') : '')
      + (x.status === 'uncertain' && x.refund === 'to_verify' ? btn(i, 'refund_uncertain', 'Rembourser') : '')
      + (x.sniper === 'unresolved' ? btn(i, 'resolve', 'Résoudre le Sniper') : '')
      + (x.sniper === 'hit' ? btn(i, 'revoke_bonus', 'Retirer la prime', 1) : '')
      + btn(i, 'block', 'Bloquer 5 min', 1) + btn(i, 'cooldown', 'Délai 10 min', 1) + btn(i, 'lift', 'Lever', 1)
      + '</td></tr>';
  }).join('');
}
setInterval(tick, 1500); tick();
</script></body></html>`;

/** A fictional profile picture (the demo has no Twitch): a gradient, a face, a hairstyle — stable per id. */
function avatarSvg(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  const skin = ['#f2c9a0', '#d9a273', '#a86b45', '#7a4a2e', '#ffd9b8'][h % 5];
  const hair = [
    '#2b1b10',
    '#7a3d12',
    '#e8c45a',
    '#c2185b',
    '#3949ab',
    '#f5f5f5',
  ][h % 6];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 70% 55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360} 70% 35%)"/></linearGradient></defs>
<rect width="64" height="64" fill="url(#g)"/><ellipse cx="32" cy="64" rx="22" ry="16" fill="hsl(${(h + 180) % 360} 45% 40%)"/>
<circle cx="32" cy="30" r="14" fill="${skin}"/><path d="M17 28c0-11 8-16 15-16s15 5 15 16c-4-5-9-7-15-7s-11 2-15 7z" fill="${hair}"/>
<circle cx="27" cy="31" r="1.8" fill="#222"/><circle cx="37" cy="31" r="1.8" fill="#222"/><path d="M27 37q5 4 10 0" stroke="#222" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`;
}

const STREAM = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:linear-gradient(135deg,#2c3a4a,#4a3c5a)}
#wrap{width:1920px;height:1080px;transform:scale(.5);transform-origin:0 0;position:relative}#stage{position:absolute;inset:0}
.card{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);padding:28px 48px;border-radius:24px;background:#1a1024ee;color:#fff;
font:900 54px system-ui;text-align:center;box-shadow:0 20px 60px #000a}.card small{display:block;font-size:24px;opacity:.7;font-weight:600}
.tag{position:absolute;left:24px;top:20px;color:#fff;font:700 28px system-ui;opacity:.6}</style></head>
<body><div id="wrap"><div class="tag">Flux du stream (démo) — lecteur d’effets</div><div id="stage"></div></div><script type="module">
const stage = document.getElementById('stage');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const card = async (title, small) => { const c = document.createElement('div'); c.className = 'card'; c.innerHTML = title + '<small>' + small + '</small>'; stage.append(c); await wait(2600); c.remove(); };
for (;;) {
  const a = (await (await fetch('/api/stream/next', { method: 'POST' })).json()).animation;
  if (a) {
    if (a.animation === 'flop') await card(a.trigger + ' a flop cheh !', 'personne d’éligible');
    else await card('BANNI : ' + (a.banned ?? '?'), 'Random Ban de ' + a.trigger + ' — ici la vidéo de ban de Studio (« ' + a.animation + ' »)');
    await fetch('/api/stream/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: a.request_id }) });
  }
  await wait(400);
}
</script></body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://demo');
  const p = url.pathname;
  try {
    if (p === '/') return void res.end(INDEX);
    if (p === '/stream') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return void res.end(STREAM);
    }
    if (p === '/ext/shared/runtime-config.js') {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      return void res.end(RUNTIME);
    }
    if (p.startsWith('/ext/calibration/'))
      return await file(res, CAL, p.slice('/ext/calibration/'.length));
    if (p.startsWith('/ext/')) return await file(res, EXT, p.slice(5));
    if (p.startsWith('/fx/')) return await file(res, FX, p.slice(4));
    if (p === '/api/wallet') {
      const w = (
        await db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, ME.id],
        )
      )[0];
      return json(res, 200, { tokens: Number(w?.tokens ?? 0) });
    }
    if (p === '/api/ext') {
      const b = await body(req);
      const out = await moduleFacade({
        call: host,
        channelId: CH,
        method: String(b.method),
        path: String(b.path),
        body: b.body,
        viewer: { id: ME.id, display_name: ME.display_name },
        idempotencyKey: typeof b.key === 'string' ? b.key : null,
        moderator: null,
      });
      return json(
        res,
        out?.status ?? 404,
        out?.body ?? { ok: false, error: 'not_available' },
      );
    }
    if (p === '/api/chat') {
      const b = await body(req);
      const msg: LabChatMessage = {
        channel_id: CH,
        message_id: `demo-${++n}`,
        text: String(b.text ?? ''),
        chatter: {
          id: ME.id,
          login: ME.login,
          display_name: ME.display_name,
          role: 'viewer',
        },
        source: 'twitch',
      };
      return json(res, 200, await router.message(msg));
    }
    if (p === '/api/replies') {
      const rows = await db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'rb:%' order by seq_global desc limit 12`,
      );
      return json(
        res,
        200,
        rows.map((r) => r.params.text),
      );
    }
    if (p.startsWith('/av/') && p.endsWith('.svg')) {
      res.writeHead(200, {
        'content-type': 'image/svg+xml',
        'cache-control': 'max-age=3600',
      });
      return void res.end(avatarSvg(p.slice(4, -4)));
    }
    if (p === '/api/chatters') return json(res, 200, DEMO_CHATTERS);
    if (p === '/api/sniper-free') {
      sniperFree = !sniperFree;
      await core.moduleSettings.set(
        CH,
        'random_ban.sniper_window_min',
        sniperFree ? 0 : 30,
        'demo',
      );
      return json(res, 200, { free: sniperFree });
    }
    if (p === '/api/fast') {
      fastRecharge = !fastRecharge;
      await core.moduleSettings.set(
        CH,
        'random_ban.recharge_min',
        fastRecharge ? 1 : 10,
        'demo',
      );
      return json(res, 200, { fast: fastRecharge });
    }
    // A channel points redemption of the Random Ban reward (3 000 points): the SAME charges as the extension and `!rb`;
    // refused → nothing created, the points would go back (CANCELED on Raptoru's reward), one short line at most.
    if (p === '/api/cp') {
      const out = await rb.requestChannelPoints({
        channel_id: CH,
        source_ref: `twitch:demo-cp-${++n}:0`,
        mode: 'real',
        buyer: { id: ME.id, login: ME.login, name: ME.display_name },
      });
      if (out.refused) {
        const code = {
          cooldown: 'viewer_cooldown',
          blocked: 'viewer_blocked',
          paused: 'rb_paused',
          busy: 'rb_busy',
          no_charge: 'no_charge',
        }[out.refused] as RbRefusal;
        const why = refusalText(code, out.cooling_ms);
        await db.tx((q) =>
          sayRefusal(q, {
            channelId: CH,
            viewerId: ME.id,
            ref: `cp:demo-${n}`,
            text: `@${ME.display_name} - ${why[0]!.toUpperCase()}${why.slice(1)} · points remboursés.`,
            now: systemClock.now(),
          }),
        );
      }
      return json(res, 200, out);
    }
    if (p === '/api/small-chat') {
      smallChat = !smallChat;
      return json(res, 200, { small: smallChat });
    }
    if (p === '/api/chat-other') {
      const c =
        DEMO_CHATTERS[Math.floor(Math.random() * DEMO_CHATTERS.length)]!;
      await editWallet(
        db,
        systemClock.now(),
        CH,
        c.id,
        'set',
        { tokens: 500_000 },
        'demo',
      ).catch(() => {});
      const msg: LabChatMessage = {
        channel_id: CH,
        message_id: `demo-${++n}`,
        text: '!rb',
        chatter: {
          id: c.id,
          login: c.login,
          display_name: c.name,
          role: 'viewer',
        },
        source: 'twitch',
      };
      return json(res, 200, await router.message(msg));
    }
    if (p === '/api/lab-mod') {
      const b = await body(req);
      try {
        return json(
          res,
          200,
          await labMod.act(CH, { actor: studio, command: b as never }),
        );
      } catch (e) {
        return json(res, 200, {
          error:
            (e as { code?: string; message: string }).code ??
            (e as Error).message,
        });
      }
    }
    if (p === '/api/refuse-next') {
      refuseNext = true;
      return json(res, 200, { ok: true });
    }
    if (p === '/api/history')
      return json(
        res,
        200,
        await rb.moderation!.history(CH, studio, { limit: 20 }),
      );
    if (p === '/api/mod') {
      const b = await body(req);
      try {
        return json(res, 200, await rb.moderation!.act(CH, studio, b as never));
      } catch (e) {
        return json(res, 200, {
          error:
            (e as { code?: string; message: string }).code ??
            (e as Error).message,
        });
      }
    }
    // Studio's two loops, here driven by the stream pane: « I am there » (the mute poll) and the next animation.
    if (p === '/api/stream/next') {
      await rb.claimMute(CH, {
        consumer_id: 'demo-studio',
        obs_ready: false,
        mic_held: false,
      });
      return json(res, 200, await rb.claimAnimation(CH, 'demo-studio'));
    }
    if (p === '/api/stream/report') {
      const b = await body(req);
      await rb
        .reportAnimation(String(b.request_id), {
          consumer_id: 'demo-studio',
          event: 'completed',
        })
        .catch(() => {});
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: (e as Error).message });
  }
}).listen(PORT, '127.0.0.1', () =>
  console.log(
    `[mini-jeux-demo] http://127.0.0.1:${PORT} — tout est local et fictif (Ctrl+C pour arrêter)`,
  ),
);
