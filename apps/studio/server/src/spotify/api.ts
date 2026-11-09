import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SpotifyReason } from '@raptoru/schemas';
import { normalizeText, type Candidate } from './search.js';

// Spotify V2 — the ONE gate to the Spotify Web API (docs/SPOTIFY_V2.md § 5; historical client.js + api-budget.js).
// Nothing else in Raptoru calls Spotify. Every call goes through here: serialized, spaced (≥ 200 ms), capped (90 in any
// sliding minute), reads cached and shared while in flight; a 429 stops EVERY call until Retry-After (never shortened,
// + jitter, persisted across restarts, QUOTA_EXCEEDED kept apart); network errors / 5xx back off (1 s → 60 s);
// a 401 refreshes the token once (shared) and retries once; a 403 is never retried; a write (queue, next) is never
// retried — when its answer is lost the caller reads back instead.
// Two lanes (docs/music/SPOTIFY_QUOTA.md): the ESSENTIAL one (queue, skip, player, playback readings, the reward's and
// `!song`'s searches) always goes first; the CATALOGUE one (the Music Hub's searches) has its own budget and only uses
// what the essential lane leaves — a wave of searches can never hold a skip or an addition behind it. Local counters
// only (per endpoint, cache, waits): nothing leaves the PC.

export const SPOTIFY_API = {
  base: 'https://api.spotify.com/v1',
  minSpacingMs: 200,
  maxPerMinute: 90,
  /** The Music Hub's catalogue lane: at most this many calls in any sliding minute… */
  catalogPerMinute: 30,
  /** …and only while the whole gate stays under this (the rest is kept for the essential lane). */
  catalogWhileUnder: 60,
  /** Above this, the panel warns (historical API_CALL_RATE_HIGH). */
  warnPerMinute: 60,
  timeoutMs: 10_000,
  rateLimitFallbackMs: 60_000,
  recoveryJitterMs: 1_000,
  backoffMaxMs: 60_000,
  ttl: {
    playback: 1_500,
    queue: 3_000,
    search: 5 * 60_000,
    devices: 5_000,
    track: 30 * 60_000,
  },
} as const;

export type SpotifyLane = 'essential' | 'catalog';

interface Task {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  query: Record<string, string | number | undefined>;
  lane: SpotifyLane;
  queuedAt: number;
  resolve: (v: { status: number; data: unknown }) => void;
  reject: (e: unknown) => void;
}

export class SpotifyApiError extends Error {
  constructor(
    readonly code: SpotifyReason,
    /** A write may have reached Spotify (no answer, non-204): the caller reads back, never resends. */
    readonly maybeSent = false,
    readonly status?: number,
  ) {
    super(code);
  }
}

export interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
  /** The device's volume (0–100), when Spotify gives it. */
  volume_percent?: number | null;
}

export interface SpotifyPlaybackRaw {
  is_playing?: boolean;
  progress_ms?: number | null;
  currently_playing_type?: string;
  item?: Candidate | null;
  device?: SpotifyDevice;
}

export interface SpotifyAuthSource {
  /** A valid access token (refreshed if needed), or throws SpotifyApiError(AUTH_NOT_CONFIGURED | AUTH_REQUIRED). */
  accessToken(): Promise<string>;
  /** Forces one refresh (shared by concurrent callers). */
  refresh(): Promise<string>;
}

export interface SpotifyApiDeps {
  auth: SpotifyAuthSource;
  /** Persisted rate-limit state (survives a Studio restart). */
  stateFile: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  base?: string;
  /**
   * Lab with the broadcaster's real account (LAB_SPOTIFY=real): writes (queue, skip, player) only while this says yes —
   * refused before any network otherwise (LAB_READ_ONLY). Absent: every write is allowed (Production, simulator).
   */
  writesAllowed?: () => boolean;
}

interface LimitState {
  until: number;
  reason: 'RATE_LIMITED' | 'QUOTA_EXCEEDED' | null;
  endpoint: string | null;
}

export function classifyRateLimit(
  payload: unknown,
): 'RATE_LIMITED' | 'QUOTA_EXCEEDED' {
  let text = '';
  try {
    text =
      typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  } catch {
    /* unreadable: a plain rate limit */
  }
  return /quota[_\s-]*exceeded|development\s+mode|quota\s+limit|quota\s+exhausted/i.test(
    text,
  )
    ? 'QUOTA_EXCEEDED'
    : 'RATE_LIMITED';
}

