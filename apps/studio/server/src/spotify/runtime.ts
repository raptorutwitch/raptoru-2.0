import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  SPOTIFY_RULES,
  type SpotifyJob,
  type SpotifyJobReport,
  type SpotifyPlayback,
  type SpotifyReason,
  type SpotifySyncAnswer,
  type SpotifyTrack,
} from '@raptoru/schemas';
import type { LabCoreCall } from '../lab-moderation/proxy.js';
import {
  SpotifyApi,
  SpotifyApiError,
  type SpotifyDevice,
  type SpotifyPlaybackRaw,
} from './api.js';
import { SpotifyAuth, simulatedAuth } from './oauth.js';
import { selectCandidate, type Candidate } from './search.js';
import { SpotifySim } from './sim.js';

// Spotify V2 in Studio (docs/SPOTIFY_V2.md § 2–6): the only Spotify caller, Core's hands. Every second Studio tells Core
// its state (+ a playback reading when it took one) and gets the jobs and the logical queue back; it runs the jobs
// (search → queue, skip, `!song`), watches the playback ONLY when Core says there is something to watch (historical
// scheduler cadence), and skips the canceled requests when Spotify reaches them — the first one of that track in the
// queue's order (FIFO), reserved locally before the skip is sent (never two skips for one request), then reported.

const SYNC_MS = 1_000;
/** Module off: Studio still says it is there (Core's admission wants it seen within 15 s once switched on). */
const IDLE_SYNC_MS = 5_000;
const POLL = {
  active: 2_500,
  ending: 1_000,
  endingWindow: 15_000,
  external: 30_000,
  idle: 10_000,
  fast: 200,
  fastArm: 3_500,
  fastFor: 5_000,
} as const;
const QUEUE_READBACK_MS = [250, 500, 750, 1_000];
/** Same track again from its start (Core's rule): a new occurrence. */
const RESTART_PROGRESS_MS = 5_000;
const SKIP_READBACK_MS = 250;
/** After a skip, one reading this much later (even with nothing left to watch): the panel never keeps the old track. */
const AFTER_SKIP_READ_MS = 1_000;
/** « Actualiser » in the panel: at most one reading per this delay (the API budget stays Studio's). */
const MANUAL_REFRESH_MS = 5_000;

type Auth = SpotifyAuth | typeof simulatedAuth;

export interface SpotifyRuntimeDeps {
  core: LabCoreCall;
  environment: 'lab' | 'production';
  channelId: string;
  api: SpotifyApi;
  auth: Auth;
  /** The Lab's fake Spotify (null in Production). */
  sim: SpotifySim | null;
  /** Auto-skip reservations (survive a restart: a reserved skip is never sent twice). */
  reservationsFile: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

interface Reservation {
  request_id: string;
  at: string;
  result: 'SKIPPED' | 'UNKNOWN' | 'FAILED' | null;
  reported: boolean;
}

const VALID_ID = /^[A-Za-z0-9]{22}$/;

/** A Spotify track → Core's shape, or null (episode, local file, no duration). */
export function toTrack(c: Candidate | null | undefined): SpotifyTrack | null {
  if (!c || !VALID_ID.test(c.id ?? '') || !Number.isInteger(c.duration_ms))
    return null;
  return {
    id: c.id,
    uri: `spotify:track:${c.id}`,
    title: String(c.name ?? '').slice(0, 300),
    artists: (c.artists ?? [])
      .slice(0, 20)
      .map((a) => String(a?.name ?? '').slice(0, 300)),
    duration_ms: c.duration_ms!,
  };
}

function toPlayback(
  raw: SpotifyPlaybackRaw | null,
  at: number,
): SpotifyPlayback {
  const track =
    raw?.currently_playing_type === 'episode' ? null : toTrack(raw?.item);
  return {
    observed_at: new Date(at).toISOString(),
    track,
    progress_ms:
      track && Number.isFinite(raw?.progress_ms)
        ? Math.max(0, Math.round(raw!.progress_ms!))
        : null,
    is_playing: Boolean(raw?.is_playing && track),
  };
}

const sameTrack = (c: Candidate | null | undefined, uri: string) =>
  !!c &&
  (c.uri === uri ||
    `spotify:track:${c.id}` === uri ||
    c.linked_from?.uri === uri);

const pickDevice = (devices: SpotifyDevice[]) =>
  devices.find((d) => d.is_active && !d.is_restricted) ?? null;

const reasonOf = (e: unknown): SpotifyReason =>
  e instanceof SpotifyApiError ? e.code : 'SPOTIFY_UNAVAILABLE';

export class SpotifyRuntime {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Last answer from Core (jobs, logical queue, attributed request, watch). */
  answer: SpotifySyncAnswer | null = null;
  /** One reading due at this instant (after a skip), watched or not; 0 = none. */
  private readAt = 0;
  private lastManualRead = 0;
  /** Timing of the song job in progress (Studio log only: where the seconds go). */
  private marks: [string, number][] = [];
  private mark(label: string) {
    this.marks.push([label, this.now()]);
  }
  /** Last playback reading (sent to Core with the next sync if not yet sent). */
  private reading: {
    playback: SpotifyPlayback;
    raw: SpotifyPlaybackRaw | null;
    sent: boolean;
  } | null = null;
  /** The occurrence playing (a track change, or the same track from its start) and whether the auto-skip judged it. */
  private occurrence: { uri: string; checked: boolean } | null = null;
  private nextPollAt = 0;
  private fastUntil = 0;
  private reservations = new Map<string, Reservation>();
  private device: { name: string; type: string } | null = null;
  lastError: string | null = null;

