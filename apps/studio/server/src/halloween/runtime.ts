import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { EVENT_EFFECTS } from '@raptoru/schemas';
import type { LabCoreCall } from '../lab-moderation/proxy.js';

// Halloween (docs/HALLOWEEN.md) — Studio's overlay engine. The overlay is a transparent, click-through, always-on-top
// window opened by Electron's main process on the chosen screen (never focused, never taking a click or a key); it
// loads /halloween/overlay.html from this server and asks it what to play. The Core decides every purchase; this
// runtime only plays what it claimed, ONE at a time, and reports. Rules (same as the effects player):
// - the engine is « ready » only while the overlay page answers (polled within PAGE_MS) and is enabled;
// - a play is handed to the page once; never replayed: not taken / not started in time → failed (the Core refunds);
//   started, no end → ended as failed-after-start (no refund); everything lives in memory (a restart keeps nothing);
// - STOP ALL: the page drops everything at once, the Core refunds what still waited.
// Local tests (Studio's panel, an explicit click) play without the Core and without any payment.

export const HALLOWEEN = {
  /** The overlay page answered within this delay: connected. */
  pageMs: 4000,
  /** Long-poll of the page. */
  waitMs: 10_000,
  /** A play the page did not take within this delay fails. */
  pickupMs: 3000,
  /** Taken, never started (media blocked, unreadable). */
  startMs: 8000,
  /** Started, no end: given up (the media's own length + this margin, at most maxPlayMs). */
  endMarginMs: 8000,
  maxPlayMs: 80_000,
  heartbeatMs: 3000,
  claimMs: 700,
} as const;

export interface HalloweenSettings {
  /** The overlay window is open (Electron) and the engine may play. */
  overlay_enabled: boolean;
  /** Electron display id (null: the primary screen). */
  display_id: number | null;
  /** 0–1, applied to every media. */
  volume: number;
  /** Photosensitivity-safe: no glitch effect, softer contrasts. */
  safe_mode: boolean;
}

const DEFAULT_SETTINGS: HalloweenSettings = {
  overlay_enabled: true,
  display_id: null,
  volume: 0.8,
  safe_mode: false,
};

export interface MediaEntry {
  id: string;
  label: string;
  kind: 'screamer' | 'apparition';
  file: string;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  alpha: boolean;
  audio: boolean;
}

export interface Play {
  kind: string;
  media_id: string | null;
  effect: string | null;
  params: Record<string, unknown>;
  label: string;
  viewer_name: string;
}

interface Delivery {
  delivery_id: string;
  source: 'shop' | 'test';
  purchase_id: string | null;
  attempt_id: string | null;
  play: Play;
  /** The media's url (null: a drawn effect). */
  url: string | null;
  duration_ms: number | null;
  handed_at: number;
  taken_at: number | null;
  started_at: number | null;
  created_at: number;
}

export interface Display {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scale: number;
  primary: boolean;
}

export interface HalloweenDeps {
  /** Studio's own origin (http://127.0.0.1:4100). */
  origin: string;
  /** runtimeDir/halloween: settings, overlay token, media (media/manifest.json + <id>.webm). */
  dir: string;
  pageDir: string;
  /** The profile's Core (Lab Core or the Production Core's installation client); null: local tests only. */
  core: LabCoreCall | null;
  environment: 'lab' | 'production' | null;
  channelId: string;
  studioId: string;
  /** Electron main's own header (displays, overlay config). */
  fromMain: (req: IncomingMessage) => boolean;
  now?: () => number;
  log?: (line: string) => void;
}

type Reply = (status: number, body: unknown) => void;
const json =
  (res: ServerResponse): Reply =>
  (status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };
