import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BonkWorker, localCoreClient } from './worker.js';
import { LabObs } from './obs.js';
import { ViewerAuth } from './viewer-auth.js';
import { paths, REPO_ROOT } from '../test-lab/local-env.js';

export class BonkRuntime {
  readonly obs = new LabObs();
  private running = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastObsCheck = 0;
  private sourceReady = false;
  private constructor(
    readonly worker: BonkWorker,
    readonly origin: string,
    readonly viewerAuth: ViewerAuth,
  ) {}
  get overlayUrl() {
    return `${this.origin}/bonk-lab/overlay.html#${this.worker.token}`;
  }

  static async create(origin: string) {
    const core = localCoreClient(
      process.env.BONK_LAB_CORE_URL!,
      process.env.BONK_LAB_SECRET!,
    );
    const worker = await BonkWorker.open(
      join(paths.runtimeDir, 'bonk-lab', 'journal.json'),
      core,
    );
    return new BonkRuntime(worker, origin, new ViewerAuth(core));
  }
  start() {
    const loop = async () => {
      if (!this.running) return;
      if (Date.now() - this.lastObsCheck > 2000) {
        this.sourceReady = await this.obs.sourceReady(this.overlayUrl);
        this.lastObsCheck = Date.now();
      }
      this.worker.setObs(this.obs.connected, this.sourceReady);
      await this.worker.tick();
      if (this.running) this.timer = setTimeout(() => void loop(), 150);
    };
    void loop();
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.obs.disconnect();
    this.viewerAuth.stop();
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (
      !url.pathname.startsWith('/bonk-lab/') &&
      !url.pathname.startsWith('/api/bonk-lab/')
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
    const files = new Set([
      'overlay.html',
      'overlay.js',
      'overlay.css',
      'bonk-v3-core.js',
    ]);
    const file = url.pathname.slice('/bonk-lab/'.length);
    if (req.method === 'GET' && files.has(file)) {
      const data = await readFile(
        join(REPO_ROOT, 'apps/studio/server/bonk-overlay', file),
      );
      res.writeHead(200, {
        'content-type': (
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
          } as Record<string, string>
        )[extname(file)]!,
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https://static-cdn.jtvnw.net; media-src 'self'; frame-ancestors 'none'",
      });
      res.end(data);
      return true;
    }
    const isRenderer = url.pathname.startsWith('/bonk-lab/renderer/');
    if (
      isRenderer
        ? req.headers['x-bonk-token'] !== this.worker.token
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
      if (req.method === 'GET' && url.pathname === '/api/bonk-lab/status') {
        let interactions: unknown[] = [];
        let coreError: string | null = null;
        try {
          interactions = (await this.worker.recent()).interactions;
        } catch {
          coreError = 'core_unavailable';
        }
        reply(200, {
          enabled: true,
          obs: this.obs.connected,
          ready: this.worker.ready,
          sourceReady: this.sourceReady,
          overlayUrl: this.overlayUrl,
          error: coreError ?? this.worker.error,
          interactions,
        });
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/bonk-lab/connect'
      ) {
        await this.obs.connect(Number(body.port), String(body.password ?? ''));
        reply(200, { ok: true });
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/bonk-lab/disconnect'
      ) {
        this.obs.disconnect();
        this.worker.setObs(false, false);
        reply(200, { ok: true });
      } else if (req.method === 'POST' && isRenderer) {
        const renderer = String(body.renderer ?? '');
        if (!/^[a-zA-Z0-9-]{1,64}$/.test(renderer))
          throw new Error('invalid_renderer');
        if (url.pathname.endsWith('/heartbeat')) {
          await this.worker.rendererHeartbeat(renderer);
          reply(200, { ok: true });
        } else if (url.pathname.endsWith('/next'))
          reply(200, { interaction: await this.worker.command(renderer) });
        else if (
          url.pathname.endsWith('/ack') &&
          ['started', 'completed', 'failed'].includes(String(body.event))
        ) {
          await this.worker.rendererAck(
            String(body.interaction_id),
            String(body.attempt_id),
            renderer,
            body.event as 'started' | 'completed' | 'failed',
          );
          reply(200, { ok: true });
        } else reply(404, { error: 'not_found' });
      } else reply(404, { error: 'not_found' });
    } catch (e) {
      reply(409, { error: (e as Error).message });
    }
    return true;
  }
}
