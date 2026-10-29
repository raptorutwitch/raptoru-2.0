import { BonkRuntime } from './bonk-lab/runtime.js';
import { bootPlan } from './prod-transport/profile.js';
import {
  createProductionRuntimes,
  fromMain,
  handleProfileApi,
  type ProfileApiDeps,
} from './prod-transport/production.js';
import { SoundRuntime } from './sound-lab/runtime.js';
import { TtsRuntime } from './tts-lab/runtime.js';
import {
  LAB_CHANNEL_ID,
  labProxy,
  localLabCoreClient,
  localLabCoreEvents,
} from './lab-moderation/proxy.js';
import { AlertMediaStore } from './alerts/media-store.js';
import { AlertsRuntime } from './alerts/runtime.js';
import { SeTipsLink } from './alerts/se-tips.js';
import { ChannelPointsRuntime } from './channel-points/runtime.js';
import { EffectsPlayer } from './effects/player.js';
import { RaffleRuntime } from './raffle-lab/runtime.js';
import { WordGameRuntime } from './word-game/runtime.js';
import { LabChatIngress } from './lab-chat/ingress.js';
import { hasTwitchScope } from '@raptoru/schemas';
import {
  createTwitchConnections,
  type TwitchConnections,
} from './twitch-oauth/twitch-connections.js';
import { commandsRelay } from './commands/relay.js';
import { miniGamesRelay } from './mini-games/relay.js';
import { ManagedProcess, PidStore } from './test-lab/managed-process.js';
import { existsSync } from 'node:fs';
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
  paths,
  readEnvFile,
  readTokenSummary,
  REPO_ROOT,
  twitchTokenFiles,
} from './test-lab/local-env.js';
import { createTestLab, type TestLab } from './test-lab/test-lab.js';
import { botStatusProvider } from './control-center/bot.js';
import { ControlCenter } from './control-center/model.js';
import {
  type InteractionSources,
  interactionsStatusProvider,
  readSignals,
  type Signal,
} from './supervision/signals.js';
import { Supervisor } from './supervision/supervisor.js';
import { DockHub } from './dock/hub.js';
import { DockKey, DockServer } from './dock/server.js';
import { dockStudioApi, type DockRuntime } from './dock/studio-api.js';
import { HalloweenRuntime } from './halloween/runtime.js';
import { ProgressionRelay } from './progression/relay.js';
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
        // Moderation console: Bonk emotes of the Twitch / 7TV / BTTV / FFZ CDNs (images only).
        "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https://static-cdn.jtvnw.net https://cdn.7tv.app https://cdn.betterttv.net https://cdn.frankerfacez.com",
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
/** Shown instead of the Extension Lab in the Production profile (never a simulated, outdated view). */
const PRODUCTION_NO_EXT_LAB =
  'Extension Lab indisponible en profil Production : la preview n’existe qu’en profil Lab (Core Lab local). En Production, l’Extension Twitch (Hosted Test) parle directement au Core, jamais à Studio.';

async function extensionLabRoute(
  extLab: LabEbs | null,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  production = false,
): Promise<boolean> {
  // Production profile (ASTRA-P1-019 lot 2): no Lab façade at all. Without it, the extension would run
  // on the façade's in-memory simulation and look like an old version (legacy screens, no V2 data).
  // Only the extension PAGES are refused: the Production players (Bonk overlay, Soundboard, TTS) load
  // their static assets from /ext/ (sounds, emotes, TTS characters).
  const extPage =
    url.pathname.startsWith(EXT_PREFIX) &&
    (url.pathname.endsWith('.html') || url.pathname.endsWith('/'));
  if (
    production &&
    (url.pathname === TWITCH_EXT_MOCK_PATH ||
      extPage ||
      url.pathname.startsWith(`${LAB_API_PREFIX}/`))
  ) {
    if (extPage) {
      res.writeHead(409, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'",
        'x-frame-options': 'SAMEORIGIN',
      });
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;color:#ddd;background:#111317;padding:24px">${PRODUCTION_NO_EXT_LAB}</body>`,
      );
    } else
      send(res, 409, {
        ok: false,
        error: 'production_profile',
        message: PRODUCTION_NO_EXT_LAB,
      });
    return true;
  }
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

