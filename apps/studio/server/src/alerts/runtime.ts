import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { LabCoreCall } from '../lab-moderation/proxy.js';
import type { AlertMediaStore } from './media-store.js';
import { AlertPlacementStore } from './placement-store.js';
import type { SeTipsLink } from './se-tips.js';

// Twitch alerts V1 (A2) in Studio (docs/TWITCH_ALERTS_PARITY_2026-10.md § 14). Core decides and queues; Studio serves
// the OBS source and its media, and relays the source's claim / reports to Core (token from the source URL). The
// Studio tab's preview plays the same engine WITHOUT the queue (no claim, no report). A claimed alert whose media is
// missing in Studio's storage is reported failed (media_missing) at once: never played half, never replayed.
// Calibration (17/10/2026): each claimed alert carries its variant's SAVED placement (placement-store.ts), read at
// claim time, so a change applies from the next alert on and never moves one already playing.

const MAX_BODY = 4096;
const PLAYER_FILES: Record<string, string> = {
  'player.html': 'text/html; charset=utf-8',
  'player.js': 'text/javascript; charset=utf-8',
  'preview.html': 'text/html; charset=utf-8',
  'preview.js': 'text/javascript; charset=utf-8',
  'engine.js': 'text/javascript; charset=utf-8',
  'timeline.js': 'text/javascript; charset=utf-8',
  'alerts.css': 'text/css; charset=utf-8',
};
/** The files the OBS source runs: their content is its version (a change on disk = a new version). */
const SOURCE_FILES = [
  'player.html',
  'player.js',
  'engine.js',
  'timeline.js',
  'alerts.css',
];
const VERSION_MARK = '%PLAYER_VERSION%';
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; frame-ancestors 'self'";

/** The test event fields the Studio tab may set (Core validates them all). */
const TEST_FIELDS = [
  'type',
  'actor',
  'anonymous',
  'recipient',
  'count',
  'tier',
  'months',
  'bits',
  'viewers',
  'amount',
  'message',
] as const;

interface Variant {
  id: string;
  video?: string;
  audio?: string;
}
interface ClaimedAlert {
  alert_id: string;
  attempt_id: string;
  family?: string;
  variant: Variant;
  data: Record<string, unknown>;
}

export interface AlertsRuntimeDeps {
  channelId: string;
  core: LabCoreCall;
  /** Studio's own origin (http://127.0.0.1:<port>). */
  origin: string;
  /** Studio storage for this module (the OBS source token). */
  dir: string;
  /** The OBS source / preview files (apps/studio/server/alerts-player). */
  playerDir: string;
  media: AlertMediaStore;
  /**
   * Real Twitch events (17/10/2026): the Lab chat adapter's state (it carries the alert subscriptions) and its
   * restart, so a new mode applies (the adapter reads it at start). Absent: the mode is kept but unused.
   */
  twitch?: {
    status(): {
      ingestion_enabled: boolean;
      ingestion_running: boolean;
      token_login: string | null;
      follow_scope: boolean;
    };
    restart(): Promise<void>;
  };
  /** Real StreamElements donations (se-tips.ts): its own mode, connection and journal under /api/alerts/se. */
  se?: SeTipsLink;
  /**
   * Which Core holds the queue (§ 22): the Lab Core (/v1/lab/alerts, default) or the production Core of the paired
   * Studio (/v1/studio/alerts). Same service, same sub-paths: only the base and the client change.
   */
  environment?: 'lab' | 'production';
}

/**
 * « Événements Twitch réels », Studio storage, OFF by default and after any unreadable file:
 * off = no alert subscription; test = received and logged, never queued; active = queued in the Core of this profile
 * (the OBS source connected to this Studio plays them). A saved ACTIVE is never resumed by a Studio start: it starts
 * in TEST until chosen again (§ 22).
 */
export const TWITCH_MODES = ['off', 'test', 'active'] as const;
/** The production bot reports every minute: older than this, its reception is shown as « sans nouvelles ». */
export const BOT_REPORT_STALE_MS = 3 * 60_000;
export type TwitchMode = (typeof TWITCH_MODES)[number];

export class AlertsRuntime {
  private constructor(
    private readonly d: AlertsRuntimeDeps,
    private readonly token: string,
    readonly placement: AlertPlacementStore,
    private mode: TwitchMode,
    /** ACTIVE was saved but this start resumed in TEST (shown until a mode is chosen). */
    private resumedFromActive = false,
  ) {}

