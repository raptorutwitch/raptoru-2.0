import {
  PRESENCE_INTERVAL_SECONDS,
  type Chatter,
  type PresenceLeaseRequest,
  type PresenceLeaseResponse,
  type PresenceObservationRequest,
  type PresenceObservationResponse,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { activeSession } from '../stream/stream-sessions.js';
import {
  buildPresenceReport,
  latestPresenceStreamId,
  type PresenceReport,
} from './presence-report.js';

// Presence tracker V1, shadow mode: estimated watch time only. Never touches credits or wallets.
//
// Rule: a viewer earns the interval between two snapshots only if they appear in both, the two
// snapshots are consecutive successful cycles of the same worker, and they are at most
// MAX_CREDITED_GAP_SECONDS apart. Errors, restarts and long gaps are never turned into watch time.

/** Single-channel platform: one lease row. */
export const PRESENCE_CHANNEL = 'default';
export const LEASE_TTL_MS = (PRESENCE_INTERVAL_SECONDS + 60) * 1000;
export const MAX_CREDITED_GAP_SECONDS = PRESENCE_INTERVAL_SECONDS * 1.5;
/**
 * An interval is credited only if Twitch confirmed the live recently at both ends (EventSub or the
 * bot's Helix check). Chat stays readable after a stream ends: without this bound, a missed
 * stream.offline plus a Helix outage would keep crediting presence after the real offline.
 * The bot confirms every minute except during the 5-minute EventSub trust window.
 */
export const MAX_LIVE_STATE_AGE_SECONDS = 10 * 60;

const liveConfirmed = (ageSeconds: number | null) =>
  ageSeconds !== null && ageSeconds <= MAX_LIVE_STATE_AGE_SECONDS;

type GapReason = NonNullable<PresenceObservationResponse['gapReason']>;

interface CycleRow {
  id: number;
  worker_id: string;
  live_state_age_s: number | null;
  observed_at: Date;
  status: 'ok' | 'error';
  credited_seconds: number;
  credited_viewers: number;
  gap_reason: GapReason | null;
}

const rejected = (
  rejection: NonNullable<PresenceObservationResponse['rejection']>,
): PresenceObservationResponse => ({
  accepted: false,
  rejection,
  creditedSeconds: 0,
  creditedViewers: 0,
  gapReason: null,
});

/** Validated presence interval: these viewers were present in two consecutive snapshots. */
export interface ValidatedPresence {
  streamId: string;
  seconds: number;
  viewerIds: string[];
  at: Date;
}

/**
 * Optional consumer of validated intervals (the Loyalty Engine). `validated` runs inside the cycle
 * transaction (exactly-once with the cycle); `committed` runs after it. Presence never knows what
 * the consumer does with it.
 */
export interface PresenceListener {
  validated(q: Queryable, interval: ValidatedPresence): Promise<void>;
  committed?(): Promise<void>;
}

async function lockPresence(q: Queryable): Promise<void> {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', ['presence']);
}

export class PresenceService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly listener: PresenceListener | null = null,
  ) {}

  /** Grants or renews the channel lease unless another worker holds a non-expired one. */
  acquireLease({
    workerId,
  }: PresenceLeaseRequest): Promise<PresenceLeaseResponse> {
    return this.db.tx(async (q) => {
      await lockPresence(q);
      const now = this.clock.now();
      const current = (
        await q.query<{ worker_id: string; expires_at: Date }>(
          'select worker_id, expires_at from presence_lease where channel = $1',
          [PRESENCE_CHANNEL],
        )
      )[0];
      if (
        current &&
        current.worker_id !== workerId &&
        current.expires_at > now
      ) {
        return {
          granted: false,
          holder: current.worker_id,
          expiresAt: current.expires_at.toISOString(),
        };
      }
      const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);
      await q.query(
        `insert into presence_lease (channel, worker_id, expires_at) values ($1, $2, $3)
         on conflict (channel) do update set worker_id = excluded.worker_id, expires_at = excluded.expires_at`,
        [PRESENCE_CHANNEL, workerId, expiresAt],
      );
      return {
        granted: true,
        holder: workerId,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async record(
    obs: PresenceObservationRequest,
  ): Promise<PresenceObservationResponse> {
    const response = await this.recordCycle(obs);
    if (
      response.accepted &&
      response.creditedViewers > 0 &&
      this.listener?.committed
    ) {
      await this.listener.committed().catch((error: unknown) => {
        console.error('[presence] listener failed after commit', error);
      });
    }
    return response;
  }

  private recordCycle(
    obs: PresenceObservationRequest,
  ): Promise<PresenceObservationResponse> {
    return this.db.tx(async (q) => {
      await lockPresence(q);
      const now = this.clock.now();

      const replay = (
        await q.query<CycleRow>(
          'select * from presence_cycles where cycle_id = $1',
          [obs.cycleId],
        )
      )[0];
      if (replay) {
        return {
          accepted: true,
          rejection: null,
          creditedSeconds: replay.credited_seconds,
          creditedViewers: replay.credited_viewers,
          gapReason: replay.gap_reason,
        };
      }

      const lease = (
        await q.query<{ worker_id: string; expires_at: Date }>(
          'select worker_id, expires_at from presence_lease where channel = $1',
          [PRESENCE_CHANNEL],
        )
      )[0];
      if (
        !lease ||
        lease.worker_id !== obs.workerId ||
        lease.expires_at <= now
      ) {
        return rejected('lease_held');
      }
      const session = await activeSession(q);
      if (session?.streamId !== obs.streamId)
        return rejected('stream_not_live');

      const observedAt = new Date(obs.observedAt);
      const previous = (
        await q.query<CycleRow>(
          'select * from presence_cycles where stream_id = $1 order by observed_at desc, id desc limit 1',
          [obs.streamId],
        )
      )[0];
      if (previous && observedAt <= previous.observed_at)
        return rejected('out_of_order');

      await q.query(
        'update presence_lease set expires_at = $2 where channel = $1',
        [PRESENCE_CHANNEL, new Date(now.getTime() + LEASE_TTL_MS)],
      );

      const snap = obs.snapshot;
      const cycleId = (
        await q.query<{ id: number }>(
          `insert into presence_cycles (cycle_id, stream_id, worker_id, observed_at, received_at, duration_ms,
             live_state_age_s, status, error_kind, http_status, error_message, chatter_count, reported_total, pages)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
          [
            obs.cycleId,
            obs.streamId,
            obs.workerId,
            observedAt,
            now,
            obs.durationMs,
            obs.liveStateAgeSeconds,
            snap.status,
            snap.status === 'error' ? snap.errorKind : null,
            snap.status === 'error' ? snap.httpStatus : null,
            snap.status === 'error' ? snap.message : null,
            snap.status === 'ok' ? snap.chatters.length : null,
            snap.status === 'ok' ? snap.reportedTotal : null,
            snap.status === 'ok' ? snap.pages : null,
          ],
        )
      )[0]!.id;

      let gapReason: GapReason | null = null;
      let creditedSeconds = 0;
      let creditedViewers = 0;

      if (snap.status === 'error') {
        gapReason = 'snapshot_failed';
      } else {
        const gapSeconds = previous
          ? (observedAt.getTime() - previous.observed_at.getTime()) / 1000
          : 0;
        if (!previous) gapReason = 'first_snapshot';
        else if (
          !liveConfirmed(obs.liveStateAgeSeconds) ||
          !liveConfirmed(previous.live_state_age_s)
        )
          gapReason = 'live_unconfirmed';
        else if (previous.status !== 'ok') gapReason = 'previous_failed';
        else if (previous.worker_id !== obs.workerId)
          gapReason = 'worker_changed';
        else if (gapSeconds > MAX_CREDITED_GAP_SECONDS)
          gapReason = 'gap_too_long';
        else creditedSeconds = Math.round(gapSeconds);

        const chatters = uniqueChatters(snap.chatters);
        const credited = await this.applySnapshot(
          q,
          obs.streamId,
          cycleId,
          observedAt,
          chatters,
          creditedSeconds > 0 ? previous!.id : null,
          creditedSeconds,
        );
        creditedViewers = credited.length;
        if (credited.length && this.listener) {
          await this.listener.validated(q, {
            streamId: obs.streamId,
            seconds: creditedSeconds,
            viewerIds: credited,
            at: observedAt,
          });
        }
      }

      await q.query(
        'update presence_cycles set credited_seconds = $2, credited_viewers = $3, gap_reason = $4 where id = $1',
        [cycleId, creditedSeconds, creditedViewers, gapReason],
      );
      return {
        accepted: true,
        rejection: null,
        creditedSeconds,
        creditedViewers,
        gapReason,
      };
    });
  }

  /** Read-only report for a stream, or the latest observed one. */
  async report(streamId: string | 'latest'): Promise<PresenceReport | null> {
    const id =
      streamId === 'latest' ? await latestPresenceStreamId(this.db) : streamId;
    return id ? buildPresenceReport(this.db, id, this.clock.now()) : null;
  }

  /** Upserts viewers and their per-stream aggregate in two set-based statements. */
  private async applySnapshot(
    q: Queryable,
    streamId: string,
    cycleId: number,
    observedAt: Date,
    chatters: Chatter[],
    creditFromCycle: number | null,
    creditedSeconds: number,
  ): Promise<string[]> {
    if (chatters.length === 0) return [];
    const ids = chatters.map((c) => c.twitchUserId);
    await q.query(
      `insert into viewers (twitch_user_id, login, display_name)
       select * from unnest($1::text[], $2::text[], $3::text[])
       on conflict (twitch_user_id) do update set login = excluded.login,
         display_name = excluded.display_name, updated_at = now()`,
      [ids, chatters.map((c) => c.login), chatters.map((c) => c.displayName)],
    );
    // Present in the previous snapshot = its row still points at the previous cycle.
    const creditedViewers =
      creditFromCycle === null
        ? []
        : (
            await q.query<{ twitch_user_id: string }>(
              `select twitch_user_id from presence_viewer_streams
               where stream_id = $1 and last_seen_cycle = $2 and twitch_user_id = any($3::text[])`,
              [streamId, creditFromCycle, ids],
            )
          ).map((r) => r.twitch_user_id);
    await q.query(
      `insert into presence_viewer_streams as p (stream_id, twitch_user_id, snapshots_present,
         first_seen_at, last_seen_at, last_seen_cycle)
       select $1, id, 1, $2, $2, $3 from unnest($4::text[]) as id
       on conflict (stream_id, twitch_user_id) do update set
         estimated_watch_seconds = p.estimated_watch_seconds
           + case when p.last_seen_cycle = $5::bigint then $6::int else 0 end,
         intervals_credited = p.intervals_credited
           + case when p.last_seen_cycle = $5::bigint then 1 else 0 end,
         snapshots_present = p.snapshots_present + 1,
         last_seen_at = excluded.last_seen_at,
         last_seen_cycle = excluded.last_seen_cycle`,
      [streamId, observedAt, cycleId, ids, creditFromCycle, creditedSeconds],
    );
    return creditedViewers;
  }
}

function uniqueChatters(chatters: Chatter[]): Chatter[] {
  return [...new Map(chatters.map((c) => [c.twitchUserId, c])).values()];
}
