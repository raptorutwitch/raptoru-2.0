import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  SPOTIFY_LIVE,
  SPOTIFY_RULES,
  type SpotifyLiveNow,
  type SpotifyJob,
  type SpotifyJobReport,
  type SpotifyPlayback,
  type SpotifyReason,
  type SpotifySearchItem,
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
import { normalizeText, selectCandidate, type Candidate } from './search.js';
import { SpotifySim } from './sim.js';
import { SimSmtc, SmtcProbe, SmtcTracker, type SmtcLine } from './smtc.js';
import { MusicOverlayHost, type OverlayLive } from './music-overlay-host.js';
import type { ObsLike } from './music-overlay-obs.js';
import { OverlayStore } from './music-overlays.js';
import {
  MusicOverlay,
  MusicOverlayConfig,
  type MusicCardPlayer,
  type MusicStateView,
} from './overlay.js';

// Spotify V2 in Studio (docs/SPOTIFY_V2.md § 2–6): the only Spotify caller, Core's hands. Every second Studio tells Core
// its state (+ a playback reading when it took one) and gets the jobs and the logical queue back; it runs the jobs
// (search → queue, skip, `!song`), watches the playback ONLY when Core says there is something to watch (historical
// scheduler cadence), and skips the canceled requests when Spotify reaches them — the first one of that track in the
// queue's order (FIFO), reserved locally before the skip is sent (never two skips for one request), then reported.

const SYNC_MS = 1_000;
/** Requests open: Core's jobs are picked up every 0.5 s (decision 25/10: the job waited 0.5 s on average at 1 s). */
const SYNC_OPEN_MS = 500;
/** Module off: Studio still says it is there (Core's admission wants it seen within 15 s once switched on). */
const IDLE_SYNC_MS = 5_000;
const POLL = {
  /** A request's first seconds (its `!songcancel` grace), a canceled request next, a track change just seen. */
  active: 2_500,
  /** A request playing past its first seconds, nothing sensitive next (docs/music/SPOTIFY_QUOTA.md). */
  steady: 6_000,
  /** How long after a request starts it stays read at the `active` pace (the cancel grace, 10 s, and a margin). */
  startWatch: 15_000,
  /** One reading this long before a track's end: Core's « played to its end » needs one within 5 s of it. */
  preEnd: 4_000,
  /** Then one this long after the expected end (the next track, or the same one again), then `ending` until the change. */
  postEnd: 700,
  ending: 1_000,
  endingWindow: 15_000,
  external: 30_000,
  idle: 10_000,
  fast: 200,
  fastArm: 3_500,
  fastFor: 5_000,
  /** After a skip, when the next request is a canceled one: fast reads this long (it is about to play). */
  afterSkipFor: 3_000,
} as const;
/** A Core answer this fresh lets Studio judge a new occurrence before its next sync (the skip goes out sooner). */
const EARLY_ANSWER_MS = 1_500;
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
  /** The Lab's fake Spotify (null in Production, and in the Lab with the real account). */
  sim: SpotifySim | null;
  /**
   * The Lab on the broadcaster's REAL account (LAB_SPOTIFY=real, explicit at each launch, never saved): reads only,
   * until the panel allows writes for this session (`labWrites`, off at every start).
   */
  labReal?: { writes: boolean } | null;
  /** Auto-skip reservations (survive a restart: a reserved skip is never sent twice). */
  reservationsFile: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Music Hub V2: the OBS music card (overlay.ts), and the effects player's sounds (catalogue, import). */
  overlay?: MusicOverlay | null;
  sounds?: {
    list(): { id: string; label: string; available: boolean }[];
    importSound(
      body: Buffer,
      name: string,
    ): Promise<{ id: string; name: string }>;
  } | null;
  /**
   * Music Hub: what Spotify Desktop plays as Windows tells it (SMTC, smtc.ts) — the display and the stream's music
   * history, never a request's decision. `source` feeds the tracker (the probe, or the Lab's simulated Windows).
   */
  live?: {
    tracker: SmtcTracker;
    source: (
      onLine: (line: SmtcLine) => void,
      onDown: (reason: string) => void,
    ) => { start(): void; stop(): void };
  } | null;
  /** Music Hub: the OBS music overlays (their setting, the page's folder, Studio's origin and OBS connection). */
  overlays?: {
    store: OverlayStore;
    dir: string;
    origin: string;
    obs: () => ObsLike | null;
  } | null;
}

/**
 * Music Hub (SMTC): after a track change Windows announced, ONE Web API reading this much later (Spotify's API follows
 * its app within ~1 s) gives the exact track (uri, cover) of that occurrence; once more 2 s later if it still showed the
 * previous one. Never during a 429, never without a connected account, at most one every `LINK_SPACING_MS`.
 */
const LINK_DELAY_MS = 1_200;
const LINK_RETRY_MS = 2_000;
const LINK_SPACING_MS = 3_000;

/** Music Hub V2: how often Core's state is read for the overlay (only while it is on). */
const OVERLAY_READ_MS = 2_500;
/** Music Hub searches run at once beside the loop (the catalogue lane of the API gate paces them anyway). */
const SEARCH_POOL = 2;
/** A search waiting longer than Core's own timeout is dropped (the viewer was already told « indisponible »). */
const SEARCH_STALE_MS = 6_000;

interface Reservation {
  request_id: string;
  at: string;
  result: 'SKIPPED' | 'UNKNOWN' | 'FAILED' | null;
  reported: boolean;
}

const VALID_ID = /^[A-Za-z0-9]{22}$/;
/** Covers Studio remembers for its own page (read from the tracks it already fetches: no extra Spotify call). */
const COVERS_MAX = 200;
const COVER_URL = /^(https:\/\/i\.scdn\.co\/|data:image\/svg\+xml)/;

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
    volume_percent: Number.isInteger(raw?.device?.volume_percent)
      ? Math.max(0, Math.min(100, raw!.device!.volume_percent!))
      : null,
  };
}

