import { timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  DailyClaimRequest,
  PresenceLeaseRequest,
  PresenceObservationRequest,
  DailyStreakRequest,
  StreamOfflineRequest,
  StreamOnlineRequest,
  StreamSyncRequest,
  type StreamStateResponse,
} from '@raptoru/schemas';
import { z } from 'zod';
import { dbReady, type Db } from '../db/db.js';
import type { DailyService } from '../daily/daily-service.js';
import type { PresenceService } from '../presence/presence-service.js';
import { BoostConflictError } from '../wallet/loyalty.js';
import type { WalletModule } from '../wallet/index.js';
import {
  LoyaltyIdempotencyError,
  type LoyaltyEngine,
} from '../loyalty/engine.js';
import type { BonkLabService } from '../bonk-lab/bonk-lab-service.js';
import { bonkLabRoutes } from './bonk-lab-routes.js';
import { soundLabRoutes } from './sound-lab-routes.js';
import { ttsLabRoutes } from './tts-lab-routes.js';
import { labModerationRoutes } from './lab-moderation-routes.js';
import type { LabModerationService } from '../lab-moderation/service.js';
import type { RaffleLabService } from '../raffle-lab/raffle-lab-service.js';
import type { TtsLabService } from '../tts-lab/tts-lab-service.js';
import type { SoundLabService } from '../sound-lab/sound-lab-service.js';
import { loyaltyRoutes } from './loyalty-routes.js';
import {
  WalletIdempotencyError,
  WalletInputError,
} from '../wallet/wallet-service.js';
import { walletRoutes } from './wallet-routes.js';
import { studioTransportRoutes } from './studio-transport-routes.js';
import { alertsRoutes } from './alerts-routes.js';
import { channelPointsRoutes } from './channel-points-routes.js';
import { randomBanRoutes } from './random-ban-routes.js';
import type { RandomBanService } from '../random-ban/service.js';
import { subWheelRoutes } from './sub-wheel-routes.js';
import type { SubWheelService } from '../sub-wheel/service.js';
import type { ChannelPointsService } from '../channel-points/service.js';
import type { AlertsService } from '../alerts/service.js';
import {
  STUDIO_PROTOCOL,
  STUDIO_PROTOCOL_HEADER,
  StudioAuthError,
  type StudioInstallations,
} from '../studio/installations.js';
import type {
  ActiveSession,
  StreamSessions,
} from '../stream/stream-sessions.js';
import {
  ExtAuthError,
  verifyExtensionJwt,
  type ExtCaller,
} from '../ext/twitch-jwt.js';
import type { ExtFacade } from '../ext/ext-facade.js';
import { RateLimiter, type BucketRule } from '../ext/rate-limit.js';
import { extRoutes } from './ext-routes.js';
import type { LabCall } from '../ext/lab-internal.js';
import { studioCockpitRoutes } from './studio-cockpit-routes.js';
import { studioAdminRoutes } from './studio-admin-routes.js';

export interface AppDeps {
  daily: DailyService;
  streams: StreamSessions;
  presence: PresenceService;
  wallet: WalletModule;
  loyalty: LoyaltyEngine;
  /** Bonk V2 Lab slice (test only). */
  bonkLab?: BonkLabService;
  /** Soundboard V2 Lab slice (test only). */
  soundLab?: SoundLabService;
  /** TTS V2 Lab slice (test only). */
  ttsLab?: TtsLabService;
  /**
   * Moderation V2 + Lab test wallet + TTS configuration: never set by the production Core (only the
   * Lab Core process and tests expose these routes).
   */
  labModeration?: LabModerationService;
  /** Tombola V2 Lab slice (with labModeration only). */
  raffleLab?: RaffleLabService;
  botSecret: string;
  studioSecret: string;
  /**
   * Future production transport (ASTRA-P1-019): per-installation Studio credentials. With bonkLab,
   * mounts the /v1/studio/* execution routes. Never set by the Lab Core.
   */
  studioInstallations?: StudioInstallations;
  /**
   * Twitch alerts V1 (§ 22): with studioInstallations and a channel (cockpit), the /v1/studio/alerts/* routes of the
   * canonical alerts service. Never set by the Lab Core (it serves /v1/lab/alerts itself).
   */
  alerts?: AlertsService;
  /** Points de chaîne V1: /v1/studio/channel-points/* and /v1/bot/channel-points/* (same conditions as alerts). */
  channelPoints?: ChannelPointsService;
  /** Random Ban V2: /v1/studio/random-ban/* and /v1/bot/random-ban/* (same conditions as the channel points). */
  randomBan?: RandomBanService;
  /** Roue du Sub: /v1/studio/sub-wheel/* and the wheel side of the alerts reception (same conditions as alerts). */
  subWheel?: SubWheelService;
  /** Readiness probe (GET /ready): the database answers. */
  db?: Pick<Db, 'query'>;
  /**
   * The /v1/lab/* routes (Studio secret, viewer named in the body). Default on for the Lab and the
   * tests; the public Core bootstrap turns them off: nothing Lab is reachable from the Internet.
   */
  labRoutes?: boolean;
  /** Public viewer frontier /v1/ext/* (ASTRA-P1-006 minimal): Twitch Extension JWT, one channel. */
  ext?: {
    facade: ExtFacade;
    secret: Buffer;
    channelId: string;
    /** Twitch OAuth return of the Bonk emotes linking (no JWT): page shown in the viewer's browser. */
    emotesCallback?: (
      q: URLSearchParams,
    ) => Promise<{ status: number; title: string; text: string }>;
    /** Rate limits (defaults below; tests use tiny ones). */
    limits?: { ip: BucketRule; viewer: BucketRule };
  };
  /** Studio cockpit over the installation credential (ASTRA-P1-019): needs studioInstallations. */
  cockpit?: { core: LabCall; channelId: string };
}