function retryAfterMs(h: Headers, now: number) {
  const v = h.get('retry-after');
  if (v === null) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, Math.round(s * 1000));
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.max(0, d - now) : undefined;
}

export class SpotifyApi {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly base: string;
  private limit: LimitState = { until: 0, reason: null, endpoint: null };
  private loaded: Promise<void> | null = null;
  private readonly lanes: Record<SpotifyLane, Task[]> = {
    essential: [],
    catalog: [],
  };
  private pumping = false;
  private lastCallAt = 0;
  private calls: number[] = [];
  private catalogCalls: number[] = [];
  private readonly since: number;
  /** Per endpoint (GET /search, POST /me/player/queue…): calls sent, 429 received, other errors. */
  private readonly endpoints = new Map<
    string,
    { calls: number; r429: number; errors: number }
  >();
  /** Cache hits per kind of reading (search, track, playback, queue, devices). */
  private readonly hits = new Map<string, number>();
  /** Time spent waiting in each lane before being sent. */
  private readonly waits: Record<
    SpotifyLane,
    { count: number; total_ms: number; max_ms: number }
  > = {
    essential: { count: 0, total_ms: 0, max_ms: 0 },
    catalog: { count: 0, total_ms: 0, max_ms: 0 },
  };
  private failures = 0;
  private failUntil = 0;
  private readonly cache = new Map<string, { value: unknown; until: number }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  readonly counters = {
    calls: 0,
    writes: 0,
    rate_limited: 0,
    quota_exceeded: 0,
    cache_hits: 0,
    shared: 0,
    suppressed: 0,
    /** Music Hub searches refused by the catalogue lane's budget (never sent). */
    catalog_deferred: 0,
    /** Lab with the real account: writes refused before the network (read-only session). */
    blocked_writes: 0,
  };

  constructor(private readonly d: SpotifyApiDeps) {
    this.fetch = d.fetch ?? fetch;
    this.now = d.now ?? Date.now;
    this.sleep = d.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
    this.random = d.random ?? Math.random;
    this.base = (d.base ?? SPOTIFY_API.base).replace(/\/$/, '');
    this.since = this.now();
  }

  private load() {
    this.loaded ??= readFile(this.d.stateFile, 'utf8')
      .then((raw) => {
        const s = JSON.parse(raw) as Partial<LimitState>;
        if (Number.isFinite(s.until))
          this.limit = {
            until: Number(s.until),
            reason:
              s.reason === 'QUOTA_EXCEEDED'
                ? 'QUOTA_EXCEEDED'
                : s.reason
                  ? 'RATE_LIMITED'
                  : null,
            endpoint: typeof s.endpoint === 'string' ? s.endpoint : null,
          };
      })
      .catch(() => {});
    return this.loaded;
  }

  private async persist() {
    try {
      await mkdir(dirname(this.d.stateFile), { recursive: true });
      await writeFile(`${this.d.stateFile}.tmp`, JSON.stringify(this.limit), {
        mode: 0o600,
      });
      await rename(`${this.d.stateFile}.tmp`, this.d.stateFile);
    } catch {
      /* the in-memory circuit still holds; only a restart would forget it */
    }
  }

  /** What the panel and Core see (SpotifyStudioStatus fields + counters). */
  async status() {
    await this.load();
    const now = this.now();
    this.calls = this.calls.filter((t) => t > now - 60_000);
    const limited = this.limit.until > now;
    return {
      limited_until: limited ? new Date(this.limit.until).toISOString() : null,
      quota_exceeded: limited && this.limit.reason === 'QUOTA_EXCEEDED',
      limited_endpoint: limited ? this.limit.endpoint : null,
      calls_last_minute: this.calls.length,
      rate_high: this.calls.length > SPOTIFY_API.warnPerMinute,
      backoff_until:
        this.failUntil > now ? new Date(this.failUntil).toISOString() : null,
      counters: { ...this.counters },
      /** Since this Studio started: per endpoint, cache hits per kind, waits per lane (local only). */
      usage: {
        since: new Date(this.since).toISOString(),
        endpoints: Object.fromEntries(this.endpoints),
        cache_hits: Object.fromEntries(this.hits),
        waits: {
          essential: { ...this.waits.essential },
          catalog: { ...this.waits.catalog },
        },
        catalog_last_minute: this.catalogCalls.filter((t) => t > now - 60_000)
          .length,
        queued: {
          essential: this.lanes.essential.length,
          catalog: this.lanes.catalog.length,
        },
      },
    };
  }

