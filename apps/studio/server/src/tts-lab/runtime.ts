import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkerLoop } from '../worker-loop.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TtsLabModerationRequest } from '@raptoru/schemas';
import { TtsWorker, localTtsCoreClient } from './worker.js';
import { paths, REPO_ROOT } from '../test-lab/local-env.js';
import type { RuntimeWiring } from '../worker-journal.js';

const PLAYER_FILES: Record<string, string> = {
  'player.html': 'text/html',
  'player.js': 'text/javascript',
  'stage.js': 'text/javascript',
  'stage.css': 'text/css',
};

/** TTS V2 Lab in Studio: worker loop + local player page (OBS overlay) + status and moderation. */
export class TtsRuntime {
  private loop: WorkerLoop | null = null;
  private constructor(
    readonly worker: TtsWorker,
    readonly origin: string,
    /** Production profile: remote Core over the future-prod transport (ASTRA-P1-019). */
    readonly production = false,
  ) {}
  /** OBS browser source (1920×1080, transparent). */
  get overlayUrl() {
    return `${this.origin}/tts-lab/player.html#${this.worker.token}`;
  }
  get previewUrl() {
    return `${this.origin}/tts-lab/player.html?preview=1#${this.worker.token}`;
  }

  /** Lab by default (local Lab Core from the environment); `production`: never the Lab Core. */
  static async create(origin: string, production?: RuntimeWiring) {
    const core =
      production?.core ??
      localTtsCoreClient(
        process.env.BONK_LAB_CORE_URL!,
        process.env.BONK_LAB_SECRET!,
      );
    const worker = await TtsWorker.open(
      production?.journal ?? join(paths.runtimeDir, 'tts-lab', 'journal.json'),
      core,
      production?.transport,
    );
    return new TtsRuntime(worker, origin, !!production);
  }
  start() {
    const loop = new WorkerLoop(
      () => this.worker.tick(),
      () => this.worker.busy,
      // Production: a remote Core that fails is retried with a backoff, never every 150 ms.
      this.production ? () => this.worker.error !== null : undefined,
    );
    this.worker.onAdmitted = () => loop.wake();
    this.loop = loop;
    loop.start();
  }
  stop() {
    this.loop?.stop();
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (
      !url.pathname.startsWith('/tts-lab/') &&
      !url.pathname.startsWith('/api/tts-lab/')
    )
      return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (
      req.headers.host !== new URL(this.origin).host ||
      (req.headers.origin && req.headers.origin !== this.origin)
    ) {
      reply(403, { error: 'forbidden_origin' });
      return true;
    }
    const file = url.pathname.slice('/tts-lab/'.length);
    if (req.method === 'GET' && file in PLAYER_FILES) {
      const data = await readFile(
        join(REPO_ROOT, 'apps/studio/server/tts-player', file),
      );
      res.writeHead(200, {
        'content-type': PLAYER_FILES[file]!,
        'cache-control': 'no-store',
        // OBS browser source, or embedded by the Studio page (same origin) for the preview.
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; img-src 'self'; frame-ancestors 'self'",
      });
      res.end(data);
      return true;
    }
    const isPlayer = url.pathname.startsWith('/tts-lab/player/');
    if (
      isPlayer
        ? req.headers['x-tts-token'] !== this.worker.token
        : req.headers['x-raptoru-studio'] !== '1'
    ) {
      reply(403, { error: 'forbidden' });
      return true;
    }
    try {
      let body: Record<string, unknown> = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += String(chunk);
          if (raw.length > 8192) throw new Error('body_too_large');
        }
        body = JSON.parse(raw || '{}');
      }
      if (req.method === 'GET' && url.pathname === '/api/tts-lab/status') {
        let queue: Record<string, unknown> | null = null;
        let coreError: string | null = null;
        try {
          // Production: no Lab queue route on the execution transport.
          if (!this.production) queue = await this.worker.queue();
        } catch {
          coreError = 'core_unavailable';
        }
        reply(200, {
          enabled: true,
          ready: this.worker.ready,
          player: this.worker.playerInfo,
          module_state:
            (queue?.module_state as string | undefined) ??
            this.worker.moduleState,
          overlayUrl: this.overlayUrl,
          previewUrl: this.previewUrl,
          current: this.worker.current,
          error: coreError ?? this.worker.error,
          queue,
        });
      } else if (
        req.method === 'GET' &&
        url.pathname === '/api/tts-lab/audit'
      ) {
        reply(200, await this.worker.audit());
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/tts-lab/moderation'
      ) {
        // Validated here and again by Core; the panel only relays the streamer's action.
        const m = TtsLabModerationRequest.safeParse(body);
        if (!m.success) reply(400, { error: 'invalid_request' });
        else reply(200, await this.worker.moderate(m.data));
      } else if (req.method === 'POST' && isPlayer) {
        const player = String(body.player ?? '');
        if (!/^[a-zA-Z0-9-]{1,64}$/.test(player))
          throw new Error('invalid_player');
        if (url.pathname.endsWith('/heartbeat')) {
          reply(200, {
            ok: true,
            ...(await this.worker.playerHeartbeat(
              player,
              Number(body.voices) || 0,
            )),
          });
        } else if (url.pathname.endsWith('/next')) {
          reply(200, {
            command: await this.worker.command(player, body.accept !== false),
          });
        } else if (
          url.pathname.endsWith('/ack') &&
          ['started', 'completed', 'failed', 'stopped'].includes(
            String(body.event),
          )
        ) {
          const raw =
            body.error && typeof body.error === 'object'
              ? (body.error as Record<string, unknown>)
              : null;
          const error =
            body.event === 'failed' && raw
              ? {
                  code: String(raw.code ?? 'playback_failed').slice(0, 64),
                  message: String(raw.message ?? '').slice(0, 300),
                }
              : null;
          await this.worker.playerAck(
            String(body.interaction_id),
            String(body.attempt_id),
            player,
            body.event as 'started' | 'completed' | 'failed' | 'stopped',
            error,
          );
          reply(200, { ok: true });
        } else reply(404, { error: 'not_found' });
      } else reply(404, { error: 'not_found' });
    } catch (e) {
      reply((e as { status?: number }).status ?? 409, {
        error: (e as Error).message,
      });
    }
    return true;
  }
}
