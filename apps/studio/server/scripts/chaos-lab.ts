// npm run chaos:lab — banc de test du moteur Chaos, indépendant de toute instance de Studio (Production ou Lab) :
// son propre port (4120), son propre dossier de réglages (%LOCALAPPDATA%\Raptoru\Chaos\lab), aucun Core, aucun bot,
// aucun OBS, aucun Jeton. Il sert la page Studio › Chaos (le même module) et la même API locale (ChaosRuntime).
// Options : --no-open (ne pas ouvrir le navigateur), --port <n>. Isolement (un second Lab d'essai pendant qu'Antoni
// garde le sien) : CHAOS_ENGINE_EXE, CHAOS_LAB_STATE (réglages), CHAOS_LAB_DIST (page construite), CHAOS_LAB_PORT.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ChaosRuntime } from '../src/chaos/runtime.js';

const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(
  portArg >= 0 ? args[portArg + 1] : (process.env.CHAOS_LAB_PORT ?? 4120),
);
const EXE =
  process.env.CHAOS_ENGINE_EXE ??
  join(ROOT, 'apps', 'chaos-engine', 'bin', 'ChaosEngine.exe');
const STATE =
  process.env.CHAOS_LAB_STATE ??
  join(process.env.LOCALAPPDATA ?? tmpdir(), 'Raptoru', 'Chaos', 'lab');
const WEB = join(ROOT, 'apps', 'studio', 'web');
// resolve : chemin absolu au format de Windows (le contrôle « fichier dans DIST » compare des chaînes).
const DIST = resolve(
  process.env.CHAOS_LAB_DIST ?? join(WEB, 'dist', 'chaos-lab'),
);

const step = (what: string, cmd: string, a: string[]) => {
  console.log(`· ${what}`);
  const r = spawnSync(cmd, a, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`Échec : ${what}`);
    process.exit(1);
  }
};
if (!existsSync(EXE))
  step('construction du moteur (apps/chaos-engine/build.cmd)', 'cmd.exe', [
    '/c',
    join(ROOT, 'apps', 'chaos-engine', 'build.cmd'),
  ]);
step('construction de la page Chaos', process.execPath, [
  join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
  'build',
  '--config',
  join(WEB, 'chaos-lab.vite.config.mjs'),
  '--outDir',
  DIST,
  '--emptyOutDir',
]);

const rt = new ChaosRuntime({
  exe: EXE,
  stateDir: STATE,
  log: (l) => console.log(l),
});
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  // Même protection que Studio contre les pages d'un autre site (DNS rebinding) : hôte local exact.
  if (
    req.headers.host !== `127.0.0.1:${PORT}` &&
    req.headers.host !== `localhost:${PORT}`
  ) {
    res.writeHead(403).end();
    return;
  }
  void (async () => {
    if (await rt.handle(req, res, url)) return;
    const rel =
      url.pathname === '/'
        ? 'chaos-lab.html'
        : normalize(url.pathname).replace(/^[\\/]+/, '');
    const file = join(DIST, rel);
    if (!file.startsWith(DIST)) return void res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  })();
});
server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(
    e.code === 'EADDRINUSE'
      ? `Port ${PORT} occupé : un Chaos Lab tourne déjà ?`
      : e.message,
  );
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Chaos Lab : ${url}  (réglages : ${STATE})`);
  console.log(
    'Arrêt d’urgence d’un effet : Ctrl+Maj+F11 · arrêter le banc : Ctrl+C',
  );
  if (!args.includes('--no-open') && process.platform === 'win32')
    spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
    }).unref();
});
const quit = () => void rt.stop().finally(() => process.exit(0));
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
