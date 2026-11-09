import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SpotifyLiveNow, SpotifyLiveTrack } from '@raptoru/schemas';

// Music Hub — what Spotify Desktop plays, as WINDOWS tells it (SMTC: System Media Transport Controls), for the display
// and the stream's music history (docs/music/SMTC_STUDIO.md). Local and free: no Spotify Web API call. Never a request's
// decision: SMTC has no Spotify id (title, artist, album, cover, state, position only) — the requests stay judged by
// Core on the Web API's exact track. The source is the probe (tools/smtc-probe, `--studio`: JSON lines on stdout), or,
// in the Lab on the simulator, the simulated Spotify itself (the same lines).

/** One line of the probe (or of the Lab's simulated Windows). */
export interface SmtcLine {
  /** The probe's monotonic clock (ms since it started): an older line never overwrites a newer one. */
  t?: number;
  kind: string;
  source?: string;
  title?: string;
  artist?: string;
  album?: string;
  status?: string;
  position_ms?: number;
  end_ms?: number;
  thumb_bytes?: number;
  /** The cover's bytes (base64), once per new cover. */
  thumb?: string;
  text?: string;
}

/** The same track from (almost) its start, after this much of it: played again (a new occurrence). */
const REPLAY_FROM_MS = 10_000;
const REPLAY_TO_MS = 3_000;
/** The position moved this far from where the clock put it: a seek (the bar jumps; nothing else changes). */
const SEEK_MS = 2_500;
/** No line from Windows for this long (the probe writes a local reading every 5 s): stale. */
const SILENT_MS = 20_000;
/** Playing this far past the track's end with no change announced: stale (frozen at the end). */
const PAST_END_MS = 15_000;
const COVER_MAX = 600 * 1024;

export type LiveChange =
  'track' | 'replay' | 'state' | 'seek' | 'session' | 'none';
export type LiveState = SpotifyLiveNow['state'] | 'waiting';

interface Current {
  gen: number;
  key: string;
  track: SpotifyLiveTrack;
  playing: boolean;
  /** Position at `at` (this Studio's clock). */
  pos: number;
  at: number;
}

export interface LiveView {
  source: 'smtc' | 'sim';
  state: LiveState;
  gen: number;
  seq: number;
  track: SpotifyLiveTrack | null;
  /** Where the track is now (extrapolated while playing, never past its end). */
  position_ms: number | null;
  /** The cover Studio holds for this track (GET /api/spotify/live/cover?v=<hash>), or null. */
  cover: string | null;
  /** Why there is no source (probe missing, not Windows, stopped…). */
  reason: string | null;
}

const sniff = (b: Buffer) =>
  b[0] === 0x89 && b[1] === 0x50
    ? 'image/png'
    : b[0] === 0xff && b[1] === 0xd8
      ? 'image/jpeg'
      : b.subarray(0, 64).toString('utf8').includes('<svg')
        ? 'image/svg+xml'
        : 'application/octet-stream';

/**
 * The live state from SMTC lines: one occurrence (`gen`) per track change or replay, `seq` bumped by every visible
 * change (track, play / pause, seek, session). Duplicates (Spotify sends most events twice), the empty title of a
 * transition and an older line are ignored. Pure: the clock is injected.
 */
export class SmtcTracker {
  gen = 0;
  seq = 0;
  /** When the current occurrence was announced (this Studio's clock): a Web API reading before it is not of it. */
  genAt = 0;
  private cur: Current | null = null;
  private lastT = -1;
  private seenAt = 0;
  private session: 'waiting' | 'found' | 'lost' = 'waiting';
  private offReason: string | null = 'starting';
  /** The cover the probe sent last (it sends one only when it changes). */
  private sentCover: { hash: string; bytes: Buffer; type: string } | null =
    null;
  cover: { hash: string; bytes: Buffer; type: string } | null = null;
  /** How the previous occurrence ended (kept until Core has it). */
  ended: SpotifyLiveNow['ended'] = null;

  constructor(
    readonly source: 'smtc' | 'sim',
    private readonly now: () => number = Date.now,
  ) {}