/** One stderr line for a crash: full stack (diagnosis) through the secret redaction. */
export function crashLine(
  kind: string,
  reason: unknown,
  redactText: (text: string) => string,
): string {
  const text =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  return `[studio-server] ${kind}: ${redactText(text)}`;
}

/**
 * Shutdown barrier: every managed stop runs, and only once ALL have settled (each forces its child
 * after its own timeout) may the server exit. A failing stop is reported, never blocks the others.
 */
export async function stopAll(
  stops: Record<string, (() => Promise<unknown>) | undefined>,
  report: (name: string, error: unknown) => void,
): Promise<void> {
  await Promise.all(
    Object.entries(stops).map(async ([name, stop]) => {
      try {
        await stop?.();
      } catch (error) {
        report(name, error);
      }
    }),
  );
}

export function createStudioServer(
  lab: TestLab,
  onShutdown: () => void,
  extLab: LabEbs | null = null,
  bonk: BonkRuntime | null = null,
  sound: SoundRuntime | null = null,
  runtime: LocalRuntime | null = null,
  tts: TtsRuntime | null = null,
  labApi: ReturnType<typeof labProxy> | null = null,
  raffle: RaffleRuntime | null = null,
  labChat: LabChatIngress | null = null,
  commands: ReturnType<typeof commandsRelay> | null = null,
  /** Studio profile (Lab / Production) status and main-process-only switch (ASTRA-P1-019 lot 2). */
  profile: ProfileApiDeps | null = null,
  /** Jeu des mots V1 (Lab): panel relay + OBS sound source. */
  wordGame: WordGameRuntime | null = null,
  /** Roulette and Slot V1 (Lab): the switch « Mini-jeux » (Simulation de stream panel). */
  miniGames: ReturnType<typeof miniGamesRelay> | null = null,
  /** Twitch alerts V1 (Lab): OBS source + media, Studio preview, queue relay. */
  alerts: AlertsRuntime | null = null,
  /** Points de chaîne V1: tab API and the OBS executor of the redemptions. */
  points: ChannelPointsRuntime | null = null,
  /** Account diagnostics are passive; authorization is an explicit, guarded user action. */
  twitchConnections: TwitchConnections | null = null,
  /** Centre de contrôle (lot 3): one status per module, the bot first. */
  control: ControlCenter | null = null,
  /** Incidents of the live (incident 22/10): global banner and desktop notifications. */
  supervision: { handle: Supervisor['handle']; origin: string } | null = null,
  /** Dock OBS V1: its own local server (another port); here only Studio's panel API (docs/OBS_DOCK.md). */
  dock: DockRuntime | null = null,
  /** Halloween (docs/HALLOWEEN.md): the overlay engine, its page and media, Studio's panel and the shop relay. */
  halloween: HalloweenRuntime | null = null,
  /** Progression native (docs/PROGRESSION.md): Studio's panel relay to the profile's Core. */
  progression: ProgressionRelay | null = null,
) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { service: 'studio-server', status: 'ok' });
      }
      if (
        url.pathname === '/api/twitch-connections' ||
        url.pathname.startsWith('/api/twitch-connections/')
      ) {
        if (!sameHost(req)) return send(res, 403, { error: 'forbidden_host' });
        if (req.headers[STUDIO_HEADER] !== '1')
          return send(res, 403, { error: 'missing_studio_header' });
        if (!twitchConnections)
          return send(res, 503, { error: 'twitch_connections_unavailable' });
        if (await twitchConnections.handle(req, res, url)) return;
      }
      // Do not start a preflight/bot or enable the supervised ingress halfway through OAuth.
      if (
        twitchConnections?.authorizing &&
        req.method === 'POST' &&
        (url.pathname.startsWith('/api/test-lab/') ||
          url.pathname === '/api/lab-chat/ingress')
      ) {
        if (!sameHost(req) || req.headers[STUDIO_HEADER] !== '1')
          return send(res, 403, { error: 'forbidden' });
        return send(res, 409, { error: 'twitch_authorization_in_progress' });
      }
      if (control && (await control.handle(req, res, url))) return;
      if (
        supervision &&
        (await supervision.handle(req, res, url, supervision.origin))
      )
        return;
      if (bonk && (await bonk.handle(req, res, url))) return;
      if (sound && (await sound.handle(req, res, url))) return;
      if (url.pathname === '/api/sound-lab/status' && !sound)
        return send(res, 200, { enabled: false });
      if (tts && (await tts.handle(req, res, url))) return;
      // Tombola V2: Studio UI relay, launch sounds, single OBS source.
      if (raffle && (await raffle.handle(req, res, url))) return;
      // Single Lab chat ingress (Twitch switch + simulator), routed by Core to every module.
      if (labChat && (await labChat.handle(req, res, url))) return;
      if (url.pathname === '/api/lab-chat/status' && !labChat)
        return send(res, 200, {
          enabled: false,
          running: false,
          blocked: {
            code: 'unavailable',
            // Production: the chat / bot 2.0 stays off (no collision with SAMMI / the legacy).
            message:
              profile?.plan.effective === 'production'
                ? 'Chat 2.0 coupé en profil Production : inscriptions par l’Extension uniquement.'
                : 'Ingestion indisponible : Core Lab non démarré.',
          },
          token_login: null,
          last_exit: null,
          lines: [],
        });
      // Commands V2: Core decides; Studio relays (configuration, categories, rights, test, history).
      if (
        url.pathname === '/api/commands' ||
        url.pathname.startsWith('/api/commands/')
      ) {
        if (!sameHost(req)) return send(res, 403, { error: 'forbidden_host' });
        if (!commands) return send(res, 503, { error: 'lab_core_unavailable' });
        if (await commands(req, res, url)) return;
      }
      if (url.pathname === '/api/raffle/status' && !raffle)
        return send(res, 200, { enabled: false });
      // Jeu des mots V1: Core decides; Studio relays the panel and serves the OBS sound source.
      if (wordGame && (await wordGame.handle(req, res, url))) return;
      if (url.pathname === '/api/word-game/state' && !wordGame)
        return send(res, 200, { enabled: false });
      // Dock OBS V1: the panel's URL / key (the dock itself is served on its own port).
      if (url.pathname === '/api/dock' || url.pathname === '/api/dock/key') {
        if (!sameHost(req)) return send(res, 403, { error: 'forbidden_host' });
        if (req.headers[STUDIO_HEADER] !== '1')
          return send(res, 403, { error: 'missing_studio_header' });
        const out = await dockStudioApi(dock, req, url);
        if (out) return send(res, out.status, out.body);
      }
      // Halloween: overlay page / media (its key), Electron main (screens), Studio's panel and the shop relay.
      if (halloween && (await halloween.handle(req, res, url))) return;
      if (progression && (await progression.handle(req, res, url))) return;
      // Twitch alerts V1: Core queues; Studio serves the OBS source / preview and relays the claims / reports.
      if (alerts && (await alerts.handle(req, res, url))) return;
      if (points && (await points.handle(req, res, url))) return;
      if (url.pathname === '/api/alerts/state' && !alerts)
        return send(res, 200, { enabled: false });
      // Roulette and Slot V1: Core decides; Studio relays the switch « Mini-jeux ».
      if (url.pathname.startsWith('/api/mini-games/')) {
        if (!sameHost(req)) return send(res, 403, { error: 'forbidden_host' });
        if (!miniGames)
          return url.pathname === '/api/mini-games/state'
            ? send(res, 200, { available: false })
            : send(res, 503, { error: 'lab_core_unavailable' });
        if (await miniGames(req, res, url)) return;
      }
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
      if (
        await extensionLabRoute(
          extLab,
          req,
          res,
          url,
          profile?.plan.effective === 'production',
        )
      )
        return;
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
        profile &&
        (await handleProfileApi(
          req,
          url,
          () => readJson(req) as Promise<Record<string, unknown>>,
          (status, body) => send(res, status, body),
          profile,
        ))
      )
        return;

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
  // Known only to Electron main and this process: never inherited by the Lab children (Core, bot…).
  const mainToken = process.env.RAPTORU_MAIN_TOKEN;
  delete process.env.RAPTORU_MAIN_TOKEN;
  applyDataRootEnv();
  const lab = createTestLab();
  // Studio profile, read once at startup (a change = explicit action + supervised restart). Lab by
  // default; Production never starts the Lab Core and never reads the Lab environment.
  const plan = await bootPlan(paths.runtimeDir, process.env);
  const labProfile = plan.effective === 'lab';
  if (plan.notice) lab.logs.add('studio', plan.notice, 'error');
  lab.logs.add(
    'studio',
    labProfile
      ? 'Profil Lab'
      : `Profil Production (Core ${plan.production!.config.origin})`,
  );
  // Every crash leaves a trace in the output captured by Electron (<userData>/logs/studio-server.log).
  // Crash traces go through the same redaction as Lab.logs before stderr (kept by Electron in its
  // log file): stack and message stay, secrets never (ASTRA-P2-014).
  process.on('unhandledRejection', (reason) => {
    console.error(crashLine('unhandled rejection', reason, lab.deps.redact));
    lab.logs.add(
      'studio',
      `Erreur non gérée : ${lab.deps.redact(String(reason))}`,
      'error',
    );
  });
  process.on('uncaughtException', (error) => {
    console.error(crashLine('uncaught exception', error, lab.deps.redact));
    process.exit(1);
  });
  // Standalone Studio: the local runtime (Postgres → base Lab → Core local) is started and watched
  // here; Bonk and Soundboard workers use its per-session secret. `npm run bonk:lab` (BONK_LAB_ONLY)
  // keeps its own launcher and environment.
  const runtime =
    process.env.BONK_LAB_ONLY === '1' || !plan.startLabCore
      ? null
      : createLocalRuntime(lab.logs, lab.deps.redact);
  if (runtime) {
    process.env.BONK_LAB_CORE_URL = runtime.coreUrl;
    process.env.BONK_LAB_SECRET = runtime.secret;
    // The Lab Core uses the same Postgres: the Test Lab never stops it under a running Lab Core.
    lab.deps.postgresUsers = () =>
      runtime.deps.labCore.running ? ['the Lab Core (Studio runtime)'] : [];
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
  const labCoreUrl = labProfile ? process.env.BONK_LAB_CORE_URL : undefined;
  // Production profile: the same Bonk / Soundboard / TTS runtimes over the future-prod transport
  // (own journals and player tokens). Started inside a guard: a failure falls back to nothing
  // running and an explicit error, never to a silent Lab Core.
  let productionError: string | null = null;
  const production = plan.production
    ? await createProductionRuntimes(
        `http://${host}:${port}`,
        paths.runtimeDir,
        plan.production,
      ).catch((error: Error) => {
        productionError = lab.deps.redact(error.message);
        lab.logs.add(
          'studio',
          `Profil Production : démarrage impossible (${lab.deps.redact(error.message)})`,
          'error',
        );
        return null;
      })
    : null;
  const bonk = production
    ? production.bonk
    : labCoreUrl
      ? await BonkRuntime.create(`http://${host}:${port}`)
      : null;
  // Soundboard V2 Lab: same Lab Core (test only), local player page.
  const sound = production
    ? production.sound
    : labCoreUrl
      ? await SoundRuntime.create(`http://${host}:${port}`)
      : null;
  // TTS V2 Lab: same Lab Core (test only), local player page / OBS overlay.
  const tts = production
    ? production.tts
    : labCoreUrl
      ? await TtsRuntime.create(`http://${host}:${port}`)
      : null;
  // Lab chat ingress, created below (the shutdown may run before it exists).
  let labChatRef: LabChatIngress | null = null;
  let seRef: SeTipsLink | null = null;
  let dockRef: DockRuntime | null = null;
  let halloweenRef: HalloweenRuntime | null = null;
  let pointsRef: ChannelPointsRuntime | null = null;
  let twitchConnectionsRef: TwitchConnections | null = null;
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    bonk?.stop();
    sound?.stop();
    tts?.stop();
    production?.link.stop();
    seRef?.close();
    void dockRef?.server.close();
    halloweenRef?.stop();
    pointsRef?.stop();
    lab.logs.add(
      'studio',
      'Studio closing: stopping bot and Core (Postgres keeps running)',
    );
    const ingress = labChatRef;
    const full = process.env.BONK_LAB_ONLY !== '1';
    void stopAll(
      {
        // The Lab chat ingress (bot child process) is awaited like the others before exiting.
        labchat: ingress ? () => ingress.stop() : undefined,
        twitchOAuth: twitchConnectionsRef
          ? () => twitchConnectionsRef!.stop()
          : undefined,
        testlab: full ? () => lab.shutdown() : undefined,
        runtime: full && runtime ? () => runtime.stop() : undefined,
      },
      (name, error) =>
        console.error(
          `[studio-server] ${name} stop failed: ${lab.deps.redact(String((error as Error)?.message ?? error))}`,
        ),
    ).finally(() => process.exit(0));
  };
  // Lab profile only: in Production the façade would only serve its outdated simulation.
  const extLab = !labProfile
    ? null
    : await LabEbs.create(EXTENSION_DIR).catch((error: Error) => {
        lab.logs.add(
          'studio',
          `Extension Lab unavailable: ${error.message}`,
          'error',
        );
        return null;
      });
  if (production) {
    // Admissions will come from the public EBS (P1-006): no Lab façade on the production workers.
    production.bonk.start();
    production.sound.start();
    production.tts.start();
    production.link.start();
  }
  if (bonk && extLab && !production) {
    extLab.connectBonk(bonk.worker, bonk.viewerAuth, bonk.thirdPartyCatalog);
    bonk.start();
  }
  if (sound && extLab && !production) {
    extLab.connectSound(sound.worker);
    sound.onConfigChange = () => extLab.invalidateSoundCatalog();
    sound.start();
  }
  if (tts && extLab && !production) {
    extLab.connectTts(tts.worker);
    tts.start();
  }
  // Moderation V2 + TTS configuration + Lab test wallet: Core decides, Studio relays. Production: the
  // same cockpit on the Production Core (installation credential, the Core's own channel).
  const labCore = production
    ? production.cockpit
    : labCoreUrl
      ? localLabCoreClient(labCoreUrl, process.env.BONK_LAB_SECRET ?? '')
      : null;
  const cockpitChannel = plan.production?.config.channelId ?? LAB_CHANNEL_ID;
  if (labCore && extLab) extLab.connectLab(labCore);
  const labApi = labCore
    ? labProxy({
        channelId: cockpitChannel,
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
  // Tombola V2: Core decides; Studio relays, stores the launch sounds and serves the OBS source.
  const raffle = labCore
    ? await RaffleRuntime.create({
        channelId: cockpitChannel,
        core: labCore,
        origin: `http://${host}:${port}`,
        dir: join(paths.runtimeDir, 'raffle-lab'),
        overlayDir: join(
          REPO_ROOT,
          'apps',
          'studio',
          'server',
          'raffle-overlay',
        ),
      })
    : null;
  // Jeu des mots V1, both profiles (lot 9): the Lab Core, or the main Core through the cockpit (state, actions and
  // its wins stream). Same OBS sound source and token in both profiles (the OBS URL does not change at the cutover).
  const wordGame = labCore
    ? await WordGameRuntime.create({
        channelId: cockpitChannel,
        core: labCore,
        environment: production ? 'production' : 'lab',
        events: production
          ? production.cockpitEvents
          : localLabCoreEvents(labCoreUrl!, process.env.BONK_LAB_SECRET ?? ''),
        origin: `http://${host}:${port}`,
        dir: join(paths.runtimeDir, 'word-game'),
        playerDir: join(
          REPO_ROOT,
          'apps',
          'studio',
          'server',
          'word-game-player',
        ),
      })
    : null;
  // Twitch alerts V1 (§ 22): ONE runtime, on the Core of the profile — the Lab Core, or the paired production Core
  // (/v1/studio/alerts). Media, calibration and the OBS source token are shared by both profiles (runtimeDir/alerts:
  // the OBS URL does not change at the cutover); the StreamElements mode and journal are per profile.
  const alertsEnv: 'lab' | 'production' | null =
    labCore && labProfile ? 'lab' : production ? 'production' : null;
  const alertsCore =
    alertsEnv === 'lab' ? labCore : (production?.alertsCore ?? null);
  // Real StreamElements donations: own mode (OFF by default, ACTIVE never resumed at start), token from Electron main.
  const se =
    alertsCore && alertsEnv
      ? await SeTipsLink.open({
          dir:
            alertsEnv === 'lab'
              ? join(paths.runtimeDir, 'alerts')
              : join(paths.runtimeDir, 'production', 'alerts'),
          environment: alertsEnv,
          channelId: cockpitChannel,
          core: alertsCore,
          fromMain: (req) => fromMain(req, { RAPTORU_MAIN_TOKEN: mainToken }),
          log: (line) => lab.logs.add('studio', line),
        })
      : null;
  seRef = se;
  // Media in Studio's storage (imported by alerts/import-cli.ts).
  const alerts: AlertsRuntime | null =
    alertsCore && alertsEnv
      ? await AlertsRuntime.create({
          channelId: cockpitChannel,
          core: alertsCore,
          environment: alertsEnv,
          origin: `http://${host}:${port}`,
          dir: join(paths.runtimeDir, 'alerts'),
          se: se ?? undefined,
          // Real Twitch events ride on the Lab chat adapter (created below): its state, and a restart on a new mode.
          // Production profile (lot 9): the production bot's reception, reported to the main Core (read only).
          twitch:
            alertsEnv === 'production'
              ? undefined
              : {
                  status: () => {
                    const ingress = labChat?.status();
                    const token = readTokenSummary(
                      process.env.TWITCH_TOKEN_FILE ?? paths.tokenFile,
                    );
                    return {
                      ingestion_enabled: ingress?.enabled ?? false,
                      ingestion_running: ingress?.running ?? false,
                      token_login: token.login,
                      follow_scope: token.scopes.includes(
                        'moderator:read:followers',
                      ),
                    };
                  },
                  restart: async () => {
                    await labChat?.restart();
                  },
                },
          playerDir: join(
            REPO_ROOT,
            'apps',
            'studio',
            'server',
            'alerts-player',
          ),
          media: await AlertMediaStore.open(
            join(paths.runtimeDir, 'alerts', 'media'),
          ),
        })
      : null;
  // Single Lab chat ingress: ONE Twitch chat connection (bot adapter, switch OFF by default) for every
  // Lab module, plus the chat simulator. Never started automatically unless left ON and unblocked.
  // Lab profile only: in Production the chat / bot 2.0 stays off (no collision with SAMMI / legacy).
  const ingressLines: string[] = [];
  const labChat: LabChatIngress | null =
    labCore && labProfile
      ? await LabChatIngress.create({
          core: labCore,
          origin: `http://${host}:${port}`,
          dir: join(paths.runtimeDir, 'lab-chat'),
          identities: () => extLab?.labIdentities() ?? [],
          process: new ManagedProcess({
            name: 'labchat',
            cwd: paths.botDir,
            args: [
              `--env-file-if-exists=${paths.botEnv}`,
              'dist/lab-chat-main.js',
            ],
            pids: new PidStore(paths.runtimeDir),
            onLine: (line) => {
              ingressLines.push(lab.deps.redact(line));
              if (ingressLines.length > 50) ingressLines.shift();
            },
          }),
          env: () => ({
            LAB_CHAT_CORE_URL: process.env.BONK_LAB_CORE_URL ?? '',
            LAB_CHAT_SECRET: process.env.BONK_LAB_SECRET ?? '',
            LAB_CHAT_CHANNEL_ID: LAB_CHANNEL_ID,
            // Twitch alerts: OFF unless chosen in the Alertes tab (read at start; a change restarts the adapter).
            LAB_ALERTS_MODE: alerts?.twitchMode ?? 'off',
            LAB_ALERTS_CHANNEL_ID: cockpitChannel,
            // Never the production chat features: this process only reads for the Lab modules.
            DAILY_CHAT_COMMANDS: 'false',
            LOYALTY_CHAT_COMMANDS: 'false',
            LOYALTY_TWITCH_EVENTS: 'false',
            PRESENCE_SHADOW: 'false',
          }),
          token: () => readTokenSummary(twitchTokenFiles().bot),
          prerequisite: () =>
            !existsSync(paths.botEnv)
              ? 'bot_env_missing'
              : !existsSync(join(paths.botDir, 'dist', 'lab-chat-main.js'))
                ? 'bot_not_built'
                : null,
          botRunning: () => lab.deps.bot.running,
          lines: () => ingressLines,
        })
      : null;
  labChatRef = labChat;
  // Points de chaîne V1 (both profiles, on the Core of the profile): Studio runs the OBS part of the redemptions on
  // its one OBS connection (the Bonk's). Starts with Studio; nothing runs unless Core queued a job (master switch ON
  // in Core, or an explicit « Tester »). Twitch reception: the Lab chat adapter's broadcaster connection (Lab) or
  // the production bot (Production).
  const broadcasterTokenFile = twitchTokenFiles().broadcaster;
  const points =
    alertsCore && alertsEnv
      ? await ChannelPointsRuntime.create({
          core: alertsCore,
          environment: alertsEnv,
          channelId: cockpitChannel,
          origin: `http://${host}:${port}`,
          dir:
            alertsEnv === 'lab'
              ? join(paths.runtimeDir, 'channel-points')
              : join(paths.runtimeDir, 'production', 'channel-points'),
          obs: () => bonk?.obs ?? null,
          // Effects player (P0.1): one OBS browser source; media imported by effects/import-cli.ts.
          effects: await EffectsPlayer.create({
            dir: join(paths.runtimeDir, 'effects'),
            origin: `http://${host}:${port}`,
            media: await AlertMediaStore.open(
              join(paths.runtimeDir, 'effects', 'media'),
            ),
            playerDir: join(
              REPO_ROOT,
              'apps',
              'studio',
              'server',
              'effects-player',
            ),
            // Sounds imported from Studio (Votekick launch sound): kept across Studio updates.
            uploadsDir: join(paths.runtimeDir, 'effects', 'uploads'),
          }),
          votekickOverlayDir: join(
            REPO_ROOT,
            'apps',
            'studio',
            'server',
            'votekick-overlay',
          ),
          // Spotify V2: the Lab plays on the simulator; Production on the broadcaster's account (panel « Musique »).
          spotifyDir:
            alertsEnv === 'lab'
              ? join(paths.runtimeDir, 'spotify-lab')
              : join(paths.runtimeDir, 'production', 'spotify'),
          twitch: () => ({
            scope: hasTwitchScope(
              readTokenSummary(broadcasterTokenFile).scopes,
              'channel:read:redemptions',
            ),
            adapter_running:
              alertsEnv === 'lab'
                ? (labChat?.status().running ?? false)
                : false,
            ...(alertsEnv === 'production'
              ? { profile_note: 'production_bot' }
              : {}),
          }),
        })
      : null;
  points?.start();
  pointsRef = points;
  labChat?.start();
  const twitchConnections = createTwitchConnections({
    clientId:
      process.env.TWITCH_CLIENT_ID ??
      readEnvFile(paths.botEnv).TWITCH_CLIENT_ID ??
      '',
    tokenFiles: twitchTokenFiles(),
    botDir: paths.botDir,
    envFile: paths.botEnv,
    production: !labProfile,
    canAuthorize: () =>
      lab.tokenOperationsBusy || labChat?.status().enabled
        ? {
            ok: false,
            reason:
              'Coupe Ingestion chat Twitch dans Simulation, arrête le bot dans Test Lab et attends la fin des opérations. Arrête aussi les anciens processus lancés à part.',
          }
        : { ok: true },
  });
  twitchConnectionsRef = twitchConnections;
  // Supervision (incident 22/10): what would make the Core refuse a viewer, read from the live runtimes.
  const studioOrigin = `http://${host}:${port}`;
  const interactionSources = (): InteractionSources => ({
    link: production?.link ?? null,
    tts: tts?.worker ?? null,
    sound: sound?.worker ?? null,
    bonk: bonk
      ? {
          obsConnected: bonk.obs.connected,
          obsReconnecting: bonk.obs.reconnecting,
          obsError: bonk.obs.error,
          sourceReady: bonk.sourceReady,
          overlayReady: bonk.worker.ready,
          error: bonk.worker.error,
          lastHeartbeat: bonk.worker.lastHeartbeat,
        }
      : null,
  });
  const bot = botStatusProvider(production?.alertsCore ?? null);
  const control = new ControlCenter(studioOrigin, [
    bot,
    interactionsStatusProvider(() =>
      readSignals(interactionSources(), Date.now()),
    ),
  ]);
  const supervisor = new Supervisor({
    read: async (): Promise<Signal[]> => {
      const [b] = await control.statuses();
      const botSignal: Signal[] =
        b && b.id === 'bot' && b.level !== 'off'
          ? [
              {
                id: 'bot',
                label: 'LeCroupier_ (bot)',
                level: b.level,
                value: b.state,
                cause: b.level === 'error' ? b.state : null,
                action: b.level === 'error' ? 'auto' : null,
                hint: b.hint ?? b.summary,
              },
            ]
          : [];
      return [...botSignal, ...readSignals(interactionSources(), Date.now())];
    },
    log: (line) => console.log(lab.deps.redact(line)),
  });
  // Dock OBS V1 (docs/OBS_DOCK.md): the activity feed of the profile's Core, followed once and served to OBS docks on
  // Studio's port + 10 (DOCK_PORT; 4110 for the installed Studio). A port already taken leaves the dock unavailable, never Studio.
  const dockHub =
    alertsCore && alertsEnv
      ? new DockHub({
          core: alertsCore,
          environment: alertsEnv,
          channelId: cockpitChannel,
        })
      : null;
  const dock: DockRuntime | null = dockHub
    ? {
        hub: dockHub,
        error: null,
        server: new DockServer({
          hub: dockHub,
          key: await DockKey.open(join(paths.runtimeDir, 'dock', 'key.json')),
          port: Number(process.env.DOCK_PORT ?? port + 10),
          pageDir: join(REPO_ROOT, 'apps', 'studio', 'server', 'dock-page'),
          log: (line) => console.log(line),
        }),
      }
    : null;
  dockRef = dock;
  // Halloween (docs/HALLOWEEN.md): the overlay engine plays what the profile's Core sold (Lab or Production), one at a
  // time; its window is opened by Electron main on the chosen screen. Without a Core: local tests only.
  const halloween = new HalloweenRuntime({
    origin: `http://${host}:${port}`,
    dir: join(paths.runtimeDir, 'halloween'),
    pageDir: join(REPO_ROOT, 'apps', 'studio', 'server', 'halloween-overlay'),
    core: alertsCore,
    environment: alertsEnv,
    channelId: cockpitChannel,
    studioId:
      plan.production?.installation.installationId ?? 'studio-lab-halloween',
    fromMain: (req) => fromMain(req, { RAPTORU_MAIN_TOKEN: mainToken }),
    log: (line) => console.log(line),
  });
  await halloween
    .start()
    .catch((e: Error) => console.error('[halloween] start failed', e.message));
  halloweenRef = halloween;
  const httpServer = createStudioServer(
    lab,
    shutdown,
    extLab,
    bonk,
    sound,
    runtime,
    tts,
    labApi,
    raffle,
    labChat,
    // Commands V2: the Lab Core, or the main Core through the production cockpit (lot 8: it hosts the chat games).
    labCore ? commandsRelay(labCore, cockpitChannel) : null,
    {
      plan,
      runtimeDir: paths.runtimeDir,
      env: { ...process.env, RAPTORU_MAIN_TOKEN: mainToken },
      link: production?.link ?? null,
      startError: productionError,
      busy: () => [bonk, sound, tts].some((r) => r?.worker.busy ?? false),
      stopWorkers: () => {
        bonk?.stop();
        sound?.stop();
        tts?.stop();
      },
    },
    wordGame,
    labCore ? miniGamesRelay(labCore, cockpitChannel) : null,
    alerts,
    points,
    twitchConnections,
    // Centre de contrôle: the Production bot through the paired Studio's Core client (Lab profile: not followed), then
    // the viewer interactions as Studio sees them (supervision/signals.ts).
    control,
    { handle: supervisor.handle.bind(supervisor), origin: studioOrigin },
    dock,
    halloween,
    new ProgressionRelay({ core: alertsCore, environment: alertsEnv }),
  );
  supervisor.start();
  if (dock)
    dock.server.listen().then(
      () =>
        console.log(
          `[studio-server] Dock OBS on ${dock.server.url().split('#')[0]}`,
        ),
      (e: NodeJS.ErrnoException) => {
        dock.error = e.code === 'EADDRINUSE' ? 'port_in_use' : 'listen_failed';
        console.error(
          `[studio-server] Dock OBS unavailable: ${e.code ?? e.message}`,
        );
      },
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
