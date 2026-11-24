// Banc mobile Twitch (docs/extension/BANC_MOBILE_TWITCH.md) : l'extension servie depuis ce PC à la VRAIE application
// Twitch d'un téléphone (version « Local Test » de la console), sans ZIP et sans toucher à la Production.
//   node scripts/mobile-lab.mjs            démarre tout (base, Core Lab, serveur, tunnel) ; Ctrl+C arrête tout
//   node scripts/mobile-lab.mjs --reset    idem, après avoir remis la base du banc à zéro (Jetons fictifs d'origine)
//   node scripts/mobile-lab.mjs --no-tunnel   sans tunnel (adresse publique fournie autrement, ou essai sur le PC)
//   node scripts/mobile-lab.mjs --root <dossier>   sert un ZIP extrait au lieu des sources (mêmes octets que le paquet)
//   node scripts/mobile-lab.mjs stop       arrête ce qu'un lancement interrompu aurait laissé (Core, tunnel, base)
// Isolement : le Core tourne en mode Lab (CORE_ENVIRONMENT=lab : chaîne fictive 900100, base locale, aucun accès
// Twitch ; ses propres gardes refusent de démarrer sinon), sur une base PostgreSQL dédiée (conteneur Docker
// raptoru-mobile-lab-pg). Le jeton Twitch que l'application donne à l'extension est lu (rôle, chaîne, identité),
// puis remplacé par celui du compte fictif correspondant : aucune donnée réelle n'entre, aucun Jeton réel ne bouge.
// Le diagnostic (shared/diagnostic.js) est actif et son journal arrive EN DIRECT dans ce terminal (relais injecté).
import http from 'node:http';
import { Buffer } from 'node:buffer';
import { clearTimeout, setTimeout } from 'node:timers';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const { fetch } = globalThis;

const EXT_APP = dirname(dirname(fileURLToPath(import.meta.url))); // apps/twitch-extension
const CORE_APP = join(EXT_APP, '..', 'core-api');
const STATE = join(process.env.LOCALAPPDATA || homedir(), 'raptoru-mobile-lab');
const PORT = 4530; // jamais 4100/4110/3789 (Studio installé)
const CORE_PORT = 4531;
const PG = {
  container: 'raptoru-mobile-lab-pg',
  port: 55640,
  db: 'raptoru_mobile_lab',
};
const LAB = {
  channel: '900100',
  broadcaster: '900100',
  moderator: '900102',
  viewer: '900101',
};
export const API_PREFIX = '/ext-lab/api'; // la seule base relative admise par shared/runtime-guard.js
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

/** La configuration d'exécution servie à la place de shared/runtime-config.js : diagnostic actif, badge visible. */
export function benchRuntimeConfig(buildId) {
  return `// Banc mobile Twitch (scripts/mobile-lab.mjs) : Core Lab de ce PC, Jetons fictifs. Jamais emballé.
export const RUNTIME = Object.freeze({
  mode: 'connected',
  environment: 'banc-mobile',
  apiBase: '${API_PREFIX}',
  siteUrl: '',
  buildId: ${JSON.stringify(buildId)},
  shell: 'v2',
  diagnostics: true,
});
`;
}

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** Lit (sans le vérifier : le secret de l'extension réelle ne quitte pas la console Twitch) le jeton de l'application. */
export function readTwitchToken(authorization) {
  const m = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]*)$/.exec(authorization ?? '');
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[2], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Le jeton du compte fictif du Lab qui a le même rôle et la même identité (partagée ou non) que le vrai. */
export function labTokenFor(
  real,
  secret,
  nowS = Math.floor(Date.now() / 1000),
) {
  const role = ['broadcaster', 'moderator'].includes(real?.role)
    ? real.role
    : 'viewer';
  const id = LAB[role];
  const shared = role !== 'viewer' || !!real?.user_id;
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    exp: nowS + 3600,
    opaque_user_id: shared
      ? `U${id}`
      : `A${String(real?.opaque_user_id ?? 'anonyme')
          .replace(/\W/g, '')
          .slice(-20)}`,
    ...(shared ? { user_id: id } : {}),
    channel_id: LAB.channel,
    role,
    is_unlinked: !shared,
    pubsub_perms: { listen: ['broadcast', 'global'], send: [] },
  })}`;
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`;
}

