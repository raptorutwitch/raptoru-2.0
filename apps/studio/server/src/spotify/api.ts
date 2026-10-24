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

export const SPOTIFY_API = {
  base: 'https://api.spotify.com/v1',
  minSpacingMs: 200,
  maxPerMinute: 90,
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
  private chain: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;
  private calls: number[] = [];
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
  };

  constructor(private readonly d: SpotifyApiDeps) {
    this.fetch = d.fetch ?? fetch;
    this.now = d.now ?? Date.now;
    this.sleep = d.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
    this.random = d.random ?? Math.random;
    this.base = (d.base ?? SPOTIFY_API.base).replace(/\/$/, '');
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
    };
  }

  /** True while Spotify refuses everything (429): no polling, no fast lane. */
  limited() {
    return this.limit.until > this.now();
  }

  /** One HTTP call, in the serialized queue. */
  private call(
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string | number | undefined> = {},
  ) {
    const run = this.chain.then(() => this.send(method, path, query));
    this.chain = run.catch(() => {});
    return run;
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string | number | undefined>,
  ) {
    await this.load();
    const write = method === 'POST';
    const endpoint = `${method} /${path.replace(/\/[A-Za-z0-9]{22}$/, '/{id}')}`;
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
      this.counters.calls++;
      if (write) this.counters.writes++;
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
        this.backoff();
        throw new SpotifyApiError('TEMPORARY_ERROR', write, res.status);
      }
      if (!res.ok)
        throw new SpotifyApiError('SPOTIFY_UNAVAILABLE', false, res.status);
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
  ): Promise<T> {
    const pending = this.inFlight.get(key);
    if (pending) {
      this.counters.shared++;
      return pending as Promise<T>;
    }
    const hit = this.cache.get(key);
    if (!force && hit && hit.until > this.now()) {
      this.counters.cache_hits++;
      return hit.value as T;
    }
    const run = load().then((value) => {
      this.cache.set(key, { value, until: this.now() + ttl });
      if (this.cache.size > 200)
        for (const k of [...this.cache.keys()].slice(0, 100))
          this.cache.delete(k);
      return value;
    });
    this.inFlight.set(key, run);
    try {
      return await run;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private forget(...prefixes: string[]) {
    for (const k of this.cache.keys())
      if (prefixes.some((p) => k.startsWith(p))) this.cache.delete(k);
  }

  search(query: string) {
    return this.read(
      `search:${normalizeText(query)}`,
      SPOTIFY_API.ttl.search,
      async () => {
        const r = await this.call('GET', 'search', {
          q: query,
          type: 'track',
          limit: 10,
        });
        return (
          (r.data as { tracks?: { items?: (Candidate | null)[] } })?.tracks
            ?.items ?? []
        ).filter((c): c is Candidate => Boolean(c));
      },
    );
  }

  /** A track by id, or null when Spotify does not know it (404 / 400). */
  track(id: string) {
    return this.read(`track:${id}`, SPOTIFY_API.ttl.track, async () => {
      try {
        return (await this.call('GET', `tracks/${encodeURIComponent(id)}`))
          .data as Candidate;
      } catch (e) {
        if (
          e instanceof SpotifyApiError &&
          (e.status === 404 || e.status === 400)
        )
          return null;
        throw e;
      }
    });
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
