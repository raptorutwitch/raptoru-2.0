import { BonkRuntime } from './bonk-lab/runtime.js';
import { SoundRuntime } from './sound-lab/runtime.js';
import { TtsRuntime } from './tts-lab/runtime.js';
import { labProxy, localLabCoreClient } from './lab-moderation/proxy.js';
import { readdir, readFile, stat } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, normalize } from 'node:path';
import { LabEbs } from './extension-lab/lab-ebs.js';
import {
  EXT_PREFIX,
  EXTENSION_CSP,
  extensionFile,
  LAB_API_PREFIX,
} from './extension-lab/serve.js';
import {
  TWITCH_EXT_MOCK_JS,
  TWITCH_EXT_MOCK_PATH,
} from './extension-lab/twitch-mock.js';
import {
  applyDataRootEnv,
  DATA_ROOT,
  REPO_ROOT,
} from './test-lab/local-env.js';
import { createTestLab, type TestLab } from './test-lab/test-lab.js';
import {
  createLocalRuntime,
  portFree,
  type LocalRuntime,
} from './runtime/local-runtime.js';

/** Exit code when the Studio port is taken: the Electron supervisor does not retry in a loop. */
const EXIT_PORT_IN_USE = 3;

const port = Number(process.env.PORT ?? 4100);
// Studio is local-only: bind to loopback, never to a public interface.
const host = '127.0.0.1';
const webDir = join(REPO_ROOT, 'apps', 'studio', 'web', 'dist');
/** Production extension, served as is to the Extension Lab (see extension-lab/serve.ts). */
export const EXTENSION_DIR = join(
  REPO_ROOT,
  'apps',
  'twitch-extension',
  'extension',
);
/** Custom header: a cross-site page cannot send it without a CORS preflight, which is never granted. */
export const STUDIO_HEADER = 'x-raptoru-studio';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Dev/Lab: prototypes are local, unversioned work. They are never packaged; Studio only serves them
// when it runs from the repository (the folder exists), read-only, from two allowlisted trees
// (prototypes link the real extension stylesheets and the TTS player assets by relative paths).
const DEV_PREFIX = '/dev/';
const DEV_ROOTS = ['prototypes/', 'apps/twitch-extension/extension/'];
const DEV_MIME: Record<string, string> = {
  ...MIME,
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.md': 'text/plain; charset=utf-8',
};

