import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WorkerLoop } from '../worker-loop.js';
import { dirname, join, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BonkLabThirdPartyCatalog } from '@raptoru/schemas';
import { BonkWorker, localCoreClient, type CoreCall } from './worker.js';
import { LabObs } from './obs.js';
import { AUTO_EVENTS, ObsAuto } from './obs-auto.js';
import type { Candidate } from './obs-scene.js';
import { BonkSettingsStore } from './settings.js';
import { ViewerAuth } from './viewer-auth.js';
import { paths, REPO_ROOT } from '../test-lab/local-env.js';
import type { RuntimeWiring } from '../worker-journal.js';

/** Renderer modules of the overlay (bonk-overlay/engine), served next to overlay.js. */
const ENGINE_FILES = [
  'audio.js',
  'cadence.js',
  'density.js',
  'families.js',
  'physics.js',
  'plan.js',
  'presets.js',
  'scene.js',
  'size.js',
  'target.js',
];
/** « Tester » preview: at most this many shots pending; local Twemoji only. */
const PREVIEW_MAX = 10;
const PREVIEW_EMOJIS = [
  '1f600',
  '1f923',
  '1f60e',
  '1f525',
  '1f480',
  '1f44d',
  '1f4a5',
  '1f921',
];

export class BonkRuntime {
  /** Read-only OBS client; subscribed to the scene events Auto needs (lot 3). */
  readonly obs = new LabObs(AUTO_EVENTS);
  /** Auto target: the camera found in the OBS program scene (lot 3). */
  readonly auto = new ObsAuto(this.obs);
  /** Pending « Tester » shots (memory only, never journaled, never sent to Core). */
  private readonly preview: { preview_id: string; emote_url: string }[] = [];
  private previewSeq = 0;
  private loop: WorkerLoop | null = null;
  private lastObsCheck = 0;
  private sourceReady = false;
  private constructor(
    readonly worker: BonkWorker,
    readonly origin: string,
    readonly viewerAuth: ViewerAuth,
    private readonly core: CoreCall,
    /** Production profile: remote Core over the future-prod transport (ASTRA-P1-019). */
    readonly production: boolean,
    /** Where the Bonks aim (lot 2), one file per profile next to its journal. */
    readonly settings: BonkSettingsStore,
  ) {
    this.obs.onEvent = (type, data) => this.auto.onEvent(type, data);
    this.obs.onConnected = () => this.auto.onConnected();
  }
  /** Public 7TV/BTTV/FFZ catalog of the channel, resolved by Lab Core (metadata + CDN URLs). */
  readonly thirdPartyCatalog = (refresh = false) =>
    this.core<BonkLabThirdPartyCatalog>(
      '/v1/lab/bonk/third-party/catalog' + (refresh ? '?refresh=1' : ''),
      undefined,
      { timeoutMs: 20_000 },
    );
  get overlayUrl() {
    return `${this.origin}/bonk-lab/overlay.html#${this.worker.token}`;
  }

  /** Lab by default (local Lab Core from the environment); `production`: never the Lab Core. */
  static async create(origin: string, production?: RuntimeWiring) {
    const core =
      production?.core ??
      localCoreClient(
        process.env.BONK_LAB_CORE_URL!,
        process.env.BONK_LAB_SECRET!,
      );
    const journal =
      production?.journal ?? join(paths.runtimeDir, 'bonk-lab', 'journal.json');
    const worker = await BonkWorker.open(journal, core, production?.transport);
    const settings = await BonkSettingsStore.open(
      join(dirname(journal), 'bonk-settings.json'),
    );
    return new BonkRuntime(
      worker,
      origin,
      new ViewerAuth(core),
      core,
      !!production,
      settings,
    );
  }
  /**
   * What the live renderer aims at: Fullscreen, the Manuel zone, or in Auto the camera found in the
   * OBS program scene — the Manuel zone when Auto has no reliable camera right now (lot 3).
   */
  effectiveTarget() {
    const t = this.settings.target();
    const s = this.settings.settings;
    if (s.mode !== 'auto') return t;
    const chosen = this.auto.snapshot(s.auto.pinned).chosen;
    return chosen ? { ...t, rect: { ...chosen.rect } } : t;
  }

