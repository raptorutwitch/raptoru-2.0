// Votekick V2 — local preview (docs/VOTEKICK_V2.md § Aperçu): serves this folder on 127.0.0.1 (a free port) so the
// comparison page can drive the legacy and the V2 overlays with the same events (same origin). Read-only, local,
// never OBS: `node apps/studio/server/votekick-overlay/preview-server.mjs` then open the printed URL.
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.shader': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(root, path === '/' ? 'preview.html' : path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res
      .writeHead(200, {
        'content-type': types[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      .end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`Votekick preview: http://127.0.0.1:${port}/`);
});
