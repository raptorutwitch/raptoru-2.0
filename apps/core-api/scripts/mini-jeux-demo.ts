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
import { randomBanRoutes } from '../src/http/random-ban-routes.js';
import { modulesRoutes } from '../src/http/modules-routes.js';
import { chatRouter } from '../src/lab-chat/games.js';
import { editWallet } from '../src/lab-moderation/store.js';
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
rb.candidates = async () => RB_LAB_CHATTERS.map((c) => ({ ...c }));
const step = Number(process.env.TIER_STEP_MIN ?? 5);
for (const [k, v] of [
  ['random_ban_ext.enabled', 1],
  ['random_ban.sequence', 1],
  ['random_ban.strike_offset_s', 1],
  ['random_ban.tier_step_min', step],
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
        ...RB_LAB_CHATTERS.map((c) => ({ ...c })),
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
<style>body{margin:0;font:14px system-ui,sans-serif;background:#140d1c;color:#f3e9f2}
header{padding:10px 16px;background:#2a1636}header b{color:#f4d3dc}
main{display:grid;grid-template-columns:651px 1fr;gap:16px;padding:16px}
iframe{border:0;border-radius:10px;background:#000}
.col{display:grid;gap:12px;align-content:start}
.box{background:#1f1428;border-radius:10px;padding:10px 12px}
.box h3{margin:0 0 6px;font-size:13px;text-transform:uppercase;opacity:.7}
button{margin:2px 4px 2px 0;padding:6px 10px;border:0;border-radius:8px;background:#e58aa6;color:#2a0d20;font-weight:700;cursor:pointer}
ul{margin:0;padding-left:18px;max-height:220px;overflow:auto}li{margin:2px 0}
input{padding:6px;border-radius:6px;border:0;width:160px}</style></head><body>
<header><b>Mini-jeux · démo Lab</b> — tout est local et fictif : Core en mémoire, faux Twitch, Jetons fictifs. Tu es <b>Alice</b> (1 000 000 Jetons).</header>
<main><div class="col"><iframe src="/ext/video_component.html?anchor=component" width="651" height="434"></iframe>
<div class="box"><h3>Chat (Alice)</h3><input id="t" value="!rb"> <button onclick="say()">Envoyer</button>
<button onclick="refuse()">Twitch refusera le prochain timeout</button></div>
<div class="box"><h3>Réponses de LeCroupier_</h3><ul id="replies"></ul></div></div>
<div class="col"><iframe src="/stream" width="960" height="540"></iframe>
<div class="box"><h3>Modération (Studio)</h3><button onclick="mod('pause')">Pause file</button><button onclick="mod('resume')">Reprise</button>
<button onclick="cancelLast()">Annuler la dernière demande en attente</button><ul id="hist"></ul></div></div></main>
<script>
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
const say = () => post('/api/chat', { text: document.getElementById('t').value });
const refuse = () => post('/api/refuse-next');
const mod = (action, request_id) => post('/api/mod', { action, request_id, reason: 'démo' }).then((r) => r.error && alert(r.error));
async function cancelLast() { const h = await (await fetch('/api/history')).json(); const q = h.requests.find((r) => r.status === 'queued'); if (q) mod('cancel', q.request_id); else alert('Aucune demande en attente'); }
async function tick() {
  const r = await (await fetch('/api/replies')).json();
  document.getElementById('replies').innerHTML = r.map((x) => '<li>' + x.replace(/</g, '&lt;') + '</li>').join('');
  const h = await (await fetch('/api/history')).json();
  document.getElementById('hist').innerHTML = (h.paused ? '<li><b>File en pause</b></li>' : '') + h.requests.slice(0, 8).map((x) =>
    '<li>' + [x.source, x.buyer.name, x.status, x.target?.name ?? '', x.price_paid ? x.price_paid + ' J' : '', x.wish ? '🎯' + x.wish.name + ' ' + x.sniper : ''].join(' · ') + '</li>').join('');
}
setInterval(tick, 1000); tick();
</script></body></html>`;

const STREAM = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:linear-gradient(135deg,#2c3a4a,#4a3c5a)}
#wrap{width:1920px;height:1080px;transform:scale(.5);transform-origin:0 0;position:relative}#stage{position:absolute;inset:0}
.card{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);padding:28px 48px;border-radius:24px;background:#1a1024ee;color:#fff;
font:900 54px system-ui;text-align:center;box-shadow:0 20px 60px #000a}.card small{display:block;font-size:24px;opacity:.7;font-weight:600}
.tag{position:absolute;left:24px;top:20px;color:#fff;font:700 28px system-ui;opacity:.6}</style></head>
<body><div id="wrap"><div class="tag">Flux du stream (démo) — lecteur d’effets</div><div id="stage"></div></div><script type="module">
import { playReel, playDodge } from '/fx/reel.js';
const stage = document.getElementById('stage');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const card = async (title, small) => { const c = document.createElement('div'); c.className = 'card'; c.innerHTML = title + '<small>' + small + '</small>'; stage.append(c); await wait(2600); c.remove(); };
for (;;) {
  const a = (await (await fetch('/api/stream/next', { method: 'POST' })).json()).animation;
  if (a) {
    if (a.animation === 'reel') await playReel(stage, { ...a.reel, trigger: a.trigger });
    else if (a.animation === 'dodge') await playDodge(stage, { trigger: a.trigger, banned: a.banned });
    else if (a.animation === 'flop') await card(a.trigger + ' a flop cheh !', 'personne d’éligible');
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