// Injecté dans chaque page HTML servie : envoie au PC le journal du diagnostic (le même module que l'extension : même
// URL, même instance), un rapport complet après 5 s, 15 s et à chaque alerte, et les erreurs d'avant son démarrage.
const RELAY = `import { __diag } from '/shared/diagnostic.js';
const page = location.pathname + location.search.replace(/[?&](token|jwt)=[^&]*/g, '');
const id = Math.random().toString(36).slice(2, 8);
const sent = new WeakSet();
const post = (kind, body) => fetch('/__banc/' + kind, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, page, ...body }) }).catch(() => {});
post('journal', { entries: [{ t: 0, kind: 'banc', text: 'page chargée · ' + navigator.userAgent }] });
addEventListener('error', (e) => post('journal', { entries: [{ t: Math.round(performance.now()), kind: 'banc-erreur', text: (e.message || (e.target && (e.target.src || e.target.href)) || '?') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '') }] }), true);
addEventListener('unhandledrejection', (e) => post('journal', { entries: [{ t: Math.round(performance.now()), kind: 'banc-promesse', text: String(e.reason && (e.reason.stack || e.reason.message) || e.reason) }] }));
let alerts = 0;
const report = () => { try { post('rapport', { text: __diag.report(window) }); } catch (e) { post('journal', { entries: [{ t: 0, kind: 'banc-erreur', text: 'rapport : ' + e }] }); } };
setInterval(() => {
  const fresh = __diag.journal.filter((e) => !sent.has(e));
  if (!fresh.length) return;
  fresh.forEach((e) => sent.add(e));
  post('journal', { entries: fresh });
  const a = fresh.filter((e) => ['erreur', 'promesse', 'ressource', 'alerte'].includes(e.kind)).length;
  if (a) { alerts += a; setTimeout(report, 1500); }
}, 1000);
setTimeout(report, 5000);
setTimeout(report, 15000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && report());
`;

const stamp = () => new Date().toLocaleTimeString('fr-FR');
const logFile = () =>
  join(STATE, `journal-${new Date().toISOString().slice(0, 10)}.log`);
function log(line) {
  const text = `${stamp()} ${line}`;
  console.log(text);
  try {
    appendFileSync(logFile(), `${text}\n`);
  } catch {
    // sans conséquence : réessayé ou affiché ailleurs
  }
}

function body(req, limit = 256 * 1024) {
  return new Promise((ok, ko) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) =>
      (size += c.length) > limit
        ? (ko(new Error('trop gros')), req.destroy())
        : chunks.push(c),
    );
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', ko);
  });
}

