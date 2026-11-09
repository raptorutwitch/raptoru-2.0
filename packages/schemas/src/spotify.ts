import { z } from 'zod';

// Spotify V2 (docs/SPOTIFY_V2.md) — « Choisi la prochaine musique ! » without SAMMI. Core decides (requests, logical
// queue, limits, chat); Studio is the only one that talks to Spotify (search, queue, playback, skips); the bot changes the
// redemption's status on Twitch. Rules and texts come from the historical Node service (spotify-v2/, 25/08 → 18/10/2026).

/** Historical rules (spotify-v2/config.js): defaults never changed by Raptoru, adjustable in Studio. */
export const SPOTIFY_RULES = {
  maxPendingPerViewer: 2,
  viewerCooldownSeconds: 600,
  maxDurationSeconds: 600,
  /** `!songcancel` on the viewer's song already playing: only within its first seconds. */
  cancelGraceSeconds: 10,
  searchLimit: 10,
  minScore: 0.68,
  minMargin: 0.08,
  /** A Studio job claimed but not reported within this delay is not replayed (it may have run). */
  jobLeaseMs: 30_000,
  /** Studio not seen for this long: requests are refused before any search (Spotify unreachable). */
  studioFreshMs: 15_000,
  /** A playback observation older than this cannot attribute or time a cancellation. */
  observationFreshMs: 10_000,
  /** `!song`: Studio's answer awaited this long, then « indisponible ». */
  readPlaybackTimeoutMs: 6_000,
  // Music Hub (docs/music/MUSIC_HUB_STATE.md): the extension's entry, paid in Jetons, into the SAME requests and queue.
  /** Default price of a request made from the extension, in Jetons (set in Studio). */
  extensionPriceTokens: 500,
  /** A search shorter than this is not sent (characters, trimmed). */
  searchMinChars: 2,
  /** The extension's searches of one viewer per minute (Core refuses beyond, the catalogue API is shared). */
  searchesPerViewerPerMinute: 20,
  /** New catalogue searches of the whole channel per minute (a text already searched is reused, free). Matches Studio's
   *  catalogue lane: a wave of searches never eats the budget of the queue, the skips and the reward. */
  searchesPerChannelPerMinute: 30,
  /** A search job Studio has not answered within this delay: « catalogue indisponible ». */
  searchTimeoutMs: 6_000,
  /** A finished search stays reusable this long (same text): no second job, no second catalogue call. */
  searchReuseMs: 5 * 60_000,
} as const;

const ChannelId = z.string().regex(/^\d{1,32}$/);
const Uuid = z.uuid();
const SpotifyId = z.string().regex(/^[A-Za-z0-9]{22}$/);
const TrackUri = z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/);
const ShortText = z.string().max(300);

export const SpotifySettingsUpdate = z.strictObject({
  enabled: z.boolean().optional(),
  max_pending_per_viewer: z.number().int().min(1).max(10).optional(),
  viewer_cooldown_seconds: z.number().int().min(0).max(3_600).optional(),
  max_duration_seconds: z.number().int().min(60).max(1_800).optional(),
  cancel_grace_seconds: z.number().int().min(0).max(60).optional(),
  // Music Hub (extension entry). OFF by default: nothing changes for the channel-points reward.
  extension_enabled: z.boolean().optional(),
  extension_price_tokens: z.number().int().min(0).max(1_000_000).optional(),
  /** From the extension: a track already waiting in the queue cannot be asked again (the reward is unchanged). */
  no_duplicates: z.boolean().optional(),
  /** Pause / resume / volume from the team (Studio, extension moderators). OFF by default. */
  player_controls: z.boolean().optional(),
});
export type SpotifySettingsUpdate = z.infer<typeof SpotifySettingsUpdate>;

export const SpotifyTrack = z.strictObject({
  id: SpotifyId,
  uri: TrackUri,
  title: ShortText,
  artists: z.array(ShortText).max(20),
  duration_ms: z
    .number()
    .int()
    .min(0)
    .max(24 * 3_600_000),
});
export type SpotifyTrack = z.infer<typeof SpotifyTrack>;

/** A per-viewer exception to the global limits (Studio › Musique › Viewers). Null = the global setting; both null
 *  = back to the global settings (the exception is removed). */