  private positionOf(c: Current, at: number, capped = true) {
    const pos = c.playing ? c.pos + Math.max(0, at - c.at) : c.pos;
    return capped && c.track.duration_ms !== null
      ? Math.min(pos, c.track.duration_ms)
      : pos;
  }

  private end(cause: NonNullable<SpotifyLiveNow['ended']>['cause']) {
    const c = this.cur;
    if (!c) return;
    this.ended = {
      gen: c.gen,
      position_ms: Math.round(this.positionOf(c, this.now())),
      playing: c.playing,
      cause,
    };
  }

  /** The source is gone (probe missing or stopped, not Windows): nothing is shown, the occurrence ends unknown. */
  off(reason: string) {
    if (this.cur) {
      this.end('off');
      this.cur = null;
    }
    if (this.offReason !== reason) this.seq++;
    this.offReason = reason;
  }

  feed(line: SmtcLine): LiveChange {
    const at = this.now();
    if (typeof line.t === 'number') {
      if (line.t < this.lastT) return 'none';
      this.lastT = line.t;
    }
    this.seenAt = at;
    // The source counts as back only once Windows said something definite (a track, or no Spotify): the probe's
    // start lines alone keep it « off » (a restarted Studio never tells Core « nothing plays » too early).
    const back = () => {
      if (!this.offReason) return;
      this.offReason = null;
      this.seq++;
    };
    if (line.kind === 'DÉPART' || line.kind === 'ERREUR') return 'none';
    if (line.kind === 'TROUVÉE') {
      this.session = 'found';
      this.sentCover = null;
      return 'none';
    }
    if (line.kind === 'ATTENTE' || line.kind === 'PERDUE') {
      back();
      this.session = line.kind === 'ATTENTE' ? 'waiting' : 'lost';
      this.sentCover = null;
      if (!this.cur) return 'none';
      this.end('lost');
      this.cur = null;
      this.cover = null;
      this.seq++;
      return 'session';
    }
    if (typeof line.thumb === 'string') {
      const bytes = Buffer.from(line.thumb, 'base64');
      if (bytes.length > 0 && bytes.length <= COVER_MAX)
        this.sentCover = {
          hash: createHash('sha1').update(bytes).digest('hex').slice(0, 16),
          bytes,
          type: sniff(bytes),
        };
    }
    const title = String(line.title ?? '').trim();
    if (!title) return 'none'; // a transition: Spotify empties the title for an instant
    back();
    this.session = 'found';
    const artist = String(line.artist ?? '').trim();
    const album = String(line.album ?? '').trim();
    const end = Number(line.end_ms);
    const track: SpotifyLiveTrack = {
      title: title.slice(0, 300),
      artists: artist ? [artist.slice(0, 300)] : [],
      album: album ? album.slice(0, 300) : null,
      duration_ms: Number.isFinite(end) && end > 0 ? Math.round(end) : null,
    };
    // Stopped / closed: frozen like a pause; « Changing » keeps what it was.
    const prev = this.cur;
    const playing =
      line.status === 'Playing'
        ? true
        : line.status === 'Changing'
          ? (prev?.playing ?? false)
          : false;
    const raw = Number(line.position_ms);
    const pos = Math.max(
      0,
      Math.min(
        Number.isFinite(raw) ? Math.round(raw) : 0,
        track.duration_ms ?? Number.MAX_SAFE_INTEGER,
      ),
    );
    const key = `${track.title}\u001f${artist}\u001f${album}`;
    let change: LiveChange;
    if (!prev || prev.key !== key) change = 'track';
    else {
      const expected = this.positionOf(prev, at);
      if (expected >= REPLAY_FROM_MS && pos < REPLAY_TO_MS) change = 'replay';
      else if (prev.playing !== playing) change = 'state';
      else if (Math.abs(pos - expected) > SEEK_MS) change = 'seek';
      else change = 'none';
    }
    // The cover: what the probe read for this track (it sends the bytes only when they change).
    const media = line.source === 'media' || line.source === 'start';
    if (media)
      this.cover =
        typeof line.thumb_bytes === 'number' && line.thumb_bytes > 0
          ? this.sentCover
          : null;
    else if (change === 'track') this.cover = null; // read without the cover: unknown until the media event
    if (change === 'none') return 'none';
    if (change === 'track' || change === 'replay') {
      this.end(change === 'replay' ? 'replay' : 'change');
      this.gen++;
      this.genAt = at;
    }
    this.seq++;
    this.cur = {
      gen: this.gen,
      key,
      track,
      playing,
      pos,
      at,
    };
    return change;
  }