/** Music Hub: a catalogue result as the extension shows it (never sent anywhere else). */
export function toSearchItem(c: Candidate): SpotifySearchItem | null {
  const t = toTrack(c);
  if (!t) return null;
  const art = c.album?.images?.[0]?.url ?? null;
  return {
    ...t,
    album: c.album?.name ? String(c.album.name).slice(0, 300) : null,
    image_url: art && COVER_URL.test(art) && art.length <= 4_000 ? art : null,
    playable: c.is_playable !== false,
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
  private answerAt = 0;
  /** One reading due at this instant (after a skip), watched or not; 0 = none. */
  private readAt = 0;
  private lastManualRead = 0;
  private readonly covers = new Map<string, string>();
  /** Timing of the song job in progress (Studio log only: where the seconds go). */
  private marks: [string, number][] = [];
  /** Music Hub searches: run beside the loop (never in it), at most `SEARCH_POOL` at once, dropped once stale. */
  private readonly searches = new Map<string, number>();
  private readonly searchWaiting: { job: SpotifyJob; at: number }[] = [];
  /** Local counters of the playback watch and the searches (shown in the panel, never sent anywhere). */
  readonly watchCounters = { searches_abandoned: 0, polls: 0 };
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
    this.overlays = d.overlays
      ? new MusicOverlayHost({
          store: d.overlays.store,
          dir: d.overlays.dir,
          origin: d.overlays.origin,
          obs: d.overlays.obs,
          live: () => this.overlayLive(),
          now: this.now,
        })
      : null;
  }

  /** Music Hub: the OBS music overlays (null: none in this Studio). */
  readonly overlays: MusicOverlayHost | null;
  /** Requesters' display names by request (read from Core once per request, for the overlay). */
  private readonly requesters = new Map<string, string | null>();
  private requesterReading: string | null = null;
  private lastCurrentId: string | null = null;

  /**
   * What the overlay shows: Windows' track (its exact Spotify track once read), else the Web API's last reading. The
   * requester only when Core attributes the request playing to THIS exact track (its uri) — never a title.
   */
  overlayLive(): OverlayLive {
    const t = this.d.live?.tracker;
    const v = t?.view();
    const cur = this.answer?.current_request_id
      ? this.answer.queue.find(
          (q) => q.request_id === this.answer!.current_request_id,
        )
      : null;
    const requestOf = (uri: string | null | undefined) =>
      cur && uri && cur.track_uri === uri
        ? this.requesterOf(cur.request_id)
        : null;
    if (v && v.state !== 'off') {
      const link = this.link?.gen === v.gen ? this.link : null;
      return {
        state: v.state === 'waiting' ? 'lost' : v.track ? v.state : 'none',
        gen: v.gen,
        track: v.track
          ? {
              ...v.track,
              artists: link?.artists.length ? link.artists : v.track.artists,
            }
          : null,
        position_ms: v.position_ms,
        cover: v.cover
          ? `/api/spotify/live/cover?v=${v.cover}`
          : (link?.cover_url ?? null),
        request: requestOf(link?.uri),
      };
    }
    // No Windows source (another PC, the probe off): the Web API's last reading while it is fresh.
    const p = this.reading?.playback;
    const age = p ? this.now() - Date.parse(p.observed_at) : Infinity;
    if (!p?.track || age > 30_000)
      return {
        state: 'none',
        gen: 0,
        track: null,
        position_ms: null,
        cover: null,
        request: null,
      };
    return {
      state: p.is_playing ? 'playing' : 'paused',
      gen: this.apiGen(p.track.uri),
      track: {
        title: p.track.title,
        artists: p.track.artists,
        album: null,
        duration_ms: p.track.duration_ms,
      },
      position_ms:
        p.progress_ms === null
          ? null
          : Math.min(
              p.track.duration_ms,
              p.progress_ms + (p.is_playing ? Math.max(0, age) : 0),
            ),
      cover: this.covers.get(p.track.id) ?? null,
      request: requestOf(p.track.uri),
    };
  }

  private apiTrack: { uri: string; gen: number } = { uri: '', gen: 0 };
  private apiGen(uri: string) {
    if (this.apiTrack.uri !== uri)
      this.apiTrack = { uri, gen: this.apiTrack.gen + 1 };
    return this.apiTrack.gen;
  }

  /** A requester's display name (read once from Core's state; null meanwhile, then the overlay is told). */
  private requesterOf(id: string) {
    if (this.requesters.has(id)) return { by: this.requesters.get(id)! };
    if (this.requesterReading !== id) {
      this.requesterReading = id;
      void this.d
        .core<{
          current?: {
            request_id: string;
            viewer?: { name?: string; login?: string };
          } | null;
        }>(`${this.base}/state`)
        .then((st) => {
          const c = st.current;
          if (c?.request_id !== id) return;
          this.requesters.set(id, c.viewer?.name || c.viewer?.login || null);
          if (this.requesters.size > 50)
            this.requesters.delete(this.requesters.keys().next().value!);
          this.overlays?.bump();
        })
        .catch(() => {})
        .finally(() => {
          if (this.requesterReading === id) this.requesterReading = null;
        });
    }
    return { by: null };
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
    /** Music Hub V2: the effects player (the music card of the overlay, its sounds). */
    effects?: {
      sounds(): { id: string; label: string; available: boolean }[];
      importSound(
        body: Buffer,
        name: string,
      ): Promise<{ id: string; name: string }>;
      play: MusicCardPlayer['play'];
    } | null;
    /**
     * Lab only: the broadcaster's REAL Spotify account instead of the simulator (LAB_SPOTIFY=real at this launch, never
     * saved). Its own folder (token, rate limit) apart from the simulator's; read-only until allowed for the session.
     */
    labReal?: boolean;
    /**
     * Music Hub: the SMTC probe built for Studio (tools/smtc-probe). Absent: no live display from Windows (the Lab on
     * the simulator always has its simulated Windows instead).
     */
    smtc?: { exe: string; script: string; out: string } | null;
    /** Music Hub: the OBS music overlays' page folder (apps/studio/server/music-overlay); absent: none. */
    overlayDir?: string | null;
    /** Studio's one OBS connection (the overlays' install assistant only ever adds, on a click). */
    obs?: (() => ObsLike | null) | null;
  }) {
    const labReal = p.environment === 'lab' && p.labReal === true;
    const sim = p.environment === 'lab' && !labReal ? new SpotifySim() : null;
    const lab = labReal ? { writes: false } : null;
    const smtc = p.smtc ?? null;
    const live: SpotifyRuntimeDeps['live'] = sim
      ? {
          tracker: new SmtcTracker('sim'),
          source: (onLine) => {
            const s = new SimSmtc(() => sim.local(), onLine);
            return { start: () => s.start(), stop: () => s.stop() };
          },
        }
      : smtc
        ? {
            tracker: new SmtcTracker('smtc'),
            source: (onLine, onDown) =>
              new SmtcProbe({
                exe: smtc.exe,
                build: { script: smtc.script, out: smtc.out },
                onLine,
                onDown,
                ...(p.log ? { log: p.log } : {}),
              }),
          }
        : null;
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
        ...(lab ? { writesAllowed: () => lab.writes } : {}),
      }),
      auth,
      sim,
      labReal: lab,
      reservationsFile: join(p.dir, 'spotify-auto-skips.json'),
      ...(p.log ? { log: p.log } : {}),
      overlay: await MusicOverlay.open(
        join(p.dir, 'music-overlay.json'),
        p.effects ?? null,
        p.log,
      ),
      sounds: p.effects
        ? {
            list: () => p.effects!.sounds(),
            importSound: (b, n) => p.effects!.importSound(b, n),
          }
        : null,
      live,
      overlays: p.overlayDir
        ? {
            store: await OverlayStore.open(p.dir),
            dir: p.overlayDir,
            origin: p.origin,
            obs: p.obs ?? (() => null),
          }
        : null,
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
      this.running = true;
      this.wakeup = false;
      let delay = SYNC_MS;
      try {
        delay = await this.once();
        this.lastError = null;
      } catch (e) {
        this.lastError = (e as Error).message;
        // A Core without the Spotify routes (not deployed yet): ask again rarely.
        if ((e as { status?: number }).status === 404) delay = IDLE_SYNC_MS * 6;
      }
      this.running = false;
      if (this.stopped) return;
      this.timer = setTimeout(() => void loop(), this.wakeup ? 0 : delay);
      this.timer.unref?.();
    };
    this.loop = loop;
    void loop();
    // Music Hub: Windows' media session (the probe, or the Lab's simulated Windows) — a change wakes the loop.
    const live = this.d.live;
    if (live) {
      this.liveSource = live.source(
        (line) => this.onSmtc(line),
        (reason) => {
          live.tracker.off(reason);
          this.overlays?.bump();
          this.wake();
        },
      );
      this.liveSource.start();
    }
    // Music Hub V2: the overlay follows Core's queue on its own pace, only while it is on (no read otherwise).
    const overlay = this.d.overlay;
    if (overlay) {
      const follow = async () => {
        if (this.stopped) return;
        if (overlay.following)
          try {
            overlay.observe(
              await this.d.core<MusicStateView>(`${this.base}/state`),
            );
          } catch {
            /* Core unreachable: the next reading after the gap only notes (never a late card) */
          }
        this.overlayTimer = setTimeout(() => void follow(), OVERLAY_READ_MS);
        this.overlayTimer.unref?.();
      };
      void follow();
    }
  }

  private overlayTimer: ReturnType<typeof setTimeout> | null = null;
  private loop: (() => Promise<void>) | null = null;
  private running = false;
  private wakeup = false;
  private liveSource: { start(): void; stop(): void } | null = null;

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.overlayTimer) clearTimeout(this.overlayTimer);
    this.liveSource?.stop();
  }

  /** The next cycle now (a change from Windows): never two cycles at once. */
  private wake() {
    if (this.stopped || !this.loop) return;
    if (this.running) {
      this.wakeup = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loop!(), 0);
    this.timer.unref?.();
  }

  // ------------------------------------------------------------------ Music Hub: the live track (SMTC)

  /** This Studio process, for Core's ordering of the live messages (a restart is a new boot). */
  private readonly boot = randomUUID();
  private readonly bootAt = new Date().toISOString();
  private liveSeq = 0;
  private liveSent: string | null = null;
  private liveSentAt = 0;
  /** Core without the live route (older Core): asked again later, never in a loop. */
  private liveOffUntil = 0;
  /** The exact Spotify track of an occurrence (Web API reading taken after Windows announced it). */
  private link: {
    gen: number;
    uri: string;
    cover_url: string | null;
    artists: string[];
  } | null = null;
  private linkAt = 0;
  private linkTries = 0;
  private lastLinkRead = 0;
  /** Local counters of the live track (panel only). */
  readonly liveCounters = {
    link_reads: 0,
    linked: 0,
    link_misses: 0,
    posts: 0,
  };

  /** One line from Windows: a track change asks for its exact identity (one reading), any change wakes the loop. */
  onSmtc(line: SmtcLine) {
    const tracker = this.d.live?.tracker;
    if (!tracker) return;
    const change = tracker.feed(line);
    if (change === 'none') return;
    this.overlays?.bump();
    if (change === 'track' || change === 'replay') {
      this.link = null;
      this.linkTries = 0;
      this.linkAt = this.now() + LINK_DELAY_MS;
      // Watching anyway (a request in play): the scheduled reading comes at that instant instead of an extra one.
      if (this.watching())
        this.nextPollAt = Math.min(this.nextPollAt, this.linkAt);
    }
    this.wake();
  }

  /** The link reading is due (and allowed): only for an occurrence without its exact track yet. */
  private linkDue() {
    const t = this.d.live?.tracker;
    if (!t || !this.linkAt || this.now() < this.linkAt) return false;
    const v = t.view();
    // Nothing to link, or no reading allowed (no account, Spotify limiting us): given up for this occurrence — the
    // scheduled readings may still link it. Never a waiting link that would make the loop spin.
    if (
      !v.track ||
      this.link?.gen === v.gen ||
      this.d.auth.view().auth !== 'ok' ||
      this.d.api.limited()
    ) {
      this.linkAt = 0;
      return false;
    }
    // Too soon after the previous link reading: the same link, later (the loop waits for it).
    const spaced = this.lastLinkRead + LINK_SPACING_MS;
    if (this.now() < spaced) {
      this.linkAt = spaced;
      return false;
    }
    return true;
  }

  /**
   * A Web API reading → the exact track of the occurrence Windows shows, when the reading is of THAT occurrence: taken
   * after it started, same title, same duration (± 2.5 s). The title only rejects a reading of the previous track (the
   * API is ~1 s behind the app); the identity is the API's uri, never a title.
   */
  private noteLink(
    raw: SpotifyPlaybackRaw | null,
    at: number,
    linkRead: boolean,
  ) {
    const t = this.d.live?.tracker;
    if (!t) return;
    const v = t.view();
    if (!v.track || this.link?.gen === v.gen) return;
    const item = raw?.currently_playing_type === 'episode' ? null : raw?.item;
    const track = toTrack(item);
    const ok =
      !!track &&
      at >= t.genAt &&
      normalizeText(track.title) === normalizeText(v.track.title) &&
      (v.track.duration_ms === null ||
        Math.abs(track.duration_ms - v.track.duration_ms) <= 2_500);
    if (ok) {
      const images = item?.album?.images ?? [];
      const url = (images[1] ?? images[0])?.url ?? null;
      this.link = {
        gen: v.gen,
        uri: track.uri,
        cover_url:
          url && COVER_URL.test(url) && url.length <= 4_000 ? url : null,
        artists: track.artists,
      };
      this.linkAt = 0;
      this.liveCounters.linked++;
      this.overlays?.bump();
      this.wake();
      return;
    }
    if (!linkRead) return; // a scheduled reading only tries
    // The API still showed the previous track: once more a bit later, then the scheduled readings only.
    if (this.linkTries < 1) {
      this.linkTries++;
      this.linkAt = this.now() + LINK_RETRY_MS;
    } else this.liveCounters.link_misses++;
  }

  /** The live state to Core, on a change and every `heartbeatMs` (never a message per second for the bar). */
  private async pushLive() {
    const t = this.d.live?.tracker;
    if (!t) return;
    const now = this.now();
    if (this.liveOffUntil > now) return;
    const v = t.view();
    // Nothing heard from Windows yet (Studio just started): nothing to say — Core keeps what it knows.
    if (v.state === 'off' && v.reason === 'starting') return;
    const link = this.link?.gen === v.gen ? this.link : null;
    const state = v.state === 'waiting' ? 'lost' : v.state;
    const sig = `${state}|${v.gen}|${v.seq}|${link?.uri ?? ''}|${t.ended?.gen ?? ''}`;
    if (
      sig === this.liveSent &&
      now - this.liveSentAt < SPOTIFY_LIVE.heartbeatMs
    )
      return;
    const ended = t.ended;
    const body: SpotifyLiveNow = {
      boot: this.boot,
      boot_at: this.bootAt,
      seq: ++this.liveSeq,
      gen: v.gen,
      state,
      track: v.track,
      position_ms: v.position_ms,
      link: link
        ? { uri: link.uri, cover_url: link.cover_url, artists: link.artists }
        : null,
      ended,
    };
    try {
      await this.d.core(`${this.base}/now`, body);
      this.liveSent = sig;
      this.liveSentAt = now;
      this.liveCounters.posts++;
      if (ended && t.ended === ended) t.ended = null;
    } catch (e) {
      if ((e as { status?: number }).status === 404)
        this.liveOffUntil = now + 10 * 60_000;
      // Otherwise (Core unreachable): the next cycle sends it again.
    }
  }

  /** The live track as Studio's page shows it (local: no Core, no Spotify). */
  liveView() {
    const t = this.d.live?.tracker;
    if (!t) return null;
    const v = t.view();
    return {
      ...v,
      link: this.link?.gen === v.gen ? this.link : null,
      counters: { ...this.liveCounters },
    };
  }

  /** One cycle: maybe a playback reading, the sync, the auto-skip, the jobs. Returns the delay to the next one. */
  async once(): Promise<number> {
    let polled = false;
    // A link reading due while watching: the scheduled reading comes now (it carries the link).
    if (this.linkAt && this.now() >= this.linkAt && this.watching())
      this.nextPollAt = Math.min(this.nextPollAt, this.now());
    if (this.watching() && this.now() >= this.nextPollAt) {
      // The scheduled reading, at the link's instant when Windows just announced a track (no extra reading).
      const linkRead = this.linkDue();
      if (linkRead) this.startLinkRead();
      // A failed reading (429, network…) never blocks the sync: Core must still see Studio and its state.
      polled = await this.poll(linkRead, linkRead).then(
        () => true,
        (e: Error) => ((this.lastError = e.message), false),
      );
    } else if (!this.watching() && this.linkDue()) {
      // Music Hub: nothing to watch, a track change announced by Windows — its one reading (exact track, cover).
      this.startLinkRead();
      polled = await this.poll(true, true).then(
        () => true,
        (e: Error) => ((this.lastError = e.message), false),
      );
    } else if (
      this.readAt &&
      this.now() >= this.readAt &&
      this.d.auth.view().auth === 'ok' &&
      !this.d.api.limited()
    ) {
      this.readAt = 0;
      polled = await this.poll(true).then(
        () => true,
        (e: Error) => ((this.lastError = e.message), false),
      );
    }
    // A canceled request starting to play: judged on this fresh reading with the last (fresh) answer, before the
    // sync — the skip goes out one Core round trip sooner. Only a certain case is decided here; otherwise the
    // occurrence is judged after the sync, as before.
    if (
      polled &&
      this.reading &&
      !this.reading.sent &&
      this.now() - this.answerAt <= EARLY_ANSWER_MS
    )
      await this.autoSkip(this.reading.playback, this.reading.raw, true);
    this.answer = await this.sync();
    this.answerAt = this.now();
    // A request starts or ends (Core's attribution): the overlay's requester follows.
    if (this.answer.current_request_id !== this.lastCurrentId) {
      this.lastCurrentId = this.answer.current_request_id;
      this.overlays?.bump();
    }
    if (this.reading?.sent)
      await this.autoSkip(this.reading.playback, this.reading.raw);
    await this.reportPending();
    // The essential jobs in the loop, in Core's order; the catalogue searches beside it (a wave of searches never
    // holds a skip, an addition or the next sync behind it).
    for (const job of this.answer.jobs)
      if (job.kind === 'search') this.queueSearch(job);
      else await this.run(job);
    if (!this.answer.watch) this.fastUntil = 0;
    // Music Hub: the live track to Core (a change, or the heartbeat).
    await this.pushLive();
    const delay = !this.answer.enabled
      ? IDLE_SYNC_MS
      : this.watching()
        ? Math.max(0, Math.min(SYNC_OPEN_MS, this.nextPollAt - this.now()))
        : SYNC_OPEN_MS;
    // A link reading waiting: the next cycle at its instant (never a cycle at once: a due link was handled above).
    const wait = this.linkAt - this.now();
    return this.linkAt && wait > 0 ? Math.min(delay, wait) : delay;
  }

  private startLinkRead() {
    this.linkAt = 0;
    this.lastLinkRead = this.now();
    this.liveCounters.link_reads++;
  }

  private queueSearch(job: SpotifyJob) {
    if (
      this.searches.has(job.job_id) ||
      this.searchWaiting.some((w) => w.job.job_id === job.job_id)
    )
      return;
    this.searchWaiting.push({ job, at: this.now() });
    this.pumpSearches();
  }

  private pumpSearches() {
    while (this.searches.size < SEARCH_POOL && this.searchWaiting.length) {
      const { job, at } = this.searchWaiting.shift()!;
      if (this.now() - at > SEARCH_STALE_MS) {
        this.watchCounters.searches_abandoned++;
        continue;
      }
      this.searches.set(job.job_id, this.now());
      const run = this.run(job)
        .catch(() => {})
        .finally(() => {
          this.searches.delete(job.job_id);
          this.searchRuns.delete(run);
          this.pumpSearches();
        });
      this.searchRuns.add(run);
    }
  }

  private readonly searchRuns = new Set<Promise<unknown>>();
  /** Every search started beside the loop has reported (tests, and a clean stop). */
  async searchesSettled() {
    while (this.searchRuns.size) await Promise.all([...this.searchRuns]);
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

  private noteCover(c: Candidate | null | undefined) {
    // Spotify lists the sizes largest first: the middle one (300 px) is enough for the page.
    const images = c?.album?.images ?? [];
    const url = (images[1] ?? images[0])?.url;
    if (!c?.id || !url || !COVER_URL.test(url)) return;
    this.covers.delete(c.id);
    this.covers.set(c.id, url);
    if (this.covers.size > COVERS_MAX)
      this.covers.delete(this.covers.keys().next().value!);
  }

  /** One playback reading (forced: fresh) and the next reading's time (historical cadence). */
  private async poll(force: boolean, linkRead = false) {
    this.watchCounters.polls++;
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
    this.noteCover(r.data?.item);
    this.noteLink(r.data, r.at, linkRead);
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

  /**
   * The playback watch's pace (docs/music/SPOTIFY_QUOTA.md). Spotify's Web API stays the only source of every decision;
   * this only chooses WHEN to read it. Kept close where Core's rules need it:
   * - a canceled request next (it may start any time): the historical pace — 2.5 s, 1 s over the last 15 s, and the
   *   200 ms fast lane just before it starts (the auto-skip);
   * - a request's first 15 s (its `!songcancel` grace is judged on a reading under 10 s old): 2.5 s;
   * - every track's end: one reading 4 s before it (« played to its end » needs one within 5 s), one 0.7 s after it,
   *   then 1 s until the change is seen;
   * - after a skip or a player action: read at once (unchanged).
   * Otherwise 6 s on a request, 30 s on a track outside the requests (the broadcaster's music), 10 s when paused.
   */
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
    const known =
      queue.some((q) => q.track_uri === p.track!.uri) ||
      this.answer?.current_request_id;
    // A canceled request next: it may start at any time (a skip by hand in Spotify) — the historical pace, unchanged.
    if (this.nextTombstone()) {
      if (remaining <= POLL.endingWindow)
        return Math.min(POLL.ending, Math.max(POLL.fast, remaining));
      return POLL.active;
    }
    // Around the end: just after it, then every second until Spotify shows the next track (or the same one again).
    if (remaining <= POLL.preEnd)
      return Math.max(POLL.ending, remaining + POLL.postEnd);
    const pace = known
      ? (p.progress_ms ?? 0) < POLL.startWatch
        ? POLL.active
        : POLL.steady
      : POLL.external;
    // Never past the reading 4 s before the end.
    return Math.max(POLL.fast, Math.min(pace, remaining - POLL.preEnd));
  }

  /** The next request of the logical queue, when it is a canceled one not skipped yet (about to be skipped). */
  private nextTombstone() {
    const next = (this.answer?.queue ?? []).find(
      (q) =>
        q.state !== 'PLAYING' &&
        q.request_id !== this.answer?.current_request_id &&
        !this.reservations.has(q.request_id),
    );
    return next?.auto_skip ? next : null;
  }

  /** After a skip: if the next request is a canceled one, read fast for a moment (it is starting now). */
  private afterSkip() {
    if (this.nextTombstone() && !this.d.api.limited()) {
      this.fastUntil = this.now() + POLL.afterSkipFor;
      this.nextPollAt = Math.min(this.nextPollAt, this.now() + POLL.fast);
    }
  }

  /**
   * A new occurrence: the first request of that track in the queue's order (FIFO) is a canceled one → skip it, once.
   * A track already playing is never re-judged (it may be another request's).
   * - after the sync (default): Core judged this same reading first; an occurrence it gave to a live request is kept;
   * - early (before the sync, fresh answer): decided only when the FIFO first is a canceled one; anything else is left
   *   to the after-sync judgement. Its report waits for the sync, so Core always sees the reading before the skip.
   */
  private async autoSkip(
    p: SpotifyPlayback,
    raw: SpotifyPlaybackRaw | null,
    early = false,
  ) {
    const occ = this.occurrence;
    if (
      !p.track ||
      !this.answer ||
      !occ ||
      occ.checked ||
      occ.uri !== p.track.uri
    )
      return;
    const first = this.answer.queue.find(
      (q) => q.track_uri === p.track!.uri && q.state !== 'PLAYING',
    );
    if (early) {
      // Before the sync: only the certain case (the FIFO first of this track is canceled); the rest after the sync.
      if (!first?.auto_skip || this.reservations.has(first.request_id)) return;
      occ.checked = true;
    } else {
      occ.checked = true;
      // Core judged this same reading first: an occurrence it gave to a live request is never skipped.
      const current = this.answer.queue.find(
        (q) => q.request_id === this.answer!.current_request_id,
      );
      if (current?.track_uri === p.track.uri) return;
      if (!first?.auto_skip || this.reservations.has(first.request_id)) return;
    }
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
    if (result === 'SKIPPED') this.afterSkip();
    await this.saveReservations();
    // Where the time went: the track had played `progress` ms when Spotify was read; the reading reached this
    // decision `seen` ms later; the skip was sent `wait` ms after the decision and Spotify answered in `answer` ms.
    this.d.log?.(
      `[spotify] auto-skip ${r.request_id}: ${result} · lu à ${p.progress_ms ?? '?'} ms du début (suivi ${fast ? 'rapide' : 'normal'}) · décision +${detectedAt - Date.parse(p.observed_at)} ms après la lecture · skip envoyé +${sentAt - detectedAt} ms · réponse Spotify ${this.now() - sentAt} ms`,
    );
    // Early: reported after the sync (once() reports right after it), never before Core saw this reading.
    if (!early) await this.reportPending();
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
    // A search runs beside the loop: it never touches the song job's timing log.
    if (job.kind !== 'search') this.marks = [['début', this.now()]];
    try {
      await this.d.core(`${this.base}/jobs/${job.job_id}/start`, {
        attempt_id,
      });
    } catch {
      return; // taken / unknown: never run twice
    }
    if (job.kind !== 'search') this.mark('Core (prise)');
    let report: SpotifyJobReport;
    if (job.kind === 'song_request')
      report = {
        kind: 'song_request',
        attempt_id,
        ...(await this.songRequest(job)),
      };
    else if (job.kind === 'skip')
      report = { kind: 'skip', attempt_id, ...(await this.skip()) };
    else if (job.kind === 'search')
      report = { kind: 'search', attempt_id, ...(await this.search(job)) };
    else if (job.kind === 'control')
      report = { kind: 'control', attempt_id, ...(await this.control(job)) };
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
        // The search result is a full track object (duration included): read it again only if it lacks one.
        chosen = Number.isInteger(s.top.candidate.duration_ms)
          ? s.top.candidate
          : ((await this.d.api.track(s.top.candidate.id)) ?? s.top.candidate);
        if (chosen !== s.top.candidate) this.mark('titre (durée)');
      }
      const track = toTrack(chosen);
      this.noteCover(chosen);
      if (!track)
        return { outcome: 'refused', reason: 'SPOTIFY_UNAVAILABLE', ...extra };
      if (track.duration_ms > job.max_duration_ms)
        return { outcome: 'refused', reason: 'TOO_LONG', track, ...extra };
      try {
        // Without device_id Spotify queues on the active device (the one the historical service picked); with none
        // active it answers 404 « no active device », a certain refusal (nothing was queued).
        await this.d.api.addToQueue(track.uri, null);
        this.mark('ajout');
        return { outcome: 'queued', track, confirmation: 'http_204', ...extra };
      } catch (e) {
        if (e instanceof SpotifyApiError && !e.maybeSent && e.status === 404)
          return { outcome: 'refused', reason: 'NO_DEVICE', track, ...extra };
        // Lab on the real account, read-only: the exact track WAS resolved (shown to Core), nothing was queued.
        if (e instanceof SpotifyApiError && e.code === 'LAB_READ_ONLY')
          return {
            outcome: 'refused',
            reason: 'LAB_READ_ONLY',
            track,
            ...extra,
          };
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
        this.afterSkip();
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

  /**
   * Music Hub: a catalogue search for the extension. The same gate as everything else (pacing, cache of 5 min per text,
   * 429). Never queues anything. The provider says whose catalogue it is: the Lab's simulator or the connected account.
   */
  private async search(
    job: Extract<SpotifyJob, { kind: 'search' }>,
  ): Promise<
    Omit<Extract<SpotifyJobReport, { kind: 'search' }>, 'kind' | 'attempt_id'>
  > {
    const provider = this.d.sim ? ('lab' as const) : ('spotify' as const);
    try {
      // Music Hub V2: a pasted link names one track — read by its id, as the reward reads an exact reference.
      const found = job.track_id
        ? [await this.d.api.track(job.track_id, 'catalog')].filter(
            (c): c is NonNullable<typeof c> => !!c,
          )
        : await this.d.api.search(job.query, 'catalog');
      const items = found
        .map(toSearchItem)
        .filter((i): i is SpotifySearchItem => i !== null)
        .slice(0, 10);
      return { outcome: 'done', provider, items };
    } catch (e) {
      return { outcome: 'failed', reason: reasonOf(e), provider, items: [] };
    }
  }

  /**
   * Music Hub: pause / resume / volume on the playing device. The result is what Spotify says after (a fresh reading),
   * never an assumed success; « maybe sent » → read back, `unknown` when the reading does not prove it.
   */
  private async control(
    job: Extract<SpotifyJob, { kind: 'control' }>,
  ): Promise<
    Omit<Extract<SpotifyJobReport, { kind: 'control' }>, 'kind' | 'attempt_id'>
  > {
    try {
      const p = await this.d.api.playback(true);
      const device =
        p.data?.device?.is_active && !p.data.device.is_restricted
          ? p.data.device
          : pickDevice(await this.d.api.devices(true));
      if (!device) return { outcome: 'failed', reason: 'NO_DEVICE' };
      const proven = (after: SpotifyPlayback) =>
        job.action === 'volume'
          ? after.volume_percent === job.volume_percent
          : after.is_playing === (job.action === 'resume');
      try {
        if (job.action === 'volume')
          await this.d.api.setVolume(job.volume_percent ?? 0, device.id);
        else await this.d.api.setPlaying(job.action === 'resume', device.id);
      } catch (e) {
        if (!(e instanceof SpotifyApiError && e.maybeSent)) throw e;
      }
      this.nextPollAt = 0;
      const after = await this.d.api.playback(true);
      const playback = toPlayback(after.data, after.at);
      return { outcome: proven(playback) ? 'done' : 'unknown', playback };
    } catch (e) {
      return { outcome: 'failed', reason: reasonOf(e) };
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
    // Music Hub: the cover Windows gave for the track playing (an <img> of Studio's own page: no Studio header).
    // Local bytes only, never sent to Core nor to the viewers (they get Spotify's image URL).
    // Music Hub: the OBS music overlay's page and its state (token, long poll).
    if (this.overlays && (await this.overlays.handle(req, res, url)))
      return true;
    if (url.pathname === '/api/spotify/live/cover' && req.method === 'GET') {
      const cover = this.d.live?.tracker.cover ?? null;
      if (!cover) {
        res.writeHead(404, { 'cache-control': 'no-store' });
        res.end();
        return true;
      }
      res.writeHead(200, {
        'content-type': cover.type,
        // Versioned by its hash (?v=): the page never downloads the same cover twice.
        'cache-control':
          url.searchParams.get('v') === cover.hash
            ? 'private, max-age=86400, immutable'
            : 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(cover.bytes);
      return true;
    }
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

  /**
   * Read-only diagnostic (26/10): one Spotify search through Studio's own client (its token, rate limit and cache), and
   * what each result carries — album, release date, popularity, ISRC — to decide how editions could be told apart.
   * Nothing is requested, queued or played.
   */
  private async diagnosticSearch(body: () => Promise<Record<string, unknown>>) {
    if (this.d.auth.view().auth !== 'ok')
      throw Object.assign(new Error('spotify_not_connected'), { status: 409 });
    const q = String((await body()).q ?? '')
      .trim()
      .slice(0, 200);
    if (!q) throw Object.assign(new Error('empty_query'), { status: 400 });
    type Raw = {
      id?: string;
      name?: string;
      duration_ms?: number;
      popularity?: unknown;
      explicit?: unknown;
      artists?: { name?: string }[];
      external_ids?: { isrc?: unknown };
      album?: {
        name?: unknown;
        album_type?: unknown;
        release_date?: unknown;
        total_tracks?: unknown;
      };
    };
    const items = (await this.d.api.search(q)) as unknown as Raw[];
    const has = (f: (t: Raw) => unknown) =>
      items.filter((t) => f(t) !== undefined && f(t) !== null).length;
    return {
      query: q,
      count: items.length,
      fields: {
        popularity: has((t) => t.popularity),
        album_name: has((t) => t.album?.name),
        album_type: has((t) => t.album?.album_type),
        release_date: has((t) => t.album?.release_date),
        isrc: has((t) => t.external_ids?.isrc),
      },
      items: items.map((t) => ({
        id: t.id ?? null,
        name: t.name ?? null,
        artists: (t.artists ?? []).map((a) => a.name ?? ''),
        duration_ms: t.duration_ms ?? null,
        popularity: t.popularity ?? null,
        isrc: t.external_ids?.isrc ?? null,
        album: t.album
          ? {
              name: t.album.name ?? null,
              type: t.album.album_type ?? null,
              release_date: t.album.release_date ?? null,
              total_tracks: t.album.total_tracks ?? null,
            }
          : null,
      })),
    };
  }

  private async overlayApi(
    method: string,
    path: string,
    body: () => Promise<Record<string, unknown>>,
    upload?: () => Promise<{ body: Buffer; name: string }>,
  ) {
    const o = this.d.overlay;
    if (!o)
      throw Object.assign(new Error('overlay_unavailable'), { status: 503 });
    const view = () => ({
      config: o.config,
      available: o.available,
      sounds: this.d.sounds?.list() ?? [],
    });
    if (method === 'GET' && path === '/overlay') return view();
    if (method === 'POST' && path === '/overlay') {
      const next = MusicOverlayConfig.safeParse(await body());
      if (!next.success)
        throw Object.assign(new Error('invalid_overlay'), {
          status: 400,
          body: { issues: next.error.issues.map((i) => i.path.join('.')) },
        });
      await o.save(next.data);
      return view();
    }
    if (method === 'POST' && path === '/overlay/preview') {
      try {
        return await o.preview();
      } catch (e) {
        throw Object.assign(e as Error, {
          status: (e as { status?: number }).status ?? 409,
        });
      }
    }
    if (method === 'POST' && path === '/overlay/sounds') {
      if (!this.d.sounds || !upload)
        throw Object.assign(new Error('effects_unavailable'), { status: 503 });
      const { body: raw, name } = await upload();
      try {
        return await this.d.sounds.importSound(raw, name);
      } catch (e) {
        throw Object.assign(e as Error, { status: 400 });
      }
    }
    throw Object.assign(new Error('not_found'), { status: 404 });
  }

  /** /api/spotify/* behind Studio's origin check. */
  async api(
    method: string,
    path: string,
    body: () => Promise<Record<string, unknown>>,
    upload?: () => Promise<{ body: Buffer; name: string }>,
  ) {
    const auth = this.d.auth;
    // Music Hub V2: the OBS music card (overlay.ts): its setting, a preview, an imported alert sound.
    if (path === '/overlay' || path.startsWith('/overlay/'))
      return this.overlayApi(method, path, body, upload);
    if (method === 'GET' && path === '/state') {
      const core = await this.d.core<Record<string, unknown>>(
        `${this.base}/state`,
      );
      return {
        ...core,
        environment: this.d.environment,
        connection: {
          ...auth.view(),
          simulated: Boolean(this.d.sim),
          // Lab: the simulator, or the broadcaster's real account (read-only unless allowed for this session).
          mode: this.d.sim
            ? 'lab_sim'
            : this.d.labReal
              ? 'lab_real'
              : 'production',
          lab_writes: this.d.labReal ? this.d.labReal.writes : null,
        },
        api: await this.d.api.status(),
        watch: { ...this.watchCounters },
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
        covers: Object.fromEntries(this.covers),
        // Music Hub: what Windows says plays (SMTC) and its exact track once read (absent: no live source).
        live: this.liveView(),
      };
    }
    // Music Hub: the live track alone, every second from the page (local: no Core, no Spotify).
    if (method === 'GET' && path === '/live') return { live: this.liveView() };
    // Music Hub: the OBS music overlays' editor (presets, variants, show / hide, OBS assistant).
    if (path === '/overlays' || path.startsWith('/overlays/')) {
      if (!this.overlays)
        throw Object.assign(new Error('overlays_unavailable'), { status: 503 });
      return this.overlays.api(method, path, body);
    }
    if (method !== 'POST')
      throw Object.assign(new Error('not_found'), { status: 404 });
    // Music Hub: the stream's music history (Core), newest first, 50 per page.
    if (path === '/history') {
      const before = (await body()).before;
      return this.d.core(`${this.base}/music-history`, {
        before:
          typeof before === 'string' && !Number.isNaN(Date.parse(before))
            ? new Date(before).toISOString()
            : null,
      });
    }
    if (path === '/diagnostic/search') return this.diagnosticSearch(body);
    // Lab with the real account only: allow (or stop) the writes — the queue, the skips, the player — for this session.
    if (path === '/lab-writes') {
      if (!this.d.labReal)
        throw Object.assign(new Error('not_lab_real'), { status: 409 });
      const b = await body();
      if (typeof b.enabled !== 'boolean')
        throw Object.assign(new Error('enabled_required'), { status: 400 });
      this.d.labReal.writes = b.enabled;
      this.d.log?.(
        `[spotify] Lab réel : écritures ${b.enabled ? 'AUTORISÉES pour cette session' : 'coupées (lecture seule)'}`,
      );
      return { lab_writes: b.enabled };
    }
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
      /^\/sim\/(near-end|external|no-device|device|rate-limit|quota|skip|answer-200|answer-500|end|app-close|app-open|replay|pause-hand)$/.exec(
        path,
      );
    if (sim && this.d.sim) {
      const s = this.d.sim;
      // Music Hub (SMTC): Spotify Desktop closed / reopened, the same track again, a pause in the app.
      if (sim[1] === 'app-close' || sim[1] === 'app-open')
        s.closeApp(sim[1] === 'app-close');
      else if (sim[1] === 'replay') s.replay();
      else if (sim[1] === 'pause-hand') s.pauseByHand();
      else if (sim[1] === 'near-end') s.seekNearEnd();
      else if (sim[1] === 'external') s.playExternal();
      else if (sim[1] === 'no-device') s.deviceActive = false;
      else if (sim[1] === 'device') s.deviceActive = true;
      else if (sim[1] === 'rate-limit') s.rateLimit(30);
      // A Development Mode quota (July 2026: `QUOTA_EXCEEDED`, waits of hours): one hour here.
      else if (sim[1] === 'quota') s.rateLimit(3_600, true);
      // The broadcaster skips in the Spotify app (Raptoru only sees it at its next reading).
      else if (sim[1] === 'skip') s.skipByHand();
      else if (sim[1] === 'end') s.seekNearEnd(0);
      else s.queueAnswer = sim[1] === 'answer-200' ? 200 : 500;
      this.nextPollAt = 0;
      return s.view();
    }
    throw Object.assign(new Error('not_found'), { status: 404 });
  }
}
