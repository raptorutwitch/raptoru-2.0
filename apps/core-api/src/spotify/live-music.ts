import { randomUUID } from 'node:crypto';
import {
  SPOTIFY_LIVE,
  type SpotifyLiveNow,
  type SpotifyLiveTrack,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { liveChannelSession } from '../stream/channel-sessions.js';
import { activeSession } from '../stream/stream-sessions.js';

// Music Hub — the live track and the stream's music history (docs/music/SMTC_STUDIO.md). What Spotify Desktop plays,
// as Windows tells Studio (SMTC): every track that really played during a live — the broadcaster's own, a playlist's,
// a request's. DISPLAY ONLY: SMTC has no Spotify id, so nothing here decides a request (start, end, cancel, refund stay
// Core's, on the Web API's exact track — service.ts observe()). A request is recognised in the history only through
// the Web API's exact uri of that occurrence (Studio's link) and Core's own attribution of that occurrence, never a title.
//
// Storage: the module host's tables (module_state: the live state; module_activity: one row per occurrence, keyed by
// Studio's boot + occurrence — a replayed message never writes twice). No migration of its own.

const MODULE = 'music_history';
const HISTORY_DAYS = 30;
/** A request whose Core-observed start is this close to the occurrence's start is that occurrence (same exact uri). */
const SAME_OCCURRENCE_MS = 30_000;
/** A skip reported this long after the change still marks the track it skipped (the report may come second). */
const LATE_SKIP_MS = 15_000;

export type EndKind = 'natural' | 'interrupted' | 'unknown';
type Cause =
  | NonNullable<SpotifyLiveNow['ended']>['cause']
  | 'restart'
  | 'live_end'
  | 'gap';

/**
 * How an occurrence ended, from what Studio saw at the change — display only, never a decision:
 * - `natural`: a change within `naturalEndMs` of the end (an end, a crossfade, a skip in the last seconds — compatible);
 * - `interrupted`: another track (or the same again) started earlier — PROBABLY interrupted (by hand, a skip in the app,
 *   a click elsewhere…): never shown as a certain skip;
 * - `unknown`: Spotify closed, the source lost, Studio restarted, the live ended, or no position — never a skip.
 * A skip COMMAND (Raptoru: panel, `!songskip`, the extension's player) on this exact track is recorded apart (`skip`).
 */
export function classifyEnd(e: {
  duration_ms: number | null;
  position_ms: number | null;
  cause: Cause;
}): EndKind {
  if (e.cause !== 'change' && e.cause !== 'replay') return 'unknown';
  if (e.position_ms === null || e.duration_ms === null) return 'unknown';
  return e.duration_ms - e.position_ms <= SPOTIFY_LIVE.naturalEndMs
    ? 'natural'
    : 'interrupted';
}

interface OpenEntry {
  id: string;
  boot: string;
  gen: number;
  key: string;
  started_at: string;
  duration_ms: number | null;
  uri: string | null;
  request_id: string | null;
  /** A skip command took this exact track. */
  skip: boolean;
  listened_ms: number;
  /** Skips reported before the occurrence's exact track was known (checked once it is). */
  pending_skips: string[];
}

interface LiveRow {
  boot: string;
  boot_at: string;
  seq: number;
  gen: number;
  state: SpotifyLiveNow['state'];
  track: SpotifyLiveTrack | null;
  position_ms: number | null;
  link: SpotifyLiveNow['link'];
  /** Core's clock when it received this state (the anchor of the extrapolated position). */
  received_at: string;
  entry: OpenEntry | null;
  last_closed: { id: string; uri: string | null; ended_at: string } | null;
}

interface EntryRow {
  activity_id: string;
  viewer_id: string | null;
  viewer_name: string | null;
  input: {
    title: string;
    artists: string[];
    album: string | null;
    duration_ms: number | null;
    cover_url?: string | null;
    uri?: string | null;
    request_id?: string | null;
    session_started_at?: string | null;
  };
  result: {
    end: EndKind;
    cause: Cause;
    skip: boolean;
    listened_ms: number;
    ended_at: string;
  } | null;
  created_at: Date;
}

interface RequestLite {
  request_id: string;
  viewer_id: string;
  viewer_name: string;
  state: string;
  track: { uri: string; title: string; artists: string[] } | null;
  display: { image_url?: string | null; album?: string | null } | null;
  playback_started_at: Date;
}

const keyOf = (t: SpotifyLiveTrack) =>
  `${t.title}\u001f${t.artists.join(', ')}\u001f${t.album ?? ''}`;

export interface LiveView {
  state: SpotifyLiveNow['state'];
  gen: number;
  track: SpotifyLiveTrack | null;
  /** Extrapolated to Core's now (a display estimate, never a proof of play). */
  position_ms: number | null;
  is_playing: boolean;
  cover_url: string | null;
  /** The exact track of this occurrence, once Studio read it (null before: no request can be shown yet). */
  uri: string | null;
  received_at: string;
}

export interface HistoryItem {
  id: string;
  at: string;
  title: string | null;
  artists: string[];
  album: string | null;
  image_url: string | null;
  kind: 'request' | 'track';
  requested_by: string | null;
  own: boolean;
  /** `skipped` only on a skip command of this exact track (or a request Core ended SKIPPED); null: playing now. */
  end: 'skipped' | 'interrupted' | 'natural' | 'unknown' | null;
  listened_ms: number | null;
  session_started_at: string | null;
  viewer_login?: string | null;
}

export class LiveMusic {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Lab: the simulated live of the Lab (lab_stream_sessions); else the canonical live (stream_sessions). */
    private readonly labSessions: () => boolean,
  ) {}

  private async load(q: Queryable, channelId: string) {
    return (
      (
        await q.query<{ value: LiveRow }>(
          `select value from module_state where channel_id = $1 and module_id = $2 and key = 'now'`,
          [channelId, MODULE],
        )
      )[0]?.value ?? null
    );
  }

  private async save(q: Queryable, channelId: string, v: LiveRow) {
    await q.query(
      `insert into module_state (channel_id, module_id, key, value, updated_at) values ($1, $2, 'now', $3, $4)
       on conflict (channel_id, module_id, key) do update set value = $3, updated_at = $4`,
      [channelId, MODULE, JSON.stringify(v), this.clock.now()],
    );
  }

  /** The live the history follows (Lab: its simulated one), for Studio's page. */
  async session(q: Queryable, channelId: string) {
    const at = await this.liveStart(q, channelId);
    return { live: !!at, since: at ? new Date(at).toISOString() : null };
  }

  private async liveStart(q: Queryable, channelId: string) {
    if (this.labSessions())
      return (await liveChannelSession(q, channelId))?.started_at ?? null;
    return (await activeSession(q))?.startedAt ?? null;
  }

  /**
   * Studio's message, under the channel's lock (service.ts). Older or replayed messages change nothing. The open entry
   * ends on a new occurrence, the source lost, a Studio restart on another track, or the live's end; a new entry opens
   * when a track really plays during a live.
   */
  async apply(q: Queryable, channelId: string, body: SpotifyLiveNow) {
    const now = this.clock.now();
    const prev = await this.load(q, channelId);
    if (prev) {
      if (prev.boot === body.boot && body.seq <= prev.seq)
        return { accepted: false as const };
      // An older Studio still talking is ignored — unless the stored one went silent (a PC clock set back, then a
      // restart, must never stop the history for good).
      if (
        prev.boot !== body.boot &&
        Date.parse(body.boot_at) < Date.parse(prev.boot_at) &&
        now.getTime() - Date.parse(prev.received_at) <= SPOTIFY_LIVE.freshMs
      )
        return { accepted: false as const };
    }
    let entry = prev?.entry ?? null;
    let lastClosed = prev?.last_closed ?? null;
    // Listened time: what played since the previous message of the same occurrence.
    if (
      entry &&
      prev?.state === 'playing' &&
      prev.boot === entry.boot &&
      prev.gen === entry.gen
    )
      // Capped: a Studio silent for long (closed) never counts its silence as listened.
      entry.listened_ms += Math.min(
        SPOTIFY_LIVE.freshMs,
        Math.max(0, now.getTime() - Date.parse(prev.received_at)),
      );
    const liveAt = await this.liveStart(q, channelId);
    const key = body.track ? keyOf(body.track) : null;

    if (entry) {
      let cause: Cause | null = null;
      let position: number | null = null;
      if (entry.boot === body.boot) {
        if (body.gen !== entry.gen) {
          const e = body.ended?.gen === entry.gen ? body.ended : null;
          cause = e?.cause ?? 'gap';
          position = e?.position_ms ?? null;
        } else if (body.state === 'lost' || body.state === 'off')
          cause = body.state;
      } else {
        // Studio restarted: the same track, started at the same time, is the same occurrence going on.
        const same =
          key === entry.key &&
          (body.state === 'playing' || body.state === 'paused') &&
          body.position_ms !== null &&
          Math.abs(
            now.getTime() - body.position_ms - Date.parse(entry.started_at),
          ) <= SPOTIFY_LIVE.sameStartMs;
        if (same) {
          entry.boot = body.boot;
          entry.gen = body.gen;
        } else if (body.state !== 'off' && body.state !== 'stale')
          cause = 'restart';
        // Off / stale from the new Studio (its source not heard yet): nothing decided until it tells what plays.
      }
      if (!cause && !liveAt) cause = 'live_end';
      if (cause) {
        await this.close(q, entry, cause, position, now);
        lastClosed = {
          id: entry.id,
          uri: entry.uri,
          ended_at: now.toISOString(),
        };
        entry = null;
      }
    }

    if (!entry && liveAt && body.track && key && body.state === 'playing') {
      const started = new Date(now.getTime() - (body.position_ms ?? 0));
      const id = randomUUID();
      const inserted = await q.query<{ activity_id: string }>(
        `insert into module_activity (activity_id, channel_id, module_id, action, amount, status, input, created_at,
           updated_at, idempotency_key)
         values ($1, $2, $3, 'track', 0, 'done', $4, $5, $6, $7)
         on conflict (channel_id, module_id, idempotency_key) where idempotency_key is not null do nothing
         returning activity_id`,
        [
          id,
          channelId,
          MODULE,
          JSON.stringify({
            title: body.track.title,
            artists: body.track.artists,
            album: body.track.album,
            duration_ms: body.track.duration_ms,
            session_started_at: new Date(liveAt).toISOString(),
          }),
          started,
          now,
          // One occurrence per live: the same track still playing when a new live starts is listed in it too.
          `${body.boot}:${body.gen}:${new Date(liveAt).getTime()}`,
        ],
      );
      if (inserted.length)
        entry = {
          id,
          boot: body.boot,
          gen: body.gen,
          key,
          started_at: started.toISOString(),
          duration_ms: body.track.duration_ms,
          uri: null,
          request_id: null,
          skip: false,
          listened_ms: 0,
          pending_skips: [],
        };
    }

    // The exact track of this occurrence (Studio's Web API reading), then the request Core attributed to it.
    if (
      entry &&
      body.link &&
      entry.boot === body.boot &&
      entry.gen === body.gen &&
      !entry.uri
    ) {
      entry.uri = body.link.uri;
      if (entry.pending_skips.includes(entry.uri)) entry.skip = true;
      entry.pending_skips = [];
      await q.query(
        `update module_activity set input = input || $2::jsonb, updated_at = $3 where activity_id = $1`,
        [
          entry.id,
          JSON.stringify({
            uri: body.link.uri,
            cover_url: body.link.cover_url,
            ...(body.link.artists.length ? { artists: body.link.artists } : {}),
          }),
          now,
        ],
      );
    }
    if (entry?.uri && !entry.request_id)
      entry.request_id = await this.attach(q, channelId, entry);

    await this.save(q, channelId, {
      boot: body.boot,
      boot_at: body.boot_at,
      seq: body.seq,
      gen: body.gen,
      state: body.state,
      track: body.track,
      position_ms: body.position_ms,
      link: body.link,
      received_at: now.toISOString(),
      entry,
      last_closed: lastClosed,
    });
    return { accepted: true as const, entry_id: entry?.id ?? null };
  }

  /**
   * The request of this occurrence: same exact uri (the Web API's), and Core's own observation started it at the same
   * time (± 30 s) — the attribution Core already made (FIFO, restarts). Never twice the same request.
   */
  private async attach(q: Queryable, channelId: string, entry: OpenEntry) {
    const at = Date.parse(entry.started_at);
    const r = (
      await q.query<RequestLite>(
        `select request_id, viewer_id, viewer_name from spotify_requests r
          where channel_id = $1 and track->>'uri' = $2 and playback_started_at between $3 and $4
            and state in ('PLAYING', 'PLAYED', 'SKIPPED', 'UNKNOWN')
            and not exists (select 1 from module_activity m where m.channel_id = $1 and m.module_id = $5
                              and m.input->>'request_id' = r.request_id::text)
          order by playback_started_at desc limit 1`,
        [
          channelId,
          entry.uri,
          new Date(at - SAME_OCCURRENCE_MS),
          new Date(at + SAME_OCCURRENCE_MS),
          MODULE,
        ],
      )
    )[0];
    if (!r) return null;
    await q.query(
      `update module_activity set viewer_id = $2, viewer_name = $3, input = input || $4::jsonb where activity_id = $1`,
      [
        entry.id,
        r.viewer_id,
        r.viewer_name,
        JSON.stringify({ request_id: r.request_id }),
      ],
    );
    return r.request_id;
  }

  private async close(
    q: Queryable,
    entry: OpenEntry,
    cause: Cause,
    position: number | null,
    now: Date,
  ) {
    const listened = Math.min(
      entry.listened_ms,
      entry.duration_ms ?? Number.MAX_SAFE_INTEGER,
    );
    const end = classifyEnd({
      duration_ms: entry.duration_ms,
      position_ms: position,
      cause,
    });
    await q.query(
      `update module_activity set result = $2, reason = $3, updated_at = $4 where activity_id = $1`,
      [
        entry.id,
        JSON.stringify({
          end,
          cause,
          skip: entry.skip,
          listened_ms: Math.round(listened),
          ended_at: now.toISOString(),
        }),
        // A glimpse (a quick skip through a playlist, a canceled request skipped at once): kept, never listed.
        listened < SPOTIFY_LIVE.briefMs ? 'brief' : null,
        now,
      ],
    );
  }

  /** A skip COMMAND of Raptoru took this exact track (Studio's report): the occurrence it ended is a confirmed skip. */
  async noteSkip(q: Queryable, channelId: string, uri: string) {
    const st = await this.load(q, channelId);
    if (!st) return;
    const now = this.clock.now();
    const e = st.entry;
    const c = st.last_closed;
    // The skip's report may come after the change: then it is the occurrence that just ended (the same track
    // played again right after — a repeat, the same request twice — is never marked by it).
    const late =
      c?.uri === uri && now.getTime() - Date.parse(c.ended_at) <= LATE_SKIP_MS;
    const fresh =
      !!e && now.getTime() - Date.parse(e.started_at) <= LATE_SKIP_MS + 5_000;
    if (e && !(late && fresh)) {
      if (e.uri === uri) e.skip = true;
      else if (!e.uri && !e.pending_skips.includes(uri))
        e.pending_skips = [...e.pending_skips, uri].slice(-5);
    }
    if (late)
      await q.query(
        `update module_activity set result = jsonb_set(result, '{skip}', 'true'), updated_at = $2
          where activity_id = $1 and result is not null`,
        [c.id, now],
      );
    await this.save(q, channelId, st);
  }

  /** The live track now (Core's clock), or null when Studio has said nothing for `freshMs` (then: the Web API's). */
  async view(q: Queryable, channelId: string): Promise<LiveView | null> {
    const st = await this.load(q, channelId);
    if (!st) return null;
    const age = this.clock.now().getTime() - Date.parse(st.received_at);
    if (age > SPOTIFY_LIVE.freshMs) return null;
    const lost = st.state === 'lost' || st.state === 'off' || !st.track;
    const playing = st.state === 'playing';
    const pos =
      lost || st.position_ms === null
        ? null
        : st.position_ms + (playing ? Math.max(0, age) : 0);
    return {
      state: st.state,
      gen: st.gen,
      track: lost
        ? null
        : {
            ...st.track!,
            artists: st.link?.artists.length
              ? st.link.artists
              : st.track!.artists,
          },
      position_ms:
        pos === null
          ? null
          : Math.round(
              Math.min(pos, st.track?.duration_ms ?? Number.MAX_SAFE_INTEGER),
            ),
      is_playing: playing,
      cover_url: lost ? null : (st.link?.cover_url ?? null),
      uri: lost ? null : (st.link?.uri ?? null),
      received_at: st.received_at,
    };
  }

  /**
   * The stream's music history, newest first: every occurrence recorded during a live (glimpses excepted), and the
   * requests Core saw play that no occurrence carries (no SMTC then) — one list, `limit` per page, 30 days at most.
   */
  async history(
    q: Queryable,
    channelId: string,
    o: {
      before: string | null;
      limit: number;
      viewerId: string | null;
      team: boolean;
    },
  ) {
    const now = this.clock.now();
    const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
    // « En cours » only while Studio is heard (a Studio closed at the end of a live leaves no track « playing »).
    const st = await this.load(q, channelId);
    const openId =
      st && now.getTime() - Date.parse(st.received_at) <= SPOTIFY_LIVE.freshMs
        ? (st.entry?.id ?? null)
        : null;
    const entries = await q.query<EntryRow>(
      `select activity_id, viewer_id, viewer_name, input, result, created_at from module_activity
        where channel_id = $1 and module_id = $2 and reason is distinct from 'brief' and created_at > $3
          and ($4::timestamptz is null or created_at < $4)
        order by created_at desc limit $5`,
      [channelId, MODULE, since, o.before, o.limit + 1],
    );
    const requests = await q.query<RequestLite & { viewer_login: string }>(
      `select request_id, viewer_id, viewer_name, viewer_login, state, track, display, playback_started_at
         from spotify_requests r
        where channel_id = $1 and state in ('PLAYED', 'SKIPPED') and playback_started_at is not null
          and playback_started_at > $2 and ($3::timestamptz is null or playback_started_at < $3)
          and not exists (select 1 from module_activity m where m.channel_id = $1 and m.module_id = $4
                            and m.input->>'request_id' = r.request_id::text)
        order by playback_started_at desc limit $5`,
      [channelId, since, o.before, MODULE, o.limit + 1],
    );
    // The requests the occurrences carry: their outcome (Core's) wins over the guess.
    const ids = entries
      .map((e) => e.input.request_id)
      .filter((x): x is string => !!x);
    const carried = new Map(
      (ids.length
        ? await q.query<RequestLite & { viewer_login: string }>(
            `select request_id, viewer_id, viewer_name, viewer_login, state, track, display, playback_started_at
               from spotify_requests where request_id = any($1::uuid[])`,
            [ids],
          )
        : []
      ).map((r) => [r.request_id, r]),
    );
    const items: HistoryItem[] = [
      ...entries.map((e) => {
        const r = e.input.request_id
          ? (carried.get(e.input.request_id) ?? null)
          : null;
        const end: HistoryItem['end'] =
          e.activity_id === openId
            ? null
            : e.result?.skip || r?.state === 'SKIPPED'
              ? 'skipped'
              : r?.state === 'PLAYED'
                ? 'natural'
                : // Not closed and Studio silent: its end is not known.
                  (e.result?.end ?? 'unknown');
        return {
          id: e.activity_id,
          at: new Date(e.created_at).toISOString(),
          title: e.input.title,
          artists: e.input.artists ?? [],
          album: e.input.album ?? null,
          image_url: e.input.cover_url ?? r?.display?.image_url ?? null,
          kind: r ? ('request' as const) : ('track' as const),
          requested_by: r?.viewer_name ?? null,
          own: !!r && !!o.viewerId && r.viewer_id === o.viewerId,
          end,
          listened_ms: e.result?.listened_ms ?? null,
          session_started_at: e.input.session_started_at ?? null,
          ...(o.team ? { viewer_login: r?.viewer_login ?? null } : {}),
        };
      }),
      ...requests.map((r) => ({
        id: r.request_id,
        at: new Date(r.playback_started_at).toISOString(),
        title: r.track?.title ?? null,
        artists: r.track?.artists ?? [],
        album: r.display?.album ?? null,
        image_url: r.display?.image_url ?? null,
        kind: 'request' as const,
        requested_by: r.viewer_name,
        own: !!o.viewerId && r.viewer_id === o.viewerId,
        end:
          r.state === 'SKIPPED' ? ('skipped' as const) : ('natural' as const),
        listened_ms: null,
        session_started_at: null,
        ...(o.team ? { viewer_login: r.viewer_login } : {}),
      })),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const page = items.slice(0, o.limit);
    const more = items.length > o.limit;
    const liveAt = await this.liveStart(q, channelId);
    return {
      live: !!liveAt,
      since: liveAt ? new Date(liveAt).toISOString() : null,
      items: page,
      next: more ? page[page.length - 1]!.at : null,
    };
  }
}
