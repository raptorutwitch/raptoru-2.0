// LAB ONLY — Casino demonstration on this machine (docs/CASINO.md § 9).
//   npm run casino:demo -w @raptoru/core-api          → http://127.0.0.1:4497
// Everything is local and fictional: an in-memory Postgres (PGlite), the REAL Core (its casino service, the Lab test
// wallet, LeCroupier_'s chat queue), the REAL extension (its files, client and views) whose answers come from this
// Core through the same door as Production's façade (ext/casino-ext.ts). Two fictional viewers side by side: Alice plays,
// Bob watches (spectator mode). No network call leaves the machine: no Twitch, no Production, no real Jeton.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleFacade } from '@raptoru/schemas';
import { createCore } from '../src/app.js';
import { systemClock } from '../src/clock.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { casinoExt } from '../src/ext/casino-ext.js';
import { internalLabCall } from '../src/ext/lab-internal.js';
import { casinoRoutes } from '../src/http/casino-routes.js';
import { modulesRoutes } from '../src/http/modules-routes.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { createTestDb } from '../test/helpers.js';
import { generateCoffre } from '../src/casino/coffre.js';
import { cryptoIntRng, floatFrom, seededRng } from '../src/casino/rng.js';
import { ORDER } from '../src/casino/roulette.js';
import { STRIPS } from '../src/casino/slot.js';

const PORT = Number(process.env.PORT || 4497);
const CH = '83603689';
const VIEWERS: Record<
  string,
  { id: string; display_name: string; tokens: number }
> = {
  alice: { id: '9001', display_name: 'Alice', tokens: 1_000_000 },
  bob: { id: '9002', display_name: 'Bob', tokens: 50_000 },
  luna: { id: '9003', display_name: 'Luna', tokens: 500_000 },
  carla: { id: '9004', display_name: 'Carla', tokens: 20_000 },
};
const ROOT = fileURLToPath(new URL('../../', import.meta.url)); // apps/
const EXT = join(ROOT, 'twitch-extension', 'extension');
const CAL = join(ROOT, 'twitch-extension', 'calibration');

const db = await createTestDb();
// CASINO_DEMO_SLOW=<ms>: logs every query slower than that (this demo's database runs on the server's only thread).
if (process.env.CASINO_DEMO_SLOW) {
  const limit = Number(process.env.CASINO_DEMO_SLOW);
  const wrap = (target: { query: (...a: never[]) => Promise<unknown> }) => {
    const q = target.query.bind(target);
    target.query = (async (...a: never[]) => {
      const t = Date.now();
      try {
        return await q(...a);
      } finally {
        const d = Date.now() - t;
        if (d > limit)
          console.log(
            `[slow ${d} ms] ${String(a[0]).replace(/\s+/g, ' ').slice(0, 160)}`,
          );
      }
    }) as typeof target.query;
  };
  wrap(db as never);
  const tx = db.tx.bind(db);
  db.tx = ((fn: (q: never) => Promise<unknown>) =>
    tx((q) => (wrap(q as never), fn(q as never)))) as typeof db.tx;
}
const core = createCore(db, systemClock, new DevFakeCreditProvider());
const casino = core.casino;
await core.moduleSettings.set(CH, 'casino.open', 1, 'demo');
await core.moduleSettings.set(CH, 'random_ban_ext.enabled', 1, 'demo'); // the Mini-jeux card
for (const v of Object.values(VIEWERS))
  await editWallet(
    db,
    systemClock.now(),
    CH,
    v.id,
    'set',
    { tokens: v.tokens },
    'demo',
  );
