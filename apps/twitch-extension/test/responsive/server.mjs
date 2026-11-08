// Read-only static server of the responsive bench (never writes a file of the repo).
//   /calib/* -> extension/ with the calibration runtime-config (local fixtures, moderator, no network)
//   /demo/*  -> extension/ with mode 'demo' (shared/demo-data.js, ?demoScenario=...)
//   /calib-v2/*, /demo-v2/* (or -legacy) -> same, with RUNTIME.shell = 'v2' (or 'legacy')
//   calib and demo allow the Lab-only modules (RUNTIME.labModules; a page adds ?labModules=1 to load them)
//   /live/*  -> extension/ in 'test' mode (real connected client) against core.bench.invalid (never resolves):
//              no helper -> grey-screen guard (F6); requests.mjs intercepts that host with a fake Core (F2)
// The Twitch helper <script> is stripped from the HTML on the fly (no network to Twitch).
// Never use ports 4100/4110/3789 (installed Studio). Default 4471.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

// BENCH_ROOT: another copy of apps/twitch-extension (e.g. a frozen V1 for reference captures).
const ROOT = process.env.BENCH_ROOT || dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const EXT = join(ROOT, 'extension');
const CAL = join(ROOT, 'calibration');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2',
  '.wav': 'audio/wav', '.webm': 'video/webm', '.mp4': 'video/mp4',
};

const runtime = (variant, shell) => {
  const shellField = shell ? `, shell: ${JSON.stringify(shell)}` : '';
  if (variant === 'live')
    return `export const RUNTIME = Object.freeze({ mode: 'test', apiBase: 'https://core.bench.invalid/v1/ext', siteUrl: '', buildId: 'bench-live'${shellField} });
`;
  return variant === 'calib'
    ? `import { calibrationCall } from '../calibration/adapter.js';
export const RUNTIME = Object.freeze({ mode: 'demo', environment: 'calibration', apiBase: '', siteUrl: '', buildId: 'bench'${shellField}, labModules: true, fixtureCall: calibrationCall });\n`
    : `export const RUNTIME = Object.freeze({ mode: 'demo', apiBase: '', siteUrl: '', buildId: 'bench'${shellField}, labModules: true });\n`;
};

export function startServer(port = Number(process.env.PORT || 4471)) {
  if ([4100, 4110, 3789].includes(port)) throw new Error(`port ${port} is reserved for the installed Studio`);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const m = /^\/(calib|demo|live)(?:-(legacy|v2))?(\/.*)$/.exec(decodeURIComponent(url.pathname));
      if (!m) { res.writeHead(404); return res.end(); }
      const [, variant, shell, rel] = m;
      // The bench's fake Core (live variant) is allowed here only; the shipped list is unchanged.
      if (rel === '/shared/runtime-guard.js' && variant === 'live') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        return res.end(`export const ALLOWED_API_BASES = Object.freeze(['https://core.bench.invalid/v1/ext']);
export const isAllowedApiBase = (b) => ALLOWED_API_BASES.includes(b);
`);
      }
      if (rel === '/shared/runtime-config.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        return res.end(runtime(variant, shell || null));
      }
      const base = rel.startsWith('/calibration/') ? CAL : EXT;
      const file = normalize(join(base, rel.replace(/^\/calibration\//, '/')));
      if (!file.startsWith(normalize(base))) { res.writeHead(403); return res.end(); }
      let body = await readFile(file);
      const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
      if (type === 'text/html')
        body = body.toString('utf8').replace(/<script src="https:\/\/extension-files\.twitch\.tv[^"]*"><\/script>/, '');
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && normalize(fileURLToPath(import.meta.url)) === normalize(process.argv[1])) {
  const s = await startServer();
  console.log(`responsive bench server on http://127.0.0.1:${s.address().port}/calib/video_component.html`);
}