  /** True while Spotify refuses everything (429): no polling, no fast lane. */
  limited() {
    return this.limit.until > this.now();
  }

  /** One HTTP call, in its lane; one call at a time for the whole gate (the essential lane first). */
  private call(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    query: Record<string, string | number | undefined> = {},
    lane: SpotifyLane = 'essential',
  ) {
    return new Promise<{ status: number; data: unknown }>((resolve, reject) => {
      this.lanes[lane].push({
        method,
        path,
        query,
        lane,
        queuedAt: this.now(),
        resolve,
        reject,
      });
      void this.pump();
    });
  }

  /**
   * The next catalogue call, when its budget allows it; over budget it is refused at once (never held: a held search
   * would only grow stale, and Core answers « réessaie » to the viewer).
   */
  private nextCatalog(): Task | undefined {
    const now = this.now();
    this.catalogCalls = this.catalogCalls.filter((t) => t > now - 60_000);
    this.calls = this.calls.filter((t) => t > now - 60_000);
    while (
      this.lanes.catalog.length &&
      (this.catalogCalls.length >= SPOTIFY_API.catalogPerMinute ||
        this.calls.length >= SPOTIFY_API.catalogWhileUnder)
    ) {
      this.counters.catalog_deferred++;
      this.lanes.catalog.shift()!.reject(new SpotifyApiError('RATE_LIMITED'));
    }
    return this.lanes.catalog.shift();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const task = this.lanes.essential.shift() ?? this.nextCatalog();
        if (!task) return;
        const w = this.waits[task.lane];
        const waited = Math.max(0, this.now() - task.queuedAt);
        w.count++;
        w.total_ms += waited;
        w.max_ms = Math.max(w.max_ms, waited);
        try {
          task.resolve(
            await this.send(task.method, task.path, task.query, task.lane),
          );
        } catch (e) {
          task.reject(e);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private endpoint(name: string) {
    let e = this.endpoints.get(name);
    if (!e) this.endpoints.set(name, (e = { calls: 0, r429: 0, errors: 0 }));
    return e;
  }

  private async send(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    query: Record<string, string | number | undefined>,
    lane: SpotifyLane,
  ) {
    await this.load();
    const write = method !== 'GET';
    const endpoint = `${method} /${path.replace(/\/[A-Za-z0-9]{22}$/, '/{id}')}`;
    if (write && this.d.writesAllowed && !this.d.writesAllowed()) {
      // Lab with the real account, read-only session: nothing reaches Spotify (never « maybe sent »).
      this.counters.blocked_writes++;
      throw new SpotifyApiError('LAB_READ_ONLY');
    }
    const url = new URL(`${this.base}/${path}`);
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    let refreshed = false;
    for (;;) {
      const now = this.now();
      if (this.limit.until > now || this.failUntil > now) {
        // Suppressed before sending: nothing reached Spotify (never « maybe sent »).
        this.counters.suppressed++;
        throw new SpotifyApiError(
          this.limit.until > now ? 'RATE_LIMITED' : 'TEMPORARY_ERROR',
        );
      }
      const token = await this.d.auth.accessToken();
      // Spacing and the sliding-minute cap: wait for the slot (the queue is serialized, so this paces everything).
      const wait = Math.max(
        this.lastCallAt + SPOTIFY_API.minSpacingMs - now,
        0,
      );
      if (wait > 0) await this.sleep(wait);
      this.calls = this.calls.filter((t) => t > this.now() - 60_000);
      if (this.calls.length >= SPOTIFY_API.maxPerMinute)
        await this.sleep(this.calls[0]! + 60_000 - this.now());
      this.lastCallAt = this.now();
      this.calls.push(this.lastCallAt);
      if (lane === 'catalog') this.catalogCalls.push(this.lastCallAt);
      this.counters.calls++;
      if (write) this.counters.writes++;
      const stat = this.endpoint(endpoint);
      stat.calls++;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), SPOTIFY_API.timeoutMs);
      let res: Response;
      try {
        res = await this.fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
          },
          signal: ctl.signal,
        });
      } catch {
        stat.errors++;
        this.backoff();
        throw new SpotifyApiError('SPOTIFY_UNAVAILABLE', write);
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.d.auth.refresh();
        continue;
      }
      if (res.status === 401)
        throw new SpotifyApiError('AUTH_REQUIRED', false, 401);
      if (res.status === 429) {
        stat.r429++;
        const payload = await res.json().catch(() => undefined);
        const reason = classifyRateLimit(payload);
        const at = this.now();
        const until =
          Math.max(
            this.limit.until,
            at +
              (retryAfterMs(res.headers, at) ??
                SPOTIFY_API.rateLimitFallbackMs),
          ) +
          Math.round(
            Math.min(1, Math.max(0, this.random())) *
              SPOTIFY_API.recoveryJitterMs,
          );
        this.limit = { until, reason, endpoint };
        this.counters[
          reason === 'QUOTA_EXCEEDED' ? 'quota_exceeded' : 'rate_limited'
        ]++;
        await this.persist();
        // A 429 means Spotify did not apply the write.
        throw new SpotifyApiError('RATE_LIMITED', false, 429);
      }
      if (res.status >= 500) {
        stat.errors++;
        this.backoff();
        throw new SpotifyApiError('TEMPORARY_ERROR', write, res.status);
      }
      if (!res.ok) {
        stat.errors++;
        throw new SpotifyApiError('SPOTIFY_UNAVAILABLE', false, res.status);
      }
      this.failures = 0;
      this.failUntil = 0;
      if (this.limit.reason) {
        this.limit = { until: 0, reason: null, endpoint: null };
        void this.persist();
      }
      const text = res.status === 204 ? '' : await res.text().catch(() => '');
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        data = undefined;
      }
      return { status: res.status, data };
    }
  }

  private backoff() {
    this.failures++;
    this.failUntil =
      this.now() +
      Math.min(SPOTIFY_API.backoffMaxMs, 1000 * 2 ** (this.failures - 1));
  }

  /** A read: cached for `ttl`, one in flight shared by every caller. */
  private async read<T>(
    key: string,
    ttl: number,
    load: () => Promise<T>,
    force = false,
    lane: SpotifyLane = 'essential',
  ): Promise<T> {
    // Shared while in flight within ONE lane only: an essential reading never waits on a catalogue search.
    const flight = `${lane}:${key}`;
    const pending = this.inFlight.get(flight);
    if (pending) {
      this.counters.shared++;
      return pending as Promise<T>;
    }
    const hit = this.cache.get(key);
    if (!force && hit && hit.until > this.now()) {
      this.counters.cache_hits++;
      const kind = key.split(':')[0]!;
      this.hits.set(kind, (this.hits.get(kind) ?? 0) + 1);
      return hit.value as T;
    }
    const run = load().then((value) => {
      this.cache.set(key, { value, until: this.now() + ttl });
      if (this.cache.size > 200)
        for (const k of [...this.cache.keys()].slice(0, 100))
          this.cache.delete(k);
      return value;
    });
    this.inFlight.set(flight, run);
    try {
      return await run;
    } finally {
      this.inFlight.delete(flight);
    }
  }

  private forget(...prefixes: string[]) {
    for (const k of this.cache.keys())
      if (prefixes.some((p) => k.startsWith(p))) this.cache.delete(k);
  }

  /**
   * A track search (10 results: Development Mode's maximum since February 2026). The reward and `!song` search in the
   * essential lane, as before; the Music Hub in the catalogue lane, with `market=from_token` so Spotify says whether
   * each version plays on the broadcaster's account (`is_playable`).
   */
  search(query: string, lane: SpotifyLane = 'essential') {
    const hub = lane === 'catalog';
    return this.read(
      `search:${hub ? 'm:' : ''}${normalizeText(query)}`,
      SPOTIFY_API.ttl.search,
      async () => {
        const r = await this.call(
          'GET',
          'search',
          {
            q: query,
            type: 'track',
            limit: 10,
            ...(hub ? { market: 'from_token' } : {}),
          },
          lane,
        );
        return (
          (r.data as { tracks?: { items?: (Candidate | null)[] } })?.tracks
            ?.items ?? []
        ).filter((c): c is Candidate => Boolean(c));
      },
      false,
      lane,
    );
  }

  /** A track by id, or null when Spotify does not know it (404 / 400). Same lanes as `search`. */
  track(id: string, lane: SpotifyLane = 'essential') {
    const hub = lane === 'catalog';
    return this.read(
      `track:${hub ? 'm:' : ''}${id}`,
      SPOTIFY_API.ttl.track,
      async () => {
        try {
          return (
            await this.call(
              'GET',
              `tracks/${encodeURIComponent(id)}`,
              hub ? { market: 'from_token' } : {},
              lane,
            )
          ).data as Candidate;
        } catch (e) {
          if (
            e instanceof SpotifyApiError &&
            (e.status === 404 || e.status === 400)
          )
            return null;
          throw e;
        }
      },
      false,
      lane,
    );
  }

  devices(force = false) {
    return this.read(
      'devices',
      SPOTIFY_API.ttl.devices,
      async () =>
        (
          (await this.call('GET', 'me/player/devices')).data as {
            devices?: SpotifyDevice[];
          }
        )?.devices ?? [],
      force,
    );
  }

  /** The current playback (null when nothing is active: 204) and when Spotify was asked (cached readings keep it). */
  playback(force = false) {
    return this.read(
      'playback',
      SPOTIFY_API.ttl.playback,
      async () => {
        const data =
          ((await this.call('GET', 'me/player')).data as
            SpotifyPlaybackRaw | undefined) ?? null;
        return { data, at: this.now() };
      },
      force,
    );
  }

  queue(force = false) {
    return this.read(
      'queue',
      SPOTIFY_API.ttl.queue,
      async () =>
        (
          (await this.call('GET', 'me/player/queue')).data as {
            queue?: (Candidate | null)[];
          }
        )?.queue ?? [],
      force,
    );
  }

  /** The account (name, Premium), read once after a connection. */
  async me() {
    return (await this.call('GET', 'me')).data as {
      display_name?: string;
      id?: string;
      product?: string;
    };
  }

  /** POST /me/player/queue. Anything but 204 is « maybe sent » (Spotify used to answer 200): read the queue back. */
  async addToQueue(uri: string, deviceId: string | null) {
    this.forget('queue');
    const r = await this.call('POST', 'me/player/queue', {
      uri,
      device_id: deviceId ?? undefined,
    });
    this.forget('queue');
    if (r.status !== 204)
      throw new SpotifyApiError('QUEUE_RESULT_UNKNOWN', true, r.status);
  }

  /**
   * Music Hub: PUT /me/player/pause or /me/player/play (resume, no body). 204 (or 200) = done; anything else is « maybe
   * sent »: the caller reads the playback back, never retries.
   */
  async setPlaying(play: boolean, deviceId: string | null) {
    this.forget('playback');
    const r = await this.call(
      'PUT',
      play ? 'me/player/play' : 'me/player/pause',
      { device_id: deviceId ?? undefined },
    );
    this.forget('playback');
    if (r.status !== 204 && r.status !== 200)
      throw new SpotifyApiError('SPOTIFY_UNAVAILABLE', true, r.status);
  }

  /** Music Hub: PUT /me/player/volume?volume_percent= (same « maybe sent » rule). */
  async setVolume(percent: number, deviceId: string | null) {
    this.forget('playback');
    const r = await this.call('PUT', 'me/player/volume', {
      volume_percent: Math.max(0, Math.min(100, Math.round(percent))),
      device_id: deviceId ?? undefined,
    });
    this.forget('playback');
    if (r.status !== 204 && r.status !== 200)
      throw new SpotifyApiError('SPOTIFY_UNAVAILABLE', true, r.status);
  }

  /** POST /me/player/next. Anything but 204 is « maybe sent »: read the playback back. */
  async next(deviceId: string | null) {
    this.forget('playback', 'queue');
    const r = await this.call('POST', 'me/player/next', {
      device_id: deviceId ?? undefined,
    });
    this.forget('playback', 'queue');
    if (r.status !== 204)
      throw new SpotifyApiError('SPOTIFY_UNAVAILABLE', true, r.status);
  }
}
