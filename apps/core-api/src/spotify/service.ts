import { randomUUID } from 'node:crypto';
import { activeSession } from '../stream/stream-sessions.js';
import {
  MUSIC_RULES,
  SPOTIFY_RULES,
  type MusicRulesUpdate,
  type SpotifyAutoSkipReport,
  type SpotifyJob,
  type SpotifyJobReport,
  type SpotifyLiveNow,
  type SpotifyPlayback,
  type SpotifyQueueEntry,
  type SpotifyReason,
  type SpotifyRequestState,
  type SpotifySearchItem,
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
import type { EconomyPort } from '../economy/economy.js';
import {
  access,
  allowed,
  assertAllowed,
  LabForbiddenError,
  LabWalletError,
  type Actor as MusicActor,
} from '../lab-moderation/store.js';
import { LiveMusic } from './live-music.js';
import { MSG, trackLabel } from './messages.js';
import {
  loadRules,
  saveRules,
  SKIP_MODULE,
  skipPrice,
  takeSongTurn,
} from './music-rules.js';
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
    /** What the viewer needs to understand a refusal (cooldown left, balance…). Never a secret. */
    readonly details?: Record<string, unknown>,
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
  extension_enabled: boolean;
  extension_price_tokens: number;
  no_duplicates: boolean;
  player_controls: boolean;
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
  extension_enabled: boolean;
  extension_price_tokens: number;
  no_duplicates: boolean;
  player_controls: boolean;
  updated_at: Date;
}

export interface RequestRow {
  request_id: string;
  seq: number | string;
  channel_id: string;
  source: 'twitch' | 'simulation' | 'extension';
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
  /** Music Hub: channel points (the reward) or Jetons (the extension). */
  payment: 'channel_points' | 'tokens';
  price_tokens: number | null;
  refund_status: 'refunded' | 'kept' | null;
  refunded_at: Date | null;
  refunded_by: string | null;
  display: {
    album?: string | null;
    image_url?: string | null;
    provider?: 'spotify' | 'lab';
  } | null;
  updated_at: Date;
}

interface StudioRow {
  seen_at: Date;
  /**
   * `targeted_skip`: Core's own mark (never sent in the body, whose schema an older Core rejects) — the Studio
   * declared `?caps=targeted_skip` on its sync, i.e. it honours `expect_uri` (skips / seeks only THAT track).
   */
  status: SpotifyStudioStatus & { targeted_skip?: boolean };
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

/** Music Hub: one paid skip (module_activity, module `music_skip`). */
interface SkipRow {
  activity_id: string;
  viewer_id: string;
  viewer_name: string;
  amount: number;
  status: 'queued' | 'done' | 'refunded';
  input: {
    price: number;
    doublings: number;
    job_id: string;
    track: { title: string; artists: string[]; uri: string };
  };
  result: { outcome: string; reason?: string | null; at: string } | null;
  created_at: Date;
  updated_at: Date;
}

const skipView = (r: SkipRow, team: boolean) => ({
  id: r.activity_id,
  /** pending: paid, Studio is skipping · done: proven by Studio's reading · refunded: not done, given back once. */
  status: r.status === 'queued' ? ('pending' as const) : r.status,
  price: r.amount,
  reason: r.result?.reason ?? null,
  track: { title: r.input.track.title, artists: r.input.track.artists },
  at: new Date(r.created_at).toISOString(),
  ended_at: r.result?.at ?? null,
  ...(team ? { viewer_name: r.viewer_name } : {}),
});

/** Who to answer when a job ends. */
type Reply =
  | { kind: 'song'; viewer: string }
  | { kind: 'songskip'; moderator: string; tombstone?: 'canceled' | 'removed' }
  | { kind: 'panel_skip' }
  | { kind: 'cancel_current' }
  /** Music Hub: a viewer's paid skip (its row in module_activity, debited under `activity_id`). */
  | {
      kind: 'viewer_skip';
      activity_id: string;
      price: number;
      viewer: { id: string; login: string; name: string };
    }
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
  payment: r.payment ?? 'channel_points',
  price_tokens: r.price_tokens ?? null,
  refund_status: r.refund_status ?? null,
  refunded_by: r.refunded_by ?? null,
  display: r.display ?? null,
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

/** Refonte H6: a live is over (for the Spotify queue) only this long after its canonical end — a brief cut is not an end. */
export const SPOTIFY_END_GRACE_MS = 10 * 60_000;

export class SpotifyService {
  private readonly resultListeners: ((
    channelId: string,
    ref: { request_id?: string; job_id?: string },
  ) => Promise<void>)[] = [];

  /** Music Hub: the economy the extension's requests are paid with (Jetons). Null: that entry is unavailable. */
  economy: EconomyPort | null = null;
  /** Music Hub: the live of the Lab (its simulated sessions) instead of the canonical one, for the music history. */
  labSessions = false;
  /**
   * Music Hub (audit 09/11): the new `!song` — a Twitch announcement, 30 s global cooldown, answered from Windows (SMTC).
   * ON in the Lab only (set with labSessions): a Production Core keeps the historical `!song` until Antoni decides.
   */
  songV2 = false;
  /** Music Hub: the live track (Windows SMTC via Studio) and the stream's music history — display only. */
  readonly music: LiveMusic;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly twitch: CpTwitchActions,
  ) {
    this.music = new LiveMusic(db, clock, () => this.labSessions);
  }