/** Le serveur du banc : fichiers de l'extension, relais vers le Core Lab, réception du diagnostic du téléphone. */
export function createBenchServer({ root, buildId, coreUrl, secret }) {
  const ext = join(root, 'extension');
  const seen = new Set();
  return http.createServer(async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url, 'http://banc');
    const ua =
      /Android|iPhone|iPad/.exec(req.headers['user-agent'] ?? '')?.[0] ?? 'PC';
    const done = (status, type, data, extra = {}) => {
      res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        ...extra,
      });
      res.end(data);
      if (!url.pathname.startsWith('/__banc/'))
        log(
          `${status >= 400 ? '!!' : '  '} ${req.method} ${url.pathname} ${status} ${Date.now() - t0} ms · ${ua}`,
        );
    };
    try {
      if (req.method === 'OPTIONS')
        return done(204, 'text/plain', '', {
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE',
          'access-control-allow-headers':
            'authorization,content-type,idempotency-key,x-request-id',
        });
      if (url.pathname.startsWith('/__banc/') && req.method === 'POST') {
        const msg = JSON.parse((await body(req)).toString('utf8') || '{}');
        const who = `[${ua} ${msg.id ?? '?'} ${String(msg.page ?? '').slice(0, 40)}]`;
        if (url.pathname === '/__banc/journal')
          for (const e of msg.entries ?? [])
            log(
              `📱 ${who} ${String(e.t).padStart(6)} ms · ${e.kind} · ${e.text}`,
            );
        else if (url.pathname === '/__banc/rapport') {
          const file = join(
            STATE,
            `rapport-${new Date().toISOString().replace(/[:.]/g, '-')}-${msg.id ?? 'x'}.txt`,
          );
          writeFileSync(file, String(msg.text ?? ''));
          log(`📋 ${who} rapport du panneau Diag → ${file}`);
        }
        res.writeHead(204, { 'access-control-allow-origin': '*' });
        return res.end();
      }
      if (url.pathname.startsWith(`${API_PREFIX}/`)) {
        const real = readTwitchToken(req.headers.authorization);
        const key = real
          ? `${real.channel_id}|${real.role}|${real.user_id ? 'id' : 'anon'}`
          : 'sans jeton';
        if (!seen.has(key)) {
          seen.add(key);
          log(
            real
              ? `🔑 jeton Twitch reçu : chaîne ${real.channel_id} · rôle ${real.role} · identité ${real.user_id ? 'partagée' : 'non partagée'} → compte fictif ${LAB[['broadcaster', 'moderator'].includes(real.role) ? real.role : 'viewer']}`
              : '🔑 requête sans jeton Twitch (helper absent ou pas encore autorisé)',
          );
        }
        const headers = { ...req.headers, host: new URL(coreUrl).host };
        if (real) headers.authorization = `Bearer ${labTokenFor(real, secret)}`;
        const payload = ['GET', 'HEAD'].includes(req.method)
          ? undefined
          : await body(req);
        const r = await fetch(
          `${coreUrl}/v1/ext${url.pathname.slice(API_PREFIX.length)}${url.search}`,
          {
            method: req.method,
            headers: Object.fromEntries(
              Object.entries(headers).filter(
                ([k]) =>
                  ![
                    'content-length',
                    'connection',
                    'origin',
                    'referer',
                  ].includes(k),
              ),
            ),
            body: payload,
          },
        );
        const data = Buffer.from(await r.arrayBuffer());
        return done(
          r.status,
          r.headers.get('content-type') ?? 'application/json',
          data,
        );
      }
      if (url.pathname === '/__banc/relais.js')
        return done(200, TYPES['.js'], RELAY);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/mobile.html';
      const file = normalize(join(ext, rel));
      if (!file.startsWith(ext)) return done(403, 'text/plain', 'refusé');
      if (rel === '/shared/runtime-config.js')
        return done(200, TYPES['.js'], benchRuntimeConfig(buildId));
      let data = await readFile(file);
      if (extname(file) === '.html')
        data = data
          .toString('utf8')
          .replace(
            '</head>',
            '  <script type="module" src="/__banc/relais.js"></script>\n</head>',
          );
      return done(
        200,
        TYPES[extname(file)] ?? 'application/octet-stream',
        data,
      );
    } catch (e) {
      return done(
        e?.code === 'ENOENT' ? 404 : 502,
        'text/plain',
        e?.code === 'ENOENT' ? 'absent' : `banc : ${e?.message ?? e}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------------------------- lancement / arrêt

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return {
    ok: r.status === 0,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
  };
}

function secrets() {
  const file = join(STATE, 'secrets.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const s = {
    pg: randomBytes(18).toString('hex'),
    bot: randomBytes(24).toString('hex'),
    studio: randomBytes(24).toString('hex'),
    ext: randomBytes(32).toString('base64'),
  };
  writeFileSync(file, JSON.stringify(s));
  return s;
}

function startDatabase(s) {
  const exists = run('docker', [
    'ps',
    '-a',
    '--filter',
    `name=^${PG.container}$`,
    '--format',
    '{{.Names}}',
  ]);
  if (!exists.ok)
    throw new Error(
      `Docker ne répond pas (Docker Desktop lancé ?) : ${exists.out}`,
    );
  if (!exists.out)
    run('docker', [
      'run',
      '-d',
      '--name',
      PG.container,
      '-e',
      `POSTGRES_PASSWORD=${s.pg}`,
      '-p',
      `127.0.0.1:${PG.port}:5432`,
      'postgres:17-alpine',
    ]);
  else run('docker', ['start', PG.container]);
  for (let i = 0; i < 60; i++) {
    if (
      run('docker', ['exec', PG.container, 'pg_isready', '-U', 'postgres']).ok
    )
      return;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']);
  }
  throw new Error('la base du banc ne répond pas');
}

function coreEnv(s) {
  const env = { ...process.env };
  // Rien de réel ne doit atteindre le Core du banc (ses gardes Lab le refuseraient de toute façon).
  for (const k of Object.keys(env))
    if (
      /^(TWITCH_|DATABASE_|OPS_|EXT_|BOT_|STUDIO_|CORE_|ECONOMY_|CASINO_)/.test(
        k,
      )
    )
      delete env[k];
  return Object.assign(env, {
    CORE_ENVIRONMENT: 'lab',
    PORT: String(CORE_PORT),
    DATABASE_URL: `postgres://postgres:${s.pg}@127.0.0.1:${PG.port}/${PG.db}`,
    TWITCH_CHANNEL_ID: LAB.channel,
    TWITCH_CHANNEL_LOGIN: 'raptoru_lab',
    TWITCH_EXTENSION_SECRET: s.ext,
    BOT_SECRET: s.bot,
    STUDIO_SECRET: s.studio,
    ECONOMY_MODE: 'lab',
    CASINO_EXTENSION: 'on',
  });
}

