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
});
export type SpotifyStudioStatus = z.infer<typeof SpotifyStudioStatus>;

/** One playback reading (GET /me/player), as Studio reports it. Null track: nothing (or no track) playing. */
export const SpotifyPlayback = z.strictObject({
  observed_at: z.iso.datetime({ offset: true }),
  track: SpotifyTrack.nullable(),
  progress_ms: z.number().int().min(0).nullable(),
  is_playing: z.boolean(),
});
export type SpotifyPlayback = z.infer<typeof SpotifyPlayback>;

/** Studio → Core, every second or so: its status, and (when it polled Spotify) the last playback reading. */
export const SpotifyStudioSync = z.strictObject({
  status: SpotifyStudioStatus,
  playback: SpotifyPlayback.nullable().optional(),
});
export type SpotifyStudioSync = z.infer<typeof SpotifyStudioSync>;

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
  }),
  z.strictObject({ kind: z.literal('read_playback'), job_id: Uuid }),
]);
export type SpotifyJob = z.infer<typeof SpotifyJob>;

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
  z.strictObject({ action: z.literal('remove'), request_id: Uuid }),
  z.strictObject({ action: z.literal('skip') }),
]);
export type SpotifyPanelAction = z.infer<typeof SpotifyPanelAction>;

export { ChannelId as SpotifyChannelId };