export const SpotifyViewerOverrideUpdate = z.strictObject({
  viewer_login: z
    .string()
    .trim()
    .toLowerCase()
    .transform((s) => s.replace(/^@/, ''))
    .pipe(z.string().regex(/^[a-z0-9_]{1,25}$/)),
  max_pending_per_viewer: z.number().int().min(1).max(10).nullable(),
  viewer_cooldown_seconds: z.number().int().min(0).max(3_600).nullable(),
});
export type SpotifyViewerOverrideUpdate = z.infer<
  typeof SpotifyViewerOverrideUpdate
>;

/** Request states (historical names, spotify-v2/constants.js). */
export const SpotifyRequestState = z.enum([
  'RECEIVED',
  'SEARCHING',
  'QUEUED',
  'PLAYING',
  'PLAYED',
  'SKIPPED',
  'CANCELED',
  'REMOVED_BY_MOD',
  'FAILED',
  'AMBIGUOUS',
  'TOO_LONG',
  'VIEWER_LIMIT',
  'VIEWER_COOLDOWN',
  'UNKNOWN',
]);
export type SpotifyRequestState = z.infer<typeof SpotifyRequestState>;

/** Reason codes (historical, plus the Raptoru admission ones). */
export const SpotifyReason = z.enum([
  'QUEUED',
  'PLAYING',
  'PLAYED',
  'SKIPPED',
  'NATURAL_END',
  'INTERRUPTED',
  'INTERRUPTED_EXTERNAL',
  'INVALID_INPUT',
  'INVALID_REFERENCE',
  'NOT_FOUND',
  'AMBIGUOUS',
  'TOO_LONG',
  'VIEWER_LIMIT',
  'VIEWER_COOLDOWN',
  'DUPLICATE_REDEEM',
  'NO_DEVICE',
  'AUTH_NOT_CONFIGURED',
  'AUTH_REQUIRED',
  'SPOTIFY_UNAVAILABLE',
  'RATE_LIMITED',
  'TEMPORARY_ERROR',
  'QUEUE_RESULT_UNKNOWN',
  'VIEWER_CANCEL',
  'MOD_REMOVE',
  'MODULE_DISABLED',
  'STUDIO_UNAVAILABLE',
  'LATE',
  'STUDIO_LOST',
  // Refonte H6: canceled at the end of the live (not started), refunded when the reward allows it.
  'STREAM_ENDED',
  // Music Hub: the track is already waiting in the queue / the catalogue says it cannot be played / the
  // extension's entry is off.
  'DUPLICATE_TRACK',
  'NOT_PLAYABLE',
  'EXTENSION_DISABLED',
  // Lab with the broadcaster's real account (LAB_SPOTIFY=real): the session is read-only, nothing was sent to Spotify.
  'LAB_READ_ONLY',
  // Music Hub: a paid skip aimed at a track that is no longer the one playing (nothing was skipped).
  'TRACK_CHANGED',
]);
export type SpotifyReason = z.infer<typeof SpotifyReason>;

/** What Studio says about its Spotify side, with every sync (shown in Studio, used by Core's admission). */
export const SpotifyStudioStatus = z.strictObject({
  /** OAuth: connected and usable / never configured / refresh refused (reconnect). */
  auth: z.enum(['ok', 'not_configured', 'needs_reauth']),
  /** Spotify refuses every call until this instant (429 Retry-After), or null. */
  limited_until: z.iso.datetime({ offset: true }).nullable(),
  quota_exceeded: z.boolean(),
  /** The device Spotify plays on (last read), or null when none is active. */
  device: z.strictObject({ name: ShortText, type: ShortText }).nullable(),
  /** Calls to Spotify in the last minute (all kinds), for the panel. */
  calls_last_minute: z.number().int().min(0).max(100_000),
  /**
   * Music Hub, Lab on the broadcaster's real account only: writes (queue, skips, player) are refused by Studio this
   * session. Absent everywhere else (an older Core never receives it from a Production Studio).
   */
  read_only: z.boolean().optional(),
});
export type SpotifyStudioStatus = z.infer<typeof SpotifyStudioStatus>;

/** One playback reading (GET /me/player), as Studio reports it. Null track: nothing (or no track) playing. */
export const SpotifyPlayback = z.strictObject({
  observed_at: z.iso.datetime({ offset: true }),
  track: SpotifyTrack.nullable(),
  progress_ms: z.number().int().min(0).nullable(),
  is_playing: z.boolean(),
  /** The device's volume (0–100) when the reading has it. */
  volume_percent: z.number().int().min(0).max(100).nullable().optional(),
});
export type SpotifyPlayback = z.infer<typeof SpotifyPlayback>;