const tsx = () =>
  join(EXT_APP, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

function prepareCore(env, reset) {
  // Le Core importe @raptoru/schemas compilé (dist/) : recompilé à chaque lancement, sinon il peut dater d'une autre branche.
  const repo = join(EXT_APP, '..', '..');
  const tsc = run(process.execPath, [
    join(repo, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    join(repo, 'packages', 'schemas', 'tsconfig.json'),
  ]);
  if (!tsc.ok) throw new Error(`compilation de @raptoru/schemas : ${tsc.out}`);
  if (reset) {
    const r = run(process.execPath, [tsx(), 'src/scripts/lab-reset.ts'], {
      cwd: CORE_APP,
      env,
      shell: false,
    });
    if (!r.ok) throw new Error(`remise à zéro refusée : ${r.out}`);
  }
  const r = run(process.execPath, [tsx(), 'src/scripts/lab-prepare.ts'], {
    cwd: CORE_APP,
    env,
    shell: false,
  });
  if (!r.ok) throw new Error(`préparation du Core Lab refusée : ${r.out}`);
  log(r.out.split('\n').pop());
  // Le Casino ouvert et le live simulé du Lab (ce que Studio › Simulation ferait), à chaque lancement.
  const sql = `
    insert into module_settings (channel_id, key, value, updated_at, updated_by) values
      ('${LAB.channel}', 'casino.open', 1, now(), 'banc-mobile'), ('${LAB.channel}', 'random_ban_ext.enabled', 1, now(), 'banc-mobile')
      on conflict (channel_id, key) do update set value = excluded.value, updated_at = now(), updated_by = 'banc-mobile';
    insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
      select gen_random_uuid(), '${LAB.channel}', now(), 'simulated', 'banc-mobile'
      where not exists (select 1 from lab_stream_sessions where channel_id = '${LAB.channel}' and ended_at is null);`;
  const q = run(
    'docker',
    [
      'exec',
      '-i',
      PG.container,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      PG.db,
    ],
    { input: sql, shell: false },
  );
  if (!q.ok) throw new Error(`ouverture du Casino du banc : ${q.out}`);
}

async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // sans conséquence : réessayé ou affiché ailleurs
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function findCloudflared() {
  const candidates = [
    process.env.CLOUDFLARED,
    join(EXT_APP, '..', '..', '..', '_outils', 'cloudflared.exe'),
    'C:/Program Files (x86)/cloudflared/cloudflared.exe',
    'C:/Program Files/cloudflared/cloudflared.exe',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return run('cloudflared', ['--version']).ok ? 'cloudflared' : null;
}

function startTunnel(children) {
  const bin = findCloudflared();
  if (!bin) {
    log(
      '⚠ tunnel absent : installez cloudflared une fois (voir la procédure), puis relancez. Le banc reste joignable sur ce PC.',
    );
    return Promise.resolve(null);
  }
  const p = spawn(
    bin,
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.push(p);
  return new Promise((ok) => {
    const timer = setTimeout(() => ok(null), 45000);
    const scan = (chunk) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(
        chunk.toString(),
      );
      if (!m) return;
      clearTimeout(timer);
      ok(`${m[0]}/`);
    };
    p.stdout.on('data', scan);
    p.stderr.on('data', scan);
    p.on('exit', () => ok(null));
  });
}

function gitBuildId() {
  const sha =
    run('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: EXT_APP }).out ||
    'inconnu';
  const dirty = run('git', ['status', '--porcelain', '--', 'extension'], {
    cwd: EXT_APP,
  }).out
    ? '-modifié'
    : '';
  return `banc-mobile-${sha}${dirty}`;
}

function stopAll() {
  const pids = join(STATE, 'pids.json');
  if (existsSync(pids)) {
    for (const pid of JSON.parse(readFileSync(pids, 'utf8')))
      if (pid !== process.pid)
        run('taskkill', ['/PID', String(pid), '/T', '/F']);
    rmSync(pids, { force: true });
  }
  run('docker', ['stop', PG.container]);
}

async function main() {
  const args = process.argv.slice(2);
  mkdirSync(STATE, { recursive: true });
  if (args[0] === 'stop') {
    stopAll();
    return console.log(
      'Banc mobile arrêté (la base est conservée ; --reset la remet à zéro au prochain lancement).',
    );
  }
  const rootArg = args.indexOf('--root');
  const root = rootArg >= 0 ? resolve(args[rootArg + 1]) : EXT_APP;
  if (!existsSync(join(root, 'extension', 'mobile.html')))
    throw new Error(`${root}\\extension\\mobile.html introuvable`);
  stopAll(); // un lancement précédent interrompu
  const s = secrets();
  log('1/4 base PostgreSQL du banc (Docker, données fictives)…');
  startDatabase(s);
  const env = coreEnv(s);
  log(
    `2/4 Core en mode Lab${args.includes('--reset') ? ' (remise à zéro)' : ''}…`,
  );
  prepareCore(env, args.includes('--reset'));
  const children = [];
  const core = spawn(process.execPath, [tsx(), 'src/index.ts'], {
    cwd: CORE_APP,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(core);
  const coreLog = join(STATE, 'core.log');
  core.stdout.on('data', (c) => appendFileSync(coreLog, c));
  core.stderr.on('data', (c) => appendFileSync(coreLog, c));
  if (!(await waitFor(`http://127.0.0.1:${CORE_PORT}/health`)))
    throw new Error(`le Core Lab ne démarre pas : voir ${coreLog}`);
  const buildId = gitBuildId();
  log(
    `3/4 serveur du banc sur http://127.0.0.1:${PORT}/ (build ${buildId}, sources ${root})`,
  );
  const server = createBenchServer({
    root,
    buildId,
    coreUrl: `http://127.0.0.1:${CORE_PORT}`,
    secret: Buffer.from(s.ext, 'base64'),
  });
  await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));
  const tunnel = args.includes('--no-tunnel')
    ? null
    : (log('4/4 tunnel HTTPS…'), await startTunnel(children));
  writeFileSync(
    join(STATE, 'pids.json'),
    JSON.stringify([process.pid, ...children.map((c) => c.pid)]),
  );
  if (tunnel) {
    writeFileSync(join(STATE, 'adresse.txt'), tunnel);
    log(
      (await waitFor(`${tunnel}mobile.html`, 40000))
        ? `tunnel vérifié : ${tunnel}mobile.html répond depuis Internet`
        : `⚠ ${tunnel} ne répond pas encore (DNS) : réessayez dans une minute`,
    );
  }
  console.log(`
════════════════════════════════════════════════════════════════════════
 BANC MOBILE PRÊT${tunnel ? '' : ' (sans tunnel)'}
 Testing Base URI à coller dans la console Twitch (version Local Test) :
     ${tunnel ?? '(aucune : tunnel absent)'}
 Chemin mobile : mobile.html
 Sur le téléphone : fermez complètement l'application Twitch, rouvrez-la, chaîne de test, icône des extensions.
 Le badge « BANC-MOBILE · test » prouve que c'est cette version. Le journal du téléphone s'affiche ci-dessous.
 Journal : ${logFile()} · rapports Diag : ${STATE}
 Modifier un fichier de extension/ puis rouvrir l'extension suffit (pas de ZIP). Ctrl+C arrête tout.
════════════════════════════════════════════════════════════════════════`);
  const stop = () => {
    log('arrêt du banc…');
    server.close();
    for (const c of children)
      run('taskkill', ['/PID', String(c.pid), '/T', '/F']);
    rmSync(join(STATE, 'pids.json'), { force: true });
    run('docker', ['stop', PG.container]);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop); // fenêtre fermée
  core.on('exit', (code) =>
    log(`⚠ le Core Lab s'est arrêté (code ${code}) : voir ${coreLog}`),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(`Banc mobile : ${e?.message ?? e}`);
    process.exit(1);
  });