  private lastSource: { at: number; current: boolean } | null = null;

  /** OBS source: seen in the last 5 s (it asks every second), on the current files or not. */
  private sourceView() {
    if (!this.lastSource) return { seen: false, ago_ms: null, current: null };
    const ago = Date.now() - this.lastSource.at;
    return { seen: ago < 5000, ago_ms: ago, current: this.lastSource.current };
  }

  private get base() {
    return this.d.environment === 'production'
      ? '/v1/studio/alerts'
      : '/v1/lab/alerts';
  }

  /** The mode given to the Lab chat adapter at its start. */
  get twitchMode() {
    return this.mode;
  }

  static async create(d: AlertsRuntimeDeps) {
    await mkdir(d.dir, { recursive: true });
    const tokenFile = join(d.dir, 'player-token');
    let token = '';
    try {
      token = (await readFile(tokenFile, 'utf8')).trim();
    } catch {
      /* first run */
    }
    if (!/^[a-f0-9]{32}$/.test(token)) {
      token = randomBytes(16).toString('hex');
      await writeFile(tokenFile, token);
    }
    let mode: TwitchMode = 'off';
    try {
      const saved = JSON.parse(
        await readFile(join(d.dir, 'twitch-mode.json'), 'utf8'),
      ).mode;
      if (TWITCH_MODES.includes(saved)) mode = saved;
    } catch {
      /* OFF by default */
    }
    // Never an automatic start of the real alerts: a saved ACTIVE resumes as TEST (observation).
    const resumed = mode === 'active';
    return new AlertsRuntime(
      d,
      token,
      await AlertPlacementStore.open(join(d.dir, 'placement.json')),
      resumed ? 'test' : mode,
      resumed,
    );
  }

  /** The OBS browser source (1920×1080). */
  get playerUrl() {
    return `${this.d.origin}/alerts/player.html#${this.token}`;
  }

