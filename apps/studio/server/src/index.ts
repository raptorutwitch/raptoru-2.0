import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, normalize } from 'node:path';
import { REPO_ROOT } from './test-lab/local-env.js';
import { createTestLab, type TestLab } from './test-lab/test-lab.js';

const port = Number(process.env.PORT ?? 4100);
// Studio is local-only: bind to loopback, never to a public interface.
const host = '127.0.0.1';
const webDir = join(REPO_ROOT, 'apps', 'studio', 'web', 'dist');
/** Custom header: a cross-site page cannot send it without a CORS preflight, which is never granted. */
export const STUDIO_HEADER = 'x-raptoru-studio';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function serveStatic(pathname: string, res: ServerResponse) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(
    /^([/\\])+/,
    '',
  );
  if (rel.startsWith('..')) return send(res, 404, { error: 'not_found' });
  try {
    const body = await readFile(join(webDir, rel));
    res.writeHead(200, {
      'content-type': MIME[extname(rel)] ?? 'application/octet-stream',
      'content-security-policy':
        "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
      'x-frame-options': 'DENY',
    });
    res.end(body);
  } catch {
    send(res, 404, {
      error: 'not_found',
      hint: 'build the web UI: npm run build -w @raptoru/studio-web',
    });
  }
}

type Action = (lab: TestLab) => Promise<unknown>;

const actions: Record<string, Action> = {
  'postgres/start': (lab) => lab.startPostgres(),
  'postgres/stop': (lab) => lab.stopPostgres(),
  'core/start': (lab) => lab.startCore(),
  'core/stop': (lab) => lab.stopCore(),
  'core/restart': (lab) => lab.restartCore(),
  'bot/start': (lab) => lab.startBot(),
  'bot/stop': (lab) => lab.stopBot(),
  'bot/restart': (lab) => lab.restartBot(),
  preflight: (lab) => lab.runPreflight(),
  'start-all': (lab) => lab.startAll(),
  'stop-all': (lab) => lab.stopAll(),
  'logs/clear': async (lab) => lab.logs.clear(),
};

export function createStudioServer(lab: TestLab, onShutdown: () => void) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { service: 'studio-server', status: 'ok' });
      }
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET')
          return send(res, 405, { error: 'method_not_allowed' });
        return await serveStatic(url.pathname, res);
      }
      // API: same-host only (DNS rebinding) and custom header (cross-site requests).
      if (
        req.headers.host !== `${host}:${port}` &&
        req.headers.host !== `localhost:${port}`
      ) {
        return send(res, 403, { error: 'forbidden_host' });
      }
      if (req.headers[STUDIO_HEADER] !== '1')
        return send(res, 403, { error: 'missing_studio_header' });

      if (req.method === 'GET' && url.pathname === '/api/test-lab/status')
        return send(res, 200, await lab.status());
      if (req.method === 'GET' && url.pathname === '/api/test-lab/logs') {
        return send(
          res,
          200,
          lab.logs.since(Number(url.searchParams.get('since') ?? 0)),
        );
      }
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        send(res, 200, { ok: true });
        onShutdown();
        return;
      }
      const action =
        req.method === 'POST'
          ? actions[url.pathname.replace('/api/test-lab/', '')]
          : undefined;
      if (!action) return send(res, 404, { error: 'not_found' });
      return send(res, 200, { ok: true, result: await action(lab) });
    } catch (error) {
      const message = lab.deps.redact((error as Error).message);
      lab.logs.add('studio', message, 'error');
      return send(res, /^busy:/.test(message) ? 409 : 500, {
        ok: false,
        error: message,
      });
    }
  });
}

if (process.env.STUDIO_SERVER_NO_LISTEN !== '1') {
  const lab = createTestLab();
  for (const service of [lab.deps.core, lab.deps.bot]) {
    if (await service.adoptPrevious())
      lab.logs.add(
        'studio',
        `found ${service.name} (pid ${service.pid}) left running by a previous Studio session`,
      );
  }
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    lab.logs.add(
      'studio',
      'Studio closing: stopping bot and Core (Postgres keeps running)',
    );
    void lab.shutdown().finally(() => process.exit(0));
  };
  createStudioServer(lab, shutdown).listen(port, host, () => {
    console.log(`[studio-server] Test Lab on http://${host}:${port}`);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