  private constructor(private readonly d: SpotifyRuntimeDeps) {
    this.now = d.now ?? Date.now;
    this.sleep = d.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  }

  /** Studio's profile: the Lab plays on the simulator (never the real account); Production on the broadcaster's
   *  Spotify, connected from the panel (redirect to this Studio's own loopback). */
  static async forProfile(p: {
    core: LabCoreCall;
    environment: 'lab' | 'production';
    channelId: string;
    /** Module storage (rate-limit state, OAuth file, reservations). */
    dir: string;
    /** This Studio's origin (http://127.0.0.1:4100). */
    origin: string;
    log?: (line: string) => void;
  }) {
    const sim = p.environment === 'lab' ? new SpotifySim() : null;
    const auth = sim
      ? simulatedAuth
      : await SpotifyAuth.open({
          file: join(p.dir, 'spotify-auth.json'),
          redirectUri: `${p.origin}/api/spotify/oauth/callback`,
        });
    return SpotifyRuntime.open({
      core: p.core,
      environment: p.environment,
      channelId: p.channelId,
      api: new SpotifyApi({
        auth,
        stateFile: join(p.dir, 'spotify-rate-limit.json'),
        ...(sim ? { fetch: sim.fetch } : {}),
      }),
      auth,
      sim,
      reservationsFile: join(p.dir, 'spotify-auto-skips.json'),
      ...(p.log ? { log: p.log } : {}),
    });
  }

  static async open(d: SpotifyRuntimeDeps) {
    const r = new SpotifyRuntime(d);
    try {
      const list = JSON.parse(
        await readFile(d.reservationsFile, 'utf8'),
      ) as Reservation[];
      for (const x of list) r.reservations.set(x.request_id, x);
    } catch {
      /* none yet */
    }
    return r;
  }

  private get base() {
    return `${this.d.environment === 'production' ? '/v1/studio/spotify' : '/v1/lab/spotify'}/${this.d.channelId}`;
  }

  private async saveReservations() {
    await mkdir(dirname(this.d.reservationsFile), { recursive: true });
    const f = this.d.reservationsFile;
    await writeFile(
      `${f}.tmp`,
      JSON.stringify([...this.reservations.values()]),
      { mode: 0o600 },
    );
    await rename(`${f}.tmp`, f);
  }

