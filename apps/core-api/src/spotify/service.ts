import { randomUUID } from 'node:crypto';
import {
  SPOTIFY_RULES,
  type SpotifyAutoSkipReport,
  type SpotifyJob,
  type SpotifyJobReport,
  type SpotifyPlayback,
  type SpotifyQueueEntry,
  type SpotifyReason,
  type SpotifyRequestState,
  type SpotifySettingsUpdate,
  type SpotifyStudioStatus,
  type SpotifyStudioSync,
  type SpotifyViewerOverrideUpdate,
  type SpotifySyncAnswer,
  type SpotifyTrack,
} from '@raptoru/schemas';
import type { CpTwitchActions } from '../channel-points/twitch-actions.js';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import { MSG, trackLabel } from './messages.js';
import { parseTrackReference } from './reference.js';

// Spotify V2 — Core side (docs/SPOTIFY_V2.md). The authority on « Choisi la prochaine musique ! »: requests and their
// life, the logical queue, the per-viewer limits, the chat answers (LeCroupier_, the historical texts) and the Twitch
// status of each redemption (asked once to the bot). Studio is the only Spotify caller: it receives jobs (search +
// queue, skip, playback read) and reports them, plus what Spotify plays (observations) — Core turns those into the
// request's life (PLAYING → PLAYED / SKIPPED / interrupted) with the historical rules (spotify-v2/scheduler.js).
// Every change of a channel runs under its settings row lock (one at a time per channel, any number of Cores).

export class SpotifyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Activity window of the historical logical queue (24 h): older requests are history, never « en attente ». */
const ACTIVITY_MS = 24 * 3_600_000;
/** A track change within this distance of the end is a natural end (historical TRACK_END_TOLERANCE_MS). */
const TRACK_END_TOLERANCE_MS = 5_000;
/** The same track again: a new occurrence when its progress went back to its start (historical progress reset). */
const RESTART_PROGRESS_MS = 5_000;
/** A song request job not taken by Studio within this delay: refused (refund). */
const UNCLAIMED_REQUEST_MS = 20_000;

const REFUSED_STATE: Partial<Record<SpotifyReason, SpotifyRequestState>> = {
  AMBIGUOUS: 'AMBIGUOUS',
  TOO_LONG: 'TOO_LONG',
  VIEWER_LIMIT: 'VIEWER_LIMIT',
  VIEWER_COOLDOWN: 'VIEWER_COOLDOWN',
};

export interface SpotifySettings {
  enabled: boolean;
  max_pending_per_viewer: number;
  viewer_cooldown_seconds: number;
  max_duration_seconds: number;
  cancel_grace_seconds: number;
  updated_at: string | null;
}

interface OverrideRow {
  viewer_login: string;
  max_pending_per_viewer: number | null;
  viewer_cooldown_seconds: number | null;
  updated_at: Date;
  updated_by: string | null;
}

interface SettingsRow {
  enabled: boolean;
  max_pending_per_viewer: number;
  viewer_cooldown_seconds: number;
  max_duration_seconds: number;
  cancel_grace_seconds: number;
  updated_at: Date;
}

export interface RequestRow {
  request_id: string;
  seq: number | string;
  channel_id: string;
  source: 'twitch' | 'simulation';
  source_ref: string;
  reward_id: string | null;
  redemption_id: string | null;
  viewer_id: string;
  viewer_login: string;
  viewer_name: string;
  raw_input: string;
  mode: 'search' | 'exact' | null;
  state: SpotifyRequestState;
  reason: string | null;
  track: SpotifyTrack | null;
  candidates: unknown;
  confidence: string | null;
  margin: string | number | null;
  max_duration_ms: number;
  confirmation: string | null;
  received_at: Date;
  queued_at: Date | null;
  playback_started_at: Date | null;
  ended_at: Date | null;
  end_reason: string | null;
  canceled_at: Date | null;
  canceled_by: string | null;
  removed_at: Date | null;
  removed_by: string | null;
  skipped_by: string | null;
  auto_skip: boolean;
  auto_skip_consumed_at: Date | null;
  auto_skip_result: string | null;
  twitch_status: 'cancel_requested' | 'kept' | 'unmanaged' | 'none' | null;
  updated_at: Date;
}

interface StudioRow {
  seen_at: Date;
  status: SpotifyStudioStatus;
  playback: SpotifyPlayback | null;
  playback_at: Date | null;
  current_request_id: string | null;
}

interface JobRow {
  job_id: string;
  channel_id: string;
  kind: SpotifyJob['kind'];
  request_id: string | null;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'expired';
  attempt_id: string | null;
  lease_expires_at: Date | null;
  result: Record<string, unknown> | null;
  reply: Reply | null;
  created_at: Date;
  updated_at: Date;
}

/** Who to answer when a job ends. */
type Reply =
  | { kind: 'song'; viewer: string }
  | { kind: 'songskip'; moderator: string; tombstone?: 'canceled' | 'removed' }
  | { kind: 'panel_skip' }
  | { kind: 'cancel_current' }
  | {
      kind: 'reward_skip';
      viewer: { id: string; login: string; name: string };
      source: 'twitch' | 'simulation';
      reward_id: string;
      redemption_id: string;
    };

export const requestView = (r: RequestRow) => ({
  request_id: r.request_id,
  source: r.source,
  viewer: { id: r.viewer_id, login: r.viewer_login, name: r.viewer_name },
  input: r.raw_input,
  state: r.state,
  reason: r.reason,
  track: r.track,
  confidence: r.confidence,
  margin: r.margin === null ? null : Number(r.margin),
  confirmation: r.confirmation,
  received_at: new Date(r.received_at).toISOString(),
  queued_at: r.queued_at ? new Date(r.queued_at).toISOString() : null,
  playback_started_at: r.playback_started_at
    ? new Date(r.playback_started_at).toISOString()
    : null,
  ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
  end_reason: r.end_reason,
  canceled_by: r.canceled_by,
  removed_by: r.removed_by,
  skipped_by: r.skipped_by,
  auto_skip: r.auto_skip,
  auto_skip_result: r.auto_skip_result,
  twitch_status: r.twitch_status,
});
export type SpotifyRequestView = ReturnType<typeof requestView>;

const iso = (d: Date) => d.toISOString();
const ms = (d: Date | string) => new Date(d).getTime();

/** In Spotify's queue for sure, or maybe (an uncertain addition): what the logical queue lists and counts. */
const isQueuedLike = (r: RequestRow) =>
  r.state === 'QUEUED' ||
  (r.state === 'UNKNOWN' && !!r.queued_at && !r.ended_at);
const isUncertainAddition = (r: RequestRow) =>
  r.state === 'UNKNOWN' &&
  !r.ended_at &&
  (r.reason === 'QUEUE_RESULT_UNKNOWN' || r.reason === 'STUDIO_LOST');
const isTombstone = (r: RequestRow) =>
  (r.state === 'CANCELED' || r.state === 'REMOVED_BY_MOD') &&
  r.auto_skip &&
  !!r.track;