type Auth = 'public' | 'bot' | 'studio' | 'studio_installation' | 'extension';

export interface Route {
  method: 'GET' | 'POST';
  pattern: RegExp;
  auth: Auth;
  handle: (ctx: {
    params: string[];
    /** Authenticated Studio installation (auth 'studio_installation' only). */
    installation?: string;
    /** Verified Twitch Extension caller (auth 'extension' only). */
    caller?: ExtCaller;
    /** Client Idempotency-Key header (auth 'extension' only). */
    idempotencyKey?: string;
    body: unknown;
    url: URL;
  }) => Promise<unknown>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`http ${status}`);
  }
}

const MAX_BODY_BYTES = 64 * 1024;
const TwitchUserId = z.string().regex(/^\d+$/);

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, {
      error: 'invalid_request',
      issues: z.treeifyError(result.error),
    });
  }
  return result.data;
}

export function limitParam(url: URL, fallback: number, max: number): number {
  const raw = Number(url.searchParams.get('limit') ?? fallback);
  return Number.isInteger(raw) && raw > 0 ? Math.min(raw, max) : fallback;
}

function streamState(session: ActiveSession | null): StreamStateResponse {
  return {
    live: session !== null,
    streamId: session?.streamId ?? null,
    streamDay: session?.streamDay ?? null,
  };
}

