import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SoundWorker, localSoundCoreClient } from './worker.js';
import { WorkerLoop } from '../worker-loop.js';
import { paths, REPO_ROOT } from '../test-lab/local-env.js';

/** Soundboard V2 Lab in Studio: worker loop + local player page + status for the Lab UI. */
export class SoundRuntime {
  /** Called after a saved setting (the Lab façade drops its cached catalog). */
  onConfigChange: () => void = () => {};
  private loop: WorkerLoop | null = null;
  private constructor(
    readonly worker: SoundWorker,
    readonly origin: string,
  ) {}
  get playerUrl() {
    return `${this.origin}/sound-lab/player.html#${this.worker.token}`;
  }

  static async create(origin: string) {
    const core = localSoundCoreClient(
      process.env.BONK_LAB_CORE_URL!,
      process.env.BONK_LAB_SECRET!,
    );
    const worker = await SoundWorker.open(
      join(paths.runtimeDir, 'sound-lab', 'journal.json'),
      core,
    );
    return new SoundRuntime(worker, origin);
  }
  start() {
    const loop = new WorkerLoop(
      () => this.worker.tick(),
      () => this.worker.busy,
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
      !url.pathname.startsWith('/sound-lab/') &&
      !url.pathname.startsWith('/api/sound-lab/')
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
    const file = url.pathname.slice('/sound-lab/'.length);
    if (req.method === 'GET' && ['player.html', 'player.js'].includes(file)) {
      const data = await readFile(
        join(REPO_ROOT, 'apps/studio/server/sound-player', file),
      );
      res.writeHead(200, {
        'content-type':
          extname(file) === '.html' ? 'text/html' : 'text/javascript',
        'cache-control': 'no-store',
        // Embedded by the Studio Lab page (same origin) to receive the "enable sound" click.
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; frame-ancestors 'self'",
      });
      res.end(data);
      return true;
    }
    const isPlayer = url.pathname.startsWith('/sound-lab/player/');
    if (
      isPlayer
        ? req.headers['x-sound-token'] !== this.worker.token
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
      if (req.method === 'GET' && url.pathname === '/api/sound-lab/status') {
        let interactions: unknown[] = [];
        let coreError: string | null = null;
        try {
          interactions = (await this.worker.recent()).interactions;
        } catch {
          coreError = 'core_unavailable';
        }
        reply(200, {
          enabled: true,
          ready: this.worker.ready,
          playerUrl: this.playerUrl,
          error: coreError ?? this.worker.error,
          interactions,
        });
      } else if (
        req.method === 'GET' &&
        url.pathname === '/api/sound-lab/config'
      ) {
        reply(200, await this.worker.config());
      } else if (
        req.method === 'POST' &&
        /^\/api\/sound-lab\/sounds\/[a-z0-9][a-z0-9_-]{0,47}$/.test(
          url.pathname,
        )
      ) {
        // Validation is Core's (strict schema): the panel only relays the edited fields.
        const updated = await this.worker.updateSound(
          url.pathname.split('/').pop()!,
          body,
        );
        this.onConfigChange();
        reply(200, updated);
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/sound-lab/settings'
      ) {
        reply(
          200,
          await this.worker.updateSettings({
            volume_protection: body.volume_protection as never,
          }),
        );
      } else if (req.method === 'POST' && isPlayer) {
        const player = String(body.player ?? '');
        if (!/^[a-zA-Z0-9-]{1,64}$/.test(player))
          throw new Error('invalid_player');
        if (url.pathname.endsWith('/heartbeat')) {
          await this.worker.playerHeartbeat(player, body.audio === true);
          reply(200, { ok: true, settings: this.worker.settings });
        } else if (url.pathname.endsWith('/next'))
          reply(200, {
            // Moderation stops first, then the next sound (never replayed).
            stop: await this.worker.stopOrders(player),
            interaction: await this.worker.command(player),
          });
        else if (
          url.pathname.endsWith('/ack') &&
          ['started', 'completed', 'failed', 'stopped'].includes(
            String(body.event),
          )
        ) {
          const error =
            body.event === 'failed' &&
            body.error &&
            typeof body.error === 'object'
              ? {
                  code: String(
                    (body.error as Record<string, unknown>).code ??
                      'playback_failed',
                  ).slice(0, 64),
                  message: String(
                    (body.error as Record<string, unknown>).message ?? '',
                  ).slice(0, 300),
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
      // Core's status (e.g. 400 invalid_request from its validation) is kept for the panel.
      reply((e as { status?: number }).status ?? 409, {
        error: (e as Error).message,
      });
    }
    return true;
  }
}