export class SpotifyService {
  private readonly resultListeners: ((
    channelId: string,
    ref: { request_id?: string; job_id?: string },
  ) => Promise<void>)[] = [];

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly twitch: CpTwitchActions,
  ) {}

  /** Points de chaîne follows its song requests / skips (their redemption's result). */
  onResult(
    fn: (
      channelId: string,
      ref: { request_id?: string; job_id?: string },
    ) => Promise<void>,
  ) {
    this.resultListeners.push(fn);
  }

  private async told(
    channelId: string,
    ref: { request_id?: string; job_id?: string },
  ) {
    for (const fn of this.resultListeners)
      await fn(channelId, ref).catch(() => {});
  }

  // ---------------------------------------------------------------- settings

  private async lock(q: Queryable, channelId: string): Promise<SettingsRow> {
    await q.query(
      `insert into spotify_settings (channel_id, updated_at) values ($1, $2) on conflict (channel_id) do nothing`,
      [channelId, this.clock.now()],
    );
    return (
      await q.query<SettingsRow>(
        'select * from spotify_settings where channel_id = $1 for update',
        [channelId],
      )
    )[0]!;
  }

  private settingsView(s: SettingsRow | undefined): SpotifySettings {
    return {
      enabled: s?.enabled ?? false,
      max_pending_per_viewer:
        s?.max_pending_per_viewer ?? SPOTIFY_RULES.maxPendingPerViewer,
      viewer_cooldown_seconds:
        s?.viewer_cooldown_seconds ?? SPOTIFY_RULES.viewerCooldownSeconds,
      max_duration_seconds:
        s?.max_duration_seconds ?? SPOTIFY_RULES.maxDurationSeconds,
      cancel_grace_seconds:
        s?.cancel_grace_seconds ?? SPOTIFY_RULES.cancelGraceSeconds,
      updated_at: s ? iso(new Date(s.updated_at)) : null,
    };
  }

  /** The limits that apply to this viewer: their exception (Studio › Viewers) where set, else the global setting. */
  private async limitsFor(
    q: Queryable,
    channelId: string,
    login: string,
    settings: Pick<
      SettingsRow,
      'max_pending_per_viewer' | 'viewer_cooldown_seconds'
    >,
  ) {
    const o = (
      await q.query<OverrideRow>(
        'select * from spotify_viewer_overrides where channel_id = $1 and viewer_login = $2',
        [channelId, login.toLowerCase()],
      )
    )[0];
    return {
      max_pending_per_viewer:
        o?.max_pending_per_viewer ?? settings.max_pending_per_viewer,
      viewer_cooldown_seconds:
        o?.viewer_cooldown_seconds ?? settings.viewer_cooldown_seconds,
    };
  }

  /** The rewards Raptoru's app created on this channel (only those can be refunded by Raptoru). */
  managedRewards(channelId: string) {
    return this.db.query<{ reward_id: string; title: string; cost: number }>(
      'select reward_id, title, cost from cp_rewards where channel_id = $1 and managed_by_raptoru order by title',
      [channelId],
    );
  }

  async overrides(channelId: string) {
    const rows = await this.db.query<OverrideRow>(
      'select * from spotify_viewer_overrides where channel_id = $1 order by viewer_login',
      [channelId],
    );
    return rows.map((o) => ({
      viewer_login: o.viewer_login,
      max_pending_per_viewer: o.max_pending_per_viewer,
      viewer_cooldown_seconds: o.viewer_cooldown_seconds,
      updated_at: iso(new Date(o.updated_at)),
      updated_by: o.updated_by,
    }));
  }

  /** Sets a viewer's exception; both fields null = back to the global settings (row removed). */
  async saveOverride(
    channelId: string,
    u: SpotifyViewerOverrideUpdate,
    by: string,
  ) {
    await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      if (
        u.max_pending_per_viewer === null &&
        u.viewer_cooldown_seconds === null
      )
        await q.query(
          'delete from spotify_viewer_overrides where channel_id = $1 and viewer_login = $2',
          [channelId, u.viewer_login],
        );
      else
        await q.query(
          `insert into spotify_viewer_overrides (channel_id, viewer_login, max_pending_per_viewer,
             viewer_cooldown_seconds, updated_at, updated_by) values ($1, $2, $3, $4, $5, $6)
           on conflict (channel_id, viewer_login) do update set max_pending_per_viewer = $3,
             viewer_cooldown_seconds = $4, updated_at = $5, updated_by = $6`,
          [
            channelId,
            u.viewer_login,
            u.max_pending_per_viewer,
            u.viewer_cooldown_seconds,
            this.clock.now(),
            by,
          ],
        );
    });
    return this.overrides(channelId);
  }

  async settings(channelId: string): Promise<SpotifySettings> {
    const s = (
      await this.db.query<SettingsRow>(
        'select * from spotify_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    return this.settingsView(s);
  }

  async saveSettings(channelId: string, u: SpotifySettingsUpdate, by: string) {
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const fields = Object.entries(u).filter(([, v]) => v !== undefined);
      if (fields.length) {
        const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
        await q.query(
          `update spotify_settings set ${sets}, updated_at = $${fields.length + 2}, updated_by = $${fields.length + 3}
           where channel_id = $1`,
          [
            channelId,
            ...fields.map(([, v]) => v),
            this.clock.now(),
            by.slice(0, 64),
          ],
        );
      }
      return this.settingsView(
        (
          await q.query<SettingsRow>(
            'select * from spotify_settings where channel_id = $1',
            [channelId],
          )
        )[0],
      );
    });
  }

  // ---------------------------------------------------------------- helpers

  /** One chat line (idempotent by key), outside any other change. */
  async sayOnce(channelId: string, key: string, text: string) {
    await this.db.tx((q) => this.say(q, channelId, key, text));
  }

  private say(q: Queryable, channelId: string, key: string, text: string) {
    return insertWordGameSteps(q, {
      channelId,
      now: this.clock.now(),
      origin: 'music',
      drafts: [
        {
          idempotencyKey: key.slice(0, 200),
          mode: 'normal',
          text: text.slice(0, 500),
        },
      ],
    });
  }

  private async studio(
    q: Queryable,
    channelId: string,
  ): Promise<StudioRow | null> {
    return (
      (
        await q.query<StudioRow>(
          'select * from spotify_studio where channel_id = $1',
          [channelId],
        )
      )[0] ?? null
    );
  }

  /** Why Studio cannot take a request now (null: it can). */
  private studioRefusal(st: StudioRow | null): SpotifyReason | null {
    const now = this.clock.now().getTime();
    if (!st || now - ms(st.seen_at) > SPOTIFY_RULES.studioFreshMs)
      return 'STUDIO_UNAVAILABLE';
    if (st.status.auth === 'not_configured') return 'AUTH_NOT_CONFIGURED';
    if (st.status.auth === 'needs_reauth') return 'AUTH_REQUIRED';
    if (st.status.limited_until && ms(st.status.limited_until) > now)
      return 'RATE_LIMITED';
    return null;
  }

  private async request(q: Queryable, requestId: string) {
    return (
      (
        await q.query<RequestRow>(
          'select * from spotify_requests where request_id = $1',
          [requestId],
        )
      )[0] ?? null
    );
  }

  private async update(
    q: Queryable,
    requestId: string,
    fields: Partial<Record<keyof RequestRow, unknown>>,
  ) {
    const entries = Object.entries(fields);
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    await q.query(
      `update spotify_requests set ${sets}, updated_at = $${entries.length + 2} where request_id = $1`,
      [
        requestId,
        ...entries.map(([k, v]) =>
          (k === 'track' || k === 'candidates') && v !== null && v !== undefined
            ? JSON.stringify(v)
            : v,
        ),
        this.clock.now(),
      ],
    );
  }

  /** Would Twitch give the points back for this request (a real redemption of a reward Raptoru created)? */
  private async refundable(q: Queryable, r: RequestRow) {
    return (
      r.source === 'twitch' &&
      !!r.redemption_id &&
      r.twitch_status === null &&
      (await this.twitch.managed(q, r.channel_id, r.reward_id))
    );
  }

  /**
   * A refused / failed / canceled request: asks Twitch once to give the points back (CANCELED). The ONLY status Raptoru
   * ever sends for a song request — accepted, queued, played: the redemption stays PENDING on Twitch, Antoni validates
   * or refunds it there by hand (decision 24/10). Returns true when a refund was asked now.
   */
  private async refundTwitch(q: Queryable, r: RequestRow) {
    if (r.twitch_status !== null) return false;
    if (r.source !== 'twitch' || !r.redemption_id || !r.reward_id) {
      await this.update(q, r.request_id, { twitch_status: 'none' });
      return false;
    }
    if (!(await this.twitch.managed(q, r.channel_id, r.reward_id))) {
      await this.update(q, r.request_id, { twitch_status: 'unmanaged' });
      return false;
    }
    await this.twitch.redemptionStatus(q, {
      channel_id: r.channel_id,
      reward_id: r.reward_id,
      redemption_id: r.redemption_id,
      status: 'CANCELED',
    });
    await this.update(q, r.request_id, { twitch_status: 'cancel_requested' });
    return true;
  }

  private recentCut() {
    return new Date(this.clock.now().getTime() - ACTIVITY_MS);
  }

  /** The requests of the logical queue (recent), FIFO: in Spotify's queue for sure or maybe, playing, tombstones. */
  private async live(q: Queryable, channelId: string) {
    return q.query<RequestRow>(
      `select * from spotify_requests where channel_id = $1 and received_at > $2
         and state in ('RECEIVED', 'SEARCHING', 'QUEUED', 'PLAYING', 'UNKNOWN', 'CANCELED', 'REMOVED_BY_MOD')
       order by coalesce(queued_at, received_at), seq`,
      [channelId, this.recentCut()],
    );
  }

  /** Future entries of the logical queue with a track (`!songqueue`, `!mysong`, `!songremove <n>`), in order. */
  private future(rows: RequestRow[]) {
    return rows.filter((r) => isQueuedLike(r) && r.track);
  }

  // ---------------------------------------------------------------- admission (Points de chaîne)

  /**
   * A « Choisi la prochaine musique ! » redemption (the reward's `song_request` action). Recorded once (source_ref);
   * the historical checks in their order (cooldown, then pending), then a job for Studio. A refusal answers in the
   * chat and gives the points back (when the reward is Raptoru's).
   */
  async admit(e: {
    channel_id: string;
    source: 'twitch' | 'simulation';
    source_ref: string;
    reward_id: string;
    redemption_id: string;
    viewer: { id: string; login: string; name: string };
    user_input: string | null;
    /** Points de chaîne did not execute it (late, automations off, rule off): refused at once. */
    refusal?: 'LATE' | 'MODULE_DISABLED' | null;
  }) {
    const out = await this.db.tx(async (q) => {
      const settings = await this.lock(q, e.channel_id);
      const prior = (
        await q.query<RequestRow>(
          'select * from spotify_requests where channel_id = $1 and source_ref = $2',
          [e.channel_id, e.source_ref],
        )
      )[0];
      if (prior) return { row: prior, duplicate: true };
      const now = this.clock.now();
      const id = randomUUID();
      const reference = parseTrackReference(e.user_input);
      await q.query(
        `insert into spotify_requests (request_id, channel_id, source, source_ref, reward_id, redemption_id, viewer_id,
           viewer_login, viewer_name, raw_input, mode, state, max_duration_ms, received_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'RECEIVED', $12, $13, $13)`,
        [
          id,
          e.channel_id,
          e.source,
          e.source_ref,
          e.reward_id,
          e.redemption_id,
          e.viewer.id,
          e.viewer.login,
          e.viewer.name,
          String(e.user_input ?? '').slice(0, 500),
          reference.kind === 'invalid' ? null : reference.kind,
          settings.max_duration_seconds * 1000,
          now,
        ],
      );
      const row = (await this.request(q, id))!;
      const refuse = async (
        reason: SpotifyReason,
        text?: (refunded: boolean) => string,
      ) => {
        await this.update(q, id, {
          state: REFUSED_STATE[reason] ?? 'FAILED',
          reason,
          ended_at: now,
        });
        const refunded = await this.refundTwitch(q, row);
        await this.say(
          q,
          e.channel_id,
          `spotify:req:${id}`,
          text ? text(refunded) : MSG.refused(e.viewer.name, reason),
        );
      };

      if (e.refusal) {
        await refuse(e.refusal);
        return { row, duplicate: false };
      }
      if (!settings.enabled) {
        await refuse('MODULE_DISABLED');
        return { row, duplicate: false };
      }
      const studioReason = this.studioRefusal(
        await this.studio(q, e.channel_id),
      );
      if (studioReason) {
        await refuse(studioReason);
        return { row, duplicate: false };
      }
      // Historical order: cooldown, then pending (spotify-v2/service.js requestSongLocked).
      const mine = await q.query<RequestRow>(
        `select * from spotify_requests where channel_id = $1 and viewer_id = $2 and request_id <> $3
           and received_at > $4 and state in ('RECEIVED', 'SEARCHING', 'QUEUED', 'UNKNOWN', 'CANCELED')`,
        [e.channel_id, e.viewer.id, id, this.recentCut()],
      );
      const limits = await this.limitsFor(
        q,
        e.channel_id,
        e.viewer.login,
        settings,
      );
      const cooldownMs = limits.viewer_cooldown_seconds * 1000;
      // The last request still waiting to play (QUEUED: since its queuing) — or one being searched (since its
      // reception: the historical service handled one request of a viewer at a time, the next one saw it QUEUED).
      // Decision of 25/10: a request the viewer canceled himself (`!songcancel`) before it played still counts from
      // its acceptance — cancelling never resets the cooldown. A moderator's removal does not count (it lifts it).
      const since = mine
        .map((r) =>
          r.state === 'QUEUED' && r.queued_at
            ? ms(r.queued_at)
            : r.state === 'RECEIVED' || r.state === 'SEARCHING'
              ? ms(r.received_at)
              : r.state === 'CANCELED' &&
                  r.reason === 'VIEWER_CANCEL' &&
                  r.queued_at &&
                  !r.playback_started_at
                ? ms(r.queued_at)
                : null,
        )
        .filter((t): t is number => t !== null);
      const last = since.length ? Math.max(...since) : null;
      const remaining =
        last === null ? 0 : cooldownMs - Math.max(0, now.getTime() - last);
      if (cooldownMs > 0 && remaining > 0) {
        await refuse('VIEWER_COOLDOWN', (refunded) =>
          MSG.cooldown(e.viewer.name, remaining, refunded),
        );
        return { row, duplicate: false };
      }
      const pending = mine.filter(
        (r) =>
          r.state === 'RECEIVED' ||
          r.state === 'SEARCHING' ||
          r.state === 'QUEUED' ||
          isUncertainAddition(r),
      ).length;
      if (pending >= limits.max_pending_per_viewer) {
        await refuse('VIEWER_LIMIT');
        return { row, duplicate: false };
      }
      if (reference.kind === 'invalid') {
        await refuse(reference.reason);
        return { row, duplicate: false };
      }
      await q.query(
        `insert into spotify_jobs (job_id, channel_id, kind, request_id, payload, status, created_at, updated_at)
         values ($1, $2, 'song_request', $3, $4, 'queued', $5, $5)`,
        [
          randomUUID(),
          e.channel_id,
          id,
          JSON.stringify({
            reference:
              reference.kind === 'exact'
                ? { kind: 'exact', track_id: reference.trackId }
                : { kind: 'search', query: reference.query },
            max_duration_ms: settings.max_duration_seconds * 1000,
          }),
          now,
        ],
      );
      return { row, duplicate: false };
    });
    const row = (
      await this.db.query<RequestRow>(
        'select * from spotify_requests where request_id = $1',
        [out.row.request_id],
      )
    )[0]!;
    if (!out.duplicate && row.state !== 'RECEIVED')
      await this.told(row.channel_id, { request_id: row.request_id });
    return { duplicate: out.duplicate, request: requestView(row) };
  }

  /** The « Skip la musique » reward (`song_skip` action): a skip job, answered and settled on Twitch at its end. */
  async rewardSkip(e: {
    channel_id: string;
    source: 'twitch' | 'simulation';
    reward_id: string;
    redemption_id: string;
    viewer: { id: string; login: string; name: string };
  }) {
    return this.db.tx(async (q) => {
      const settings = await this.lock(q, e.channel_id);
      const key = `spotify:rewardskip:${e.source}:${e.redemption_id}`;
      const prior = (
        await q.query<JobRow>(
          `select * from spotify_jobs where channel_id = $1 and reply->>'redemption_id' = $2
           and reply->>'kind' = 'reward_skip'`,
          [e.channel_id, e.redemption_id],
        )
      )[0];
      if (prior) return { job_id: prior.job_id, duplicate: true };
      const reply: Reply = {
        kind: 'reward_skip',
        viewer: e.viewer,
        source: e.source,
        reward_id: e.reward_id,
        redemption_id: e.redemption_id,
      };
      const studioReason = settings.enabled
        ? this.studioRefusal(await this.studio(q, e.channel_id))
        : 'MODULE_DISABLED';
      const jobId = randomUUID();
      const now = this.clock.now();
      await q.query(
        `insert into spotify_jobs (job_id, channel_id, kind, request_id, payload, status, reply, created_at, updated_at,
           result) values ($1, $2, 'skip', $3, '{}', $4, $5, $6, $6, $7)`,
        [
          jobId,
          e.channel_id,
          await this.currentRequestId(q, e.channel_id),
          studioReason ? 'done' : 'queued',
          JSON.stringify(reply),
          now,
          studioReason
            ? JSON.stringify({ outcome: 'failed', reason: studioReason })
            : null,
        ],
      );
      if (studioReason) {
        await this.rewardSkipRefund(q, e.channel_id, reply);
        await this.say(
          q,
          e.channel_id,
          key,
          MSG.refused(e.viewer.name, studioReason),
        );
      }
      return { job_id: jobId, duplicate: false };
    });
  }

  /** The « Skip la musique » reward failed for sure: points back (CANCELED). A skip done stays PENDING on Twitch. */
  private async rewardSkipRefund(
    q: Queryable,
    channelId: string,
    reply: Extract<Reply, { kind: 'reward_skip' }>,
  ) {
    if (
      reply.source !== 'twitch' ||
      !(await this.twitch.managed(q, channelId, reply.reward_id))
    )
      return;
    await this.twitch.redemptionStatus(q, {
      channel_id: channelId,
      reward_id: reply.reward_id,
      redemption_id: reply.redemption_id,
      status: 'CANCELED',
    });
  }

  // ---------------------------------------------------------------- Studio

  /**
   * Studio's sync (every second or so): its status, its last playback reading (when it polled Spotify). Core applies
   * the reading to the requests' life, expires what Studio left, and answers the jobs and the logical queue.
   */
  async sync(
    channelId: string,
    s: SpotifyStudioSync,
  ): Promise<SpotifySyncAnswer> {
    const changed: string[] = [];
    const answer = await this.db.tx(async (q) => {
      const settings = await this.lock(q, channelId);
      const now = this.clock.now();
      const prior = await this.studio(q, channelId);
      await q.query(
        `insert into spotify_studio (channel_id, seen_at, status) values ($1, $2, $3)
         on conflict (channel_id) do update set seen_at = $2, status = $3`,
        [channelId, now, JSON.stringify(s.status)],
      );
      if (s.playback)
        changed.push(...(await this.observe(q, channelId, prior, s.playback)));
      changed.push(...(await this.expire(q, channelId)));
      const jobs = await q.query<JobRow>(
        `select * from spotify_jobs where channel_id = $1 and status = 'queued' order by created_at limit 50`,
        [channelId],
      );
      const rows = await this.live(q, channelId);
      const st = await this.studio(q, channelId);
      const queue: SpotifyQueueEntry[] = rows
        .filter(
          (r) =>
            r.track &&
            r.queued_at &&
            (isQueuedLike(r) ||
              r.state === 'PLAYING' ||
              (isTombstone(r) && !r.auto_skip_consumed_at)),
        )
        .map((r) => ({
          request_id: r.request_id,
          track_uri: r.track!.uri,
          state: r.state,
          auto_skip: isTombstone(r) && !r.auto_skip_consumed_at,
          queued_at: iso(new Date(r.queued_at!)),
        }));
      const running = await q.query(
        `select 1 from spotify_jobs where channel_id = $1 and status in ('queued', 'running') limit 1`,
        [channelId],
      );
      return {
        enabled: settings.enabled,
        jobs: jobs.map((j) => this.jobView(j)),
        queue,
        current_request_id: st?.current_request_id ?? null,
        watch: queue.length > 0 || running.length > 0,
      } satisfies SpotifySyncAnswer;
    });
    for (const id of new Set(changed))
      await this.told(channelId, { request_id: id });
    return answer;
  }

  private jobView(j: JobRow): SpotifyJob {
    if (j.kind === 'song_request')
      return {
        kind: 'song_request',
        job_id: j.job_id,
        request_id: j.request_id!,
        reference: j.payload.reference as Extract<
          SpotifyJob,
          { kind: 'song_request' }
        >['reference'],
        max_duration_ms: Number(j.payload.max_duration_ms),
      };
    if (j.kind === 'skip')
      return { kind: 'skip', job_id: j.job_id, request_id: j.request_id };
    return { kind: 'read_playback', job_id: j.job_id };
  }

  /** Studio takes a job before calling Spotify: once (a second start of the same job is refused). */
  async startJob(channelId: string, jobId: string, attemptId: string) {
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const job = (
        await q.query<JobRow>(
          'select * from spotify_jobs where channel_id = $1 and job_id = $2',
          [channelId, jobId],
        )
      )[0];
      if (!job) throw new SpotifyError(404, 'job_not_found');
      if (job.status !== 'queued') throw new SpotifyError(409, 'job_taken');
      const now = this.clock.now();
      await q.query(
        `update spotify_jobs set status = 'running', attempt_id = $2, lease_expires_at = $3, updated_at = $4
         where job_id = $1`,
        [
          jobId,
          attemptId,
          new Date(now.getTime() + SPOTIFY_RULES.jobLeaseMs),
          now,
        ],
      );
      if (job.kind === 'song_request' && job.request_id)
        await this.update(q, job.request_id, { state: 'SEARCHING' });
      return { job: this.jobView({ ...job, status: 'running' }) };
    });
  }

  async reportJob(channelId: string, jobId: string, r: SpotifyJobReport) {
    const changed: { request_id?: string; job_id?: string }[] = [];
    await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const job = (
        await q.query<JobRow>(
          'select * from spotify_jobs where channel_id = $1 and job_id = $2',
          [channelId, jobId],
        )
      )[0];
      if (!job) throw new SpotifyError(404, 'job_not_found');
      if (job.kind !== r.kind) throw new SpotifyError(400, 'wrong_kind');
      if (job.attempt_id !== r.attempt_id)
        throw new SpotifyError(409, 'stale_attempt');
      if (job.status !== 'running') return;
      const now = this.clock.now();
      await q.query(
        `update spotify_jobs set status = 'done', result = $2, lease_expires_at = null, updated_at = $3 where job_id = $1`,
        [jobId, JSON.stringify(r), now],
      );
      if (r.kind === 'song_request') {
        const req = await this.request(q, job.request_id!);
        if (req && (req.state === 'SEARCHING' || req.state === 'RECEIVED')) {
          await this.finishSongRequest(q, req, r);
          changed.push({ request_id: req.request_id });
        }
      } else if (r.kind === 'skip') {
        await this.finishSkip(q, job, r);
        if (job.request_id) changed.push({ request_id: job.request_id });
        changed.push({ job_id: job.job_id });
      } else {
        if (r.playback) {
          const prior = await this.studio(q, channelId);
          for (const id of await this.observe(q, channelId, prior, r.playback))
            changed.push({ request_id: id });
        }
        await this.answerSong(q, job, r.playback);
      }
    });
    for (const c of changed) await this.told(channelId, c);
  }

  private async finishSongRequest(
    q: Queryable,
    req: RequestRow,
    r: Extract<SpotifyJobReport, { kind: 'song_request' }>,
  ) {
    const now = this.clock.now();
    const details = {
      track: r.track ?? null,
      candidates: r.candidates ?? null,
      confidence: r.confidence ?? null,
      margin: r.margin ?? null,
    };
    if (r.outcome === 'queued' && r.track) {
      await this.update(q, req.request_id, {
        ...details,
        state: 'QUEUED',
        reason: 'QUEUED',
        confirmation: r.confirmation ?? null,
        queued_at: now,
      });
      await this.say(
        q,
        req.channel_id,
        `spotify:req:${req.request_id}`,
        MSG.queued(req.viewer_name, r.track),
      );
      return;
    }
    if (r.outcome === 'unknown') {
      // Maybe in Spotify's queue: never retried, never refunded automatically (« à vérifier » in Studio).
      await this.update(q, req.request_id, {
        ...details,
        state: 'UNKNOWN',
        reason: 'QUEUE_RESULT_UNKNOWN',
      });
      await this.say(
        q,
        req.channel_id,
        `spotify:req:${req.request_id}`,
        MSG.refused(req.viewer_name, 'QUEUE_RESULT_UNKNOWN'),
      );
      return;
    }
    const reason = r.reason ?? 'SPOTIFY_UNAVAILABLE';
    await this.update(q, req.request_id, {
      ...details,
      state: REFUSED_STATE[reason] ?? 'FAILED',
      reason,
      ended_at: now,
    });
    await this.refundTwitch(q, req);
    await this.say(
      q,
      req.channel_id,
      `spotify:req:${req.request_id}`,
      MSG.refused(req.viewer_name, reason),
    );
  }

  private async finishSkip(
    q: Queryable,
    job: JobRow,
    r: Extract<SpotifyJobReport, { kind: 'skip' }>,
  ) {
    const reply = job.reply;
    const target = job.request_id
      ? await this.request(q, job.request_id)
      : null;
    const now = this.clock.now();
    if (r.outcome === 'skipped' && target?.state === 'PLAYING') {
      const by =
        reply?.kind === 'songskip'
          ? reply.moderator
          : reply?.kind === 'reward_skip'
            ? reply.viewer.login
            : 'studio';
      await this.update(q, target.request_id, {
        state: 'SKIPPED',
        reason: 'SKIPPED',
        end_reason: 'SKIP',
        ended_at: now,
        skipped_by: by,
      });
      await q.query(
        'update spotify_studio set current_request_id = null where channel_id = $1',
        [job.channel_id],
      );
    }
    if (target && isTombstone(target)) {
      await this.update(q, target.request_id, {
        auto_skip_consumed_at: target.auto_skip_consumed_at ?? now,
        auto_skip_result:
          r.outcome === 'skipped'
            ? reply?.kind === 'songskip'
              ? 'SKIPPED_BY_MOD'
              : 'SKIPPED'
            : r.outcome === 'unknown'
              ? 'UNKNOWN'
              : 'FAILED',
      });
    }
    if (!reply) return;
    const key = `spotify:job:${job.job_id}`;
    if (reply.kind === 'songskip') {
      const text =
        r.outcome === 'skipped'
          ? reply.tombstone
            ? MSG.skipTombstoneDone(reply.tombstone === 'removed')
            : target &&
                (target.state === 'PLAYING' || target.state === 'SKIPPED')
              ? MSG.skipped(target.track, target.viewer_login)
              : MSG.skipped(null, null)
          : MSG.skipFailed(
              reply.moderator,
              r.outcome === 'unknown'
                ? 'SKIP_RESULT_UNKNOWN'
                : (r.reason ?? 'SPOTIFY_UNAVAILABLE'),
            );
      await this.say(q, job.channel_id, key, text);
    } else if (reply.kind === 'reward_skip') {
      if (r.outcome === 'skipped') {
        await this.say(
          q,
          job.channel_id,
          key,
          MSG.rewardSkipped(reply.viewer.name),
        );
      } else if (r.outcome === 'failed') {
        await this.rewardSkipRefund(q, job.channel_id, reply);
        await this.say(
          q,
          job.channel_id,
          key,
          MSG.refused(reply.viewer.name, r.reason ?? 'SPOTIFY_UNAVAILABLE'),
        );
      } else {
        await this.say(
          q,
          job.channel_id,
          key,
          MSG.refused(reply.viewer.name, 'SKIP_RESULT_UNKNOWN'),
        );
      }
    }
  }

  /** `!song`: the reading Studio just made (with the requester only when Core attributes this exact track). */
  private async answerSong(
    q: Queryable,
    job: JobRow,
    playback: SpotifyPlayback | null,
  ) {
    if (job.reply?.kind !== 'song') return;
    const key = `spotify:job:${job.job_id}`;
    if (!playback?.track) {
      await this.say(q, job.channel_id, key, MSG.noPlayback);
      return;
    }
    const st = await this.studio(q, job.channel_id);
    const current = st?.current_request_id
      ? await this.request(q, st.current_request_id)
      : null;
    const requester =
      current?.state === 'PLAYING' && current.track?.uri === playback.track.uri
        ? current.viewer_login
        : null;
    await this.say(
      q,
      job.channel_id,
      key,
      MSG.nowPlaying(playback.track, requester),
    );
  }

  /** A canceled / removed request reached playback: Studio skipped it (reserved locally, once). */
  async autoSkip(channelId: string, r: SpotifyAutoSkipReport) {
    await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const req = await this.request(q, r.request_id);
      if (!req || req.channel_id !== channelId)
        throw new SpotifyError(404, 'request_not_found');
      if (req.auto_skip_consumed_at) return;
      await this.update(q, req.request_id, {
        auto_skip_consumed_at: new Date(r.at),
        auto_skip_result: r.result,
      });
    });
    await this.told(channelId, { request_id: r.request_id });
  }

  // ---------------------------------------------------------------- what Spotify plays

  /**
   * One playback reading → the requests' life (historical scheduler rules): a request starts PLAYING when its track
   * plays and it is the first of that track in the queue's order (FIFO; a canceled one there is left to Studio's
   * auto-skip); the previous one ends PLAYED when the change happened within 5 s of its end, otherwise it was
   * interrupted (by another request: INTERRUPTED; by a track outside the requests: INTERRUPTED_EXTERNAL).
   */
  private async observe(
    q: Queryable,
    channelId: string,
    prior: StudioRow | null,
    cur: SpotifyPlayback,
  ) {
    const changed: string[] = [];
    const prev = prior?.playback ?? null;
    if (prev && ms(cur.observed_at) < ms(prev.observed_at)) return changed; // an older reading: ignored
    await q.query(
      'update spotify_studio set playback = $2, playback_at = $3 where channel_id = $1',
      [channelId, JSON.stringify(cur), new Date(cur.observed_at)],
    );
    const prevUri = prev?.track?.uri ?? null;
    const curUri = cur.track?.uri ?? null;
    const restarted =
      !!curUri &&
      prevUri === curUri &&
      cur.progress_ms !== null &&
      prev?.progress_ms !== null &&
      prev?.progress_ms !== undefined &&
      cur.progress_ms < RESTART_PROGRESS_MS &&
      prev.progress_ms - cur.progress_ms > RESTART_PROGRESS_MS;
    const occurrenceChanged = prevUri !== curUri || restarted;
    let currentId = prior?.current_request_id ?? null;
    if (!occurrenceChanged) return changed;

    const rows = await this.live(q, channelId);
    const firstFor = (uri: string | null) =>
      uri
        ? (rows.find(
            (r) =>
              r.track?.uri === uri &&
              r.request_id !== currentId &&
              ((isQueuedLike(r) && r.queued_at) ||
                (isTombstone(r) && !r.auto_skip_consumed_at)),
          ) ?? null)
        : null;
    const next = firstFor(curUri);

    // The previous occurrence ends.
    if (currentId) {
      const before =
        rows.find((r) => r.request_id === currentId) ??
        (await this.request(q, currentId));
      // Playing again after a gap without any track (paused, Spotify reopened): the same occurrence goes on.
      if (
        before?.state === 'PLAYING' &&
        before.track?.uri === curUri &&
        !restarted
      )
        return changed;
      if (before?.state === 'PLAYING') {
        const nearEnd =
          !!prev?.track &&
          prev.is_playing &&
          prev.progress_ms !== null &&
          prev.progress_ms >=
            Math.max(0, prev.track.duration_ms - TRACK_END_TOLERANCE_MS);
        if (nearEnd) {
          await this.update(q, before.request_id, {
            state: 'PLAYED',
            reason: 'PLAYED',
            end_reason: 'NATURAL_END',
            ended_at: new Date(cur.observed_at),
          });
          changed.push(before.request_id);
        } else if (curUri) {
          const reason = next ? 'INTERRUPTED' : 'INTERRUPTED_EXTERNAL';
          await this.update(q, before.request_id, {
            state: 'UNKNOWN',
            reason,
            end_reason: reason,
            ended_at: new Date(cur.observed_at),
          });
          changed.push(before.request_id);
        }
        // Nothing playing any more and not near its end: stopped or paused away — left PLAYING (historical).
      }
      if (curUri || before?.state !== 'PLAYING') currentId = null;
    }

    // The new occurrence starts.
    if (next && !isTombstone(next)) {
      const started = new Date(ms(cur.observed_at) - (cur.progress_ms ?? 0));
      await this.update(q, next.request_id, {
        state: 'PLAYING',
        reason: 'PLAYING',
        playback_started_at: started,
        ...(next.queued_at ? {} : { queued_at: started }),
      });
      currentId = next.request_id;
      changed.push(next.request_id);
    } else if (curUri) {
      currentId = null; // a track outside the requests, or a tombstone Studio is skipping
    }
    await q.query(
      'update spotify_studio set current_request_id = $2 where channel_id = $1',
      [channelId, currentId],
    );
    return changed;
  }

  private async currentRequestId(q: Queryable, channelId: string) {
    return (await this.studio(q, channelId))?.current_request_id ?? null;
  }

  // ---------------------------------------------------------------- time

  /** Every channel with Spotify work in flight (the Core process, every second). */
  async tickAll() {
    const channels = await this.db.query<{ channel_id: string }>(
      `select distinct channel_id from spotify_jobs where status in ('queued', 'running')`,
    );
    for (const c of channels) await this.tick(c.channel_id);
  }

  /** Leases and Studio's absence of one channel. */
  async tick(channelId: string) {
    const changed = await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      return this.expire(q, channelId);
    });
    for (const id of new Set(changed))
      await this.told(channelId, { request_id: id });
  }

  private async expire(q: Queryable, channelId: string) {
    const now = this.clock.now();
    const changed: string[] = [];
    // A running job whose report never came: it may have run — never replayed.
    const lost = await q.query<JobRow>(
      `select * from spotify_jobs where channel_id = $1 and status = 'running' and lease_expires_at < $2`,
      [channelId, now],
    );
    for (const job of lost) {
      await q.query(
        `update spotify_jobs set status = 'expired', updated_at = $2 where job_id = $1`,
        [job.job_id, now],
      );
      if (job.kind === 'song_request' && job.request_id) {
        const req = await this.request(q, job.request_id);
        if (req && (req.state === 'SEARCHING' || req.state === 'RECEIVED')) {
          await this.update(q, req.request_id, {
            state: 'UNKNOWN',
            reason: 'STUDIO_LOST',
          });
          await this.say(
            q,
            channelId,
            `spotify:req:${req.request_id}`,
            MSG.refused(req.viewer_name, 'QUEUE_RESULT_UNKNOWN'),
          );
          changed.push(req.request_id);
        }
      } else if (job.kind === 'skip') {
        await this.finishSkip(q, job, {
          kind: 'skip',
          attempt_id: job.attempt_id!,
          outcome: 'unknown',
        });
      } else await this.answerSong(q, job, null);
    }
    // Jobs Studio never took (absent): refused, nothing was sent to Spotify.
    const stale = await q.query<JobRow>(
      `select * from spotify_jobs where channel_id = $1 and status = 'queued' and created_at < $2`,
      [
        channelId,
        new Date(now.getTime() - SPOTIFY_RULES.readPlaybackTimeoutMs),
      ],
    );
    for (const job of stale) {
      const age = now.getTime() - ms(job.created_at);
      if (job.kind === 'song_request') {
        if (age < UNCLAIMED_REQUEST_MS) continue;
        await q.query(
          `update spotify_jobs set status = 'expired', updated_at = $2 where job_id = $1`,
          [job.job_id, now],
        );
        const req = job.request_id
          ? await this.request(q, job.request_id)
          : null;
        if (req && req.state === 'RECEIVED') {
          await this.update(q, req.request_id, {
            state: 'FAILED',
            reason: 'STUDIO_UNAVAILABLE',
            ended_at: now,
          });
          await this.refundTwitch(q, req);
          await this.say(
            q,
            channelId,
            `spotify:req:${req.request_id}`,
            MSG.refused(req.viewer_name, 'STUDIO_UNAVAILABLE'),
          );
          changed.push(req.request_id);
        }
      } else if (job.kind === 'skip') {
        if (age < SPOTIFY_RULES.studioFreshMs) continue;
        await q.query(
          `update spotify_jobs set status = 'expired', updated_at = $2 where job_id = $1`,
          [job.job_id, now],
        );
        await this.finishSkip(q, job, {
          kind: 'skip',
          attempt_id: job.attempt_id ?? randomUUID(),
          outcome: 'failed',
          reason: 'SPOTIFY_UNAVAILABLE',
        });
      } else {
        await q.query(
          `update spotify_jobs set status = 'expired', updated_at = $2 where job_id = $1`,
          [job.job_id, now],
        );
        await this.answerSong(q, job, null);
      }
    }
    return changed;
  }

  // ---------------------------------------------------------------- chat commands (spotify/chat.ts) and panel

  /** `!song`: one playback read by Studio (its cache shares it), answered when Studio reports. */
  async askNowPlaying(channelId: string, messageId: string, viewer: string) {
    return this.db.tx(async (q) => {
      const settings = await this.lock(q, channelId);
      const st = await this.studio(q, channelId);
      if (!settings.enabled || this.studioRefusal(st)) {
        await this.say(
          q,
          channelId,
          `spotify:msg:${messageId}`,
          MSG.noPlayback,
        );
        return 'song_unavailable';
      }
      await this.queueJob(
        q,
        channelId,
        'read_playback',
        null,
        { kind: 'song', viewer },
        `msg:${messageId}`,
      );
      return 'song_asked';
    });
  }

  private async queueJob(
    q: Queryable,
    channelId: string,
    kind: SpotifyJob['kind'],
    requestId: string | null,
    reply: Reply | null,
    ref: string,
  ) {
    const now = this.clock.now();
    const prior = await q.query(
      `select 1 from spotify_jobs where channel_id = $1 and payload->>'ref' = $2`,
      [channelId, ref],
    );
    if (prior.length) return false;
    await q.query(
      `insert into spotify_jobs (job_id, channel_id, kind, request_id, payload, status, reply, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'queued', $6, $7, $7)`,
      [
        randomUUID(),
        channelId,
        kind,
        requestId,
        JSON.stringify({ ref }),
        reply ? JSON.stringify(reply) : null,
        now,
      ],
    );
    return true;
  }

  async songQueue(channelId: string, messageId: string) {
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const entries = this.future(await this.live(q, channelId));
      const text = entries.length
        ? MSG.queue(
            entries.slice(0, 3).map((r) => ({
              title: r.track!.title,
              viewer_login: r.viewer_login,
            })),
            entries.length - 3,
          )
        : MSG.emptyQueue;
      await this.say(q, channelId, `spotify:msg:${messageId}`, text);
      return 'songqueue';
    });
  }

  async mySong(
    channelId: string,
    messageId: string,
    viewer: { id: string; name: string },
  ) {
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const rows = await this.live(q, channelId);
      const st = await this.studio(q, channelId);
      const current = rows.find(
        (r) => r.request_id === st?.current_request_id && r.state === 'PLAYING',
      );
      const entries = this.future(rows);
      const own = this.ownRequests(rows, st, viewer.id);
      let text: string;
      if (own.length > 1)
        text = MSG.mySongList(viewer.name, this.numbered(own, entries));
      else if (own[0] && own[0] === current && own[0].track)
        text = MSG.mySongCurrent(viewer.name, own[0].track);
      else if (own[0])
        text = MSG.mySongFuture(
          viewer.name,
          own[0].track!,
          entries.indexOf(own[0]) + 1,
          1,
        );
      else text = MSG.mySongNone(viewer.name);
      await this.say(q, channelId, `spotify:msg:${messageId}`, text);
      return 'mysong';
    });
  }

  /**
   * A viewer's own requests in playback order: the one playing (if it is theirs), then the future ones in the queue's
   * order. `!mysong` numbers them this way and `!songcancel <n>` takes the n-th: the playing one keeps n°1 while it
   * plays, so a request starting to play never shifts the numbers under the viewer's command.
   */
  private ownRequests(
    rows: RequestRow[],
    st: StudioRow | null,
    viewerId: string,
  ) {
    const current = rows.find(
      (r) =>
        r.request_id === st?.current_request_id &&
        r.state === 'PLAYING' &&
        r.viewer_id === viewerId &&
        r.track,
    );
    const future = this.future(rows).filter((r) => r.viewer_id === viewerId);
    return current ? [current, ...future] : future;
  }

  private numbered(own: RequestRow[], entries: RequestRow[]) {
    return own.map(
      (r, i) =>
        `${i + 1}) ${trackLabel(r.track).slice(0, 60)} (${r.state === 'PLAYING' ? 'en cours' : `#${entries.indexOf(r) + 1}`})`,
    );
  }

  /** Playback progress now (estimated from Studio's fresh reading), or null when unknown. */
  private progressNow(st: StudioRow | null) {
    const p = st?.playback;
    if (!p || !st?.playback_at) return null;
    const age = this.clock.now().getTime() - ms(p.observed_at);
    if (age > SPOTIFY_RULES.observationFreshMs || p.progress_ms === null)
      return null;
    return p.progress_ms + (p.is_playing ? Math.max(0, age) : 0);
  }

  /**
   * `!songcancel` (spotify-v2/moderation.js cancelViewer), decisions of 25/10: alone, it cancels the viewer's only
   * cancellable request; with several, it cancels nothing and lists them (`!songcancel <n>`). `!songcancel <n>` takes
   * the n-th of the viewer's own requests (never another viewer's), numbered as `!mysong` shows them. The one playing
   * can only be canceled within its first seconds (cancel_grace_seconds), then it is skipped at once.
   */
  async cancel(
    channelId: string,
    messageId: string,
    viewer: { id: string; name: string },
    index?: number,
  ) {
    const changed: string[] = [];
    const outcome = await this.db.tx(async (q) => {
      const settings = await this.lock(q, channelId);
      const rows = await this.live(q, channelId);
      const st = await this.studio(q, channelId);
      const key = `spotify:msg:${messageId}`;
      const now = this.clock.now();
      const entries = this.future(rows);
      const own = this.ownRequests(rows, st, viewer.id);
      const graceOk = () => {
        const progress = this.progressNow(st);
        return (
          progress !== null && progress <= settings.cancel_grace_seconds * 1000
        );
      };
      const cancellable = own.filter((r) => r.state !== 'PLAYING' || graceOk());
      let target: RequestRow | undefined;
      if (index !== undefined) {
        target = own[index - 1];
        if (!target) {
          await this.say(
            q,
            channelId,
            key,
            MSG.cancelNoIndex(viewer.name, index, own.length),
          );
          return 'songcancel_no_index';
        }
      } else if (cancellable.length > 1) {
        await this.say(
          q,
          channelId,
          key,
          MSG.cancelChoose(viewer.name, this.numbered(own, entries)),
        );
        return 'songcancel_choose';
      } else target = cancellable[0];

      if (target && target.state === 'PLAYING') {
        if (!graceOk()) {
          await this.say(q, channelId, key, MSG.cancelTooLate(viewer.name));
          return 'songcancel_too_late';
        }
        const refunded = await this.refundTwitch(q, target);
        await this.update(q, target.request_id, {
          state: 'CANCELED',
          reason: 'VIEWER_CANCEL',
          canceled_at: now,
          canceled_by: viewer.id,
          end_reason: 'VIEWER_CANCEL',
          ended_at: now,
          auto_skip: true,
          auto_skip_consumed_at: now,
          auto_skip_result: 'REQUESTED',
        });
        await q.query(
          'update spotify_studio set current_request_id = null where channel_id = $1',
          [channelId],
        );
        await this.queueJob(
          q,
          channelId,
          'skip',
          target.request_id,
          { kind: 'cancel_current' },
          `cancel:${target.request_id}`,
        );
        await this.say(
          q,
          channelId,
          key,
          MSG.canceled(viewer.name, target.track!, refunded, null),
        );
        changed.push(target.request_id);
        return 'songcancel_current';
      }
      if (target) {
        const inSpotify = !!target.queued_at; // QUEUED or an uncertain addition proven in the queue
        const refunded = await this.refundTwitch(q, target);
        await this.update(q, target.request_id, {
          state: 'CANCELED',
          reason: 'VIEWER_CANCEL',
          canceled_at: now,
          canceled_by: viewer.id,
          end_reason: 'VIEWER_CANCEL',
          ended_at: now,
          auto_skip: inSpotify,
        });
        const remaining = own.filter(
          (r) => r.request_id !== target.request_id && r.state !== 'PLAYING',
        ).length;
        await this.say(
          q,
          channelId,
          key,
          MSG.canceled(viewer.name, target.track!, refunded, remaining),
        );
        changed.push(target.request_id);
        return 'songcancel';
      }
      // Nothing cancellable: their song playing too long already, or nothing at all.
      if (own.some((r) => r.state === 'PLAYING')) {
        await this.say(q, channelId, key, MSG.cancelTooLate(viewer.name));
        return 'songcancel_too_late';
      }
      const last = (
        await q.query<RequestRow>(
          `select * from spotify_requests where channel_id = $1 and viewer_id = $2 and state = 'CANCELED'
           order by canceled_at desc nulls last limit 1`,
          [channelId, viewer.id],
        )
      )[0];
      await this.say(
        q,
        channelId,
        key,
        last ? MSG.cancelAlready(viewer.name) : MSG.cancelNone(viewer.name),
      );
      return 'songcancel_none';
    });
    for (const id of changed) await this.told(channelId, { request_id: id });
    return outcome;
  }

  /** `!songremove <position>` / `!songremove @viewer`, and the panel's « Retirer » (moderation.js remove). */
  async remove(
    channelId: string,
    key: string,
    target: { position: number } | { login: string } | { request_id: string },
    actor: string,
  ) {
    const changed: string[] = [];
    const outcome = await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const rows = await this.live(q, channelId);
      const st = await this.studio(q, channelId);
      const entries = this.future(rows);
      const current =
        rows.find(
          (r) =>
            r.request_id === st?.current_request_id && r.state === 'PLAYING',
        ) ?? null;
      let fresh: RequestRow | undefined;
      if ('position' in target) {
        if (target.position < 1 || !(fresh = entries[target.position - 1])) {
          await this.say(
            q,
            channelId,
            key,
            MSG.removeNoPosition(target.position),
          );
          return 'songremove_none';
        }
      } else if ('login' in target) {
        const login = target.login.replace(/^@+/, '').toLowerCase();
        if (!/^[a-z0-9_]{1,30}$/.test(login)) {
          await this.say(q, channelId, key, MSG.removeBadViewer);
          return 'songremove_invalid';
        }
        const candidates = [...(current ? [current] : []), ...entries].filter(
          (r) => r.viewer_login.toLowerCase() === login,
        );
        if (new Set(candidates.map((r) => r.viewer_id)).size > 1) {
          await this.say(q, channelId, key, MSG.removeAmbiguous(target.login));
          return 'songremove_ambiguous';
        }
        fresh = candidates[0];
        if (!fresh) {
          await this.say(q, channelId, key, MSG.removeNone(target.login));
          return 'songremove_none';
        }
      } else {
        fresh = rows.find((r) => r.request_id === target.request_id);
        if (!fresh || (!isQueuedLike(fresh) && fresh.state !== 'PLAYING'))
          throw new SpotifyError(409, 'not_removable');
      }
      if (current && fresh.request_id === current.request_id) {
        if ('request_id' in target)
          throw new SpotifyError(409, 'playing_use_skip');
        await this.say(q, channelId, key, MSG.removePlaying);
        return 'songremove_playing';
      }
      if (!isQueuedLike(fresh) || !fresh.track) {
        await this.say(q, channelId, key, MSG.removeUnsafe);
        return 'songremove_unsafe';
      }
      const now = this.clock.now();
      const refunded = await this.refundTwitch(q, fresh);
      await this.update(q, fresh.request_id, {
        state: 'REMOVED_BY_MOD',
        reason: 'MOD_REMOVE',
        removed_at: now,
        removed_by: actor.slice(0, 64),
        end_reason: 'MOD_REMOVE',
        ended_at: now,
        auto_skip: !!fresh.queued_at,
      });
      await this.say(
        q,
        channelId,
        key,
        'position' in target
          ? MSG.removedPosition(
              target.position,
              fresh.viewer_name,
              fresh.track,
              refunded,
            )
          : MSG.removedViewer(fresh.viewer_name, fresh.track, refunded),
      );
      changed.push(fresh.request_id);
      return 'songremove';
    });
    for (const id of changed) await this.told(channelId, { request_id: id });
    return outcome;
  }

  /** `!songskip` and the panel's « Passer » (moderation.js songSkip). */
  async skip(channelId: string, key: string, moderator: string | null) {
    return this.db.tx(async (q) => {
      const settings = await this.lock(q, channelId);
      const st = await this.studio(q, channelId);
      const reason = settings.enabled
        ? this.studioRefusal(st)
        : 'MODULE_DISABLED';
      if (reason) {
        if (moderator)
          await this.say(q, channelId, key, MSG.skipFailed(moderator, reason));
        return 'songskip_unavailable';
      }
      const current = st?.current_request_id
        ? await this.request(q, st.current_request_id)
        : null;
      // The track playing may be a canceled / removed request being auto-skipped by Studio.
      const uri = st?.playback?.track?.uri ?? null;
      const tomb = uri
        ? (
            await q.query<RequestRow>(
              `select * from spotify_requests where channel_id = $1 and auto_skip and state in ('CANCELED', 'REMOVED_BY_MOD')
                 and track->>'uri' = $2 and received_at > $3 order by coalesce(queued_at, received_at), seq limit 1`,
              [channelId, uri, this.recentCut()],
            )
          )[0]
        : undefined;
      if (!current && tomb) {
        const removed = tomb.state === 'REMOVED_BY_MOD';
        if (tomb.auto_skip_consumed_at) {
          if (moderator)
            await this.say(
              q,
              channelId,
              key,
              MSG.skipTombstoneConsumed(removed),
            );
          return 'songskip_tombstone_consumed';
        }
        await this.queueJob(
          q,
          channelId,
          'skip',
          tomb.request_id,
          moderator
            ? {
                kind: 'songskip',
                moderator,
                tombstone: removed ? 'removed' : 'canceled',
              }
            : { kind: 'panel_skip' },
          key,
        );
        return 'songskip_tombstone';
      }
      await this.queueJob(
        q,
        channelId,
        'skip',
        current?.state === 'PLAYING' ? current.request_id : null,
        moderator ? { kind: 'songskip', moderator } : { kind: 'panel_skip' },
        key,
      );
      return 'songskip';
    });
  }

  /**
   * The panel: an uncertain addition settled by hand — refund it (CANCELED, once), or keep it: nothing is sent to
   * Twitch, the redemption stays PENDING there (validated or refunded later by Antoni on Twitch).
   */
  async settle(
    channelId: string,
    requestId: string,
    decision: 'refund' | 'keep',
  ) {
    await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const req = await this.request(q, requestId);
      if (!req || req.channel_id !== channelId)
        throw new SpotifyError(404, 'request_not_found');
      if (req.twitch_status !== null)
        throw new SpotifyError(409, 'already_settled');
      // Only an uncertain addition (a request that played, even interrupted, is never refunded from here).
      if (!isUncertainAddition(req))
        throw new SpotifyError(409, 'not_uncertain');
      if (decision === 'keep')
        await this.update(q, requestId, { twitch_status: 'kept' });
      else await this.refundTwitch(q, req);
      if (decision === 'refund')
        await this.update(q, requestId, {
          ended_at: this.clock.now(),
          end_reason: 'SETTLED_REFUND',
        });
    });
    await this.told(channelId, { request_id: requestId });
  }

  // ---------------------------------------------------------------- reads

  /** Points de chaîne: what became of a request / a skip job (null while it runs). */
  async outcome(requestId: string) {
    const r = (
      await this.db.query<RequestRow>(
        'select * from spotify_requests where request_id = $1',
        [requestId],
      )
    )[0];
    return r ? requestView(r) : null;
  }

  async jobOutcome(jobId: string) {
    const j = (
      await this.db.query<JobRow>(
        'select * from spotify_jobs where job_id = $1',
        [jobId],
      )
    )[0];
    return j
      ? {
          status: j.status,
          result: j.result as { outcome?: string; reason?: string } | null,
        }
      : null;
  }

  /** The Studio panel: settings, Studio's last status and reading, current, queue, recent history, Twitch actions. */
  async state(channelId: string) {
    const settings = await this.settings(channelId);
    const st =
      (
        await this.db.query<StudioRow>(
          'select * from spotify_studio where channel_id = $1',
          [channelId],
        )
      )[0] ?? null;
    const rows = await this.live(this.db, channelId);
    const recent = await this.db.query<RequestRow>(
      'select * from spotify_requests where channel_id = $1 order by received_at desc, seq desc limit 50',
      [channelId],
    );
    const current =
      rows.find(
        (r) => r.request_id === st?.current_request_id && r.state === 'PLAYING',
      ) ?? null;
    const actions = await this.twitch.list(channelId, 20);
    const managed = await this.db.query<{
      reward_id: string;
      title: string;
      cost: number;
    }>(
      'select reward_id, title, cost from cp_rewards where channel_id = $1 and managed_by_raptoru order by title',
      [channelId],
    );
    return {
      settings,
      studio: st
        ? {
            seen_at: iso(new Date(st.seen_at)),
            fresh:
              this.clock.now().getTime() - ms(st.seen_at) <=
              SPOTIFY_RULES.studioFreshMs,
            status: st.status,
            playback: st.playback,
          }
        : null,
      admission: settings.enabled
        ? (this.studioRefusal(st) ?? 'ready')
        : 'MODULE_DISABLED',
      current: current ? requestView(current) : null,
      queue: this.future(rows).map(requestView),
      in_progress: rows
        .filter((r) => r.state === 'RECEIVED' || r.state === 'SEARCHING')
        .map(requestView),
      to_verify: rows
        .filter((r) => isUncertainAddition(r) && r.twitch_status === null)
        .map(requestView),
      recent: recent.map(requestView),
      overrides: await this.overrides(channelId),
      twitch_actions: actions,
      managed_rewards: managed,
    };
  }
}