  /** Media names a variant needs that are not in Studio's storage. */
  missing(v: Variant) {
    return [v.video, v.audio].filter(
      (n): n is string => !!n && this.d.media.path(n) === null,
    );
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const isApi = url.pathname.startsWith('/api/alerts/');
    const isPage = url.pathname.startsWith('/alerts/');
    if (!isApi && !isPage) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
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
      else if (req.headers['x-raptoru-studio'] !== '1')
        reply(403, { error: 'forbidden' });
      else await this.api(req, url, reply);
    } catch (e) {
      const err = e as {
        status?: number;
        body?: Record<string, unknown>;
        message: string;
      };
      if (res.headersSent) return true;
      reply(err.status ?? 503, {
        ...(err.body ?? {}),
        error: err.body?.error ?? err.message,
      });
    }
    return true;
  }

  private async body(req: IncomingMessage) {
    let raw = '';
    for await (const chunk of req) {
      raw += String(chunk);
      if (raw.length > MAX_BODY)
        throw Object.assign(new Error('body_too_large'), { status: 413 });
    }
    try {
      return JSON.parse(raw || '{}') as Record<string, unknown>;
    } catch {
      throw Object.assign(new Error('invalid_json'), { status: 400 });
    }
  }

  /** The Studio tab: queue state, catalogue (with media availability), test events. */
  private async api(
    req: IncomingMessage,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const p = url.pathname.slice('/api/alerts'.length);
    if (p === '/se' || p.startsWith('/se/'))
      return this.d.se
        ? this.d.se.api(req, p.slice(3), () => this.body(req), reply)
        : reply(404, { error: 'not_found' });
    if (req.method === 'GET' && p === '/state')
      return reply(200, {
        ...(await this.d.core<Record<string, unknown>>(
          `${this.base}/${this.d.channelId}/state`,
        )),
        media: this.d.media.status(),
        environment: this.d.environment ?? 'lab',
        source: this.sourceView(),
        player_url: this.playerUrl,
        preview_url: '/alerts/preview.html',
      });
    if (req.method === 'GET' && p === '/catalog') {
      const { variants } = await this.d.core<{ variants: Variant[] }>(
        `${this.base}/catalog`,
      );
      return reply(200, {
        variants: variants.map((v) => ({ ...v, missing: this.missing(v) })),
      });
    }
    if (req.method === 'GET' && p === '/twitch')
      return reply(
        200,
        this.d.environment === 'production'
          ? await this.productionTwitchView()
          : this.twitchView(),
      );
    // Lot 9: in Production the real events come from the production bot; its mode is its ALERTS_MODE (on the bot).
    if (
      req.method === 'POST' &&
      p === '/twitch' &&
      this.d.environment === 'production'
    )
      return reply(409, { error: 'set_on_production_bot' });
    if (req.method === 'POST' && p === '/twitch') {
      const mode = (await this.body(req)).mode as TwitchMode;
      if (!TWITCH_MODES.includes(mode))
        return reply(400, { error: 'invalid_mode' });
      if (mode !== this.mode || this.resumedFromActive) {
        await writeFile(
          join(this.d.dir, 'twitch-mode.json'),
          JSON.stringify({ mode }),
        );
        const changed = mode !== this.mode;
        this.mode = mode;
        this.resumedFromActive = false;
        if (changed) await this.d.twitch?.restart();
      }
      return reply(200, this.twitchView());
    }
    if (req.method === 'GET' && p === '/placement')
      return reply(200, { variants: this.placement.all() });
    const placed = /^\/placement\/([a-z0-9_]{1,64})$/.exec(p);
    if (req.method === 'PUT' && placed)
      return reply(200, {
        placement: await this.placement.save(placed[1]!, await this.body(req)),
      });
    if (req.method === 'POST' && p === '/test') {
      // A simulated event through Core's normal path (dedup, variant draw, queue): the OBS source plays it.
      const body = await this.body(req);
      const event: Record<string, unknown> = {
        channel_id: this.d.channelId,
        source: 'simulation',
        source_event_id: `studio-test-${randomUUID()}`,
      };
      for (const k of TEST_FIELDS) if (k in body) event[k] = body[k];
      return reply(200, await this.d.core(`${this.base}/events`, event));
    }
    reply(404, { error: 'not_found' });
  }

  /**
   * Lot 9 — Production profile: what the production bot last reported to the main Core (mode, subscriptions, outbox)
   * and the last real Twitch event Core received. Read only: Studio never subscribes to EventSub itself.
   */
  private async productionTwitchView() {
    const r = await this.d.core<{
      bot: {
        mode: TwitchMode;
        subscriptions: string[];
        refused: string[];
        pending: number;
        reported_at: string;
        age_ms: number;
      } | null;
      last_twitch_event_at: string | null;
      max_age_ms: number | null;
    }>(`${this.base}/${this.d.channelId}/reception`);
    return {
      mode: r.bot?.mode ?? 'off',
      environment: 'production' as const,
      available: true,
      managed_by: 'production_bot' as const,
      bot: r.bot,
      last_twitch_event_at: r.last_twitch_event_at,
      max_age_ms: r.max_age_ms,
      resumed_from_active: false,
      ingestion_enabled: r.bot !== null,
      ingestion_running: r.bot !== null && r.bot.age_ms < BOT_REPORT_STALE_MS,
      token_login: null,
      follow_scope: r.bot?.subscriptions.includes('channel.follow') ?? false,
    };
  }

  private twitchView() {
    return {
      mode: this.mode,
      environment: this.d.environment ?? 'lab',
      /** Real Twitch events reach this profile (the Lab chat adapter); the production bot is not wired yet. */
      available: Boolean(this.d.twitch),
      resumed_from_active: this.resumedFromActive,
      ...(this.d.twitch?.status() ?? {
        ingestion_enabled: false,
        ingestion_running: false,
        token_login: null,
        follow_scope: false,
      }),
    };
  }

  /** OBS source / preview files, media (Range for the videos) and the source's queue calls (token). */
  private async page(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    reply: (s: number, b: unknown) => void,
  ) {
    const name = url.pathname.slice('/alerts/'.length);
    if (name === 'next' || name === 'ack') {
      if (req.method !== 'POST')
        return reply(405, { error: 'method_not_allowed' });
      const body = await this.body(req);
      if (body.token !== this.token) return reply(403, { error: 'forbidden' });
      const consumer = String(body.consumer_id ?? '');
      if (name === 'ack') return reply(200, await this.ack(consumer, body));
      // Stale source (17/10/2026): a page that runs another version of the files gets no alert (it reloads once its
      // alerts end) unless it already reloaded in vain (stale_ok). A page without a version (older) claims as before.
      const version = await this.playerVersion();
      // The OBS source's state for the tab: its last request and whether it runs the current files (no extra polling).
      this.lastSource = {
        at: Date.now(),
        current: body.version === version,
      };
      // The source hung up meanwhile (Studio stopping, page gone): never reserve an alert nobody will receive.
      if (req.socket.destroyed) return;
      const stale =
        typeof body.version === 'string' &&
        body.version !== version &&
        body.stale_ok !== true;
      return reply(200, {
        alert: stale ? null : await this.next(consumer),
        version,
      });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return reply(405, { error: 'method_not_allowed' });
    if (name.startsWith('media/')) {
      let media: string;
      try {
        media = decodeURIComponent(name.slice('media/'.length));
      } catch {
        return reply(400, { error: 'bad_name' });
      }
      return this.serveMedia(req, res, media, reply);
    }
    if (!(name in PLAYER_FILES)) return reply(404, { error: 'not_found' });
    let data: Buffer;
    try {
      data = await readFile(join(this.d.playerDir, name));
    } catch {
      return reply(404, { error: 'not_found' });
    }
    res.writeHead(200, {
      'content-type': PLAYER_FILES[name]!,
      'cache-control': 'no-store',
      'content-security-policy': CSP,
    });
    // The page loads its other files after this one: they are at least as recent as the version it carries.
    if (name === 'player.html')
      data = Buffer.from(
        data.toString('utf8').replace(VERSION_MARK, await this.playerVersion()),
      );
    res.end(data);
  }

  /** Version of the OBS source: a hash of the files on disk now (read each time; a few small files). */
  async playerVersion() {
    const h = createHash('sha256');
    for (const f of SOURCE_FILES) {
      try {
        h.update(await readFile(join(this.d.playerDir, f)));
      } catch {
        h.update(`missing:${f}`);
      }
    }
    return h.digest('hex').slice(0, 16);
  }

  /** Claims the next alert for this source; one with missing media is reported failed and skipped. */
  private async next(consumer: string) {
    for (let i = 0; i < 5; i++) {
      const { alert } = await this.d.core<{ alert: ClaimedAlert | null }>(
        `${this.base}/${this.d.channelId}/claim`,
        { consumer_id: consumer },
      );
      if (!alert) return null;
      const missing = this.missing(alert.variant);
      if (!missing.length)
        return {
          alert_id: alert.alert_id,
          attempt_id: alert.attempt_id,
          family: alert.family,
          variant: alert.variant,
          data: alert.data,
          placement: this.placement.get(alert.variant.id),
        };
      await this.d.core(`${this.base}/items/${alert.alert_id}/ack`, {
        consumer_id: consumer,
        attempt_id: alert.attempt_id,
        event: 'failed',
        error: `media_missing: ${missing.join(', ')}`.slice(0, 200),
      });
    }
    return null;
  }

  private ack(consumer: string, body: Record<string, unknown>) {
    const id = String(body.alert_id ?? '');
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw Object.assign(new Error('bad_alert_id'), { status: 400 });
    const report: Record<string, unknown> = {
      consumer_id: consumer,
      attempt_id: body.attempt_id,
      event: body.event,
    };
    if (typeof body.error === 'string') report.error = body.error.slice(0, 200);
    if (typeof body.family === 'string') report.family = body.family; // Core checks it against the alert
    return this.d.core(`${this.base}/items/${id}/ack`, report);
  }

  private async serveMedia(
    req: IncomingMessage,
    res: ServerResponse,
    name: string,
    reply: (s: number, b: unknown) => void,
  ) {
    const file = this.d.media.path(name);
    if (!file) return reply(404, { error: 'media_missing' });
    const size = (await stat(file)).size;
    const headers: Record<string, string | number> = {
      'content-type': this.d.media.contentType(name),
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    let start = 0;
    let end = size - 1;
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(size - 1, Number(m[2]));
      } else start = Math.max(0, size - Number(m[2]));
      if (start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        return void res.end();
      }
      headers['content-range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['content-length'] = end - start + 1;
    res.writeHead(m && (m[1] || m[2]) ? 206 : 200, headers);
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file, { start, end }).pipe(res);
  }
}