// The Lab's simulated live (Studio › Simulation › « Simuler début »): on at start.
async function setLive(on: boolean) {
  if (on)
    await db.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
       select gen_random_uuid(), $1, $2, 'simulated', 'demo'
       where not exists (select 1 from lab_stream_sessions where channel_id = $1 and ended_at is null)`,
      [CH, systemClock.now()],
    );
  else
    await db.query(
      'update lab_stream_sessions set ended_at = $2 where channel_id = $1 and ended_at is null',
      [CH, systemClock.now()],
    );
}
await setLive(true);

// LAB ONLY — « Prochain tour » of the demo: the next draws of the Core are chosen (a Coffre with k BONUS, a full grid,
// a roulette number), then the crypto generator again. Real draws of the real engine, only chosen; never in Production.
let forced: number[] = [];
let forcedSeed: number | null = null;
casino.rng = {
  int: (n: number) => {
    if (forced.length) return forced.shift()! % n;
    if (forcedSeed !== null) return seed.int(n);
    return cryptoIntRng.int(n);
  },
};
let seed = seededRng(1);
function forceCoffre(k: number, grand: boolean) {
  const cells = Array.from({ length: k }, (_, r) => r * 3 + 1);
  forced = STRIPS.map((st, r) => {
    const b = st.indexOf('bonus');
    return r < k ? (b - 1 + st.length) % st.length : (b + 2) % st.length;
  });
  let sd = (Math.random() * 1e9) | 0;
  if (grand)
    while (!generateCoffre(k, floatFrom(seededRng(sd)), cells).full) sd++;
  forcedSeed = sd;
  seed = seededRng(sd);
}

const call = internalLabCall([
  ...casinoRoutes(casino),
  ...modulesRoutes(core.modules),
]);

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
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
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

// The extension's runtime for this demo: the calibration fixtures for everything but the casino, the module host (this
// Core) and the wallet (this Core's Lab wallet). The viewer is the iframe's `?as=` (alice, bob…).
const RUNTIME = `import { calibrationCall } from '../calibration/adapter.js';
const as = new URLSearchParams(location.search).get('as') || 'alice';
const demo = async (method, path, body, key) => {
  const r = await fetch('/api/ext', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, path, body, key, as }) });
  const out = await r.json();
  if (!r.ok || out.ok === false) throw Object.assign(new Error(out.error ?? 'error'), { code: out.error, status: r.status, details: out });
  return out;
};
const fixtureCall = async (method, path, body, key) => {
  if (path.startsWith('/modules/v3') || path.startsWith('/casino/')) return demo(method, path, body, key);
  const out = await calibrationCall(method, path, body);
  if (path === '/session' || path === '/state') {
    const w = await (await fetch('/api/wallet?as=' + as)).json();
    return { ...out, wallet: { points: w.tokens, reserved: 0, available: w.tokens } };
  }
  return out;
};
export const RUNTIME = Object.freeze({ mode: 'demo', environment: 'calibration', apiBase: '', siteUrl: '', buildId: 'casino-demo', shell: 'v2', fixtureCall });
`;

const INDEX = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Casino — démo Lab</title>
<style>body{margin:0;font:14px system-ui,sans-serif;background:#120b18;color:#f6eef3}
header{padding:10px 16px;background:linear-gradient(90deg,#3a0f22,#2a0f33)}header b{color:#ffd27a}
main{display:grid;grid-template-columns:auto auto 1fr;gap:16px;padding:16px;align-items:start}
figure{margin:0}figcaption{font-weight:800;margin-bottom:6px}figcaption small{font-weight:500;opacity:.7}
iframe{border:0;border-radius:6px;background:#000;display:block;width:565px;height:376px}
.col{display:grid;gap:12px;align-content:start}.box{background:#1d1225;border-radius:10px;padding:10px 12px}
.box h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;opacity:.7}
button{margin:2px 4px 2px 0;padding:5px 9px;border:0;border-radius:7px;background:#3a2a44;color:#fff;font-weight:700;cursor:pointer}
button.on{background:#ff9f1a;color:#2a1600}input{padding:4px 6px;border-radius:6px;border:0;width:110px}
table{width:100%;border-collapse:collapse;font-size:12px}td{padding:3px 5px;border-bottom:1px solid #ffffff12}
ul{margin:0;padding-left:18px;max-height:180px;overflow:auto;font-size:12.5px}small{opacity:.7}</style></head><body>
<header><b>Casino · démo Lab</b> — tout est local et fictif : Core en mémoire, portefeuille de test, chat simulé. <b>Alice</b> joue (1 000 000 Jetons) ; <b>Bob</b> la regarde : Mini-jeux › « Regarder les parties en direct » › Alice. <a href="/ext/video_component.html?anchor=component&as=carla&demoModule=random_ban_ext" target="_blank" style="color:#ffd27a">Un 2ᵉ spectateur (Carla)</a>. Aucune donnée réelle.</header>
<main>
<figure><figcaption>Alice <small>joueuse · fenêtre 565 × 376</small></figcaption><iframe id="alice" src="/ext/video_component.html?anchor=component&as=alice&demoModule=random_ban_ext"></iframe></figure>
<figure><figcaption>Bob <small>spectateur (aucune commande n’agit)</small></figcaption><iframe id="bob" src="/ext/video_component.html?anchor=component&as=bob&demoModule=random_ban_ext"></iframe></figure>
<div class="col">
<div class="box"><h3>Lab</h3>
<button data-do="live" id="live">Live</button><button data-do="open" id="open">Casino ouvert</button>
<button data-do="f3">Prochain tour d’Alice : Coffre 3 BONUS</button><button data-do="f5">… 5 BONUS</button><button data-do="fg">… grille pleine (GRAND)</button><button data-do="f17">… roulette : le 17</button><br><button data-do="luna-slot">Luna joue à la machine</button><button data-do="luna-coffre">Luna ouvre un Coffre</button><button data-do="luna-roulette">Luna joue à la roulette</button>
<div style="margin-top:6px">Gain max par partie <input id="maxwin" value="1000000"> <button data-do="maxwin">Appliquer</button></div>
<div>Solde d’Alice <input id="bal" value="1000000"> <button data-do="bal">Appliquer</button></div></div>
<div class="box"><h3>LeCroupier_ (chat simulé, file réelle du Core)</h3><ul id="chat"></ul></div>
<div class="box"><h3>Studio › Casino (lecture)</h3><div id="admin"></div></div>
</div></main>
<script>
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset.do;
  if (d === 'live') await post('/api/live');
  if (d === 'open') await post('/api/open');
  if (d === 'f3') await post('/api/force', { bonus: 3 });
  if (d === 'f5') await post('/api/force', { bonus: 5 });
  if (d === 'fg') await post('/api/force', { bonus: 3, grand: true });
  if (d === 'f17') await post('/api/force', { game: 'roulette', number: 17 });
  if (d === 'luna-slot') await post('/api/luna', { game: 'slot' });
  if (d === 'luna-coffre') { await post('/api/force', { bonus: 4 }); await post('/api/luna', { game: 'slot' }); }
  if (d === 'luna-roulette') await post('/api/luna', { game: 'roulette' });
  if (d === 'maxwin') await post('/api/maxwin', { value: Number(document.getElementById('maxwin').value) });
  if (d === 'bal') await post('/api/balance', { tokens: Number(document.getElementById('bal').value) });
  tick();
});
async function tick() {
  const s = await (await fetch('/api/admin')).json();
  document.getElementById('live').className = s.availability.live ? 'on' : '';
  document.getElementById('live').textContent = s.availability.live ? 'Live : en cours' : 'Live : hors live';
  document.getElementById('open').className = s.open ? 'on' : '';
  document.getElementById('open').textContent = s.open ? 'Casino : ouvert' : 'Casino : fermé';
  const day = s.day.map((x) => esc(x.game) + ' : ' + x.rounds + ' parties, misé ' + x.staked + ', payé ' + x.paid).join(' · ') || 'aucune partie';
  document.getElementById('admin').innerHTML = '<p><small>' + day + ' · refus : ' + esc(JSON.stringify(s.refusals.counts)) + '</small></p><table>' + s.recent.slice(0, 8).map((r) => '<tr><td>' + esc(r.viewer_name) + '</td><td>' + esc(r.game) + '</td><td>' + r.bet + '</td><td>' + (r.payout ? '+' + r.payout : '—') + (r.capped ? ' (plafonné)' : '') + (r.coffre ? ' · Coffre ×' + r.coffre.total : '') + '</td></tr>').join('') + '</table>';
  const c = await (await fetch('/api/chat')).json();
  document.getElementById('chat').innerHTML = c.map((x) => '<li>' + esc(x) + '</li>').join('') || '<li><small>rien pour l’instant</small></li>';
}
setInterval(tick, 2000); tick();
</script></body></html>`;