/** Studio → Core, every second or so: its status, and (when it polled Spotify) the last playback reading. */
export const SpotifyStudioSync = z.strictObject({
  status: SpotifyStudioStatus,
  playback: SpotifyPlayback.nullable().optional(),
});
export type SpotifyStudioSync = z.infer<typeof SpotifyStudioSync>;

// Music Hub — what plays on the broadcaster's PC as WINDOWS tells it (SMTC, docs/music/SMTC_STUDIO.md). Display and the
// stream's music history only: never a request's decision (those stay on SpotifyPlayback, the Web API's exact track).
export const SPOTIFY_LIVE = {
  /** Studio repeats the state this often without a change (its anchor, and it is alive). */
  heartbeatMs: 30_000,
  /** No word from Studio for this long: the live state is no longer shown (back to the Web API's reading). */
  freshMs: 90_000,
  /** A track that ends this close to its end ended normally (Spotify's crossfade is up to 12 s). */
  naturalEndMs: 15_000,
  /** Listened less than this: a glimpse (a quick skip through a playlist, a canceled request skipped), not listed. */
  briefMs: 5_000,
  /** A Studio that restarts finds the same track started within this margin: the same history entry goes on. */
  sameStartMs: 20_000,
} as const;

export const SpotifyLiveTrack = z.strictObject({
  title: z.string().min(1).max(300),
  artists: z.array(ShortText).max(20),
  album: ShortText.nullable(),
  duration_ms: z
    .number()
    .int()
    .min(0)
    .max(24 * 3_600_000)
    .nullable(),
});
export type SpotifyLiveTrack = z.infer<typeof SpotifyLiveTrack>;

/** Studio → Core on each change and every `heartbeatMs`. `seq` orders one Studio's messages; `gen` is one occurrence. */
export const SpotifyLiveNow = z.strictObject({
  /** This Studio process (a restart is a new boot), and when it started (an older boot never overwrites a newer). */
  boot: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  boot_at: z.iso.datetime({ offset: true }),
  seq: z.number().int().min(0),
  gen: z.number().int().min(0),
  state: z.enum(['playing', 'paused', 'lost', 'stale', 'off']),
  track: SpotifyLiveTrack.nullable(),
  /** Where the track is when Studio sends this (Studio extrapolates from Windows' last position). */
  position_ms: z.number().int().min(0).nullable(),
  /** The exact Spotify track of THIS occurrence, from a Web API reading taken after it started (never from a title). */
  link: z
    .strictObject({
      uri: TrackUri,
      // Spotify's image CDN (the Lab's simulator: its own SVG covers).
      cover_url: z
        .string()
        .max(4_000)
        .regex(/^(https:\/\/i\.scdn\.co\/|data:image\/svg\+xml,)/)
        .nullable(),
      artists: z.array(ShortText).max(20),
    })
    .nullable(),
  /** How the previous occurrence ended, as Studio saw it at the change (position extrapolated at that instant). */
  ended: z
    .strictObject({
      gen: z.number().int().min(0),
      position_ms: z.number().int().min(0).nullable(),
      playing: z.boolean(),
      cause: z.enum(['change', 'replay', 'lost', 'off']),
    })
    .nullable(),
});
export type SpotifyLiveNow = z.infer<typeof SpotifyLiveNow>;

/** A Spotify reference parsed by Core (historical spotify-v2/reference.js). */
export const SpotifyReference = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exact'), track_id: SpotifyId }),
  z.strictObject({
    kind: z.literal('search'),
    query: z.string().min(1).max(500),
  }),
]);
export type SpotifyReference = z.infer<typeof SpotifyReference>;

