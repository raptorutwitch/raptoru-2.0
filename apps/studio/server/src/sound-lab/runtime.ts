import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SOUND_FILE_RULES } from '@raptoru/schemas';
import { MAX_SOURCE_BYTES, SoundFiles, SoundSources } from './files.js';
import { SoundLibrary } from './library.js';
import { SoundWorker, localSoundCoreClient } from './worker.js';
import { WorkerLoop } from '../worker-loop.js';
import { paths, REPO_ROOT } from '../test-lab/local-env.js';
import type { RuntimeWiring } from '../worker-journal.js';

/** Soundboard V2 Lab in Studio: worker loop + local player page + status for the Lab UI. */
export class SoundRuntime {
  /** Called after a saved setting (the Lab façade drops its cached catalog). */
  onConfigChange: () => void = () => {};
  private loop: WorkerLoop | null = null;
  private constructor(
    readonly worker: SoundWorker,
    readonly origin: string,
    /** The streamer's categories of the bank, one file per profile. */
    readonly library: SoundLibrary,
    /** Production profile: remote Core over the future-prod transport (ASTRA-P1-019). */
    readonly production = false,
    private readonly labReads: boolean,
    /** Local copies of the files published from Studio (one folder per profile, next to the journal). */
    readonly files: SoundFiles,
    /** The originals of the extracts published from this Studio (this PC only), to re-cut a sound later. */
    readonly sources: SoundSources,
  ) {}
  get playerUrl() {
    return `${this.origin}/sound-lab/player.html#${this.worker.token}`;
  }

  /** Lab by default (local Lab Core from the environment); `production`: never the Lab Core. */
  static async create(origin: string, production?: RuntimeWiring) {
    const core =
      production?.core ??
      localSoundCoreClient(
        process.env.BONK_LAB_CORE_URL!,
        process.env.BONK_LAB_SECRET!,
      );
    const journal =
      production?.journal ??
      join(paths.runtimeDir, 'sound-lab', 'journal.json');
    const worker = await SoundWorker.open(journal, core, production?.transport);
    return new SoundRuntime(
      worker,
      origin,
      await SoundLibrary.open(join(dirname(journal), 'sound-library.json')),
      !!production,
      production?.labReads === true,
      new SoundFiles(join(dirname(journal), 'sound-files'), (id) =>
        worker.fileBytes(id),
      ),
      new SoundSources(join(dirname(journal), 'sound-sources')),
    );
  }

  /** Every published file of the catalogue copied locally ahead of a purchase (best effort, never blocking). */
  private warm(sounds: { file_id?: string | null }[]) {
    for (const s of sounds)
      if (s.file_id) void this.files.get(s.file_id).catch(() => {});
  }