  view(): LiveView {
    const now = this.now();
    const base = {
      source: this.source,
      gen: this.gen,
      seq: this.seq,
      reason: this.offReason,
    };
    if (this.offReason)
      return {
        ...base,
        state: 'off',
        track: null,
        position_ms: null,
        cover: null,
      };
    const c = this.cur;
    if (!c)
      return {
        ...base,
        state: this.session === 'found' ? 'waiting' : 'lost',
        track: null,
        position_ms: null,
        cover: null,
      };
    const past =
      c.playing &&
      c.track.duration_ms !== null &&
      this.positionOf(c, now, false) > c.track.duration_ms + PAST_END_MS;
    return {
      ...base,
      state:
        past || now - this.seenAt > SILENT_MS
          ? 'stale'
          : c.playing
            ? 'playing'
            : 'paused',
      track: c.track,
      position_ms: Math.round(this.positionOf(c, now)),
      cover: this.cover?.hash ?? null,
    };
  }
}

// ---------------------------------------------------------------------------------------------- the probe (Windows)

export interface SmtcProbeOptions {
  /** The probe built for Studio (tools/smtc-probe, its own copy: a test window may hold the other one). */
  exe: string;
  /** Builds or refreshes it (run.ps1 -BuildOnly -Out <dir>): only when the source changed. */
  build?: { script: string; out: string } | null;
  onLine: (line: SmtcLine) => void;
  onDown: (reason: string) => void;
  log?: (line: string) => void;
  platform?: string;
  spawnFn?: typeof spawn;
}

/** Restart delays after the probe stops (reset once it ran 2 min): never an aggressive loop. */
const RESTART_MS = [2_000, 5_000, 15_000, 60_000, 300_000];

/**
 * The probe as Studio's child process: started with Studio, restarted with a growing delay when it stops, stopped with
 * Studio (and it leaves by itself when Studio's end of its stdin closes). Never blocks Studio: lines are read as they
 * come, a broken line is skipped.
 */
export class SmtcProbe {
  private child: ChildProcess | null = null;
  private stopped = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly o: SmtcProbeOptions) {}

  start() {
    if ((this.o.platform ?? process.platform) !== 'win32') {
      this.o.onDown('not_windows');
      return;
    }
    void this.launch();
  }

  private async launch() {
    if (this.stopped) return;
    const spawnFn = this.o.spawnFn ?? spawn;
    if (this.o.build)
      await new Promise<void>((done) => {
        const b = spawnFn(
          'powershell',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            this.o.build!.script,
            '-BuildOnly',
            '-Out',
            this.o.build!.out,
          ],
          { stdio: 'ignore', windowsHide: true },
        );
        b.on('error', () => done());
        b.on('exit', () => done());
      });
    if (this.stopped) return;
    if (!existsSync(this.o.exe)) {
      this.o.onDown('probe_missing');
      return this.later();
    }
    const startedAt = Date.now();
    let child: ChildProcess;
    try {
      child = spawnFn(this.o.exe, ['--studio'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      this.o.onDown('probe_failed');
      return this.later();
    }
    this.child = child;
    // A launch error or an exit: one restart (never two for the same child).
    let ended = false;
    const down = (why: string) => {
      if (ended) return;
      ended = true;
      this.child = null;
      if (this.stopped) return;
      if (Date.now() - startedAt > 120_000) this.failures = 0;
      this.o.log?.(`[smtc] la sonde s'est arrêtée (${why})`);
      this.o.onDown('probe_stopped');
      this.later();
    };
    child.on('error', () => down('erreur de lancement'));
    createInterface({ input: child.stdout! }).on('line', (text) => {
      try {
        const line = JSON.parse(text) as SmtcLine;
        if (line && typeof line.kind === 'string') this.o.onLine(line);
      } catch {
        /* a broken line: skipped */
      }
    });
    child.on('exit', (code) => down(`code ${code ?? '?'}`));
  }

  private later() {
    if (this.stopped) return;
    const ms = RESTART_MS[Math.min(this.failures, RESTART_MS.length - 1)]!;
    this.failures++;
    this.timer = setTimeout(() => void this.launch(), ms);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
  }
}

