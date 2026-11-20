// Blackjack (prototype local) — UNE commande : sert le prototype et ouvre le navigateur.
//   node start.mjs            → http://127.0.0.1:4530/
//   node start.mjs --no-open  (ne pas ouvrir le navigateur) · PORT=4600 node start.mjs
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 4530);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

export function serve(port = PORT) {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([\/])+/, '');
      const file = join(ROOT, rel);
      if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404).end('introuvable');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      createReadStream(file).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => ok(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await serve();
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Blackjack (prototype) : ${url}   (Ctrl+C pour arrêter)`);
  if (!process.argv.includes('--no-open')) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
}