const PAGE_FILES: Record<string, string> = {
  'overlay.html': 'text/html; charset=utf-8',
  'overlay.js': 'text/javascript; charset=utf-8',
  'overlay.css': 'text/css; charset=utf-8',
};
const MEDIA_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export class HalloweenRuntime {
  private settings: HalloweenSettings = { ...DEFAULT_SETTINGS };
  private token = '';
  private media = new Map<string, MediaEntry>();
  private displays: Display[] = [];
  private current: Delivery | null = null;
  private stopEpoch = 0;
  private lastPoll = 0;
  /** Long-polls of the page waiting right now (a page waiting for work is connected). */
  private polling = 0;
  private pageReady = false;
  private waiters = new Set<() => void>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private claiming = false;
  private coreError: string | null = null;
  private coreOk = false;
  private events: { at: string; text: string; level: 'info' | 'error' }[] = [];

  constructor(private readonly d: HalloweenDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now();
  }

  private log(text: string, level: 'info' | 'error' = 'info') {
    this.events.unshift({
      at: new Date(this.now()).toISOString(),
      text,
      level,
    });
    this.events.length = Math.min(this.events.length, 30);
    this.d.log?.(`[halloween] ${text}`);
  }

  async start() {
    await mkdir(join(this.d.dir, 'media'), { recursive: true });
    const saved = await readFile(
      join(this.d.dir, 'settings.json'),
      'utf8',
    ).then(
      (t) => JSON.parse(t) as Partial<HalloweenSettings>,
      () => ({}),
    );
    this.settings = this.clean({ ...DEFAULT_SETTINGS, ...saved });
    const tokenFile = join(this.d.dir, 'overlay-token');
    this.token = await readFile(tokenFile, 'utf8').then(
      (t) => t.trim(),
      async () => {
        const t = randomBytes(24).toString('base64url');
        await writeFile(tokenFile, t, { mode: 0o600 });
        return t;
      },
    );
    await this.loadMedia();
    if (this.d.core) {
      this.timers.push(
        setInterval(() => void this.heartbeat(), HALLOWEEN.heartbeatMs),
      );
      this.timers.push(setInterval(() => void this.tick(), HALLOWEEN.claimMs));
      void this.heartbeat();
    } else
      this.timers.push(setInterval(() => void this.tick(), HALLOWEEN.claimMs));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.wake();
  }

  private clean(s: HalloweenSettings): HalloweenSettings {
    return {
      overlay_enabled: s.overlay_enabled !== false,
      display_id: Number.isInteger(s.display_id) ? s.display_id : null,
      volume: Math.min(1, Math.max(0, Number(s.volume ?? 0.8))),
      safe_mode: s.safe_mode === true,
    };
  }

  private async saveSettings() {
    const file = join(this.d.dir, 'settings.json');
    await writeFile(`${file}.tmp`, JSON.stringify(this.settings, null, 2));
    await rename(`${file}.tmp`, file);
  }

  /** Reads media/manifest.json; a listed media whose file is gone is ignored. */
  async loadMedia() {
    const dir = join(this.d.dir, 'media');
    const manifest = await readFile(join(dir, 'manifest.json'), 'utf8').then(
      (t) => JSON.parse(t) as { media: MediaEntry[] },
      () => ({ media: [] as MediaEntry[] }),
    );
    this.media = new Map(
      manifest.media
        .filter((m) => MEDIA_ID.test(m.id) && existsSync(join(dir, m.file)))
        .map((m) => [m.id, m]),
    );
    this.log(`${this.media.size} médias chargés`);
    return this.media.size;
  }

  // --- state -------------------------------------------------------------------------------------------------------

  get pageConnected() {
    return this.polling > 0 || this.now() - this.lastPoll < HALLOWEEN.pageMs;
  }

  /** Ready to play a purchase: overlay enabled, page connected and ready. */
  get ready() {
    return (
      this.settings.overlay_enabled && this.pageConnected && this.pageReady
    );
  }

  status() {
    return {
      environment: this.d.environment,
      core: this.d.core
        ? { connected: this.coreOk, error: this.coreError }
        : null,
      engine_ready: this.ready,
      page: {
        connected: this.pageConnected,
        ready: this.pageReady,
        last_poll_ms_ago: this.lastPoll ? this.now() - this.lastPoll : null,
      },
      settings: this.settings,
      displays: this.displays,
      media: [...this.media.values()].map((m) => ({
        id: m.id,
        label: m.label,
        kind: m.kind,
        duration_ms: m.duration_ms,
      })),
      effects: EVENT_EFFECTS.filter(
        (e) => !(this.settings.safe_mode && e === 'glitch'),
      ),
      current: this.current
        ? {
            source: this.current.source,
            label: this.current.play.label,
            viewer: this.current.play.viewer_name,
            state: this.current.started_at
              ? 'playing'
              : this.current.taken_at
                ? 'starting'
                : 'waiting',
          }
        : null,
      events: this.events,
    };
  }

  // --- Core loop ---------------------------------------------------------------------------------------------------

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/events'
      : '/v1/lab/events';
  }

  private async heartbeat() {
    if (!this.d.core) return;
    try {
      await this.d.core(`${this.base}/studio/heartbeat`, {
        studio_instance_id: this.d.studioId,
        channel_id: this.d.channelId,
        engine_ready: this.ready,
        media: [...this.media.keys()],
      });
      if (!this.coreOk) this.log('Core joint');
      this.coreOk = true;
      this.coreError = null;
    } catch (e) {
      if (this.coreOk || !this.coreError)
        this.log(`Core injoignable : ${(e as Error).message}`, 'error');
      this.coreOk = false;
      this.coreError = (e as Error).message;
    }
  }

  /** Timeouts of the current play, then (idle and ready) the next purchase from the Core. */
  async tick() {
    const c = this.current;
    const now = this.now();
    if (c) {
      if (!c.taken_at && now - c.handed_at > HALLOWEEN.pickupMs)
        await this.finish(c, 'failed', false, 'overlay_absent');
      else if (
        c.taken_at &&
        !c.started_at &&
        now - c.taken_at > HALLOWEEN.startMs
      )
        await this.finish(c, 'failed', false, 'not_started');
      else if (
        c.started_at &&
        now - c.started_at >
          Math.min(
            HALLOWEEN.maxPlayMs,
            (c.duration_ms ?? 15_000) + HALLOWEEN.endMarginMs,
          )
      )
        await this.finish(c, 'failed', true, 'no_end');
      return;
    }
    if (!this.d.core || !this.ready || this.claiming) return;
    this.claiming = true;
    try {
      const r = await this.d.core<{
        play: {
          purchase: { purchase_id: string };
          attempt_id: string;
          play: Play;
        } | null;
      }>(`${this.base}/claim`, {
        studio_instance_id: this.d.studioId,
        channel_id: this.d.channelId,
      });
      if (!r.play) return;
      const play = r.play.play;
      const m = play.media_id ? this.media.get(play.media_id) : null;
      const d = this.deliver(
        'shop',
        play,
        r.play.purchase.purchase_id,
        r.play.attempt_id,
      );
      if (play.media_id && !m)
        await this.finish(d, 'failed', false, 'media_missing');
    } catch (e) {
      this.log(`prise en charge impossible : ${(e as Error).message}`, 'error');
    } finally {
      this.claiming = false;
    }
  }

  private deliver(
    source: Delivery['source'],
    play: Play,
    purchaseId: string | null,
    attemptId: string | null,
  ) {
    const m = play.media_id ? this.media.get(play.media_id) : null;
    const now = this.now();
    this.current = {
      delivery_id: randomUUID(),
      source,
      purchase_id: purchaseId,
      attempt_id: attemptId,
      play,
      url: m
        ? `/halloween/media/${m.id}.webm?t=${encodeURIComponent(this.token)}`
        : null,
      duration_ms: m?.duration_ms ?? (Number(play.params.durationMs) || null),
      handed_at: now,
      taken_at: null,
      started_at: null,
      created_at: now,
    };
    this.log(
      `${source === 'test' ? 'test' : 'achat'} : ${play.label}${source === 'shop' ? ` (${play.viewer_name})` : ''}`,
    );
    this.wake();
    return this.current;
  }

  private async ack(
    d: Delivery,
    event: 'started' | 'completed' | 'failed',
    started?: boolean,
    error?: string,
  ) {
    if (d.source !== 'shop' || !this.d.core || !d.purchase_id || !d.attempt_id)
      return;
    try {
      await this.d.core(`${this.base}/purchases/${d.purchase_id}/ack`, {
        studio_instance_id: this.d.studioId,
        attempt_id: d.attempt_id,
        event,
        ...(event === 'failed'
          ? { started: started ?? false, ...(error ? { error } : {}) }
          : {}),
      });
    } catch (e) {
      // The Core's own timeouts settle it (refund when it never played).
      this.log(
        `compte rendu non transmis (${event}) : ${(e as Error).message}`,
        'error',
      );
    }
  }

  private async finish(
    d: Delivery,
    event: 'completed' | 'failed',
    started: boolean,
    error?: string,
  ) {
    if (this.current?.delivery_id === d.delivery_id) this.current = null;
    if (event === 'failed')
      this.log(`${d.play.label} : échec (${error ?? 'inconnu'})`, 'error');
    await this.ack(d, event, started, error);
  }

  /** STOP ALL: the page drops everything now; the Core refunds what waited. */
  async stopAll() {
    this.stopEpoch += 1;
    const c = this.current;
    this.current = null;
    this.wake();
    if (c) await this.ack(c, 'failed', !!c.started_at, 'stopped');
    let refunded = 0;
    if (this.d.core)
      refunded = await this.d
        .core<{ stopped: number }>(
          `${this.base}/channels/${this.d.channelId}/stop`,
          {},
        )
        .then((r) => r.stopped)
        .catch(() => 0);
    this.log('STOP ALL');
    return { stopped: c ? 1 : 0, core_stopped: refunded };
  }

  // --- the overlay page --------------------------------------------------------------------------------------------

  private wake() {
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  private pageView() {
    const c = this.current;
    return {
      stop_epoch: this.stopEpoch,
      settings: {
        volume: this.settings.volume,
        safe_mode: this.settings.safe_mode,
      },
      delivery:
        c && !c.started_at && !c.taken_at
          ? {
              delivery_id: c.delivery_id,
              kind: c.play.kind,
              media: c.url,
              effect: c.play.effect,
              params: c.play.params,
              label: c.play.label,
              viewer: c.play.viewer_name,
              duration_ms: c.duration_ms,
            }
          : null,
    };
  }

  private async next(url: URL, reply: Reply) {
    this.lastPoll = this.now();
    this.pageReady = url.searchParams.get('ready') === '1';
    const known = Number(url.searchParams.get('epoch') ?? -1);
    let v = this.pageView();
    if (
      !v.delivery &&
      known === this.stopEpoch &&
      url.searchParams.get('wait') === '1'
    ) {
      this.polling += 1;
      try {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, HALLOWEEN.waitMs);
          this.waiters.add(() => {
            clearTimeout(t);
            resolve();
          });
        });
      } finally {
        this.polling -= 1;
      }
      this.lastPoll = this.now();
      v = this.pageView();
    }
    if (v.delivery && this.current) this.current.taken_at = this.now();
    reply(200, v);
  }

  private async report(body: Record<string, unknown>, reply: Reply) {
    const c = this.current;
    if (!c || body.delivery_id !== c.delivery_id)
      return reply(200, { ok: true, stale: true });
    const event = String(body.event);
    if (event === 'started') {
      if (!c.started_at) {
        c.started_at = this.now();
        await this.ack(c, 'started');
      }
    } else if (event === 'ended') await this.finish(c, 'completed', true);
    else if (event === 'failed')
      await this.finish(
        c,
        'failed',
        !!c.started_at,
        String(body.error ?? 'play_failed').slice(0, 100),
      );
    reply(200, { ok: true });
  }

  /** The media, with byte ranges (a <video> asks for them). */
  private async serveMedia(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
  ) {
    const m = this.media.get(id);
    const file = m ? join(this.d.dir, 'media', m.file) : null;
    if (!m || !file) return json(res)(404, { error: 'media_not_found' });
    const size = (await stat(file)).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range) {
      const start = range[1]
        ? Number(range[1])
        : Math.max(0, size - Number(range[2]));
      const end =
        range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, {
        'content-type': 'video/webm',
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'content-type': 'video/webm',
      'content-length': size,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  }

  private tokenOk(given: string | null) {
    const a = Buffer.from(given ?? '');
    const b = Buffer.from(this.token);
    return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  }

  overlayUrl() {
    return `${this.d.origin}/halloween/overlay.html#${this.token}`;
  }

  // --- HTTP ----------------------------------------------------------------------------------------------------------

  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 64 * 1024)
        throw Object.assign(new Error('body_too_large'), { status: 413 });
    }
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw Object.assign(new Error('bad_json'), { status: 400 });
    return v as Record<string, unknown>;
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const p = url.pathname;
    const isApi = p.startsWith('/api/halloween/') || p === '/api/halloween';
    const isPage = p.startsWith('/halloween/');
    if (!isApi && !isPage) return false;
    const reply = json(res);
    const origin = new URL(this.d.origin);
    if (
      req.headers.host !== origin.host ||
      (req.headers.origin && req.headers.origin !== this.d.origin)
    ) {
      reply(403, { error: 'forbidden_origin' });
      return true;
    }
    try {
      if (isPage) await this.page(req, res, url, reply);
      else await this.api(req, url, reply);
    } catch (e) {
      const err = e as {
        status?: number;
        body?: Record<string, unknown>;
        message: string;
      };
      if (!res.headersSent)
        reply(err.status ?? 503, {
          ...(err.body ?? {}),
          error: err.body?.error ?? err.message,
        });
    }
    return true;
  }

  private async page(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    reply: Reply,
  ) {
    const name = url.pathname.slice('/halloween/'.length);
    if (req.method === 'GET' && PAGE_FILES[name]) {
      const data = await readFile(join(this.d.pageDir, name));
      res.writeHead(200, {
        'content-type': PAGE_FILES[name],
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; media-src 'self'; img-src 'self' data:; connect-src 'self'",
      });
      return res.end(data);
    }
    const token =
      url.searchParams.get('t') ?? String(req.headers['x-overlay-token'] ?? '');
    if (!this.tokenOk(token)) return reply(401, { error: 'bad_token' });
    const mediaMatch = /^media\/([a-z0-9][a-z0-9-]{0,39})\.webm$/.exec(name);
    if (req.method === 'GET' && mediaMatch)
      return this.serveMedia(req, res, mediaMatch[1]!);
    if (req.method === 'GET' && name === 'overlay/next')
      return this.next(url, reply);
    if (req.method === 'POST' && name === 'overlay/report')
      return this.report(await this.body(req), reply);
    reply(404, { error: 'not_found' });
  }

  private requireCore() {
    if (!this.d.core)
      throw Object.assign(new Error('core_unavailable'), { status: 503 });
    return this.d.core;
  }

  private async api(req: IncomingMessage, url: URL, reply: Reply) {
    const p = url.pathname;
    // Electron main: the screens, and what to open where.
    if (
      p === '/api/halloween/displays' ||
      p === '/api/halloween/overlay-config'
    ) {
      if (!this.d.fromMain(req)) return reply(403, { error: 'main_only' });
      if (req.method === 'POST' && p === '/api/halloween/displays') {
        const list = (await this.body(req)).displays;
        this.displays = Array.isArray(list)
          ? (list as Display[]).slice(0, 16)
          : [];
        return reply(200, { ok: true });
      }
      const display =
        this.displays.find((x) => x.id === this.settings.display_id) ??
        this.displays.find((x) => x.primary) ??
        null;
      return reply(200, {
        enabled: this.settings.overlay_enabled,
        display_id: display?.id ?? null,
        url: this.overlayUrl(),
      });
    }
    if (req.headers['x-raptoru-studio'] !== '1')
      return reply(403, { error: 'forbidden' });
    if (req.method === 'GET' && p === '/api/halloween/status')
      return reply(200, this.status());
    if (req.method === 'POST' && p === '/api/halloween/settings') {
      const b = await this.body(req);
      this.settings = this.clean({
        ...this.settings,
        ...(b as Partial<HalloweenSettings>),
      });
      await this.saveSettings();
      if (!this.settings.overlay_enabled && this.current) await this.stopAll();
      this.wake();
      return reply(200, this.status());
    }
    if (req.method === 'POST' && p === '/api/halloween/media/reload') {
      await this.loadMedia();
      return reply(200, this.status());
    }
    if (req.method === 'POST' && p === '/api/halloween/stop')
      return reply(200, await this.stopAll());
    if (req.method === 'POST' && p === '/api/halloween/test') {
      // An explicit click of the streamer: plays now, without the Core and without any payment.
      const b = await this.body(req);
      if (!this.pageConnected) return reply(409, { error: 'overlay_absent' });
      if (this.current) return reply(409, { error: 'busy' });
      const media =
        typeof b.media_id === 'string' ? this.media.get(b.media_id) : null;
      const effect =
        typeof b.effect === 'string' &&
        (EVENT_EFFECTS as readonly string[]).includes(b.effect)
          ? b.effect
          : null;
      if (!media && !effect)
        return reply(400, { error: 'unknown_media_or_effect' });
      if (effect === 'glitch' && this.settings.safe_mode)
        return reply(409, { error: 'safe_mode' });
      this.deliver(
        'test',
        {
          kind: media ? media.kind : 'effect',
          media_id: media?.id ?? null,
          effect,
          params: (b.params as Record<string, unknown>) ?? {},
          label: media?.label ?? effect ?? '',
          viewer_name: 'Studio (test)',
        },
        null,
        null,
      );
      return reply(200, { ok: true });
    }
    // The Core's shop (catalogue, rules, Bonbons): relayed for Studio's panel.
    const ch = this.d.channelId;
    if (req.method === 'GET' && p === '/api/halloween/admin')
      return reply(
        200,
        await this.requireCore()(`${this.base}/channels/${ch}/admin`),
      );
    if (req.method === 'POST' && p === '/api/halloween/admin/settings')
      return reply(
        200,
        await this.requireCore()(
          `${this.base}/channels/${ch}/settings`,
          await this.body(req),
        ),
      );
    const item =
      /^\/api\/halloween\/admin\/items\/([a-z0-9][a-z0-9-]{0,39})$/.exec(p);
    if (req.method === 'POST' && item)
      return reply(
        200,
        await this.requireCore()(
          `${this.base}/channels/${ch}/items/${item[1]}`,
          await this.body(req),
        ),
      );
    if (req.method === 'POST' && p === '/api/halloween/admin/grant') {
      const b = await this.body(req);
      return reply(
        200,
        await this.requireCore()(`${this.base}/grant`, {
          ...b,
          channel_id: ch,
        }),
      );
    }
    reply(404, { error: 'not_found' });
  }
}