let n = 0;
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://demo');
  const p = url.pathname;
  try {
    if (p === '/') return void res.end(INDEX);
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
    if (p === '/api/wallet') {
      const v =
        VIEWERS[url.searchParams.get('as') ?? 'alice'] ?? VIEWERS.alice!;
      return json(res, 200, {
        tokens: (await core.economy.balances(db, CH, v.id)).tokens,
      });
    }
    if (p === '/api/ext') {
      const b = await body(req);
      const spinning = String(b.path).endsWith('/spin');
      const v = VIEWERS[String(b.as)] ?? VIEWERS.alice!;
      const viewer = { id: v.id, display_name: v.display_name };
      const path = String(b.path);
      if (path.startsWith('/casino/')) {
        const out = await casinoExt(
          call,
          CH,
          String(b.method),
          path,
          (b.body ?? undefined) as Record<string, unknown> | undefined,
          viewer,
          typeof b.key === 'string' ? b.key : undefined,
        );
        if (spinning) {
          forced = [];
          forcedSeed = null;
        }
        return json(res, out.status, out.body);
      }
      const out = await moduleFacade({
        call,
        channelId: CH,
        method: String(b.method),
        path,
        body: b.body,
        viewer,
        idempotencyKey: typeof b.key === 'string' ? b.key : null,
        moderator: null,
      });
      return json(
        res,
        out?.status ?? 404,
        out?.body ?? { ok: false, error: 'not_available' },
      );
    }
    if (p === '/api/admin') {
      const s = await casino.adminState(CH);
      return json(res, 200, {
        ...s,
        open: (await core.moduleSettings.get(db, CH, 'casino.open')) === 1,
      });
    }
    if (p === '/api/live') {
      await setLive(!(await casino.live(db, CH)));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/open') {
      const open = (await core.moduleSettings.get(db, CH, 'casino.open')) === 1;
      await core.moduleSettings.set(CH, 'casino.open', open ? 0 : 1, 'demo');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/maxwin') {
      const b = await body(req);
      await core.moduleSettings
        .set(CH, 'casino.max_win', Number(b.value), 'demo')
        .catch(() => {});
      return json(res, 200, { ok: true });
    }
    if (p === '/api/balance') {
      const b = await body(req);
      await editWallet(
        db,
        systemClock.now(),
        CH,
        VIEWERS.alice!.id,
        'set',
        { tokens: Number(b.tokens) },
        'demo',
      );
      return json(res, 200, { ok: true });
    }
    if (p === '/api/luna') {
      // Another viewer plays, through the same Core calls as a real player's screen: her open game (presence), the
      // spin, then each stage once her animation would have shown it (the spectators get them then, never before).
      const b = await body(req);
      const luna = VIEWERS.luna!;
      const v = { id: luna.id, display_name: luna.display_name };
      const game = b.game === 'roulette' ? 'roulette' : 'slot';
      await casino.presence(CH, v, game);
      const out =
        game === 'roulette'
          ? await casino.spinRoulette(CH, v, {
              key: `luna-${Date.now()}-${++n}`,
              bets: { red: 2000, n17: 200, d3: 400 },
            })
          : await casino.spinSlot(CH, v, {
              key: `luna-${Date.now()}-${++n}`,
              bet: 500,
            });
      forced = [];
      forcedSeed = null;
      const id = out.round.round_id;
      const coffre = (
        out.round.outcome as { coffre?: { steps: unknown[] } | null }
      ).coffre;
      const stage = (st: string, step: number | null = null) =>
        void casino
          .progress(CH, v, {
            round_id: id,
            stage: st,
            ...(step === null ? {} : { step }),
          })
          .catch(() => {});
      setTimeout(
        () => {
          stage('result');
          if (!coffre) return;
          let i = -1;
          const next = () => {
            if (i < 0) stage('coffre');
            else if (i < coffre.steps.length) stage('step', i);
            else return stage('end');
            i++;
            setTimeout(next, 2500);
          };
          setTimeout(next, 2500);
        },
        game === 'roulette' ? 7000 : 2600,
      );
      return json(res, 200, { ok: true, round: id });
    }
    if (p === '/api/force') {
      const b = await body(req);
      if (b.game === 'roulette') {
        forced = [ORDER.indexOf(Number(b.number))];
        forcedSeed = null;
      } else forceCoffre(Number(b.bonus ?? 3), b.grand === true);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/chat') {
      const rows = await db.query<{ params: { text: string } }>(
        `select params from cmd_steps where origin = 'module:casino' order by created_at desc limit 12`,
      );
      return json(
        res,
        200,
        rows.map((r) => r.params.text),
      );
    }
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    const err = e as { status?: number; message: string };
    if (typeof err.status === 'number')
      return json(res, err.status, { ok: false, error: err.message });
    console.error(e);
    json(res, 500, { error: (e as Error).message });
  }
}).listen(PORT, '127.0.0.1', () =>
  console.log(
    `[casino-demo] http://127.0.0.1:${PORT} — tout est local et fictif (Ctrl+C pour arrêter)`,
  ),
);