function routes({
  daily,
  streams,
  presence,
  wallet,
  loyalty,
  bonkLab,
  soundLab,
  ttsLab,
  labModeration,
  raffleLab,
  studioInstallations,
  alerts,
  channelPoints,
  randomBan,
  subWheel,
  db,
  labRoutes = true,
  ext,
  cockpit,
}: AppDeps): Route[] {
  return [
    ...walletRoutes(wallet),
    ...(studioInstallations
      ? studioTransportRoutes(
          { bonk: bonkLab, sound: soundLab, tts: ttsLab },
          cockpit?.channelId,
        )
      : []),
    ...(studioInstallations && alerts && cockpit?.channelId
      ? alertsRoutes(alerts, { channelId: cockpit.channelId }, subWheel)
      : []),
    ...(studioInstallations && alerts && subWheel && cockpit?.channelId
      ? subWheelRoutes(subWheel, alerts, { channelId: cockpit.channelId })
      : []),
    ...(studioInstallations && channelPoints && cockpit?.channelId
      ? channelPointsRoutes(channelPoints, { channelId: cockpit.channelId })
      : []),
    ...(studioInstallations && randomBan && cockpit?.channelId
      ? randomBanRoutes(randomBan, { channelId: cockpit.channelId })
      : []),
    ...(studioInstallations ? studioAdminRoutes(studioInstallations) : []),
    ...(studioInstallations && cockpit
      ? studioCockpitRoutes(cockpit.core, cockpit.channelId)
      : []),
    ...(ext ? extRoutes(ext.facade) : []),
    ...loyaltyRoutes(loyalty),
    ...(labRoutes && bonkLab ? bonkLabRoutes(bonkLab) : []),
    ...(labRoutes && soundLab ? soundLabRoutes(soundLab) : []),
    ...(labRoutes && ttsLab ? ttsLabRoutes(ttsLab) : []),
    ...(labRoutes && ttsLab && labModeration && raffleLab
      ? labModerationRoutes(labModeration, ttsLab, raffleLab)
      : []),
    {
      method: 'GET',
      pattern: /^\/health$/,
      auth: 'public',
      handle: async () => ({ service: 'core-api', status: 'ok' }),
    },
    // Readiness, distinct from liveness above: 503 while the database does not answer.
    {
      method: 'GET',
      pattern: /^\/ready$/,
      auth: 'public',
      handle: async () => {
        if (!db || !(await dbReady(db)))
          throw new HttpError(503, {
            service: 'core-api',
            status: 'db_unavailable',
          });
        return { service: 'core-api', status: 'ready' };
      },
    },

    // --- twitch-bot ---
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/stream\/online$/,
      auth: 'bot',
      handle: async ({ body }) => {
        const live = parse(StreamOnlineRequest, body);
        return streamState(
          await streams.online({
            streamId: live.streamId,
            startedAt: new Date(live.startedAt),
          }),
        );
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/stream\/offline$/,
      auth: 'bot',
      handle: async ({ body }) => {
        const { endedAt } = parse(StreamOfflineRequest, body);
        await streams.offline(endedAt ? new Date(endedAt) : undefined);
        return streamState(null);
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/stream\/sync$/,
      auth: 'bot',
      handle: async ({ body }) => {
        const { live } = parse(StreamSyncRequest, body);
        return streamState(
          await streams.sync(
            live
              ? { streamId: live.streamId, startedAt: new Date(live.startedAt) }
              : null,
          ),
        );
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/daily\/claim$/,
      auth: 'bot',
      handle: async ({ body }) => daily.claim(parse(DailyClaimRequest, body)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/daily\/streak$/,
      auth: 'bot',
      handle: async ({ body }) =>
        daily.streak(parse(DailyStreakRequest, body).viewer),
    },

    // --- public read contract (raptoru.fr, extension, Studio) ---
    {
      method: 'GET',
      pattern: /^\/v1\/daily\/leaderboard$/,
      auth: 'public',
      handle: async ({ url }) => daily.leaderboard(limitParam(url, 100, 500)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/daily\/viewers\/([^/]+)$/,
      auth: 'public',
      handle: async ({ params }) =>
        daily.status(parse(TwitchUserId, params[0])),
    },

    // --- presence tracker (shadow mode) ---
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/presence\/lease$/,
      auth: 'bot',
      handle: async ({ body }) =>
        presence.acquireLease(parse(PresenceLeaseRequest, body)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/bot\/presence\/observations$/,
      auth: 'bot',
      handle: async ({ body }) =>
        presence.record(parse(PresenceObservationRequest, body)),
    },

    // --- Studio / admin ---
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/presence\/streams\/([^/]+)$/,
      auth: 'studio',
      handle: async ({ params }) => {
        const report = await presence.report(params[0]!);
        if (!report) throw new HttpError(404, { error: 'unknown_stream' });
        return report;
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/admin\/daily\/viewers\/([^/]+)$/,
      auth: 'studio',
      handle: async ({ params, url }) => {
        const id = parse(TwitchUserId, params[0]);
        const limit = limitParam(url, 50, 500);
        return {
          status: await daily.status(id),
          claims: await daily.history(id, limit),
          attempts: await daily.attempts(id, limit),
        };
      },
    },
  ];
}

function secretMatches(header: string | undefined, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES)
      throw new HttpError(413, { error: 'body_too_large' });
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, { error: 'invalid_json' });
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/** Pages of a Twitch Extension are served from https://<client id>.ext-twitch.tv only. */
const EXTENSION_ORIGIN = /^https:\/\/[a-z0-9]{1,64}\.ext-twitch\.tv$/;
const EXT_PREFIX = '/v1/ext/';
const EXT_OAUTH_CALLBACK = '/v1/ext/emotes/oauth/callback';

function extCors(origin: string | undefined): Record<string, string> {
  return {
    vary: 'Origin',
    'cache-control': 'no-store',
    ...(origin && EXTENSION_ORIGIN.test(origin)
      ? { 'access-control-allow-origin': origin }
      : {}),
  };
}

/** The client as seen by our reverse proxy (it appends the real peer last), else the socket peer. */
function clientIp(req: IncomingMessage): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return forwarded.at(-1) ?? req.socket.remoteAddress ?? 'unknown';
}

export function createApp(deps: AppDeps): Server {
  return createServer(createHandler(deps));
}

/** The request handler alone: served over HTTP by createApp, or over HTTPS (local transport tests). */
export function createHandler(deps: AppDeps): RequestListener {
  const table = routes(deps);
  // Public frontier: per IP before any token check (bounds brute force), then per viewer.
  const ipLimit = new RateLimiter(
    deps.ext?.limits?.ip ?? { capacity: 240, refillPerS: 12 },
  );
  const viewerLimit = new RateLimiter(
    deps.ext?.limits?.viewer ?? { capacity: 60, refillPerS: 4 },
  );

  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://core');
    const cors = url.pathname.startsWith(EXT_PREFIX)
      ? extCors(req.headers.origin)
      : {};
    if (req.method === 'OPTIONS' && url.pathname.startsWith(EXT_PREFIX)) {
      res.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers':
          'authorization, content-type, idempotency-key',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }
    // Twitch sends the viewer's browser back here after the emotes authorization: no JWT (the
    // one-time state names the viewer), an HTML page, rate limited per IP like the rest of /v1/ext.
    if (
      req.method === 'GET' &&
      url.pathname === EXT_OAUTH_CALLBACK &&
      deps.ext?.emotesCallback
    ) {
      const page = ipLimit.take(clientIp(req))
        ? await deps.ext.emotesCallback(url.searchParams).catch(() => ({
            status: 500,
            title: 'Connexion Twitch indisponible',
            text: 'Réessaie dans un instant depuis l’extension.',
          }))
        : {
            status: 429,
            title: 'Trop de demandes',
            text: 'Réessaie dans un instant.',
          };
      const esc = (t: string) =>
        t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      res.writeHead(page.status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'",
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
      });
      res.end(
        `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(page.title)}</title><body style="font-family:system-ui;background:#111317;color:#e6e8eb;padding:40px"><h2>${esc(page.title)}</h2><p>${esc(page.text)}</p></body></html>`,
      );
      return;
    }
    try {
      const candidates = table.filter((r) => r.pattern.test(url.pathname));
      const route = candidates.find((r) => r.method === req.method);
      if (!route) {
        throw new HttpError(candidates.length ? 405 : 404, {
          error: candidates.length ? 'method_not_allowed' : 'not_found',
        });
      }
      if (
        route.auth === 'bot' &&
        !secretMatches(req.headers.authorization, deps.botSecret)
      ) {
        throw new HttpError(401, { error: 'unauthorized' });
      }
      if (
        route.auth === 'studio' &&
        !secretMatches(req.headers.authorization, deps.studioSecret)
      ) {
        throw new HttpError(401, { error: 'unauthorized' });
      }
      let installation: string | undefined;
      if (route.auth === 'studio_installation') {
        // Version first (no work, no claim for an incompatible Studio), then the credential.
        const version = Number(req.headers[STUDIO_PROTOCOL_HEADER]);
        if (!STUDIO_PROTOCOL.supported.includes(version))
          throw new HttpError(426, {
            error: 'protocol_incompatible',
            supported: STUDIO_PROTOCOL.supported,
          });
        if (!deps.studioInstallations)
          throw new HttpError(404, { error: 'not_found' });
        try {
          installation = await deps.studioInstallations.authenticate(
            req.headers.authorization,
          );
        } catch (error) {
          if (error instanceof StudioAuthError)
            throw new HttpError(401, { error: error.code });
          throw error;
        }
      }
      let caller: ExtCaller | undefined;
      let idempotencyKey: string | undefined;
      if (route.auth === 'extension') {
        if (!deps.ext) throw new HttpError(404, { error: 'not_found' });
        if (!ipLimit.take(clientIp(req)))
          throw new HttpError(429, { ok: false, error: 'rate_limited' });
        try {
          caller = verifyExtensionJwt(req.headers.authorization, {
            secret: deps.ext.secret,
            channelId: deps.ext.channelId,
          });
        } catch (error) {
          if (error instanceof ExtAuthError)
            throw new HttpError(401, { ok: false, error: error.code });
          throw error;
        }
        if (
          !viewerLimit.take(
            caller.userId ? `u:${caller.userId}` : `o:${caller.opaqueUserId}`,
            req.method === 'POST' ? 3 : 1,
          )
        )
          throw new HttpError(429, { ok: false, error: 'rate_limited' });
        const key = req.headers['idempotency-key'];
        idempotencyKey =
          typeof key === 'string' && key.length <= 128 ? key : undefined;
      }
      const params = route.pattern.exec(url.pathname)!.slice(1);
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      send(
        res,
        200,
        await route.handle({
          params,
          body,
          url,
          installation,
          caller,
          idempotencyKey,
        }),
        cors,
      );
    } catch (error) {
      if (error instanceof WalletInputError) {
        send(
          res,
          400,
          { error: 'invalid_amount', message: error.message },
          cors,
        );
        return;
      }
      if (
        error instanceof WalletIdempotencyError ||
        error instanceof LoyaltyIdempotencyError ||
        error instanceof BoostConflictError
      ) {
        send(res, 409, { error: 'conflict', message: error.message }, cors);
        return;
      }
      if (error instanceof HttpError) {
        send(res, error.status, error.body, cors);
        return;
      }
      console.error('[core-api] request failed', req.method, req.url, error);
      send(res, 500, { error: 'internal_error' }, cors);
    }
  };
}