  /** Studio's live track (SMTC): under the channel's lock, like the sync — never a request's decision. */
  async liveNow(channelId: string, body: SpotifyLiveNow) {
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      return this.music.apply(q, channelId, body);
    });
  }

  /** The stream's music history for Studio (team view: logins too). */
  async musicHistory(channelId: string, before: string | null) {
    return this.music.history(this.db, channelId, {
      before,
      limit: 50,
      viewerId: null,
      team: true,
    });
  }

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
      extension_enabled: s?.extension_enabled ?? false,
      extension_price_tokens:
        s?.extension_price_tokens ?? SPOTIFY_RULES.extensionPriceTokens,
      no_duplicates: s?.no_duplicates ?? true,
      player_controls: s?.player_controls ?? false,
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
      override: !!o,
    };
  }

  /**
   * A viewer's usage of the limits, exactly as the admission applies them (the panel shows the same numbers): their
   * pending requests, their limit, and the cooldown left before a new request (from the last request still waiting —
   * or being searched — or canceled by them before it played; decision 25/10).
   */
  private async usage(
    q: Queryable,
    channelId: string,
    viewer: { id: string; login: string },
    settings: Pick<
      SettingsRow,
      'max_pending_per_viewer' | 'viewer_cooldown_seconds'
    >,
    excludeRequestId: string | null,
    /** Music Hub Open Bar (the extension's entry): no count per viewer, one short frequency limit instead. */
    openBar = false,
  ) {
    const mine = await q.query<RequestRow>(
      `select * from spotify_requests where channel_id = $1 and viewer_id = $2 and request_id <> $3
         and received_at > $4 and state in ('RECEIVED', 'SEARCHING', 'QUEUED', 'UNKNOWN', 'CANCELED')`,
      [
        channelId,
        viewer.id,
        excludeRequestId ?? '00000000-0000-0000-0000-000000000000',
        this.recentCut(),
      ],
    );
    const limits = await this.limitsFor(q, channelId, viewer.login, settings);
    const cooldownMs =
      (openBar
        ? Math.min(
            limits.viewer_cooldown_seconds,
            MUSIC_RULES.openBarCooldownSeconds,
          )
        : limits.viewer_cooldown_seconds) * 1000;
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
    const left =
      last === null
        ? 0
        : cooldownMs - Math.max(0, this.clock.now().getTime() - last);
    return {
      pending: mine.filter(
        (r) =>
          r.state === 'RECEIVED' ||
          r.state === 'SEARCHING' ||
          r.state === 'QUEUED' ||
          isUncertainAddition(r),
      ).length,
      max_pending: limits.max_pending_per_viewer,
      /** Open Bar: the count above is shown, never a limit. */
      unlimited: openBar,
      cooldown_left_ms: cooldownMs > 0 ? Math.max(0, left) : 0,
      override: limits.override,
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

  private say(
    q: Queryable,
    channelId: string,
    key: string,
    text: string,
    mode: 'normal' | 'announce' = 'normal',
  ) {
    return insertWordGameSteps(q, {
      channelId,
      now: this.clock.now(),
      origin: 'music',
      drafts: [
        {
          idempotencyKey: key.slice(0, 200),
          mode,
          text: text.slice(0, 500),
        },
      ],
    });
  }

  /** `!song`'s answer: a Twitch announcement (a plain message if the bot cannot announce — commands/steps.ts). */
  private announce(q: Queryable, channelId: string, key: string, text: string) {
    return this.say(
      q,
      channelId,
      key,
      text,
      this.songV2 ? 'announce' : 'normal',
    );
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

  /** Why a write to the player (skip, pause, seek…) cannot be sent now: Studio's refusal, or the Lab read-only. */
  private writeRefusal(st: StudioRow | null): SpotifyReason | null {
    return (
      this.studioRefusal(st) ?? (st?.status.read_only ? 'LAB_READ_ONLY' : null)
    );
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

  /**
   * Music Hub: the ONE refund of a request, whatever paid it — Jetons given back by the economy (the debit of this
   * request, at most once: the economy keys it by the request id) or the channel points (Twitch CANCELED, above).
   * Returns true when something was given back now.
   */
  private async refundPayment(q: Queryable, r: RequestRow, actor = 'system') {
    if (r.payment !== 'tokens') return this.refundTwitch(q, r);
    const fresh = (await this.request(q, r.request_id)) ?? r;
    if (fresh.refund_status !== null) return false;
    if (!this.economy || !fresh.price_tokens) {
      await this.update(q, r.request_id, {
        refund_status: 'kept',
        twitch_status: 'none',
      });
      return false;
    }
    const out = await this.economy.refund(
      q,
      this.clock.now(),
      r.request_id,
      actor.slice(0, 64),
      'demande de musique',
    );
    await this.update(q, r.request_id, {
      refund_status: 'refunded',
      refunded_at: this.clock.now(),
      refunded_by: actor.slice(0, 64),
      twitch_status: 'none',
    });
    return out.amount > 0;
  }

  /**
   * Moderation « Rembourser » (post-live 11/11, D4 `refund.manual` — checked by the moderation before this): a FINISHED
   * Jetons purchase of the music given back once, by hand, on a moderator's decision — a song request (its
   * `request_id`) or a paid skip (its `activity_id`). Never a request still waiting or playing (remove it first: the
   * removal refunds it), never twice, never without the original debit (the economy gives back exactly that debit, keyed
   * by the interaction: a replay credits nothing more). A refunded skip stays in the skip series (its price was real):
   * the refund is written on the activity, its status unchanged.
   */
  async moderationRefund(
    q: Queryable,
    channelId: string,
    id: string,
    actor: string,
    reason: string | null,
  ): Promise<
    | {
        ok: true;
        amount: number;
        viewer_id: string;
        kind: 'request' | 'skip';
        before: string;
      }
    | {
        ok: false;
        code:
          | 'not_found'
          | 'not_terminal'
          | 'already_refunded'
          | 'nothing_to_refund';
      }
  > {
    if (!this.economy) return { ok: false, code: 'nothing_to_refund' };
    const now = this.clock.now();
    const why = (reason ?? 'remboursement modération').slice(0, 160);
    const r = (
      await q.query<RequestRow>(
        'select * from spotify_requests where request_id::text = $1 and channel_id = $2 for update',
        [id, channelId],
      )
    )[0];
    if (r) {
      if (r.payment !== 'tokens')
        return { ok: false, code: 'nothing_to_refund' };
      if (['RECEIVED', 'SEARCHING', 'QUEUED', 'PLAYING'].includes(r.state))
        return { ok: false, code: 'not_terminal' };
      if (r.refund_status === 'refunded')
        return { ok: false, code: 'already_refunded' };
      if (!r.price_tokens) return { ok: false, code: 'nothing_to_refund' };
      const out = await this.economy.refund(
        q,
        now,
        r.request_id,
        actor.slice(0, 64),
        why,
      );
      if (!(out.amount > 0)) return { ok: false, code: 'nothing_to_refund' };
      await this.update(q, r.request_id, {
        refund_status: 'refunded',
        refunded_at: now,
        refunded_by: actor.slice(0, 64),
      });
      return {
        ok: true,
        amount: out.amount,
        viewer_id: r.viewer_id,
        kind: 'request',
        before: r.state,
      };
    }
    const a = (
      await q.query<{
        activity_id: string;
        viewer_id: string | null;
        amount: number;
        status: string;
        result: Record<string, unknown> | null;
      }>(
        `select activity_id, viewer_id, amount, status, result from module_activity
          where activity_id::text = $1 and channel_id = $2 and module_id = $3 for update`,
        [id, channelId, SKIP_MODULE],
      )
    )[0];
    if (!a) return { ok: false, code: 'not_found' };
    if (a.status === 'queued') return { ok: false, code: 'not_terminal' };
    if (a.status === 'refunded' || a.result?.refunded_at)
      return { ok: false, code: 'already_refunded' };
    if (!(Number(a.amount) > 0))
      return { ok: false, code: 'nothing_to_refund' };
    const out = await this.economy.refund(
      q,
      now,
      a.activity_id,
      actor.slice(0, 64),
      why,
    );
    if (!(out.amount > 0)) return { ok: false, code: 'nothing_to_refund' };
    await q.query(
      `update module_activity set result = coalesce(result, '{}'::jsonb) || $2::jsonb, updated_at = $3
        where activity_id = $1`,
      [
        a.activity_id,
        JSON.stringify({
          refunded_at: now.toISOString(),
          refunded_by: actor.slice(0, 64),
          refund_reason: why,
        }),
        now,
      ],
    );
    return {
      ok: true,
      amount: out.amount,
      viewer_id: a.viewer_id ?? '',
      kind: 'skip',
      before: a.status,
    };
  }

  /**
   * Music Hub V2: a request withdrawn while Studio is still adding it. Refunded once now (Jetons or channel points);
   * not taken yet (RECEIVED) → its job is withdrawn too, Studio never adds it; being added (SEARCHING) → marked to be
   * skipped: if Spotify takes it anyway, Studio's report turns it into a tombstone (reportJob) skipped when it starts.
   * Returns whether something was given back.
   */
  private async cancelInFlight(
    q: Queryable,
    r: RequestRow,
    by: string,
    now: Date,
  ) {
    const refunded = await this.refundPayment(q, r, by);
    await this.update(q, r.request_id, {
      state: 'CANCELED',
      reason: 'VIEWER_CANCEL',
      canceled_at: now,
      canceled_by: by,
      end_reason: 'VIEWER_CANCEL',
      ended_at: now,
      auto_skip: r.state === 'SEARCHING',
    });
    if (r.state === 'RECEIVED')
      await q.query(
        `update spotify_jobs set status = 'expired', updated_at = $3
         where channel_id = $1 and request_id = $2 and kind = 'song_request' and status = 'queued'`,
        [r.channel_id, r.request_id, now],
      );
    return refunded;
  }

  /** A removal WITHOUT refund (an explicit moderation choice): nothing given back, recorded as kept. */
  private async keepPayment(q: Queryable, r: RequestRow, actor: string) {
    if (r.payment === 'tokens') {
      if (r.refund_status === null)
        await this.update(q, r.request_id, {
          refund_status: 'kept',
          refunded_by: actor.slice(0, 64),
          twitch_status: 'none',
        });
      return;
    }
    if (r.twitch_status === null)
      await this.update(q, r.request_id, { twitch_status: 'kept' });
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
        const refunded = await this.refundPayment(q, row);
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
      // Historical order: cooldown, then pending (spotify-v2/service.js requestSongLocked). The rule lives in usage().
      const use = await this.usage(q, e.channel_id, e.viewer, settings, id);
      if (use.cooldown_left_ms > 0) {
        await refuse('VIEWER_COOLDOWN', (refunded) =>
          MSG.cooldown(e.viewer.name, use.cooldown_left_ms, refunded),
        );
        return { row, duplicate: false };
      }
      if (use.pending >= use.max_pending) {
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
    caps: { targetedSkip?: boolean } = {},
  ): Promise<SpotifySyncAnswer> {
    const changed: string[] = [];
    const answer = await this.db.tx(async (q) => {
      const settings = await this.lock(q, channelId);
      const now = this.clock.now();
      const prior = await this.studio(q, channelId);
      await q.query(
        `insert into spotify_studio (channel_id, seen_at, status) values ($1, $2, $3)
         on conflict (channel_id) do update set seen_at = $2, status = $3`,
        [
          channelId,
          now,
          JSON.stringify({
            ...s.status,
            ...(caps.targetedSkip ? { targeted_skip: true } : {}),
          }),
        ],
      );
      if (s.playback)
        changed.push(...(await this.observe(q, channelId, prior, s.playback)));
      changed.push(...(await this.expire(q, channelId)));
      // Music Hub: a catalogue search the viewer was already told is « indisponible » (older than its timeout) is
      // never handed out — no Spotify call for an answer nobody waits for any more.
      await q.query(
        `update spotify_jobs set status = 'expired', updated_at = $2 where channel_id = $1 and kind = 'search'
           and status = 'queued' and created_at < $3`,
        [
          channelId,
          now,
          new Date(now.getTime() - SPOTIFY_RULES.searchTimeoutMs),
        ],
      );
      // The essential jobs (song requests, skips, player controls, `!song`) first; the catalogue searches after.
      const jobs = await q.query<JobRow>(
        `select * from spotify_jobs where channel_id = $1 and status = 'queued'
           order by (kind = 'search'), created_at limit 50`,
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
      // A catalogue search never makes Studio watch the player (it reads nothing of the playback).
      const running = await q.query(
        `select 1 from spotify_jobs where channel_id = $1 and status in ('queued', 'running') and kind <> 'search'
           limit 1`,
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
      return {
        kind: 'skip',
        job_id: j.job_id,
        request_id: j.request_id,
        // Only a paid skip carries it (an older Studio never receives one: the paid skip is off by default).
        ...(typeof j.payload.expect_uri === 'string'
          ? { expect_uri: j.payload.expect_uri }
          : {}),
      };
    if (j.kind === 'search')
      return {
        kind: 'search',
        job_id: j.job_id,
        query: String(j.payload.query),
        // Music Hub V2: a pasted Spotify link → that exact track (Studio reads it, the reward's way).
        ...(typeof j.payload.track_id === 'string'
          ? { track_id: j.payload.track_id }
          : {}),
      };
    if (j.kind === 'control')
      return {
        kind: 'control',
        job_id: j.job_id,
        action: j.payload.action as 'pause' | 'resume' | 'volume' | 'seek',
        volume_percent:
          j.payload.volume_percent === null ||
          j.payload.volume_percent === undefined
            ? null
            : Number(j.payload.volume_percent),
        ...(j.payload.action === 'seek'
          ? {
              position_ms: Number(j.payload.position_ms),
              expect_uri: String(j.payload.expect_uri),
            }
          : {}),
      };
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
        } else if (
          req &&
          req.state === 'CANCELED' &&
          req.auto_skip &&
          !req.track &&
          r.track &&
          (r.outcome === 'queued' || r.outcome === 'unknown')
        ) {
          // Music Hub V2: withdrawn while Studio was adding it, and Spotify took it (or maybe did) — a tombstone now:
          // Studio skips it the moment it starts. Already refunded at the withdrawal: nothing is given back again.
          await this.update(q, req.request_id, {
            track: r.track,
            candidates: r.candidates ?? null,
            confidence: r.confidence ?? null,
            margin: r.margin ?? null,
            confirmation: r.confirmation ?? null,
            queued_at: now,
          });
          changed.push({ request_id: req.request_id });
        }
      } else if (r.kind === 'skip') {
        await this.finishSkip(q, job, r);
        if (job.request_id) changed.push({ request_id: job.request_id });
        changed.push({ job_id: job.job_id });
      } else if (r.kind === 'search') {
        // Stored in the job (result): the extension reads it, a later request checks its pick against it.
      } else if (r.kind === 'control') {
        if (r.playback) {
          const prior = await this.studio(q, channelId);
          for (const id of await this.observe(q, channelId, prior, r.playback))
            changed.push({ request_id: id });
        }
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
    await this.refundPayment(q, req);
    if (req.source !== 'extension')
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
    // Music Hub: a skip command took this exact track — its occurrence in the music history is a confirmed skip.
    if (r.outcome === 'skipped' && r.skipped_track)
      await this.music.noteSkip(q, job.channel_id, r.skipped_track.uri);
    if (r.outcome === 'skipped' && target?.state === 'PLAYING') {
      const by =
        reply?.kind === 'songskip'
          ? reply.moderator
          : reply?.kind === 'reward_skip' || reply?.kind === 'viewer_skip'
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
    } else if (reply.kind === 'viewer_skip') {
      await this.settleViewerSkip(q, job.channel_id, reply, r);
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
    const key = `spotify:song:job:${job.job_id}`;
    if (!playback?.track) {
      await this.announce(q, job.channel_id, key, MSG.noPlayback);
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
    await this.announce(
      q,
      job.channel_id,
      key,
      MSG.nowPlaying(
        playback.track,
        requester,
        this.songV2 && !playback.is_playing,
      ),
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
      if (r.result === 'SKIPPED' && req.track)
        await this.music.noteSkip(q, channelId, req.track.uri);
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

  /**
   * Refonte H6 (decided 05/11): at the canonical end of the live, the requests still waiting in the queue (accepted,
   * never started) are canceled and refunded ONCE when the reward allows it (Twitch CANCELED, Raptoru's rewards only —
   * never promised as done). The song playing keeps its normal end; an uncertain addition is never refunded; a request
   * still being searched is handled at the next pass, once it is queued or refused.
   * « End »: no open canonical session (stream_sessions) and the last one ended at least END_GRACE_MS ago — a brief cut
   * (Twitch reconnecting, a new stream id within the grace) is not an end. Replays (double offline event, restart,
   * several Cores) change nothing: one state transition per request, one refund key per redemption.
   */
  async closeAfterLive(channelId: string) {
    const changed: string[] = [];
    await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      if (await activeSession(q)) return;
      const last = (
        await q.query<{ ended_at: Date | null }>(
          'select max(ended_at) as ended_at from stream_sessions',
        )
      )[0]?.ended_at;
      if (!last) return;
      const now = this.clock.now();
      if (now.getTime() - new Date(last).getTime() < SPOTIFY_END_GRACE_MS)
        return;
      const waiting = await q.query<RequestRow>(
        `select * from spotify_requests where channel_id = $1 and state = 'QUEUED' and received_at <= $2
         order by seq for update`,
        [channelId, last],
      );
      const st = await this.studio(q, channelId);
      for (const r of waiting) {
        if (r.request_id === st?.current_request_id) continue; // playing now: never canceled here
        await this.refundPayment(q, r);
        await this.update(q, r.request_id, {
          state: 'CANCELED',
          reason: 'STREAM_ENDED',
          end_reason: 'STREAM_ENDED',
          ended_at: now,
          auto_skip: !!r.queued_at,
        });
        changed.push(r.request_id);
      }
    });
    for (const id of changed) await this.told(channelId, { request_id: id });
    return changed.length;
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
    // Music Hub: a search or a control nobody took in time is over (the extension says « indisponible »).
    await q.query(
      `update spotify_jobs set status = 'expired', updated_at = $2
       where channel_id = $1 and kind in ('search', 'control') and status = 'queued' and created_at < $3`,
      [channelId, now, new Date(now.getTime() - SPOTIFY_RULES.searchTimeoutMs)],
    );
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
          await this.refundPayment(q, req);
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

  /**
   * `!song`, as a Twitch announcement (a plain message when LeCroupier_ cannot announce: the bot's refusal is final,
   * then Core writes it again as a message — commands/steps.ts). One answer per 30 s on the channel: the asks in
   * between are ignored, silently. What Windows says plays (SMTC via Studio) answers at once, with no Spotify call;
   * otherwise one playback read by Studio (its cache shares it), answered when Studio reports.
   */
  async askNowPlaying(channelId: string, messageId: string, viewer: string) {
    if (!this.songV2)
      return this.askNowPlayingHistorical(channelId, messageId, viewer);
    return this.db.tx(async (q) => {
      const settings = await this.lock(q, channelId);
      if (!(await takeSongTurn(q, channelId, this.clock.now())))
        return 'song_cooldown';
      const key = `spotify:song:${messageId}`;
      const st = await this.studio(q, channelId);
      if (!settings.enabled) {
        await this.announce(q, channelId, key, MSG.noPlayback);
        return 'song_unavailable';
      }
      // Fresh by construction (view() is null once Studio is silent); stale / lost / off are never told as current.
      const live = await this.music.view(q, channelId);
      if (
        live?.track &&
        (live.state === 'playing' || live.state === 'paused')
      ) {
        const current = st?.current_request_id
          ? await this.request(q, st.current_request_id)
          : null;
        // The requester only on Core's exact attribution of this occurrence (its Web API track), never a title.
        const requester =
          current?.state === 'PLAYING' &&
          !!live.uri &&
          current.track?.uri === live.uri
            ? current.viewer_login
            : null;
        await this.announce(
          q,
          channelId,
          key,
          MSG.nowPlaying(live.track, requester, live.state === 'paused'),
        );
        return 'song_live';
      }
      if (this.studioRefusal(st)) {
        await this.announce(q, channelId, key, MSG.noPlayback);
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

  /** The historical `!song` (Production until Antoni's GO): one playback read by Studio, a plain chat message. */
  private askNowPlayingHistorical(
    channelId: string,
    messageId: string,
    viewer: string,
  ) {
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
    opts: { request_id?: string; silent?: boolean } = {},
  ) {
    // Music Hub: the extension cancels one request by its id and shows the outcome itself (no chat line).
    const say = (q: Queryable, ch: string, k: string, text: string) =>
      opts.silent ? Promise.resolve() : this.say(q, ch, k, text);
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
      // Music Hub V2: a request Studio is still adding (RECEIVED / SEARCHING) — withdrawn as well, never « impossible ».
      const inFlight = rows.filter(
        (r) =>
          (r.state === 'RECEIVED' || r.state === 'SEARCHING') &&
          r.viewer_id === viewer.id,
      );
      const withdrawInFlight = async (r: RequestRow) => {
        const refunded = await this.cancelInFlight(q, r, viewer.id, now);
        await say(
          q,
          channelId,
          key,
          MSG.canceledInFlight(viewer.name, refunded),
        );
        changed.push(r.request_id);
        return 'songcancel' as const;
      };
      let target: RequestRow | undefined;
      if (opts.request_id) {
        target = own.find((r) => r.request_id === opts.request_id);
        if (!target) {
          const adding = inFlight.find((r) => r.request_id === opts.request_id);
          return adding ? withdrawInFlight(adding) : 'songcancel_none';
        }
      } else if (index !== undefined) {
        target = own[index - 1];
        if (!target) {
          await say(
            q,
            channelId,
            key,
            MSG.cancelNoIndex(viewer.name, index, own.length),
          );
          return 'songcancel_no_index';
        }
      } else if (cancellable.length > 1) {
        await say(
          q,
          channelId,
          key,
          MSG.cancelChoose(viewer.name, this.numbered(own, entries)),
        );
        return 'songcancel_choose';
      } else target = cancellable[0];

      if (target && target.state === 'PLAYING') {
        if (!graceOk()) {
          await say(q, channelId, key, MSG.cancelTooLate(viewer.name));
          return 'songcancel_too_late';
        }
        const refunded = await this.refundPayment(q, target, viewer.id);
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
        await say(
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
        const refunded = await this.refundPayment(q, target, viewer.id);
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
        await say(
          q,
          channelId,
          key,
          MSG.canceled(viewer.name, target.track!, refunded, remaining),
        );
        changed.push(target.request_id);
        return 'songcancel';
      }
      // Nothing in the queue: the ONE request Studio is still adding (Music Hub V2), else too late / nothing at all.
      if (inFlight.length === 1) return withdrawInFlight(inFlight[0]!);
      if (own.some((r) => r.state === 'PLAYING')) {
        await say(q, channelId, key, MSG.cancelTooLate(viewer.name));
        return 'songcancel_too_late';
      }
      const last = (
        await q.query<RequestRow>(
          `select * from spotify_requests where channel_id = $1 and viewer_id = $2 and state = 'CANCELED'
           order by canceled_at desc nulls last limit 1`,
          [channelId, viewer.id],
        )
      )[0];
      await say(
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
    opts: { refund?: boolean; silent?: boolean } = {},
  ) {
    // Music Hub: a removal is refunded unless the moderator explicitly keeps the payment (never twice either way).
    const refund = opts.refund !== false;
    const say = (q: Queryable, ch: string, k: string, text: string) =>
      opts.silent ? Promise.resolve() : this.say(q, ch, k, text);
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
          await say(q, channelId, key, MSG.removeNoPosition(target.position));
          return 'songremove_none';
        }
      } else if ('login' in target) {
        const login = target.login.replace(/^@+/, '').toLowerCase();
        if (!/^[a-z0-9_]{1,30}$/.test(login)) {
          await say(q, channelId, key, MSG.removeBadViewer);
          return 'songremove_invalid';
        }
        const candidates = [...(current ? [current] : []), ...entries].filter(
          (r) => r.viewer_login.toLowerCase() === login,
        );
        if (new Set(candidates.map((r) => r.viewer_id)).size > 1) {
          await say(q, channelId, key, MSG.removeAmbiguous(target.login));
          return 'songremove_ambiguous';
        }
        fresh = candidates[0];
        if (!fresh) {
          await say(q, channelId, key, MSG.removeNone(target.login));
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
        await say(q, channelId, key, MSG.removePlaying);
        return 'songremove_playing';
      }
      if (!isQueuedLike(fresh) || !fresh.track) {
        await say(q, channelId, key, MSG.removeUnsafe);
        return 'songremove_unsafe';
      }
      const now = this.clock.now();
      let refunded = false;
      if (refund) refunded = await this.refundPayment(q, fresh, actor);
      else await this.keepPayment(q, fresh, actor);
      await this.update(q, fresh.request_id, {
        state: 'REMOVED_BY_MOD',
        reason: 'MOD_REMOVE',
        removed_at: now,
        removed_by: actor.slice(0, 64),
        end_reason: 'MOD_REMOVE',
        ended_at: now,
        auto_skip: !!fresh.queued_at,
      });
      await say(
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
        ? this.writeRefusal(st)
        : 'MODULE_DISABLED';
      if (reason) {
        if (moderator)
          await this.say(q, channelId, key, MSG.skipFailed(moderator, reason));
        return 'songskip_unavailable';
      }
      // Audit 09/11 (P1): a viewer's paid skip is on its way to Studio (jobs run in order): this skip, with no target,
      // would then pass the NEXT track (maybe a protected request). Refused, said; the paid skip does the job.
      const paid = await q.query(
        `select 1 from module_activity where channel_id = $1 and module_id = $2 and status = 'queued' limit 1`,
        [channelId, SKIP_MODULE],
      );
      if (paid.length) {
        if (moderator)
          await this.say(q, channelId, key, MSG.skipBusy(moderator));
        return 'songskip_busy';
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
      else await this.refundPayment(q, req);
      if (decision === 'refund')
        await this.update(q, requestId, {
          ended_at: this.clock.now(),
          end_reason: 'SETTLED_REFUND',
        });
    });
    await this.told(channelId, { request_id: requestId });
  }

  // ---------------------------------------------------------------- Music Hub: paid skip, Open Bar (§ 14)

  /**
   * What plays now, for a write aimed at it (a paid skip, a seek): Windows' track (SMTC via Studio) with the exact uri
   * Studio linked to it, else Studio's fresh Web API reading. Null: nothing plays (or nothing current is known).
   */
  private async playingNow(
    q: Queryable,
    channelId: string,
    st: StudioRow | null,
  ) {
    const live = await this.music.view(q, channelId);
    if (live?.track && (live.state === 'playing' || live.state === 'paused'))
      return {
        uri: live.uri,
        title: live.track.title,
        artists: live.track.artists,
        duration_ms: live.track.duration_ms,
        is_playing: live.is_playing,
        position_ms: live.position_ms,
      };
    // Audit 09/11 (P3): Studio's last READING must be fresh, not only Studio (a reading can be minutes old when nothing
    // is watched): never aim a paid skip or a seek at a track that may have ended.
    const now = this.clock.now().getTime();
    const fresh =
      !!st &&
      now - ms(st.seen_at) <= SPOTIFY_RULES.studioFreshMs &&
      !!st.playback_at &&
      now - ms(st.playback_at) <= SPOTIFY_RULES.studioFreshMs;
    const pb = fresh ? st!.playback : null;
    return pb?.track
      ? {
          uri: pb.track.uri,
          title: pb.track.title,
          artists: pb.track.artists,
          duration_ms: pb.track.duration_ms,
          is_playing: pb.is_playing,
          position_ms: this.progressNow(st),
        }
      : null;
  }

  /** The paid skip and the Open Bar as Studio (team: names, recent decisions) or the extension sees them. */
  private async musicRulesView(q: Queryable, channelId: string, team: boolean) {
    const rules = await loadRules(q, channelId);
    const pricing = await skipPrice(q, channelId, this.clock.now(), rules);
    const recent = await q.query<SkipRow>(
      `select * from module_activity where channel_id = $1 and module_id = $2 order by created_at desc limit $3`,
      [channelId, SKIP_MODULE, team ? 8 : 1],
    );
    return {
      viewer_skip: {
        enabled: rules.viewer_skip.enabled,
        protect_requests: rules.viewer_skip.protect_requests,
        base_price: rules.viewer_skip.base_price,
        multiplier: rules.viewer_skip.multiplier,
        window_minutes: rules.viewer_skip.window_minutes,
        ...pricing,
        /** A paid skip is on its way (the next one waits for its outcome). */
        busy: recent[0]?.status === 'queued',
        ...(team ? { recent: recent.map((r) => skipView(r, true)) } : {}),
      },
      open_bar: {
        ...rules.open_bar,
        cooldown_seconds: MUSIC_RULES.openBarCooldownSeconds,
        max_queue: MUSIC_RULES.openBarMaxQueue,
      },
    };
  }

  async musicRules(channelId: string) {
    return this.musicRulesView(this.db, channelId, true);
  }

  /**
   * Studio › Musique: the paid skip's switches and the Open Bar. Opening / closing the Open Bar applies to the next
   * request at once (read under the same lock as each request) and is journaled; requests already paid keep their price.
   */
  async saveMusicRules(channelId: string, u: MusicRulesUpdate, by: string) {
    await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const now = this.clock.now();
      const r = await loadRules(q, channelId);
      if (u.viewer_skip_enabled !== undefined)
        r.viewer_skip.enabled = u.viewer_skip_enabled;
      if (u.viewer_skip_protect_requests !== undefined)
        r.viewer_skip.protect_requests = u.viewer_skip_protect_requests;
      // The progression: the next price follows at once (skipPrice reads the settings of now); journaled.
      const before = { ...r.viewer_skip };
      if (u.viewer_skip_base_price !== undefined)
        r.viewer_skip.base_price = u.viewer_skip_base_price;
      if (u.viewer_skip_multiplier !== undefined)
        r.viewer_skip.multiplier = u.viewer_skip_multiplier;
      if (u.viewer_skip_window_minutes !== undefined)
        r.viewer_skip.window_minutes = u.viewer_skip_window_minutes;
      if (
        before.base_price !== r.viewer_skip.base_price ||
        before.multiplier !== r.viewer_skip.multiplier ||
        before.window_minutes !== r.viewer_skip.window_minutes
      )
        await q.query(
          `insert into module_activity (activity_id, channel_id, module_id, action, amount, status, created_at,
             updated_at, ended_by, result)
           values ($1, $2, 'music_hub', 'skip_rules', 0, 'done', $3, $3, $4, $5)`,
          [
            randomUUID(),
            channelId,
            now,
            by.slice(0, 64),
            JSON.stringify({
              base_price: r.viewer_skip.base_price,
              multiplier: r.viewer_skip.multiplier,
              window_minutes: r.viewer_skip.window_minutes,
            }),
          ],
        );
      if (u.open_bar !== undefined && u.open_bar !== r.open_bar.on) {
        r.open_bar = u.open_bar
          ? { on: true, since: now.toISOString(), by: by.slice(0, 64) }
          : { on: false, since: null, by: null };
        await q.query(
          `insert into module_activity (activity_id, channel_id, module_id, action, amount, status, created_at,
             updated_at, ended_by)
           values ($1, $2, 'music_hub', $3, 0, 'done', $4, $4, $5)`,
          [
            randomUUID(),
            channelId,
            u.open_bar ? 'open_bar_on' : 'open_bar_off',
            now,
            by.slice(0, 64),
          ],
        );
      }
      await saveRules(q, channelId, r, now);
    });
    return this.musicRules(channelId);
  }

  /**
   * Music Hub — a viewer pays to skip the track playing. Core decides everything under the channel's lock: the switch,
   * the player (and the Lab read-only), what plays (an exact track, never a guess), the protection of paid requests,
   * one skip at a time (a moderator's skip on its way too), and the price of now, global to the stream — the client's
   * expected price must match or nothing is debited. The debit and the skip job commit together (the same retry key
   * gives the same attempt, never a second debit). Studio's report settles it: proven → `done` (the price climbs);
   * failed, uncertain or never taken → refunded once, the price and its window do not move.
   */
  async viewerSkip(e: {
    channel_id: string;
    viewer: { id: string; login: string; name: string };
    key: string;
    expected_price: number | null;
  }) {
    if (!/^[A-Za-z0-9_:-]{8,128}$/.test(e.key))
      throw new SpotifyError(400, 'idempotency_key_required');
    const intent = `${e.viewer.id}:${e.key}`;
    const out = await this.db.tx(async (q) => {
      const settings = await this.lock(q, e.channel_id);
      const prior = (
        await q.query<SkipRow>(
          `select * from module_activity where channel_id = $1 and module_id = $2 and idempotency_key = $3`,
          [e.channel_id, SKIP_MODULE, intent],
        )
      )[0];
      if (prior) return { row: prior, duplicate: true };
      const rules = await loadRules(q, e.channel_id);
      if (
        !rules.viewer_skip.enabled ||
        !settings.extension_enabled ||
        !this.economy
      )
        throw new SpotifyError(409, 'viewer_skip_disabled');
      if (!settings.enabled) throw new SpotifyError(409, 'requests_closed');
      const st = await this.studio(q, e.channel_id);
      const refusal = this.writeRefusal(st);
      if (refusal) throw new SpotifyError(409, refusal.toLowerCase());
      // Release 10/11: a Studio that does not honour `expect_uri` (0.1.27 and older) would skip whatever plays —
      // never sell it a skip (before any debit).
      if (!st?.status.targeted_skip)
        throw new SpotifyError(409, 'studio_outdated');
      const busy = await q.query(
        `select 1 from module_activity where channel_id = $1 and module_id = $2 and status = 'queued'
         union all
         select 1 from spotify_jobs where channel_id = $1 and kind = 'skip' and status in ('queued', 'running')
         limit 1`,
        [e.channel_id, SKIP_MODULE],
      );
      if (busy.length) throw new SpotifyError(409, 'skip_in_progress');
      const t = await this.playingNow(q, e.channel_id, st);
      if (!t) throw new SpotifyError(409, 'nothing_playing');
      if (!t.is_playing) throw new SpotifyError(409, 'paused');
      if (!t.uri) throw new SpotifyError(409, 'track_not_identified');
      // Audit 09/11 (P2): in its last seconds the track may already be over when Studio sends the skip (the Web API is
      // about a second behind): the NEXT one would be skipped and charged. Refused before any debit.
      if (
        t.duration_ms &&
        t.position_ms !== null &&
        t.position_ms !== undefined &&
        t.duration_ms - t.position_ms < 10_000
      )
        throw new SpotifyError(409, 'track_ending');
      const current = st?.current_request_id
        ? await this.request(q, st.current_request_id)
        : null;
      const request =
        current?.state === 'PLAYING' && current.track?.uri === t.uri
          ? current
          : null;
      // Decided 09/11 for this delivery: a request a viewer paid for (points or Jetons) is never skipped by another
      // viewer's purchase — the moderation keeps its free skip. The switch exists, it is not turned off by Core.
      if (request && rules.viewer_skip.protect_requests)
        throw new SpotifyError(409, 'protected_request', {
          requested_by: request.viewer_name,
        });
      const now = this.clock.now();
      const pricing = await skipPrice(q, e.channel_id, now);
      if (e.expected_price !== null && e.expected_price !== pricing.price)
        throw new SpotifyError(409, 'price_changed', { price: pricing.price });
      const id = randomUUID();
      try {
        await this.economy.debit(q, now, {
          channelId: e.channel_id,
          viewer: { id: e.viewer.id, display_name: e.viewer.name },
          currency: 'tokens',
          amount: pricing.price,
          module: 'music',
          interactionId: id,
        });
      } catch (err) {
        if (err instanceof LabWalletError)
          throw new SpotifyError(409, err.code, {
            price: pricing.price,
            ...err.details,
          });
        throw err;
      }
      const jobId = randomUUID();
      await q.query(
        `insert into module_activity (activity_id, channel_id, module_id, action, viewer_id, viewer_name,
           idempotency_key, amount, status, input, created_at, updated_at)
         values ($1, $2, $3, 'viewer_skip', $4, $5, $6, $7, 'queued', $8, $9, $9)`,
        [
          id,
          e.channel_id,
          SKIP_MODULE,
          e.viewer.id,
          e.viewer.name,
          intent,
          pricing.price,
          JSON.stringify({
            price: pricing.price,
            doublings: pricing.doublings,
            job_id: jobId,
            viewer_login: e.viewer.login,
            track: { title: t.title, artists: t.artists, uri: t.uri },
          }),
          now,
        ],
      );
      const reply: Reply = {
        kind: 'viewer_skip',
        activity_id: id,
        price: pricing.price,
        viewer: e.viewer,
      };
      await q.query(
        `insert into spotify_jobs (job_id, channel_id, kind, request_id, payload, status, reply, created_at, updated_at)
         values ($1, $2, 'skip', $3, $4, 'queued', $5, $6, $6)`,
        [
          jobId,
          e.channel_id,
          request?.request_id ?? null,
          JSON.stringify({ ref: `viewer-skip:${id}`, expect_uri: t.uri }),
          JSON.stringify(reply),
          now,
        ],
      );
      return {
        row: (
          await q.query<SkipRow>(
            'select * from module_activity where activity_id = $1',
            [id],
          )
        )[0]!,
        duplicate: false,
      };
    });
    return { duplicate: out.duplicate, skip: skipView(out.row, false) };
  }

  /** Studio's report (or the expiry) of a paid skip: proven → done; anything else → given back once. */
  private async settleViewerSkip(
    q: Queryable,
    channelId: string,
    reply: Extract<Reply, { kind: 'viewer_skip' }>,
    r: Extract<SpotifyJobReport, { kind: 'skip' }>,
  ) {
    const row = (
      await q.query<SkipRow>(
        `select * from module_activity where activity_id = $1 and channel_id = $2 for update`,
        [reply.activity_id, channelId],
      )
    )[0];
    if (!row || row.status !== 'queued') return;
    const now = this.clock.now();
    if (r.outcome === 'skipped') {
      await q.query(
        `update module_activity set status = 'done', result = $2, updated_at = $3 where activity_id = $1`,
        [
          row.activity_id,
          JSON.stringify({ outcome: 'skipped', at: now.toISOString() }),
          now,
        ],
      );
      await this.say(
        q,
        channelId,
        `spotify:vskip:${row.activity_id}`,
        MSG.viewerSkipped(
          reply.viewer.name,
          reply.price,
          r.skipped_track ?? row.input.track,
        ),
      );
      return;
    }
    // Never charged for a skip nobody can prove: Spotify refused, the track changed first, Studio lost it or never took
    // it. Studio's own reading (or its silence) decides, never Windows' (SMTC) alone.
    const reason =
      r.outcome === 'unknown'
        ? 'SKIP_RESULT_UNKNOWN'
        : (r.reason ?? 'SPOTIFY_UNAVAILABLE');
    if (this.economy)
      await this.economy.refund(
        q,
        now,
        row.activity_id,
        'system',
        'skip payant non effectué',
      );
    await q.query(
      `update module_activity set status = 'refunded', result = $2, reason = $3, ended_by = 'system', updated_at = $4
        where activity_id = $1`,
      [
        row.activity_id,
        JSON.stringify({ outcome: r.outcome, reason, at: now.toISOString() }),
        reason,
        now,
      ],
    );
  }

  /** The extension follows its paid skip (its own only), and the price after it. */
  async viewerSkipResult(channelId: string, viewerId: string, id: string) {
    const row = (
      await this.db.query<SkipRow>(
        `select * from module_activity where channel_id = $1 and module_id = $2 and activity_id = $3 and viewer_id = $4`,
        [channelId, SKIP_MODULE, id, viewerId],
      )
    )[0];
    if (!row) throw new SpotifyError(404, 'skip_not_found');
    return {
      skip: skipView(row, false),
      price: (await skipPrice(this.db, channelId, this.clock.now())).price,
    };
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
    // « File musicale »: each requester of the queue with their limit, pending count, cooldown left, exception.
    const requesters = new Map<string, { id: string; login: string }>();
    for (const r of rows)
      if (
        isQueuedLike(r) ||
        r.state === 'PLAYING' ||
        r.state === 'RECEIVED' ||
        r.state === 'SEARCHING' ||
        isUncertainAddition(r)
      )
        requesters.set(r.viewer_id, { id: r.viewer_id, login: r.viewer_login });
    const viewers = [];
    for (const v of requesters.values())
      viewers.push({
        viewer_id: v.id,
        login: v.login,
        ...(await this.usage(this.db, channelId, v, settings, null)),
      });
    const today = (
      await this.db.query<Record<string, string>>(
        `select count(*) as received,
           count(*) filter (where state in ('PLAYED', 'SKIPPED', 'PLAYING')) as played,
           count(*) filter (where state in ('FAILED', 'AMBIGUOUS', 'TOO_LONG', 'VIEWER_LIMIT', 'VIEWER_COOLDOWN')) as refused,
           count(*) filter (where state = 'CANCELED') as canceled,
           count(*) filter (where state = 'REMOVED_BY_MOD') as removed,
           count(*) filter (where twitch_status = 'cancel_requested' or refund_status = 'refunded') as refunded
         from spotify_requests where channel_id = $1
           and received_at >= (date_trunc('day', $2::timestamptz at time zone 'Europe/Paris') at time zone 'Europe/Paris')`,
        [channelId, this.clock.now()],
      )
    )[0]!;
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
      // Music Hub: the live track as Core holds it (Studio's SMTC messages), extrapolated to now.
      live_core: await this.music.view(this.db, channelId),
      music_session: await this.music.session(this.db, channelId),
      overrides: await this.overrides(channelId),
      viewers,
      today: Object.fromEntries(
        Object.entries(today).map(([k, v]) => [k, Number(v)]),
      ),
      twitch_actions: actions,
      managed_rewards: managed,
      // Music Hub: the paid skip (price now, window, recent decisions) and the Open Bar.
      music_rules: await this.musicRulesView(this.db, channelId, true),
    };
  }

  // ---------------------------------------------------------------- Music Hub (docs/music/MUSIC_HUB_STATE.md)
  // The extension's entry into THIS module: the same requests, the same logical queue, the same limits, the same Studio
  // jobs and the same chat commands as the reward. Only the payment differs: Jetons, debited here in the request's own
  // transaction and given back by refundPayment (once). The catalogue is read by Studio (search jobs): the Lab's
  // simulator, or the connected provider — Core never calls a music service.

  /** Why the extension cannot ask now (null: it can). */
  private extensionClosed(settings: SettingsRow, st: StudioRow | null) {
    if (!this.economy) return 'extension_disabled';
    if (!settings.extension_enabled) return 'extension_disabled';
    if (!settings.enabled) return 'requests_closed';
    const reason = this.studioRefusal(st);
    return reason ? reason.toLowerCase() : null;
  }

  /** A team action: the moderation permission of the Core (lab-moderation PERMISSIONS), never the button alone. */
  private async allow(
    q: Queryable,
    channelId: string,
    actor: MusicActor,
    permission: string,
  ) {
    try {
      await assertAllowed(q, channelId, actor, permission);
    } catch (e) {
      if (e instanceof LabForbiddenError)
        throw new SpotifyError(403, 'forbidden', { permission });
      throw e;
    }
  }

  /** The Hub card (every session read): offered at all, open, why not, how many songs wait — a few rows only. */
  async extensionSummary(channelId: string) {
    const s = (
      await this.db.query<SettingsRow>(
        'select * from spotify_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    if (!s?.extension_enabled || !this.economy) return { offered: false };
    const st = await this.studio(this.db, channelId);
    const openBar = (await loadRules(this.db, channelId)).open_bar.on;
    return {
      offered: true,
      open: s.enabled,
      admission: this.extensionClosed(s, st) ?? 'ready',
      queue_count: this.future(await this.live(this.db, channelId)).length,
      price_tokens: openBar ? 0 : s.extension_price_tokens,
      open_bar: openBar,
    };
  }

  /** A search for the extension: the same words searched recently are reused, else one job for Studio. */
  async extensionSearch(channelId: string, viewerId: string, query: string) {
    // A Spotify track link / URI → that exact track (reference.ts, the reward's rules); another kind of link → refused.
    const ref = /^(?:spotify:|https?:\/\/|www\.|open\.spotify\.com\/)/i.test(
      query.trim(),
    )
      ? parseTrackReference(query)
      : null;
    if (ref?.kind === 'invalid')
      throw new SpotifyError(400, 'invalid_reference');
    const trackId = ref?.kind === 'exact' ? ref.trackId : null;
    const text = trackId
      ? `track:${trackId}`
      : query.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 200);
    if (text.length < SPOTIFY_RULES.searchMinChars)
      throw new SpotifyError(400, 'query_too_short');
    const id = await this.db.tx(async (q) => {
      const settings = await this.lock(q, channelId);
      const closed = this.extensionClosed(
        settings,
        await this.studio(q, channelId),
      );
      if (closed) throw new SpotifyError(409, closed);
      const now = this.clock.now();
      const reuse = (
        await q.query<{ job_id: string }>(
          `select job_id from spotify_jobs where channel_id = $1 and kind = 'search' and payload->>'query' = $2
             and status in ('queued', 'running', 'done') and created_at > $3 order by created_at desc limit 1`,
          [
            channelId,
            text,
            new Date(now.getTime() - SPOTIFY_RULES.searchReuseMs),
          ],
        )
      )[0];
      if (reuse) return reuse.job_id;
      const recent = Number(
        (
          await q.query<{ n: string }>(
            `select count(*) as n from spotify_jobs where channel_id = $1 and kind = 'search'
               and payload->>'viewer' = $2 and created_at > $3`,
            [channelId, viewerId, new Date(now.getTime() - 60_000)],
          )
        )[0]!.n,
      );
      if (recent >= SPOTIFY_RULES.searchesPerViewerPerMinute)
        throw new SpotifyError(429, 'search_rate_limited');
      // The whole channel: new catalogue searches per minute (reused texts above are free). Beyond: « réessaie ».
      const channelRecent = Number(
        (
          await q.query<{ n: string }>(
            `select count(*) as n from spotify_jobs where channel_id = $1 and kind = 'search' and created_at > $2
               and status <> 'expired'`,
            [channelId, new Date(now.getTime() - 60_000)],
          )
        )[0]!.n,
      );
      if (channelRecent >= SPOTIFY_RULES.searchesPerChannelPerMinute)
        throw new SpotifyError(429, 'search_busy');
      // A newer search of this viewer replaces their previous one still waiting for Studio (typing on): one call, not
      // one per pause in the typing.
      await q.query(
        `update spotify_jobs set status = 'expired', updated_at = $3 where channel_id = $1 and kind = 'search'
           and status = 'queued' and payload->>'viewer' = $2`,
        [channelId, viewerId, now],
      );
      const jobId = randomUUID();
      await q.query(
        `insert into spotify_jobs (job_id, channel_id, kind, payload, status, created_at, updated_at)
         values ($1, $2, 'search', $3, 'queued', $4, $4)`,
        [
          jobId,
          channelId,
          JSON.stringify({
            query: text,
            viewer: viewerId,
            ...(trackId ? { track_id: trackId } : {}),
          }),
          now,
        ],
      );
      return jobId;
    });
    return this.searchResult(channelId, id);
  }

  /** Where a search stands: pending (Studio has it), done (its results), failed (Studio absent, catalogue error). */
  async searchResult(channelId: string, searchId: string) {
    const job = (
      await this.db.query<JobRow>(
        `select * from spotify_jobs where channel_id = $1 and job_id = $2 and kind = 'search'`,
        [channelId, searchId],
      )
    )[0];
    if (!job) throw new SpotifyError(404, 'search_not_found');
    if (job.status === 'done') {
      const r = job.result as Extract<
        SpotifyJobReport,
        { kind: 'search' }
      > | null;
      if (!r || r.outcome !== 'done')
        return {
          status: 'failed' as const,
          search_id: searchId,
          reason: r?.reason ?? 'SPOTIFY_UNAVAILABLE',
        };
      const settings = await this.settings(channelId);
      return {
        status: 'done' as const,
        search_id: searchId,
        provider: r.provider,
        items: r.items.map((i) => ({
          ...i,
          too_long: i.duration_ms > settings.max_duration_seconds * 1000,
        })),
      };
    }
    const age = this.clock.now().getTime() - ms(job.created_at);
    if (
      job.status === 'expired' ||
      (job.status === 'queued' && age > SPOTIFY_RULES.searchTimeoutMs)
    )
      return {
        status: 'failed' as const,
        search_id: searchId,
        reason: 'STUDIO_UNAVAILABLE',
      };
    return { status: 'pending' as const, search_id: searchId };
  }

  /** The catalogue item a viewer picked: it must come from a recent search of this channel (never an arbitrary id). */
  private async pickedItem(q: Queryable, channelId: string, trackId: string) {
    const rows = await q.query<{
      result: Extract<SpotifyJobReport, { kind: 'search' }>;
    }>(
      `select result from spotify_jobs where channel_id = $1 and kind = 'search' and status = 'done'
         and created_at > $2 and result->'items' @> $3::jsonb order by created_at desc limit 1`,
      [
        channelId,
        new Date(this.clock.now().getTime() - 3_600_000),
        JSON.stringify([{ id: trackId }]),
      ],
    );
    const r = rows[0]?.result;
    const item: SpotifySearchItem | undefined = r?.items.find(
      (i) => i.id === trackId,
    );
    return item && r ? { item, provider: r.provider } : null;
  }

  /**
   * A request from the extension, paid in Jetons. Every rule of the reward's admission (requests open, Studio able,
   * cooldown, pending limit, duration) plus the extension's own (its switch, its price — never another one than the
   * viewer saw —, a track already waiting). All in ONE transaction with the debit: refused = nothing debited, nothing
   * recorded; admitted = debited once and handed to Studio as the reward's requests are. The same key again (double
   * click, retry after a lost answer) returns the same request, never a second debit.
   */
  async extensionRequest(e: {
    channel_id: string;
    viewer: { id: string; login: string; name: string };
    track_id: string;
    key: string;
    expected_price: number | null;
  }) {
    if (!/^[A-Za-z0-9_:-]{8,128}$/.test(e.key))
      throw new SpotifyError(400, 'idempotency_key_required');
    if (!/^[A-Za-z0-9]{22}$/.test(e.track_id))
      throw new SpotifyError(400, 'invalid_track');
    const sourceRef = `extension:${e.viewer.id}:${e.key}`;
    const out = await this.db.tx(async (q) => {
      const settings = await this.lock(q, e.channel_id);
      const prior = (
        await q.query<RequestRow>(
          'select * from spotify_requests where channel_id = $1 and source_ref = $2',
          [e.channel_id, sourceRef],
        )
      )[0];
      if (prior) return { row: prior, duplicate: true };
      const closed = this.extensionClosed(
        settings,
        await this.studio(q, e.channel_id),
      );
      if (closed || !this.economy)
        throw new SpotifyError(409, closed ?? 'extension_disabled');
      // Music Hub Open Bar: free and no count per viewer while it is open — read here, under the lock, never from the
      // client (a page still showing « 0 » after the closing gets `price_changed`, nothing is debited).
      const openBar = (await loadRules(q, e.channel_id)).open_bar.on;
      const price = openBar ? 0 : settings.extension_price_tokens;
      if (e.expected_price !== null && e.expected_price !== price)
        throw new SpotifyError(409, 'price_changed', {
          price,
          open_bar: openBar,
        });
      const picked = await this.pickedItem(q, e.channel_id, e.track_id);
      if (!picked) throw new SpotifyError(409, 'track_unknown');
      if (!picked.item.playable) throw new SpotifyError(409, 'not_playable');
      if (picked.item.duration_ms > settings.max_duration_seconds * 1000)
        throw new SpotifyError(409, 'too_long', {
          max_duration_seconds: settings.max_duration_seconds,
        });
      const use = await this.usage(
        q,
        e.channel_id,
        e.viewer,
        settings,
        null,
        openBar,
      );
      if (use.cooldown_left_ms > 0)
        throw new SpotifyError(409, 'viewer_cooldown', {
          cooldown_left_ms: use.cooldown_left_ms,
          open_bar: openBar,
        });
      if (!openBar && use.pending >= use.max_pending)
        throw new SpotifyError(409, 'viewer_limit', {
          max_pending: use.max_pending,
        });
      if (openBar) {
        const rows = await this.live(q, e.channel_id);
        const waiting =
          this.future(rows).length +
          rows.filter((r) => r.state === 'RECEIVED' || r.state === 'SEARCHING')
            .length;
        if (waiting >= MUSIC_RULES.openBarMaxQueue)
          throw new SpotifyError(409, 'queue_full', {
            max_queue: MUSIC_RULES.openBarMaxQueue,
          });
      }
      if (settings.no_duplicates) {
        const waiting = (await this.live(q, e.channel_id)).some(
          (r) =>
            (isQueuedLike(r) ||
              r.state === 'RECEIVED' ||
              r.state === 'SEARCHING' ||
              r.state === 'PLAYING') &&
            (r.track?.id === e.track_id ||
              r.raw_input === `spotify:track:${e.track_id}`),
        );
        if (waiting) throw new SpotifyError(409, 'duplicate_track');
      }
      const id = randomUUID();
      const now = this.clock.now();
      if (price > 0) {
        try {
          await this.economy.debit(q, now, {
            channelId: e.channel_id,
            viewer: { id: e.viewer.id, display_name: e.viewer.name },
            currency: 'tokens',
            amount: price,
            module: 'music',
            interactionId: id,
          });
        } catch (err) {
          if (err instanceof LabWalletError)
            throw new SpotifyError(409, err.code, { price, ...err.details });
          throw err;
        }
      }
      await q.query(
        `insert into spotify_requests (request_id, channel_id, source, source_ref, reward_id, redemption_id, viewer_id,
           viewer_login, viewer_name, raw_input, mode, state, max_duration_ms, received_at, updated_at, payment,
           price_tokens, display)
         values ($1, $2, 'extension', $3, null, null, $4, $5, $6, $7, 'exact', 'RECEIVED', $8, $9, $9, 'tokens', $10, $11)`,
        [
          id,
          e.channel_id,
          sourceRef,
          e.viewer.id,
          e.viewer.login,
          e.viewer.name,
          `spotify:track:${e.track_id}`,
          settings.max_duration_seconds * 1000,
          now,
          price,
          JSON.stringify({
            album: picked.item.album,
            image_url: picked.item.image_url,
            provider: picked.provider,
            ...(openBar ? { open_bar: true } : {}),
          }),
        ],
      );
      await q.query(
        `insert into spotify_jobs (job_id, channel_id, kind, request_id, payload, status, created_at, updated_at)
         values ($1, $2, 'song_request', $3, $4, 'queued', $5, $5)`,
        [
          randomUUID(),
          e.channel_id,
          id,
          JSON.stringify({
            reference: { kind: 'exact', track_id: e.track_id },
            max_duration_ms: settings.max_duration_seconds * 1000,
          }),
          now,
        ],
      );
      return { row: (await this.request(q, id))!, duplicate: false };
    });
    return { duplicate: out.duplicate, request: requestView(out.row) };
  }

  /**
   * The viewer withdraws ONE of their requests from the extension: the rules of `!songcancel` (a future request, or
   * the one playing within its first seconds), refunded once — Jetons or channel points, whatever paid it. Asked twice
   * (retry, two windows): the second finds nothing to cancel, nothing is refunded again.
   */
  async extensionCancel(
    channelId: string,
    viewer: { id: string; name: string },
    requestId: string,
  ) {
    const outcome = await this.cancel(
      channelId,
      `ext-cancel:${requestId}`,
      viewer,
      undefined,
      { request_id: requestId, silent: true },
    );
    const row = await this.request(this.db, requestId);
    return {
      outcome,
      request: row && row.viewer_id === viewer.id ? requestView(row) : null,
    };
  }

  /**
   * The team's actions from the extension, each behind its permission (Core decides, never the button):
   * remove with / without refund (queue.cancel, + refund), skip (queue.stop), pause / resume / volume (module.pause,
   * and Studio's « Commandes du lecteur » switch), open / close the requests (module.disable).
   */
  async extensionModerate(
    channelId: string,
    actor: MusicActor,
    a:
      | { action: 'remove'; request_id: string; refund: boolean }
      | { action: 'skip' }
      | { action: 'pause' }
      | { action: 'resume' }
      | { action: 'volume'; volume_percent: number }
      | { action: 'seek'; position_ms: number }
      | { action: 'open' }
      | { action: 'close' },
    key: string,
  ) {
    const name = actor.display_name ?? actor.login ?? actor.id;
    if (a.action === 'remove') {
      await this.allow(this.db, channelId, actor, 'queue.cancel');
      if (a.refund) await this.allow(this.db, channelId, actor, 'refund');
      const outcome = await this.remove(
        channelId,
        `spotify:ext:${key}`,
        { request_id: a.request_id },
        name,
        { refund: a.refund, silent: true },
      );
      const row = await this.request(this.db, a.request_id);
      return { outcome, request: row ? requestView(row) : null };
    }
    if (a.action === 'skip') {
      // Music Hub V2: the stream's player is the supermods' (and the broadcaster's) from the extension.
      await this.allow(this.db, channelId, actor, 'music.player');
      const ref = `spotify:ext:${key}`;
      const outcome = await this.skip(channelId, ref, name);
      const job = (
        await this.db.query<{ job_id: string }>(
          `select job_id from spotify_jobs where channel_id = $1 and kind = 'skip' and payload->>'ref' = $2`,
          [channelId, ref],
        )
      )[0];
      // A job → the extension follows Studio's answer (never an assumed success); none → refused (reason in outcome).
      return { outcome, job_id: job?.job_id ?? null };
    }
    if (a.action === 'open' || a.action === 'close') {
      await this.allow(this.db, channelId, actor, 'module.disable');
      return {
        outcome: a.action,
        settings: await this.saveSettings(
          channelId,
          { enabled: a.action === 'open' },
          `ext:${name}`,
        ),
      };
    }
    await this.allow(this.db, channelId, actor, 'music.player');
    return this.control(
      channelId,
      a.action,
      a.action === 'volume' ? a.volume_percent : null,
      name,
      a.action === 'seek' ? a.position_ms : null,
    );
  }

  /**
   * A player control (pause / resume / volume / seek): a job for Studio, only with « Commandes du lecteur » on. A seek
   * moves inside THE track playing (its exact uri, checked again by Studio before it sends): never in its first seconds
   * (a restart would be a new play) nor its last (a disguised skip) — a seek is never a new track nor a skip.
   */
  async control(
    channelId: string,
    action: 'pause' | 'resume' | 'volume' | 'seek',
    volume: number | null,
    actor: string,
    position: number | null = null,
  ) {
    return this.db.tx(async (q) => {
      const settings = await this.lock(q, channelId);
      if (!settings.player_controls)
        throw new SpotifyError(409, 'player_controls_disabled');
      const st = await this.studio(q, channelId);
      const reason = this.writeRefusal(st);
      if (reason) throw new SpotifyError(409, reason.toLowerCase());
      let seek: { position_ms: number; expect_uri: string } | null = null;
      if (action === 'seek') {
        // Same as the paid skip: an older Studio would not check the track before seeking.
        if (!st?.status.targeted_skip)
          throw new SpotifyError(409, 'studio_outdated');
        const t = await this.playingNow(q, channelId, st);
        if (!t) throw new SpotifyError(409, 'nothing_playing');
        if (!t.uri || !t.duration_ms)
          throw new SpotifyError(409, 'track_not_identified');
        const max = t.duration_ms - MUSIC_RULES.seekEndMarginMs;
        if (max < MUSIC_RULES.seekMinMs)
          throw new SpotifyError(409, 'track_too_short');
        seek = {
          position_ms: Math.round(
            Math.min(max, Math.max(MUSIC_RULES.seekMinMs, position ?? 0)),
          ),
          expect_uri: t.uri,
        };
      }
      const jobId = randomUUID();
      const now = this.clock.now();
      await q.query(
        `insert into spotify_jobs (job_id, channel_id, kind, payload, status, created_at, updated_at)
         values ($1, $2, 'control', $3, 'queued', $4, $4)`,
        [
          jobId,
          channelId,
          JSON.stringify({
            action,
            volume_percent: action === 'volume' ? volume : null,
            actor: actor.slice(0, 64),
            ...(seek ?? {}),
          }),
          now,
        ],
      );
      return {
        outcome: 'requested',
        job_id: jobId,
        ...(seek ? { position_ms: seek.position_ms } : {}),
      };
    });
  }

  /** The skip / control job a command created (by its key), to follow Studio's answer; null when none was created. */
  async jobOf(channelId: string, ref: string) {
    return (
      (
        await this.db.query<{ job_id: string }>(
          `select job_id from spotify_jobs where channel_id = $1 and payload->>'ref' = $2`,
          [channelId, ref],
        )
      )[0]?.job_id ?? null
    );
  }

  /** A control's result (the extension and Studio show what really happened, never an assumed success). */
  async controlResult(channelId: string, jobId: string) {
    const job = (
      await this.db.query<JobRow>(
        `select * from spotify_jobs where channel_id = $1 and job_id = $2 and kind in ('control', 'skip')`,
        [channelId, jobId],
      )
    )[0];
    if (!job) throw new SpotifyError(404, 'job_not_found');
    const r = job.result as { outcome?: string; reason?: string } | null;
    return {
      status:
        job.status === 'done'
          ? r?.outcome === 'skipped'
            ? 'done'
            : (r?.outcome ?? 'unknown')
          : job.status === 'expired'
            ? 'failed'
            : 'pending',
      reason: r?.reason ?? (job.status === 'expired' ? 'STUDIO_LOST' : null),
    };
  }

  /**
   * What the extension shows: the module's state for everyone (open, price, rules, the player, what plays — a request
   * of the queue or the broadcaster's own music —, the queue with an estimated wait), the viewer's own side (usage,
   * balance, requests and whether each can still be withdrawn), and for the team the requesters and payments. Never a
   * guess: no fresh reading of Studio → the player is « indisponible » and nothing is said to play.
   */
  /**
   * Music Hub — « Musiques de la soirée »: the stream's music history (live-music.ts) — every track that really played
   * during a live (the broadcaster's, a playlist's, a request's, from Windows via Studio) and the requests Core saw play,
   * newest first, 20 per page (`before` = the previous page's last `at`). A requester only through Core's exact
   * attribution, never a title.
   */
  async extensionHistory(
    channelId: string,
    viewerId: string | null,
    before: string | null,
    limit = 20,
  ) {
    return this.music.history(this.db, channelId, {
      before,
      limit,
      viewerId,
      team: false,
    });
  }

  /** The extension's « en cours » from the live track (display), with the request only on Core's exact attribution. */
  private liveNowPlaying(
    live: NonNullable<Awaited<ReturnType<LiveMusic['view']>>>,
    current: RequestRow | null,
    viewer: { id: string } | null,
  ) {
    if (!live.track) return null;
    const req =
      current && live.uri && current.track?.uri === live.uri ? current : null;
    return {
      kind: req ? ('request' as const) : ('broadcaster' as const),
      title: live.track.title,
      artists: live.track.artists,
      duration_ms: live.track.duration_ms,
      progress_ms: live.position_ms,
      is_playing: live.is_playing,
      requested_by: req?.viewer_name ?? null,
      request_id: req?.request_id ?? null,
      own: !!req && !!viewer && req.viewer_id === viewer.id,
      album: live.track.album ?? req?.display?.album ?? null,
      image_url: live.cover_url ?? req?.display?.image_url ?? null,
      // A display estimate (Windows' last position + the clock): stale when Windows stopped telling.
      stale: live.state === 'stale',
      // The occurrence (a replay of the same track is another one): the extension's « new track » cue.
      occurrence: live.gen,
      source: 'live' as const,
    };
  }

  async extensionState(
    channelId: string,
    viewer: { id: string; login: string } | null,
    team: boolean,
    role: 'viewer' | 'moderator' | 'broadcaster' = team
      ? 'moderator'
      : 'viewer',
  ) {
    // What this caller may do (Core's grades: lab-moderation access — a supermod is a moderator the broadcaster named).
    const acc =
      viewer && team
        ? await access(this.db, channelId, {
            id: viewer.id,
            role,
            via: 'extension',
          })
        : null;
    const can = {
      moderate: !!acc && allowed(acc, 'queue.cancel'),
      refund: !!acc && allowed(acc, 'refund'),
      player: !!acc && allowed(acc, 'music.player'),
      open_close: !!acc && allowed(acc, 'module.disable'),
    };
    const settings = (
      await this.db.query<SettingsRow>(
        'select * from spotify_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    const view = this.settingsView(settings);
    const st = await this.studio(this.db, channelId);
    const now = this.clock.now().getTime();
    const fresh = !!st && now - ms(st.seen_at) <= SPOTIFY_RULES.studioFreshMs;
    const music = await this.musicRulesView(this.db, channelId, false);
    const openBar = music.open_bar.on;
    const rows = await this.live(this.db, channelId);
    const entries = this.future(rows);
    const current =
      rows.find(
        (r) => r.request_id === st?.current_request_id && r.state === 'PLAYING',
      ) ?? null;
    const pb = fresh ? st!.playback : null;
    const progress = fresh ? this.progressNow(st) : null;
    const nowTrack = pb?.track ?? null;
    // Music Hub: what Windows says plays (SMTC via Studio) is the DISPLAY when fresh — the requests' timing (waits,
    // grace) stays on the Web API's reading above. The requester only when this occurrence's exact track (Studio's
    // Web API reading) is the one Core attributes to the request playing.
    const live = await this.music.view(this.db, channelId);
    let wait =
      nowTrack && progress !== null
        ? Math.max(0, nowTrack.duration_ms - progress)
        : null;
    const graceOk =
      progress !== null && progress <= view.cancel_grace_seconds * 1000;
    const entry = (r: RequestRow, position: number | null) => {
      const eta = wait;
      if (wait !== null && r.track) wait += r.track.duration_ms;
      return {
        request_id: r.request_id,
        position,
        track_id: r.track?.id ?? r.raw_input.replace(/^spotify:track:/, ''),
        title: r.track?.title ?? null,
        artists: r.track?.artists ?? [],
        duration_ms: r.track?.duration_ms ?? null,
        album: r.display?.album ?? null,
        image_url: r.display?.image_url ?? null,
        requested_by: r.viewer_name,
        own: !!viewer && r.viewer_id === viewer.id,
        state: r.state,
        eta_ms: position === null ? null : eta,
        source: r.source === 'extension' ? 'extension' : 'reward',
        ...(team
          ? {
              viewer_id: r.viewer_id,
              viewer_login: r.viewer_login,
              payment: r.payment ?? 'channel_points',
              price_tokens: r.price_tokens ?? null,
            }
          : {}),
      };
    };
    const queue = entries.map((r, i) => entry(r, i + 1));
    const pending = rows
      .filter((r) => r.state === 'RECEIVED' || r.state === 'SEARCHING')
      .filter((r) => team || r.viewer_id === viewer?.id)
      .map((r) => entry(r, null));
    let me = null;
    if (viewer) {
      const own = this.ownRequests(rows, st, viewer.id);
      const usage = await this.usage(
        this.db,
        channelId,
        viewer,
        settings ?? {
          max_pending_per_viewer: view.max_pending_per_viewer,
          viewer_cooldown_seconds: view.viewer_cooldown_seconds,
        },
        null,
        openBar,
      );
      const lastSkip = (
        await this.db.query<SkipRow>(
          `select * from module_activity where channel_id = $1 and module_id = $2 and viewer_id = $3
             and created_at > $4 order by created_at desc limit 1`,
          [channelId, SKIP_MODULE, viewer.id, new Date(now - 30 * 60_000)],
        )
      )[0];
      me = {
        pending: usage.pending,
        max_pending: usage.max_pending,
        /** Open Bar: no count per viewer (the count stays shown, never blocking). */
        unlimited: usage.unlimited,
        cooldown_left_ms: usage.cooldown_left_ms,
        /** The viewer's last paid skip (30 min): its outcome, told once by the extension. */
        last_skip: lastSkip ? skipView(lastSkip, false) : null,
        balance: this.economy
          ? (await this.economy.balances(this.db, channelId, viewer.id)).tokens
          : null,
        requests: [
          ...own,
          // Music Hub V2: still being added — withdrawable too (refunded at once, skipped if Spotify takes it).
          ...rows.filter(
            (r) =>
              (r.state === 'RECEIVED' || r.state === 'SEARCHING') &&
              r.viewer_id === viewer.id,
          ),
        ].map((r) => ({
          request_id: r.request_id,
          state: r.state,
          title: r.track?.title ?? null,
          artists: r.track?.artists ?? [],
          image_url: r.display?.image_url ?? null,
          cancellable: r.state !== 'PLAYING' || graceOk,
          payment: r.payment ?? 'channel_points',
        })),
        // The viewer's last requests that left the queue (withdrawn, removed, played, refused), with their refund.
        history: (
          await this.db.query<RequestRow>(
            `select * from spotify_requests where channel_id = $1 and viewer_id = $2 and received_at > $3
               and state not in ('RECEIVED', 'SEARCHING', 'QUEUED', 'PLAYING')
             order by coalesce(ended_at, received_at) desc limit 5`,
            [channelId, viewer.id, this.recentCut()],
          )
        ).map((r) => ({
          request_id: r.request_id,
          state: r.state,
          title: r.track?.title ?? null,
          artists: r.track?.artists ?? [],
          payment: r.payment ?? 'channel_points',
          refunded:
            r.payment === 'tokens'
              ? r.refund_status === 'refunded'
              : r.twitch_status === 'cancel_requested',
          // Music Hub final: when it left the queue and why (the extension tells it once, « pendant ton absence »).
          ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
          reason: r.reason,
        })),
      };
    }
    const recent = (
      await this.db.query<RequestRow>(
        `select * from spotify_requests where channel_id = $1 and state in ('PLAYED', 'SKIPPED')
           and received_at > $2 order by ended_at desc nulls last limit 5`,
        [channelId, this.recentCut()],
      )
    ).map((r) => ({
      title: r.track?.title ?? null,
      artists: r.track?.artists ?? [],
      requested_by: r.viewer_name,
      image_url: r.display?.image_url ?? null,
    }));
    const closed = this.extensionClosed(
      settings ?? (this.settingsView(undefined) as unknown as SettingsRow),
      st,
    );
    // The paid skip as the viewer may use it now (Core refuses anyway when it is not; this only explains why).
    const protectedNow =
      !!current &&
      music.viewer_skip.protect_requests &&
      !!live?.uri &&
      current.track?.uri === live.uri;
    return {
      admission: closed ?? 'ready',
      open: view.enabled,
      extension_enabled: view.extension_enabled && !!this.economy,
      price_tokens: openBar ? 0 : view.extension_price_tokens,
      /** Music Hub Open Bar: requests free, no count per viewer (a short frequency limit, a global queue cap). */
      open_bar: openBar
        ? {
            since: music.open_bar.since,
            cooldown_seconds: music.open_bar.cooldown_seconds,
            max_queue: music.open_bar.max_queue,
          }
        : null,
      viewer_skip:
        music.viewer_skip.enabled && view.extension_enabled && !!this.economy
          ? {
              price: music.viewer_skip.price,
              base_price: music.viewer_skip.base_price,
              window_minutes: music.viewer_skip.window_minutes,
              resets_at: music.viewer_skip.resets_at,
              busy: music.viewer_skip.busy,
              /** Why it cannot be used now (null: it can): Core decides again at the purchase. */
              blocked: !fresh
                ? 'studio_unavailable'
                : (this.writeRefusal(st)?.toLowerCase() ??
                  (protectedNow ? 'protected_request' : null)),
            }
          : null,
      rules: {
        max_pending_per_viewer: view.max_pending_per_viewer,
        viewer_cooldown_seconds: view.viewer_cooldown_seconds,
        max_duration_seconds: view.max_duration_seconds,
        cancel_grace_seconds: view.cancel_grace_seconds,
        no_duplicates: view.no_duplicates,
      },
      player: {
        connected: fresh && st!.status.auth === 'ok',
        reason: fresh ? (this.studioRefusal(st) ?? null) : 'STUDIO_UNAVAILABLE',
        /** Lab on the real account, read-only this session: the controls are shown disabled, with this reason. */
        read_only: fresh && !!st!.status.read_only,
        device: fresh ? (st!.status.device?.name ?? null) : null,
        controls: view.player_controls,
        is_playing: pb?.is_playing ?? null,
        volume_percent: pb?.volume_percent ?? null,
      },
      // Windows names no track (probe missing, Spotify closed, another device): the Web API's reading, as before.
      now_playing: live?.track
        ? this.liveNowPlaying(live, current, viewer)
        : nowTrack
          ? {
              kind: current ? ('request' as const) : ('broadcaster' as const),
              title: nowTrack.title,
              artists: nowTrack.artists,
              duration_ms: nowTrack.duration_ms,
              progress_ms: progress,
              is_playing: pb!.is_playing,
              requested_by: current?.viewer_name ?? null,
              request_id: current?.request_id ?? null,
              own: !!current && !!viewer && current.viewer_id === viewer.id,
              album: current?.display?.album ?? null,
              image_url: current?.display?.image_url ?? null,
              stale: false,
              source: 'api' as const,
            }
          : null,
      queue,
      pending,
      me,
      recent,
      team,
      can,
    };
  }
}