/** Jobs Core hands to Studio (the only Spotify caller). */
export const SpotifyJob = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('song_request'),
    job_id: Uuid,
    request_id: Uuid,
    reference: SpotifyReference,
    /** Rules frozen at reception. */
    max_duration_ms: z.number().int().min(1),
  }),
  z.strictObject({
    kind: z.literal('skip'),
    job_id: Uuid,
    /** The request this skip ends (a moderator's `!songskip`, a `!songcancel` within the grace…), or null. */
    request_id: Uuid.nullable(),
    /**
     * Music Hub (a viewer's paid skip): skip only if THIS track still plays — another one → `TRACK_CHANGED`, nothing
     * sent (never a second track skipped by a late skip). Only on the jobs of a paid skip.
     */
    expect_uri: TrackUri.optional(),
  }),
  z.strictObject({ kind: z.literal('read_playback'), job_id: Uuid }),
  // Music Hub: a catalogue search for the extension (never queues anything) and a player control.
  z.strictObject({
    kind: z.literal('search'),
    job_id: Uuid,
    query: z.string().min(1).max(200),
    /** Music Hub V2: a pasted track link — this exact track, read by its id (no text search). */
    track_id: SpotifyId.optional(),
  }),
  z.strictObject({
    kind: z.literal('control'),
    job_id: Uuid,
    action: z.enum(['pause', 'resume', 'volume', 'seek']),
    volume_percent: z.number().int().min(0).max(100).nullable(),
    /** Music Hub: `seek` — where to go in THIS track (`expect_uri`); another track playing → nothing is sent. */
    position_ms: z
      .number()
      .int()
      .min(0)
      .max(24 * 3_600_000)
      .optional(),
    expect_uri: TrackUri.optional(),
  }),
]);
export type SpotifyJob = z.infer<typeof SpotifyJob>;

/**
 * One catalogue result shown to a viewer (Music Hub). The provider says where it comes from: `spotify` (Studio's
 * connected account; its use in a Twitch extension is NOT cleared — docs/music/MUSIC_HUB_STATE.md § Conformité) or
 * `lab` (the Lab's fictional catalogue). The art is a link (https) or, in the Lab, a small inline picture.
 */
export const SpotifySearchItem = z.strictObject({
  id: SpotifyId,
  uri: TrackUri,
  title: ShortText,
  artists: z.array(ShortText).max(20),
  album: ShortText.nullable(),
  duration_ms: z
    .number()
    .int()
    .min(0)
    .max(24 * 3_600_000),
  image_url: z
    .string()
    .max(4_000)
    .regex(/^(https:\/\/|data:image\/svg\+xml,)/)
    .nullable(),
  /** False: the catalogue says this version cannot be played (shown, never requestable). */
  playable: z.boolean(),
});
export type SpotifySearchItem = z.infer<typeof SpotifySearchItem>;

/** One entry of the logical queue as Studio needs it (matching a playing track, auto-skip of canceled ones). */
export const SpotifyQueueEntry = z.strictObject({
  request_id: Uuid,
  track_uri: TrackUri,
  state: SpotifyRequestState,
  /** Canceled / removed after it reached Spotify's queue: skip it as soon as Spotify plays it (once). */
  auto_skip: z.boolean(),
  queued_at: z.iso.datetime({ offset: true }),
});
export type SpotifyQueueEntry = z.infer<typeof SpotifyQueueEntry>;

/** Core → Studio answer to a sync. */
export const SpotifySyncAnswer = z.strictObject({
  enabled: z.boolean(),
  jobs: z.array(SpotifyJob).max(50),
  /** Requests that are in Spotify's queue (or may be), in the queue's order (FIFO), tombstones included. */
  queue: z.array(SpotifyQueueEntry).max(500),
  /** The request Core attributes the current track to, or null. */
  current_request_id: Uuid.nullable(),
  /** Something to watch (a request queued / playing / a tombstone): Studio polls Spotify only then. */
  watch: z.boolean(),
});
export type SpotifySyncAnswer = z.infer<typeof SpotifySyncAnswer>;

/** Studio claims a job before calling Spotify (once: a job is never run twice). */
export const SpotifyJobStart = z.strictObject({ attempt_id: Uuid });
export type SpotifyJobStart = z.infer<typeof SpotifyJobStart>;

export const SpotifyCandidate = z.strictObject({
  id: SpotifyId,
  title: ShortText,
  artists: z.array(ShortText).max(20),
  score: z.number().min(0).max(1),
});

