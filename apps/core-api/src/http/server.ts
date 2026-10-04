import { timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
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
import type {
  ActiveSession,
  StreamSessions,
} from '../stream/stream-sessions.js';

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
  /** Readiness probe (GET /ready): the database answers. */
  db?: Pick<Db, 'query'>;
}

type Auth = 'public' | 'bot' | 'studio';

export interface Route {
  method: 'GET' | 'POST';
  pattern: RegExp;
  auth: Auth;
  handle: (ctx: {
    params: string[];
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
  db,
}: AppDeps): Route[] {
  return [
    ...walletRoutes(wallet),
    ...loyaltyRoutes(loyalty),
    ...(bonkLab ? bonkLabRoutes(bonkLab) : []),
    ...(soundLab ? soundLabRoutes(soundLab) : []),
    ...(ttsLab ? ttsLabRoutes(ttsLab) : []),
    ...(ttsLab && labModeration && raffleLab
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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createApp(deps: AppDeps): Server {
  const table = routes(deps);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://core');
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
      const params = route.pattern.exec(url.pathname)!.slice(1);
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      send(res, 200, await route.handle({ params, body, url }));
    } catch (error) {
      if (error instanceof WalletInputError) {
        send(res, 400, { error: 'invalid_amount', message: error.message });
        return;
      }
      if (
        error instanceof WalletIdempotencyError ||
        error instanceof LoyaltyIdempotencyError ||
        error instanceof BoostConflictError
      ) {
        send(res, 409, { error: 'conflict', message: error.message });
        return;
      }
      if (error instanceof HttpError) {
        send(res, error.status, error.body);
        return;
      }
      console.error('[core-api] request failed', req.method, req.url, error);
      send(res, 500, { error: 'internal_error' });
    }
  });
}