async function serveDev(pathname: string, res: ServerResponse) {
  const rel = normalize(decodeURIComponent(pathname.slice(DEV_PREFIX.length)))
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (rel.startsWith('..') || !DEV_ROOTS.some((root) => rel.startsWith(root)))
    return send(res, 404, { error: 'not_found' });
  try {
    const body = await readFile(join(REPO_ROOT, rel));
    res.writeHead(200, {
      'content-type':
        DEV_MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    send(res, 404, { error: 'not_found' });
  }
}

/** Prototype folders with an entry page, when Studio runs from the repository. */
async function listPrototypes() {
  const dir = join(REPO_ROOT, 'prototypes');
  const out: { name: string; entry: string; updatedAt: string }[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { available: false, items: out };
  }
  for (const name of names.sort()) {
    for (const entry of ['index.html', 'calibrate.html']) {
      try {
        const info = await stat(join(dir, name, entry));
        out.push({
          name,
          entry: `${DEV_PREFIX}prototypes/${encodeURIComponent(name)}/${entry}`,
          updatedAt: info.mtime.toISOString(),
        });
      } catch {
        /* no such entry */
      }
    }
  }
  return { available: true, items: out };
}

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

const sameHost = (req: IncomingMessage) =>
  req.headers.host === `${host}:${port}` ||
  req.headers.host === `localhost:${port}`;

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Extension Lab routes that the extension frames call (no Studio header: they are the extension). */
async function extensionLabRoute(
  extLab: LabEbs | null,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === TWITCH_EXT_MOCK_PATH) {
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(TWITCH_EXT_MOCK_JS);
    return true;
  }
  if (url.pathname.startsWith(EXT_PREFIX)) {
    if (req.method !== 'GET') {
      send(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const file = await extensionFile(EXTENSION_DIR, url.pathname);
    res.writeHead(file.status, {
      'content-type': file.contentType,
      'cache-control': 'no-store',
      'content-security-policy': EXTENSION_CSP,
      'x-frame-options': 'SAMEORIGIN',
    });
    res.end(file.body);
    return true;
  }
  if (url.pathname.startsWith(`${LAB_API_PREFIX}/`)) {
    if (!sameHost(req)) {
      send(res, 403, { ok: false, error: 'forbidden_host' });
      return true;
    }
    if (!extLab) {
      send(res, 503, { ok: false, error: 'extension_lab_unavailable' });
      return true;
    }
    const reply = await extLab.handle(
      req.method ?? 'GET',
      url.pathname.slice(LAB_API_PREFIX.length) + url.search,
      req.method === 'POST' ? await readJson(req) : undefined,
      {
        authorization: req.headers.authorization,
        idempotencyKey: req.headers['idempotency-key'] as string | undefined,
      },
    );
    send(res, reply.status, reply.body);
    return true;
  }
  return false;
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

export function createStudioServer(
  lab: TestLab,
  onShutdown: () => void,
  extLab: LabEbs | null = null,
  bonk: BonkRuntime | null = null,
  sound: SoundRuntime | null = null,
  runtime: LocalRuntime | null = null,
  tts: TtsRuntime | null = null,
  labApi: ReturnType<typeof labProxy> | null = null,
) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { service: 'studio-server', status: 'ok' });
      }
      if (bonk && (await bonk.handle(req, res, url))) return;
      if (sound && (await sound.handle(req, res, url))) return;
      if (url.pathname === '/api/sound-lab/status' && !sound)
        return send(res, 200, { enabled: false });
      if (tts && (await tts.handle(req, res, url))) return;
      // Moderation V2 cockpit / TTS configuration / Lab test wallet (relayed to the local Lab Core).
      if (url.pathname.startsWith('/api/lab/')) {
        if (!sameHost(req)) return send(res, 403, { error: 'forbidden_host' });
        if (!labApi) return send(res, 503, { error: 'lab_core_unavailable' });
        if (await labApi(req, res, url)) return;
      }
      if (url.pathname === '/api/tts-lab/status' && !tts)
        return send(res, 200, { enabled: false });
      if (url.pathname === '/api/bonk-lab/status' && !bonk)
        return send(res, 200, { enabled: false });
      if (await extensionLabRoute(extLab, req, res, url)) return;
      if (req.method === 'GET' && url.pathname.startsWith(DEV_PREFIX)) {
        if (!sameHost(req)) return send(res, 403, { error: 'forbidden_host' });
        return await serveDev(url.pathname, res);
      }
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET')
          return send(res, 405, { error: 'method_not_allowed' });
        return await serveStatic(url.pathname, res);
      }
      // API: same-host only (DNS rebinding) and custom header (cross-site requests).
      if (!sameHost(req)) return send(res, 403, { error: 'forbidden_host' });
      if (req.headers[STUDIO_HEADER] !== '1')
        return send(res, 403, { error: 'missing_studio_header' });

      if (
        process.env.BONK_LAB_ONLY === '1' &&
        url.pathname.startsWith('/api/test-lab/')
      )
        return send(res, 403, { error: 'bonk_lab_only' });
      // Local Runtime Manager (Lab Core, base Lab, Postgres) and Dev/Lab entry points.
      if (req.method === 'GET' && url.pathname === '/api/runtime/status')
        return send(res, 200, {
          enabled: Boolean(runtime),
          packaged: process.env.RAPTORU_PACKAGED === '1',
          dataRoot: DATA_ROOT,
          ...(runtime ? runtime.status() : {}),
        });
      if (req.method === 'POST' && url.pathname === '/api/runtime/restart') {
        if (!runtime) return send(res, 404, { error: 'runtime_disabled' });
        void runtime.restart();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/dev/prototypes')
        return send(res, 200, await listPrototypes());
      if (req.method === 'GET' && url.pathname === '/api/test-lab/status')
        return send(res, 200, await lab.status());
      if (req.method === 'GET' && url.pathname === '/api/test-lab/logs') {
        return send(
          res,
          200,
          lab.logs.since(Number(url.searchParams.get('since') ?? 0)),
        );
      }
      // Extension Lab: state and controls of the local Lab EBS (fictitious data only).
      if (url.pathname.startsWith('/api/ext-lab/')) {
        if (!extLab)
          return send(res, 503, { error: 'extension_lab_unavailable' });
        if (req.method === 'GET' && url.pathname === '/api/ext-lab/state')
          return send(
            res,
            200,
            extLab.snapshot(Number(url.searchParams.get('since') ?? 0)),
          );
        const control = /^\/api\/ext-lab\/control\/([a-z-]+)$/.exec(
          url.pathname,
        );
        if (req.method === 'POST' && control)
          return send(
            res,
            200,
            await extLab.control(control[1]!, await readJson(req)),
          );
        return send(res, 404, { error: 'not_found' });
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
  // Checked before touching anything (runtime, PIDs, Core): a second server never disturbs the first.
  if (!(await portFree(port))) {
    console.error(
      `[studio-server] port ${port} already in use: not starting (exit ${EXIT_PORT_IN_USE})`,
    );
    process.exit(EXIT_PORT_IN_USE);
  }
  applyDataRootEnv();
  const lab = createTestLab();
  // Every crash leaves a trace in the output captured by Electron (<userData>/logs/studio-server.log).
  process.on('unhandledRejection', (reason) => {
    const text =
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : String(reason);
    console.error(`[studio-server] unhandled rejection: ${text}`);
    lab.logs.add(
      'studio',
      `Erreur non gérée : ${lab.deps.redact(String(reason))}`,
      'error',
    );
  });
  process.on('uncaughtException', (error) => {
    console.error(
      `[studio-server] uncaught exception: ${error.stack ?? error.message}`,
    );
    process.exit(1);
  });
  // Standalone Studio: the local runtime (Postgres → base Lab → Core local) is started and watched
  // here; Bonk and Soundboard workers use its per-session secret. `npm run bonk:lab` (BONK_LAB_ONLY)
  // keeps its own launcher and environment.
  const runtime =
    process.env.BONK_LAB_ONLY === '1'
      ? null
      : createLocalRuntime(lab.logs, lab.deps.redact);
  if (runtime) {
    process.env.BONK_LAB_CORE_URL = runtime.coreUrl;
    process.env.BONK_LAB_SECRET = runtime.secret;
  }
  for (const service of process.env.BONK_LAB_ONLY === '1'
    ? []
    : [lab.deps.core, lab.deps.bot]) {
    if (await service.adoptPrevious())
      lab.logs.add(
        'studio',
        `found ${service.name} (pid ${service.pid}) left running by a previous Studio session`,
      );
  }
  const bonk = process.env.BONK_LAB_CORE_URL
    ? await BonkRuntime.create(`http://${host}:${port}`)
    : null;
  // Soundboard V2 Lab: same Lab Core (test only), local player page.
  const sound = process.env.BONK_LAB_CORE_URL
    ? await SoundRuntime.create(`http://${host}:${port}`)
    : null;
  // TTS V2 Lab: same Lab Core (test only), local player page / OBS overlay.
  const tts = process.env.BONK_LAB_CORE_URL
    ? await TtsRuntime.create(`http://${host}:${port}`)
    : null;
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    bonk?.stop();
    sound?.stop();
    tts?.stop();
    lab.logs.add(
      'studio',
      'Studio closing: stopping bot and Core (Postgres keeps running)',
    );
    if (process.env.BONK_LAB_ONLY === '1') process.exit(0);
    else
      void Promise.allSettled([lab.shutdown(), runtime?.stop()]).finally(() =>
        process.exit(0),
      );
  };
  const extLab = await LabEbs.create(EXTENSION_DIR).catch((error: Error) => {
    lab.logs.add(
      'studio',
      `Extension Lab unavailable: ${error.message}`,
      'error',
    );
    return null;
  });
  if (bonk && extLab) {
    extLab.connectBonk(bonk.worker, bonk.viewerAuth, bonk.thirdPartyCatalog);
    bonk.start();
  }
  if (sound && extLab) {
    extLab.connectSound(sound.worker);
    sound.onConfigChange = () => extLab.invalidateSoundCatalog();
    sound.start();
  }
  if (tts && extLab) {
    extLab.connectTts(tts.worker);
    tts.start();
  }
  // Moderation V2 + TTS configuration + Lab test wallet: Core decides, Studio relays.
  const labCore = process.env.BONK_LAB_CORE_URL
    ? localLabCoreClient(
        process.env.BONK_LAB_CORE_URL,
        process.env.BONK_LAB_SECRET ?? '',
      )
    : null;
  if (labCore && extLab) extLab.connectLab(labCore);
  const labApi = labCore
    ? labProxy({
        core: labCore,
        players: async () => ({
          tts: tts
            ? {
                ready: tts.worker.ready,
                player: tts.worker.playerInfo,
                current: tts.worker.current?.interaction_id ?? null,
                overlay_url: tts.overlayUrl,
                preview_url: tts.previewUrl,
              }
            : null,
          soundboard: sound ? { ready: sound.worker.ready } : null,
          bonk: bonk ? bonk.summary() : null,
        }),
        identities: () => extLab?.labIdentities() ?? [],
        onChange: () => extLab?.invalidateLab(),
      })
    : null;
  const httpServer = createStudioServer(
    lab,
    shutdown,
    extLab,
    bonk,
    sound,
    runtime,
    tts,
    labApi,
  );
  httpServer.once('error', (error: NodeJS.ErrnoException) => {
    console.error(
      `[studio-server] listen failed: ${error.code ?? error.message}`,
    );
    process.exit(error.code === 'EADDRINUSE' ? EXIT_PORT_IN_USE : 1);
  });
  httpServer.listen(port, host, () => {
    console.log(
      `[studio-server] Test Lab on http://${host}:${port} (data: ${DATA_ROOT})`,
    );
    void runtime?.start();
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Started by Electron: if Electron disappears (forced close, crash), stop cleanly (Core included)
  // instead of staying behind as an orphan holding the ports.
  const parentPid = Number(process.env.RAPTORU_PARENT_PID ?? 0);
  if (parentPid > 0) {
    const watch = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        clearInterval(watch);
        console.log('[studio-server] Electron parent gone: stopping');
        shutdown();
      }
    }, 2000);
    watch.unref();
  }
}