// ---------------------------------------------------------------------------------------------- the Lab's simulated Windows

/** What the Lab's simulated Spotify Desktop tells Windows (sim.ts `local()`): null when it is closed or plays nothing. */
export interface SimLocal {
  title: string;
  artist: string;
  album: string | null;
  playing: boolean;
  position_ms: number;
  end_ms: number;
  cover: string | null;
}

/**
 * The Lab on the simulator: the simulated Spotify Desktop seen through a simulated SMTC — the same lines as the probe
 * (each media event twice, like Spotify; a local reading every 5 s), read from the simulator's own state (never a Web
 * API call, so never counted as one).
 */
export class SimSmtc {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: {
    key: string;
    playing: boolean;
    pos: number;
    at: number;
  } | null = null;
  private open = false;
  private t = 0;
  private lastCheck = 0;
  private sentCover: string | null = null;

  constructor(
    private readonly local: () => SimLocal | null,
    private readonly onLine: (line: SmtcLine) => void,
    private readonly now: () => number = Date.now,
  ) {}

  private emit(line: SmtcLine) {
    this.onLine({ ...line, t: ++this.t });
  }

  private state(s: SimLocal, kind: string, source: string) {
    const cover =
      source === 'media' || source === 'start'
        ? s.cover
          ? Buffer.from(s.cover).toString('base64')
          : null
        : null;
    const thumb = cover && cover !== this.sentCover ? cover : undefined;
    if (thumb) this.sentCover = cover;
    this.emit({
      kind,
      source,
      title: s.title,
      artist: s.artist,
      album: s.album ?? '',
      status: s.playing ? 'Playing' : 'Paused',
      position_ms: s.position_ms,
      end_ms: s.end_ms,
      thumb_bytes:
        source === 'media' || source === 'start'
          ? s.cover
            ? s.cover.length
            : -1
          : -1,
      ...(thumb ? { thumb } : {}),
    });
  }

  /** One look at the simulator (every 250 ms). */
  step() {
    const s = this.local();
    const at = this.now();
    if (!s) {
      if (this.open) {
        this.open = false;
        this.last = null;
        this.sentCover = null;
        this.emit({ kind: 'PERDUE' });
      }
      return;
    }
    const key = `${s.title}\u001f${s.artist}\u001f${s.album ?? ''}`;
    if (!this.open) {
      this.open = true;
      this.emit({ kind: 'TROUVÉE' });
      this.state(s, 'EN COURS', 'start');
    } else if (!this.last || this.last.key !== key) {
      this.state(s, 'PISTE', 'media');
      this.state(s, 'DOUBLON', 'media');
    } else {
      const expected =
        this.last.pos + (this.last.playing ? at - this.last.at : 0);
      if (this.last.playing !== s.playing)
        this.state(s, s.playing ? 'LECTURE' : 'PAUSE', 'playback');
      else if (Math.abs(s.position_ms - expected) > 1_500)
        this.state(s, s.position_ms < 3_000 ? 'REJOUÉ' : 'POSITION', 'media');
      else if (at - this.lastCheck >= 5_000) {
        this.lastCheck = at;
        this.state(s, 'CONTRÔLE', 'check');
      } else {
        return;
      }
    }
    this.last = { key, playing: s.playing, pos: s.position_ms, at };
  }

  start(everyMs = 250) {
    this.step();
    this.timer = setInterval(() => this.step(), everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