  start() {
    const loop = async () => {
      if (this.stopped) return;
      let delay = SYNC_MS;
      try {
        delay = await this.once();
        this.lastError = null;
      } catch (e) {
        this.lastError = (e as Error).message;
        // A Core without the Spotify routes (not deployed yet): ask again rarely.
        if ((e as { status?: number }).status === 404) delay = IDLE_SYNC_MS * 6;
      }
      this.timer = setTimeout(() => void loop(), delay);
      this.timer.unref?.();
    };
    void loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One cycle: maybe a playback reading, the sync, the auto-skip, the jobs. Returns the delay to the next one. */
  async once(): Promise<number> {
    if (this.watching() && this.now() >= this.nextPollAt)
      // A failed reading (429, network…) never blocks the sync: Core must still see Studio and its state.
      await this.poll(false).catch((e: Error) => (this.lastError = e.message));
    else if (
      this.readAt &&
      this.now() >= this.readAt &&
      this.d.auth.view().auth === 'ok' &&
      !this.d.api.limited()
    ) {
      this.readAt = 0;
      await this.poll(true).catch((e: Error) => (this.lastError = e.message));
    }
    this.answer = await this.sync();
    if (this.reading?.sent)
      await this.autoSkip(this.reading.playback, this.reading.raw);
    await this.reportPending();
    for (const job of this.answer.jobs) await this.run(job);
    if (!this.answer.watch) this.fastUntil = 0;
    if (!this.answer.enabled) return IDLE_SYNC_MS;
    return this.watching()
      ? Math.max(0, Math.min(SYNC_MS, this.nextPollAt - this.now()))
      : SYNC_MS;
  }

  /** Spotify is read only when Core says there is something to watch (a request queued / playing, a tombstone). */
  private watching() {
    return Boolean(
      this.answer?.enabled &&
      this.answer.watch &&
      this.d.auth.view().auth === 'ok',
    );
  }

  private async sync(): Promise<SpotifySyncAnswer> {
    const api = await this.d.api.status();
    const view = this.d.auth.view();
    const fresh = this.reading && !this.reading.sent ? this.reading : null;
    const answer = await this.d.core<SpotifySyncAnswer>(`${this.base}/studio`, {
      status: {
        auth: view.auth,
        limited_until: api.limited_until,
        quota_exceeded: api.quota_exceeded,
        device: this.device,
        calls_last_minute: Math.min(api.calls_last_minute, 100_000),
      },
      ...(fresh ? { playback: fresh.playback } : {}),
    });
    if (fresh) fresh.sent = true;
    // Keep only the reservations Core still lists, or not yet reported.
    const listed = new Set(answer.queue.map((q) => q.request_id));
    let pruned = false;
    for (const [id, r] of this.reservations)
      if (
        r.reported &&
        !listed.has(id) &&
        this.now() - Date.parse(r.at) > 60_000
      ) {
        this.reservations.delete(id);
        pruned = true;
      }
    if (pruned) await this.saveReservations().catch(() => {});
    return answer;
  }

  /** One playback reading (forced: fresh) and the next reading's time (historical cadence). */
  private async poll(force: boolean) {
    let r: { data: SpotifyPlaybackRaw | null; at: number };
    try {
      r = await this.d.api.playback(force || this.fastUntil > this.now());
    } catch (e) {
      this.nextPollAt =
        this.now() + (this.d.api.limited() ? POLL.external : POLL.active);
      this.fastUntil = 0;
      throw e;
    }
    const playback = toPlayback(r.data, r.at);
    if (r.data?.device)
      this.device = {
        name: r.data.device.name.slice(0, 300),
        type: r.data.device.type.slice(0, 300),
      };
    else if (!r.data) this.device = null;
    if (!this.reading || Date.parse(this.reading.playback.observed_at) < r.at) {
      const prev = this.reading?.playback;
      const uri = playback.track?.uri ?? null;
      const restarted =
        !!uri &&
        prev?.track?.uri === uri &&
        playback.progress_ms !== null &&
        prev.progress_ms !== null &&
        playback.progress_ms < RESTART_PROGRESS_MS &&
        prev.progress_ms - playback.progress_ms > RESTART_PROGRESS_MS;
      if (!uri) this.occurrence = null;
      else if (restarted || this.occurrence?.uri !== uri)
        this.occurrence = { uri, checked: false };
      this.reading = { playback, raw: r.data, sent: false };
    }
    this.nextPollAt = this.now() + this.cadence(playback);
    return playback;
  }

  /** Historical scheduler: 2.5 s on a request, 1 s near an end, 30 s on a track outside the requests (but 1 s for its
   *  last 15 s), the fast lane (200 ms for 5 s) when the next request is a canceled one about to start. */
  private cadence(p: SpotifyPlayback) {
    const now = this.now();
    if (this.fastUntil > now && !this.d.api.limited()) return POLL.fast;
    this.fastUntil = 0;
    if (!p.track || !p.is_playing) return POLL.idle;
    const remaining = Math.max(0, p.track.duration_ms - (p.progress_ms ?? 0));
    const queue = this.answer?.queue ?? [];
    const next = queue.find(
      (q) =>
        q.state !== 'PLAYING' &&
        q.request_id !== this.answer?.current_request_id,
    );
    if (
      remaining <= POLL.fastArm &&
      next?.auto_skip &&
      !this.reservations.has(next.request_id) &&
      !this.d.api.limited()
    ) {
      this.fastUntil = now + POLL.fastFor;
      return Math.max(POLL.fast, remaining - 200);
    }
    if (remaining <= POLL.endingWindow)
      return Math.min(POLL.ending, Math.max(POLL.fast, remaining));
    const known =
      queue.some((q) => q.track_uri === p.track!.uri) ||
      this.answer?.current_request_id;
    if (known) return POLL.active;
    return Math.min(POLL.external, remaining - POLL.endingWindow);
  }

  /** A new occurrence (judged once, after Core saw it): the first request of that track in the queue's order (FIFO)
   *  is a canceled one → skip it. A track already playing is never re-judged (it may be another request's). */
  private async autoSkip(p: SpotifyPlayback, raw: SpotifyPlaybackRaw | null) {
    const occ = this.occurrence;
    if (
      !p.track ||
      !this.answer ||
      !occ ||
      occ.checked ||
      occ.uri !== p.track.uri
    )
      return;
    occ.checked = true;
    // Core judged this same reading first: an occurrence it gave to a live request is never skipped.
    const current = this.answer.queue.find(
      (q) => q.request_id === this.answer!.current_request_id,
    );
    if (current?.track_uri === p.track.uri) return;
    const first = this.answer.queue.find(
      (q) => q.track_uri === p.track!.uri && q.state !== 'PLAYING',
    );
    if (!first?.auto_skip || this.reservations.has(first.request_id)) return;
    const detectedAt = this.now();
    const r: Reservation = {
      request_id: first.request_id,
      at: new Date(detectedAt).toISOString(),
      result: null,
      reported: false,
    };
    this.reservations.set(r.request_id, r);
    await this.saveReservations();
    let result: Reservation['result'];
    const sentAt = this.now();
    try {
      await this.d.api.next(raw?.device?.id ?? null);
      result = 'SKIPPED';
    } catch (e) {
      if (e instanceof SpotifyApiError && e.maybeSent) {
        await this.sleep(SKIP_READBACK_MS);
        const after = await this.d.api.playback(true).catch(() => null);
        result =
          after && !sameTrack(after.data?.item, p.track.uri)
            ? 'SKIPPED'
            : 'UNKNOWN';
      } else if (
        e instanceof SpotifyApiError &&
        (e.code === 'RATE_LIMITED' || e.code === 'TEMPORARY_ERROR')
      ) {
        // Never sent (Spotify paused us): free the reservation, judge this occurrence again at the next reading.
        this.reservations.delete(r.request_id);
        occ.checked = false;
        await this.saveReservations();
        return;
      } else result = 'FAILED';
    }
    r.result = result;
    if (result === 'SKIPPED') this.readAt = this.now() + AFTER_SKIP_READ_MS;
    const fast = this.fastUntil > 0;
    this.fastUntil = 0;
    this.nextPollAt = this.now() + SKIP_READBACK_MS;
    await this.saveReservations();
    // Where the time went: the track had played `progress` ms when Spotify was read; the reading reached this
    // decision `seen` ms later; the skip was sent `wait` ms after the decision and Spotify answered in `answer` ms.
    this.d.log?.(
      `[spotify] auto-skip ${r.request_id}: ${result} · lu à ${p.progress_ms ?? '?'} ms du début (suivi ${fast ? 'rapide' : 'normal'}) · décision +${detectedAt - Date.parse(p.observed_at)} ms après la lecture · skip envoyé +${sentAt - detectedAt} ms · réponse Spotify ${this.now() - sentAt} ms`,
    );
    await this.reportPending();
  }

  private async reportPending() {
    for (const r of this.reservations.values()) {
      if (r.reported || !r.result) continue;
      try {
        await this.d.core(`${this.base}/auto-skips`, {
          request_id: r.request_id,
          result: r.result,
          at: r.at,
        });
        r.reported = true;
      } catch (e) {
        // Refused by Core (unknown request): nothing to retry.
        if ((e as { status?: number }).status) r.reported = true;
        else return;
      }
      await this.saveReservations();
    }
  }

  // ------------------------------------------------------------------ jobs

  private async run(job: SpotifyJob) {
    const attempt_id = randomUUID();
    this.marks = [['début', this.now()]];
    try {
      await this.d.core(`${this.base}/jobs/${job.job_id}/start`, {
        attempt_id,
      });
    } catch {
      return; // taken / unknown: never run twice
    }
    this.mark('Core (prise)');
    let report: SpotifyJobReport;
    if (job.kind === 'song_request')
      report = {
        kind: 'song_request',
        attempt_id,
        ...(await this.songRequest(job)),
      };
    else if (job.kind === 'skip')
      report = { kind: 'skip', attempt_id, ...(await this.skip()) };
    else
      report = {
        kind: 'read_playback',
        attempt_id,
        ...(await this.readPlayback()),
      };
    for (let n = 0; n < 5; n++) {
      try {
        await this.d.core(`${this.base}/jobs/${job.job_id}/report`, report);
        if (report.kind === 'song_request') {
          this.mark('Core (rapport)');
          const steps = this.marks
            .slice(1)
            .map(([l, t], i) => `${l} ${t - this.marks[i]![1]} ms`)
            .join(' · ');
          this.d.log?.(
            `[spotify] demande ${job.kind === 'song_request' ? job.request_id : job.job_id} → ${report.outcome}${report.reason ? ` (${report.reason})` : ''} : ${steps} · total ${this.now() - this.marks[0]![1]} ms`,
          );
        }
        return;
      } catch (e) {
        if ((e as { status?: number }).status) return;
        await this.sleep(500 * (n + 1));
      }
    }
  }

  /** Historical requestSongLocked: reference → track → duration → device → queue (204, else read back). */
  private async songRequest(
    job: Extract<SpotifyJob, { kind: 'song_request' }>,
  ): Promise<
    Omit<
      Extract<SpotifyJobReport, { kind: 'song_request' }>,
      'kind' | 'attempt_id'
    >
  > {
    const extra: {
      candidates?: {
        id: string;
        title: string;
        artists: string[];
        score: number;
      }[];
      confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
      margin?: number;
    } = {};
    try {
      let chosen: Candidate | null;
      if (job.reference.kind === 'exact') {
        chosen = await this.d.api.track(job.reference.track_id);
        this.mark('titre (lien)');
        if (!chosen) return { outcome: 'refused', reason: 'NOT_FOUND' };
      } else {
        const items = (await this.d.api.search(job.reference.query)).filter(
          (c) => VALID_ID.test(c.id ?? ''),
        );
        this.mark('recherche');
        const s = selectCandidate(job.reference.query, items, {
          minScore: SPOTIFY_RULES.minScore,
          minMargin: SPOTIFY_RULES.minMargin,
        });
        extra.candidates = s.ranked.slice(0, 5).map((i) => ({
          id: i.candidate.id,
          title: String(i.candidate.name ?? '').slice(0, 300),
          artists: (i.candidate.artists ?? [])
            .slice(0, 20)
            .map((a) => String(a?.name ?? '').slice(0, 300)),
          score: i.score,
        }));
        extra.margin = Math.min(1, Math.max(0, Number(s.margin.toFixed(6))));
        if (s.status === 'MATCHED') extra.confidence = s.confidence;
        if (s.status !== 'MATCHED')
          return { outcome: 'refused', reason: s.status, ...extra };
        chosen =
          (await this.d.api.track(s.top.candidate.id)) ?? s.top.candidate;
        this.mark('titre (durée)');
      }
      const track = toTrack(chosen);
      if (!track)
        return { outcome: 'refused', reason: 'SPOTIFY_UNAVAILABLE', ...extra };
      if (track.duration_ms > job.max_duration_ms)
        return { outcome: 'refused', reason: 'TOO_LONG', track, ...extra };
      const device = pickDevice(await this.d.api.devices(true));
      this.mark('appareils');
      if (!device)
        return { outcome: 'refused', reason: 'NO_DEVICE', track, ...extra };
      try {
        await this.d.api.addToQueue(track.uri, device.id);
        this.mark('ajout');
        return { outcome: 'queued', track, confirmation: 'http_204', ...extra };
      } catch (e) {
        if (!(e instanceof SpotifyApiError && e.maybeSent)) throw e;
        this.mark('ajout (réponse non 204)');
        // No clear answer: read the queue back (historical 250/500/750/1000 ms), never resend.
        for (const ms of QUEUE_READBACK_MS) {
          await this.sleep(ms);
          try {
            const present = (await this.d.api.queue(true)).some((c) =>
              sameTrack(c, track.uri),
            );
            this.mark(`relecture (+${ms} ms d'attente)`);
            if (present)
              return {
                outcome: 'queued',
                track,
                confirmation: 'queue_readback',
                ...extra,
              };
          } catch (r) {
            if (r instanceof SpotifyApiError && r.code === 'RATE_LIMITED')
              break;
          }
        }
        return {
          outcome: 'unknown',
          reason: 'QUEUE_RESULT_UNKNOWN',
          track,
          ...extra,
        };
      }
    } catch (e) {
      return { outcome: 'refused', reason: reasonOf(e), ...extra };
    }
  }

  /** `!songskip` / the panel / a cancel within the grace: one next on the playing device; read back if unclear. */
  private async skip(): Promise<
    Omit<Extract<SpotifyJobReport, { kind: 'skip' }>, 'kind' | 'attempt_id'>
  > {
    let before: SpotifyTrack | null = null;
    try {
      const p = await this.d.api.playback(true);
      before = toPlayback(p.data, p.at).track;
      const device =
        p.data?.device?.is_active && !p.data.device.is_restricted
          ? p.data.device
          : pickDevice(await this.d.api.devices(true));
      if (!device)
        return {
          outcome: 'failed',
          reason: 'NO_DEVICE',
          skipped_track: before,
        };
      try {
        await this.d.api.next(device.id);
        this.readAt = this.now() + AFTER_SKIP_READ_MS;
        return { outcome: 'skipped', skipped_track: before };
      } catch (e) {
        if (!(e instanceof SpotifyApiError && e.maybeSent)) throw e;
        await this.sleep(SKIP_READBACK_MS);
        const after = await this.d.api.playback(true).catch(() => null);
        return after && before && !sameTrack(after.data?.item, before.uri)
          ? { outcome: 'skipped', skipped_track: before }
          : { outcome: 'unknown', skipped_track: before };
      }
    } catch (e) {
      return { outcome: 'failed', reason: reasonOf(e), skipped_track: before };
    }
  }

  /** `!song`: at most one reading (the cache shares a fresh one). */
  private async readPlayback(): Promise<
    Omit<
      Extract<SpotifyJobReport, { kind: 'read_playback' }>,
      'kind' | 'attempt_id'
    >
  > {
    try {
      return { playback: await this.poll(false) };
    } catch (e) {
      return { playback: null, reason: reasonOf(e) };
    }
  }

  // ------------------------------------------------------------------ the panel (/api/spotify/*)

  /** The OAuth redirect (a plain browser GET from Spotify, no Studio header): checked by its one-time state. */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname !== '/api/spotify/oauth/callback' || req.method !== 'GET')
      return false;
    let ok = false;
    let error = '';
    try {
      if (!('callback' in this.d.auth)) throw new Error('simulateur');
      await this.d.auth.callback(url.searchParams);
      const me = await this.d.api.me().catch(() => null);
      if (me)
        await this.d.auth.setAccount({
          name: String(me.display_name ?? me.id ?? '').slice(0, 100),
          product: me.product ?? null,
        });
      ok = true;
    } catch (e) {
      error = (e as Error).message;
    }
    res.writeHead(ok ? 200 : 400, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'",
    });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>Spotify</title><p style="font-family:sans-serif">${
        ok
          ? 'Spotify est connecté à Raptoru Studio. Tu peux fermer cet onglet.'
          : `Connexion Spotify refusée (${error.replace(/[^\w ’-]/g, '')}). Réessaie depuis Studio.`
      }</p>`,
    );
    return true;
  }

  /** /api/spotify/* behind Studio's origin check. */
  async api(
    method: string,
    path: string,
    body: () => Promise<Record<string, unknown>>,
  ) {
    const auth = this.d.auth;
    if (method === 'GET' && path === '/state') {
      const core = await this.d.core<Record<string, unknown>>(
        `${this.base}/state`,
      );
      return {
        ...core,
        environment: this.d.environment,
        connection: { ...auth.view(), simulated: Boolean(this.d.sim) },
        api: await this.d.api.status(),
        local: {
          error: this.lastError,
          watching: Boolean(this.answer?.watch),
          next_poll_in_ms: this.answer?.watch
            ? Math.max(0, this.nextPollAt - this.now())
            : null,
          fast_lane: this.fastUntil > this.now(),
          refresh_in_ms: Math.max(
            0,
            this.lastManualRead + MANUAL_REFRESH_MS - this.now(),
          ),
          reservations: [...this.reservations.values()],
        },
        sim: this.d.sim?.view() ?? null,
      };
    }
    if (method !== 'POST')
      throw Object.assign(new Error('not_found'), { status: 404 });
    if (path === '/settings')
      return this.d.core(`${this.base}/settings`, await body());
    if (path === '/actions')
      return this.d.core(`${this.base}/actions`, await body());
    if (path === '/reward')
      return this.d.core(`${this.base}/reward`, await body());
    if (path === '/overrides')
      return this.d.core(`${this.base}/overrides`, await body());
    if (path === '/refresh') {
      // « Actualiser » : one reading now (cache shared), at most every 5 s, never while Spotify limits us.
      if (this.d.auth.view().auth !== 'ok')
        throw Object.assign(new Error('spotify_not_connected'), {
          status: 409,
        });
      if (this.d.api.limited())
        throw Object.assign(new Error('rate_limited'), { status: 409 });
      if (this.now() - this.lastManualRead < MANUAL_REFRESH_MS)
        return { read: false };
      this.lastManualRead = this.now();
      await this.poll(false);
      return { read: true };
    }
    // Lab: a viewer's request without Twitch (the Lab Core only has this route).
    if (path === '/simulate' && this.d.sim)
      return this.d.core(`${this.base}/simulate`, await body());
    const settle = /^\/requests\/([0-9a-f-]{36})\/settle$/.exec(path);
    if (settle)
      return this.d.core(
        `${this.base}/requests/${settle[1]}/settle`,
        await body(),
      );
    if (path === '/connect') {
      if (!('authorizeUrl' in auth))
        throw Object.assign(new Error('simulated'), { status: 409 });
      return {
        url: auth.authorizeUrl(String((await body()).client_id ?? '').trim()),
      };
    }
    if (path === '/disconnect') {
      if (!('disconnect' in auth))
        throw Object.assign(new Error('simulated'), { status: 409 });
      await auth.disconnect();
      return { ok: true };
    }
    const sim =
      /^\/sim\/(near-end|external|no-device|device|rate-limit|answer-200|answer-500)$/.exec(
        path,
      );
    if (sim && this.d.sim) {
      const s = this.d.sim;
      if (sim[1] === 'near-end') s.seekNearEnd();
      else if (sim[1] === 'external') s.playExternal();
      else if (sim[1] === 'no-device') s.deviceActive = false;
      else if (sim[1] === 'device') s.deviceActive = true;
      else if (sim[1] === 'rate-limit') s.rateLimit(30);
      else s.queueAnswer = sim[1] === 'answer-200' ? 200 : 500;
      this.nextPollAt = 0;
      return s.view();
    }
    throw Object.assign(new Error('not_found'), { status: 404 });
  }
}