  /** Auto state for the Studio editor (no polygons: names, paths, boxes, scores and reasons). */
  autoView() {
    const s = this.settings.settings;
    const snap = this.auto.snapshot(s.auto.pinned);
    const view = (c: Candidate) => ({
      name: c.name,
      uuid: c.uuid,
      input_kind: c.inputKind,
      path: c.path,
      rect: c.rect,
      area: c.area,
      score: c.score,
      reliable: c.reliable,
      reasons: c.reasons,
    });
    return {
      mode: s.mode,
      status: snap.status,
      reason: snap.reason,
      scene: snap.scene,
      pinned: snap.pinned,
      chosen: snap.chosen ? view(snap.chosen) : null,
      candidates: snap.candidates.map(view),
      error: this.auto.error,
    };
  }

  /** Live OBS / overlay state (moderation cockpit). */
  summary() {
    return {
      obs: this.obs.connected,
      ready: this.worker.ready,
      source_ready: this.sourceReady,
    };
  }

  start() {
    const loop = new WorkerLoop(
      async () => {
        if (Date.now() - this.lastObsCheck > 2000) {
          this.sourceReady = await this.obs.sourceReady(this.overlayUrl);
          this.lastObsCheck = Date.now();
        }
        this.worker.setObs(this.obs.connected, this.sourceReady);
        await this.worker.tick();
      },
      () => this.worker.busy,
      // Production: a remote Core that fails is retried with a backoff, never every 150 ms.
      this.production ? () => this.worker.error !== null : undefined,
    );
    this.worker.onAdmitted = () => loop.wake();
    this.loop = loop;
    loop.start();
    this.auto.start();
  }
  stop() {
    this.auto.stop();
    this.loop?.stop();
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
      ...ENGINE_FILES.map((f) => `engine/${f}`),
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
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https://static-cdn.jtvnw.net https://cdn.7tv.app https://cdn.betterttv.net https://cdn.frankerfacez.com; media-src 'self'; frame-ancestors 'none'",
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
          // Production: no Lab history route on the execution transport.
          if (!this.production)
            interactions = (await this.worker.recent()).interactions;
        } catch {
          coreError = 'core_unavailable';
        }
        reply(200, {
          enabled: true,
          obs: this.obs.connected,
          obs_reconnecting: this.obs.reconnecting,
          obs_error: this.obs.error,
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
        req.method === 'GET' &&
        url.pathname === '/api/bonk-lab/settings'
      ) {
        reply(200, { settings: this.settings.settings });
      } else if (
        req.method === 'GET' &&
        url.pathname === '/api/bonk-lab/auto'
      ) {
        reply(200, this.autoView());
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/bonk-lab/settings'
      ) {
        // « Enregistrer » of the zone editor: validated, persisted, then served to the overlay.
        reply(200, { ok: true, settings: await this.settings.save(body) });
      } else if (
        req.method === 'GET' &&
        url.pathname === '/api/bonk-lab/obs-screenshot'
      ) {
        if (!this.obs.connected) throw new Error('obs_offline');
        reply(200, { image: await this.obs.programScreenshot() });
      } else if (
        req.method === 'POST' &&
        url.pathname === '/api/bonk-lab/preview'
      ) {
        // « Tester » (Bonk VNext lot 1): renderer-only shots kept in memory. No Core call, no
        // wallet, no delivery journal, no ACK, no history.
        const count = Number(body.count);
        if (!Number.isInteger(count) || count < 1 || count > PREVIEW_MAX)
          throw new Error('invalid_preview_count');
        if (!this.worker.ready) throw new Error('overlay_not_ready');
        for (let n = 0; n < count; n++)
          this.preview.push({
            preview_id: `preview-${randomUUID()}`,
            emote_url: `assets/twemoji/svg/${PREVIEW_EMOJIS[this.previewSeq++ % PREVIEW_EMOJIS.length]}.svg`,
          });
        this.preview.splice(0, Math.max(0, this.preview.length - PREVIEW_MAX));
        reply(200, { ok: true, queued: count });
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
        } else if (url.pathname.endsWith('/config')) {
          // Saved target only (the Studio editor's draft never reaches the overlay).
          reply(200, {
            target: this.worker.isLiveRenderer(renderer)
              ? this.effectiveTarget()
              : null,
          });
        } else if (url.pathname.endsWith('/preview')) {
          // Only the live renderer draws previews; nothing else is read or written.
          reply(200, {
            shots: this.worker.isLiveRenderer(renderer)
              ? this.preview.splice(0)
              : [],
          });
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