/** Studio → Core: what a job did. */
export const SpotifyJobReport = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('song_request'),
    attempt_id: Uuid,
    outcome: z.enum(['queued', 'refused', 'unknown']),
    /** Refused: why (deterministic); unknown: QUEUE_RESULT_UNKNOWN. */
    reason: SpotifyReason.optional(),
    track: SpotifyTrack.optional(),
    candidates: z.array(SpotifyCandidate).max(5).optional(),
    confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
    margin: z.number().min(0).max(1).optional(),
    confirmation: z.enum(['http_204', 'queue_readback']).optional(),
  }),
  z.strictObject({
    kind: z.literal('skip'),
    attempt_id: Uuid,
    outcome: z.enum(['skipped', 'failed', 'unknown']),
    reason: SpotifyReason.optional(),
    /** The track playing when the skip was sent (what was skipped). */
    skipped_track: SpotifyTrack.nullable().optional(),
  }),
  z.strictObject({
    kind: z.literal('read_playback'),
    attempt_id: Uuid,
    playback: SpotifyPlayback.nullable(),
    reason: SpotifyReason.optional(),
  }),
  z.strictObject({
    kind: z.literal('search'),
    attempt_id: Uuid,
    outcome: z.enum(['done', 'failed']),
    reason: SpotifyReason.optional(),
    provider: z.enum(['spotify', 'lab']),
    items: z.array(SpotifySearchItem).max(10),
  }),
  z.strictObject({
    kind: z.literal('control'),
    attempt_id: Uuid,
    outcome: z.enum(['done', 'failed', 'unknown']),
    reason: SpotifyReason.optional(),
    /** The reading after the control (what really plays now), when Studio could read it. */
    playback: SpotifyPlayback.nullable().optional(),
  }),
]);
export type SpotifyJobReport = z.infer<typeof SpotifyJobReport>;

/** Studio → Core: a canceled / removed request reached playback and Studio skipped it (or tried). */
export const SpotifyAutoSkipReport = z.strictObject({
  request_id: Uuid,
  result: z.enum(['SKIPPED', 'UNKNOWN', 'FAILED']),
  at: z.iso.datetime({ offset: true }),
});
export type SpotifyAutoSkipReport = z.infer<typeof SpotifyAutoSkipReport>;

/** The Studio panel's moderation actions (Studio is the broadcaster's own console). */
export const SpotifyPanelAction = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('remove'),
    request_id: Uuid,
    /** Music Hub: false = removed without refund (an explicit choice, journaled). Default: refunded. */
    refund: z.boolean().optional(),
  }),
  z.strictObject({ action: z.literal('skip') }),
  // Music Hub: the player (only with `player_controls` on).
  z.strictObject({ action: z.literal('pause') }),
  z.strictObject({ action: z.literal('resume') }),
  z.strictObject({
    action: z.literal('volume'),
    volume_percent: z.number().int().min(0).max(100),
  }),
  // Music Hub: move in the track playing (a click on the timeline), never a skip.
  z.strictObject({
    action: z.literal('seek'),
    position_ms: z
      .number()
      .int()
      .min(0)
      .max(24 * 3_600_000),
  }),
]);
export type SpotifyPanelAction = z.infer<typeof SpotifyPanelAction>;

/**
 * Music Hub — the paid viewer skip and the Open Bar (docs/music/MUSIC_HUB_STATE.md). Rules validated by Antoni (09/11):
 * one global progression per stream, never per viewer.
 */
export const MUSIC_RULES = {
  /** A viewer's paid skip: this price, doubled for each paid skip that succeeded within the window of the previous. */
  skipBasePriceTokens: 25_000,
  /** The window restarts at every successful paid skip; past it without one, the price is back to the base. */
  skipWindowMs: 30 * 60_000,
  /** ponytail: the ledger's amounts are 32-bit — 25 000 × 2^15 = 819 200 000 at most (unreachable in a stream). */
  skipMaxDoublings: 15,
  /** Open Bar: requests from the extension free, no per-viewer count — one short frequency limit stays. */
  openBarCooldownSeconds: 20,
  /** Open Bar: the whole queue (waiting + being added) is capped at this many requests. */
  openBarMaxQueue: 50,
  /** `!song`: one answer at most per this delay on the channel (the asks in between are ignored, silently). */
  songCooldownMs: 30_000,
  /** A seek never lands in the first seconds (a restart: a new play for Spotify and Windows) nor in the last. */
  seekMinMs: 6_000,
  seekEndMarginMs: 8_000,
} as const;

/** Studio › Musique: the paid skip and the Open Bar (each field optional; Core keeps the others). */
export const MusicRulesUpdate = z.strictObject({
  viewer_skip_enabled: z.boolean().optional(),
  /** On by default: a viewer can never pay to skip a request another viewer paid for (moderation still can). */
  viewer_skip_protect_requests: z.boolean().optional(),
  open_bar: z.boolean().optional(),
});
export type MusicRulesUpdate = z.infer<typeof MusicRulesUpdate>;

export { ChannelId as SpotifyChannelId };