  start() {
    void this.worker.config().then(
      (c) => this.warm(c.sounds),
      () => {},
    );
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
    // A published file: Studio's player and page (/sound-lab/files/…), and the Lab extension's preview (its EBS path).
    const media =
      req.method === 'GET'
        ? /^\/(?:sound-lab\/files|ext-lab\/api\/sound-files)\/([0-9a-f]{64})\.wav$/.exec(
            url.pathname,
          )
        : null;
    // The extension's Lab path exists only where the Lab extension is served (Lab, or the Lab on the main Core).
    if (
      media &&
      (!this.production ||
        this.labReads ||
        url.pathname.startsWith('/sound-lab/'))
    )
      return this.serveFile(req, res, media[1]!);
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
    if (
      req.method === 'GET' &&
      [
        'player.html',
        'player.js',
        'audio-choice.js',
        'sound-source.js',
      ].includes(file)
    ) {
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
      // A cut extract from the Soundboard page (the WAV itself as the body): published to Core, then kept locally.
      if (req.method === 'POST' && url.pathname === '/api/sound-lab/files') {
        const chunks: Buffer[] = [];
        let size = 0;
        // Read to the end (a refusal mid-upload would reset the page's connection), keeping at most the limit.
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size <= SOUND_FILE_RULES.maxBytes) chunks.push(chunk as Buffer);
        }
        if (size > SOUND_FILE_RULES.maxBytes)
          throw Object.assign(new Error('file_too_large'), { status: 413 });
        const bytes = Buffer.concat(chunks);
        const file = await this.worker.uploadFile(bytes.toString('base64'));
        // The id is Core's SHA-256 of what it stored: kept only if it is exactly these bytes.
        await this.files.put(file.file_id, bytes);
        reply(200, file);
        return true;
      }
      // The original of a published extract, kept on this PC (raw body; the cut in the query).
      if (req.method === 'POST' && url.pathname === '/api/sound-lab/sources') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size <= MAX_SOURCE_BYTES) chunks.push(chunk as Buffer);
        }
        if (size > MAX_SOURCE_BYTES)
          throw Object.assign(new Error('source_too_large'), { status: 413 });
        const q = url.searchParams;
        const ms = (k: string) => {
          const v = Number(q.get(k));
          if (!Number.isInteger(v) || v < 0) throw new Error('invalid_cut');
          return v;
        };
        await this.sources.put(
          String(q.get('file_id')),
          {
            name: String(q.get('name') ?? '').slice(0, 120),
            start_ms: ms('start_ms'),
            end_ms: ms('end_ms'),
          },
          Buffer.concat(chunks),
        );
        reply(200, { ok: true });
        return true;
      }
      const source =
        req.method === 'GET'
          ? /^\/api\/sound-lab\/sources\/([0-9a-f]{64})$/.exec(url.pathname)
          : null;
      if (source) {
        const found = await this.sources.get(source[1]!);
        if (!found) {
          reply(404, { error: 'no_source' });
          return true;
        }
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'cache-control': 'no-store',
          'x-raptoru-cut': encodeURIComponent(JSON.stringify(found.cut)),
        });
        res.end(found.bytes);
        return true;
      }
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
          // Production: no Lab history route on the execution transport.
          if (!this.production || this.labReads)
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
        const config = await this.worker.config();
        this.warm(config.sounds);
        reply(200, config);
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/sound-lab/sounds'
      ) {
        // A new sound (its file already published): Core validates and decides.
        const created = await this.worker.createSound(body);
        this.onConfigChange();
        reply(200, created);
      } else if (
        req.method === 'POST' &&
        /^\/api\/sound-lab\/sounds\/[a-z0-9][a-z0-9_-]{0,47}\/delete$/.test(
          url.pathname,
        )
      ) {
        const id = url.pathname.split('/').at(-2)!;
        const done = await this.worker.deleteSound(id);
        await this.library.set(id, null).catch(() => {});
        this.onConfigChange();
        reply(200, done);
      } else if (url.pathname === '/api/sound-lab/library') {
        reply(200, {
          categories:
            req.method === 'POST'
              ? await this.library.set(body.sound_id, body.category)
              : this.library.categories,
        });
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
          await this.worker.playerHeartbeat(
            player,
            body.audio === true,
            body.off === true,
          );
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
      // Core's status (e.g. 400 invalid_request from its validation) and details (duplicate_file names the sound that
      // has the extract) are kept for the panel.
      const err = e as { status?: number; body?: Record<string, unknown> };
      reply(err.status ?? 409, {
        ...(err.body && typeof err.body === 'object' ? err.body : {}),
        error: (e as Error).message,
      });
    }
    return true;
  }

  private async serveFile(
    req: IncomingMessage,
    res: ServerResponse,
    fileId: string,
  ) {
    if (req.headers.host !== new URL(this.origin).host) {
      res.writeHead(403).end();
      return true;
    }
    let bytes: Buffer;
    try {
      bytes = await this.files.get(fileId);
    } catch {
      res.writeHead(404, { 'cache-control': 'no-store' }).end();
      return true;
    }
    res.writeHead(200, {
      'content-type': 'audio/wav',
      'content-length': bytes.length,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    res.end(bytes);
    return true;
  }
}
