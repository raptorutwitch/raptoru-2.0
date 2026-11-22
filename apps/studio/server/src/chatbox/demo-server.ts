import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createChatboxHost } from './host.js';

// Chatbox Raptoru — the demonstration WITHOUT closing the installed Studio (docs/CHATBOX.md § 10): the chatbox module
// alone on its own port, its demonstration page and Studio's Chatbox screen (the built Studio web; the other screens
// have no server here). Its own data folder (.lab-data/chatbox-demo), the simulator's feed only: nothing reaches OBS,
// StreamElements, Twitch or the Production. Run: `npm run chatbox:demo` (builds the Studio web first).

const PORT = Number(process.env.CHATBOX_DEMO_PORT ?? 4486);
const HOST = '127.0.0.1';
const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const WEB = join(ROOT, 'apps', 'studio', 'web', 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const sameHost = (req: IncomingMessage) =>
  req.headers.host === `${HOST}:${PORT}` ||
  req.headers.host === `localhost:${PORT}`;

const host = await createChatboxHost({
  dir: join(ROOT, '.lab-data', 'chatbox-demo'),
  playerDir: join(ROOT, 'apps', 'studio', 'server', 'chatbox-player'),
  origin: `http://${HOST}:${PORT}`,
  channelId: '83603689',
  guard: (req) =>
    !sameHost(req)
      ? 'forbidden_host'
      : req.headers['x-raptoru-studio'] !== '1'
        ? 'missing_studio_header'
        : null,
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  if (await host.handle(req, res, url)) return;
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not_in_chatbox_demo"}');
    return;
  }
  const rel = normalize(
    url.pathname === '/' ? 'index.html' : url.pathname.slice(1),
  );
  if (rel.startsWith('..')) {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    const body = await readFile(join(WEB, rel));
    res.writeHead(200, {
      'content-type': TYPES[extname(rel)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT, HOST, () => {
  console.log(
    `Chatbox — démonstration : http://${HOST}:${PORT}/chatbox/demo.html#${host.view().demo.token}`,
  );
  console.log(`Chatbox — écran Studio : http://${HOST}:${PORT}/?p=chatbox`);
  console.log(
    'Simulateur seulement : rien n’est envoyé à OBS, à StreamElements ni à Twitch. Ctrl+C pour arrêter.',
  );
});
