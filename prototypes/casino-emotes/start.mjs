// Machine n°2 (prototype local) — UNE commande : prépare les émotes, sert le prototype, ouvre le navigateur.
//   node start.mjs            → http://127.0.0.1:4520/
//   node start.mjs --no-open  (ne pas ouvrir le navigateur) · PORT=4600 node start.mjs
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from './tools/prepare-emotes.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 4520);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };

console.log('Émotes…');
await prepare();
createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([\\/])+/, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('introuvable');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Machine n°2 (prototype) : ${url}   (Ctrl+C pour arrêter)`);
  if (!process.argv.includes('--no-open')) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
});
