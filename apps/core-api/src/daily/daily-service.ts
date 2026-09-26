import type {
  DailyClaimHistoryItem,
  DailyClaimOutcome,
  DailyClaimRequest,
  DailyClaimResponse,
  DailyLeaderboard,
  DailyLeaderboardEntry,
  DailyStatus,
  DailyStreakResponse,
  Viewer,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { streamDayWindow } from '../stream/stream-day.js';
import { activeSession } from '../stream/stream-sessions.js';
import {
  dailyRewardBreakdown,
  loadDailyConfig,
  rewardForStreak,
} from './config.js';
import type { DailyCredits } from './credits.js';
import { dailyMessages } from './messages.js';
import { effectiveStreak, streakAfterClaim } from './streak.js';

interface StatsRow {
  total_daily: number;
  current_streak: number;
  best_streak: number;
  last_claim_day: string | null;
}

interface ClaimRow {
  id: number;
  twitch_user_id: string;
  stream_day: string;
  stream_id: string | null;
  reward: number;
  streak_after: number;
  total_after: number;
}

interface Decision {
  outcome: DailyClaimOutcome;
  replayed: boolean;
  reward: number;
  streakAfter: number;
  totalAfter: number;
}

interface DayContext {
  latestAiredDay: string | null;
  previousAiredDay: string | null;
  latestDayOpen: boolean;
  live: boolean;
  currentStreamDay: string | null;
}

const EMPTY_STATS: StatsRow = {
  total_daily: 0,
  current_streak: 0,
  best_streak: 0,
  last_claim_day: null,
};

async function readStats(
  q: Queryable,
  twitchUserId: string,
): Promise<StatsRow | null> {
  const rows = await q.query<StatsRow>(
    'select total_daily, current_streak, best_streak, last_claim_day from daily_stats where twitch_user_id = $1',
    [twitchUserId],
  );
  return rows[0] ?? null;
}

async function dayContext(q: Queryable, now: Date): Promise<DayContext> {
  const session = await activeSession(q);
  const days = await q.query<{ day: string }>(
    'select day from stream_days order by day desc limit 2',
  );
  const latestAiredDay = days[0]?.day ?? null;
  const latestDayOpen =
    latestAiredDay !== null &&
    (session?.streamDay === latestAiredDay ||
      now.getTime() < streamDayWindow(latestAiredDay).end.getTime());
  return {
    latestAiredDay,
    previousAiredDay: days[1]?.day ?? null,
    latestDayOpen,
    live: session !== null,
    currentStreamDay:
      session?.streamDay ?? (latestDayOpen ? latestAiredDay : null),
  };
}

export class DailyService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly credits: DailyCredits,
  ) {}

  async claim({
    viewer,
    requestId,
  }: DailyClaimRequest): Promise<DailyClaimResponse> {
    const now = this.clock.now();
    const decision = await this.db.tx((q) =>
      this.decideClaim(q, viewer, requestId, now),
    );

    if (decision.outcome === 'claimed' && !decision.replayed) {
      // Payment happens after the claim is committed; a failure here never undoes the claim.
      try {
        await this.credits.processPending();
      } catch (error) {
        console.error('[daily] credit processing failed', error);
      }
    }

    const name = viewer.displayName;
    const message =
      decision.outcome === 'claimed'
        ? dailyMessages.claimed(
            name,
            decision.reward,
            decision.streakAfter,
            decision.totalAfter,
          )
        : decision.outcome === 'already_claimed'
          ? dailyMessages.alreadyClaimed(name)
          : dailyMessages.noActiveStream();

    return {
      outcome: decision.outcome,
      replayed: decision.replayed,
      reward: decision.reward,
      status: await this.status(viewer.twitchUserId),
      message,
    };
  }

  private async decideClaim(
    q: Queryable,
    viewer: Viewer,
    requestId: string,
    now: Date,
  ): Promise<Decision> {
    // Serializes every claim of this viewer (retries, double messages, several Core requests).
    await q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `daily:${viewer.twitchUserId}`,
    ]);

    const attempt = {
      twitchUserId: viewer.twitchUserId,
      login: viewer.login,
      requestId,
      attemptedAt: now,
    };

    const replay = (
      await q.query<ClaimRow>(
        'select * from daily_claims where request_id = $1',
        [requestId],
      )
    )[0];
    if (replay) {
      if (replay.twitch_user_id !== viewer.twitchUserId) {
        throw new Error('request_id already used by another viewer');
      }
      await logAttempt(q, {
        ...attempt,
        outcome: 'replayed',
        streamId: replay.stream_id,
        streamDay: replay.stream_day,
        claimId: replay.id,
        reward: replay.reward,
      });
      return {
        outcome: 'claimed',
        replayed: true,
        reward: replay.reward,
        streakAfter: replay.streak_after,
        totalAfter: replay.total_after,
      };
    }

    const session = await activeSession(q);
    if (!session) {
      await logAttempt(q, { ...attempt, outcome: 'no_active_stream' });
      return {
        outcome: 'no_active_stream',
        replayed: false,
        reward: 0,
        streakAfter: 0,
        totalAfter: 0,
      };
    }

    const before = (await readStats(q, viewer.twitchUserId)) ?? EMPTY_STATS;
    const existing = (
      await q.query<ClaimRow>(
        'select * from daily_claims where twitch_user_id = $1 and stream_day = $2',
        [viewer.twitchUserId, session.streamDay],
      )
    )[0];
    if (existing) {
      await logAttempt(q, {
        ...attempt,
        outcome: 'already_claimed',
        streamId: session.streamId,
        streamDay: session.streamDay,
        claimId: existing.id,
        streakBefore: before.current_streak,
        totalBefore: before.total_daily,
      });
      return {
        outcome: 'already_claimed',
        replayed: false,
        reward: 0,
        streakAfter: before.current_streak,
        totalAfter: before.total_daily,
      };
    }

    const previousAiredDay =
      (
        await q.query<{ day: string | null }>(
          'select max(day) as day from stream_days where day < $1',
          [session.streamDay],
        )
      )[0]?.day ?? null;
    const streakAfter = streakAfterClaim(
      {
        storedStreak: before.current_streak,
        lastClaimDay: before.last_claim_day,
      },
      previousAiredDay,
    );
    const totalAfter = before.total_daily + 1;
    const bestAfter = Math.max(before.best_streak, streakAfter);
    const calc = dailyRewardBreakdown(streakAfter, await loadDailyConfig(q));
    const reward = calc.final;

    await q.query(
      `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3)
       on conflict (twitch_user_id) do update set login = excluded.login,
         display_name = excluded.display_name, updated_at = now()`,
      [viewer.twitchUserId, viewer.login, viewer.displayName],
    );
    const claimId = (
      await q.query<{ id: number }>(
        `insert into daily_claims (twitch_user_id, stream_day, stream_id, request_id, source, claimed_at,
           streak_before, streak_after, total_before, total_after, best_after, reward, breakdown)
         values ($1, $2, $3, $4, 'chat', $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [
          viewer.twitchUserId,
          session.streamDay,
          session.streamId,
          requestId,
          now,
          before.current_streak,
          streakAfter,
          before.total_daily,
          totalAfter,
          bestAfter,
          reward,
          JSON.stringify({ ...calc, streakBefore: before.current_streak }),
        ],
      )
    )[0]!.id;
    await q.query(
      `insert into daily_stats (twitch_user_id, total_daily, current_streak, best_streak, last_claim_day, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (twitch_user_id) do update set total_daily = excluded.total_daily,
         current_streak = excluded.current_streak, best_streak = excluded.best_streak,
         last_claim_day = excluded.last_claim_day, updated_at = excluded.updated_at`,
      [
        viewer.twitchUserId,
        totalAfter,
        streakAfter,
        bestAfter,
        session.streamDay,
      ],
    );
    if (reward > 0) {
      await q.query(
        `insert into daily_credits (claim_id, twitch_user_id, login, amount, provider, status, idempotency_key)
         values ($1, $2, $3, $4, $5, 'pending', $6)`,
        [
          claimId,
          viewer.twitchUserId,
          viewer.login,
          reward,
          this.credits.providerName,
          `daily-claim:${claimId}`,
        ],
      );
    }
    await logAttempt(q, {
      ...attempt,
      outcome: 'claimed',
      streamId: session.streamId,
      streamDay: session.streamDay,
      claimId,
      streakBefore: before.current_streak,
      streakAfter,
      totalBefore: before.total_daily,
      totalAfter,
      reward,
    });
    return {
      outcome: 'claimed',
      replayed: false,
      reward,
      streakAfter,
      totalAfter,
    };
  }

  /** Read-only. */
  async status(twitchUserId: string): Promise<DailyStatus> {
    const q = this.db;
    const ctx = await dayContext(q, this.clock.now());
    const viewer = (
      await q.query<{ login: string; display_name: string }>(
        'select login, display_name from viewers where twitch_user_id = $1',
        [twitchUserId],
      )
    )[0];
    const stats = (await readStats(q, twitchUserId)) ?? EMPTY_STATS;
    const last = (
      await q.query<{ stream_day: string; claimed_at: Date; reward: number }>(
        `select stream_day, claimed_at, reward from daily_claims where twitch_user_id = $1
         order by stream_day desc limit 1`,
        [twitchUserId],
      )
    )[0];
    const config = await loadDailyConfig(q);
    const currentStreak = effectiveStreak({
      storedStreak: stats.current_streak,
      lastClaimDay: stats.last_claim_day,
      latestAiredDay: ctx.latestAiredDay,
      previousAiredDay: ctx.previousAiredDay,
      latestDayOpen: ctx.latestDayOpen,
    });

    return {
      twitchUserId,
      login: viewer?.login ?? null,
      displayName: viewer?.display_name ?? null,
      totalDaily: stats.total_daily,
      currentStreak,
      bestStreak: stats.best_streak,
      live: ctx.live,
      currentStreamDay: ctx.currentStreamDay,
      claimedCurrentStreamDay:
        ctx.currentStreamDay !== null &&
        stats.last_claim_day === ctx.currentStreamDay,
      lastClaim: last
        ? {
            streamDay: last.stream_day,
            claimedAt: last.claimed_at.toISOString(),
            reward: last.reward,
          }
        : null,
      nextReward: rewardForStreak(currentStreak + 1, config),
    };
  }

  /** `!streak`: read-only. */
  async streak(viewer: Viewer): Promise<DailyStreakResponse> {
    const status = await this.status(viewer.twitchUserId);
    return {
      status,
      message: dailyMessages.streak(
        viewer.displayName,
        status.currentStreak,
        status.totalDaily,
        status.bestStreak,
      ),
    };
  }

  async history(
    twitchUserId: string,
    limit = 50,
  ): Promise<DailyClaimHistoryItem[]> {
    const rows = await this.db.query<{
      stream_day: string;
      claimed_at: Date;
      reward: number;
      streak_after: number;
      total_after: number;
      source: 'chat' | 'import';
      credit_status: DailyClaimHistoryItem['creditStatus'];
    }>(
      `select c.stream_day, c.claimed_at, c.reward, c.streak_after, c.total_after, c.source,
         cr.status as credit_status
       from daily_claims c left join daily_credits cr on cr.claim_id = c.id
       where c.twitch_user_id = $1 order by c.stream_day desc limit $2`,
      [twitchUserId, limit],
    );
    return rows.map((r) => ({
      streamDay: r.stream_day,
      claimedAt: r.claimed_at.toISOString(),
      reward: r.reward,
      streakAfter: r.streak_after,
      totalAfter: r.total_after,
      source: r.source,
      creditStatus: r.credit_status,
    }));
  }

  /** Admin: raw attempt journal of one viewer, newest first. */
  attempts(
    twitchUserId: string,
    limit = 100,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query(
      `select a.*, cr.status as credit_status, cr.last_error as credit_error, cr.provider as credit_provider,
         cr.idempotency_key as credit_key, cr.wallet_operation_id, c.breakdown
       from daily_attempts a left join daily_credits cr on cr.claim_id = a.claim_id and a.outcome = 'claimed'
         left join daily_claims c on c.id = a.claim_id and a.outcome = 'claimed'
       where a.twitch_user_id = $1 order by a.attempted_at desc, a.id desc limit $2`,
      [twitchUserId, limit],
    );
  }

  async leaderboard(limit = 100): Promise<DailyLeaderboard> {
    const ctx = await dayContext(this.db, this.clock.now());
    const rows = await this.db.query<
      StatsRow & { twitch_user_id: string; login: string; display_name: string }
    >(
      `select s.twitch_user_id, v.login, v.display_name, s.total_daily, s.current_streak, s.best_streak, s.last_claim_day
       from daily_stats s join viewers v using (twitch_user_id)`,
    );
    const viewers = rows.map((r) => ({
      twitchUserId: r.twitch_user_id,
      login: r.login,
      displayName: r.display_name,
      total: r.total_daily,
      best: r.best_streak,
      streak: effectiveStreak({
        storedStreak: r.current_streak,
        lastClaimDay: r.last_claim_day,
        latestAiredDay: ctx.latestAiredDay,
        previousAiredDay: ctx.previousAiredDay,
        latestDayOpen: ctx.latestDayOpen,
      }),
    }));
    const rank = (key: 'total' | 'streak' | 'best'): DailyLeaderboardEntry[] =>
      viewers
        .filter((v) => v[key] > 0)
        .sort(
          (a, b) =>
            b[key] - a[key] || a.twitchUserId.localeCompare(b.twitchUserId),
        )
        .slice(0, limit)
        .map((v, i) => ({
          rank: i + 1,
          twitchUserId: v.twitchUserId,
          login: v.login,
          displayName: v.displayName,
          value: v[key],
        }));
    return { total: rank('total'), streak: rank('streak'), best: rank('best') };
  }
}

interface AttemptLog {
  twitchUserId: string;
  login: string;
  requestId: string;
  attemptedAt: Date;
  outcome: DailyClaimOutcome | 'replayed';
  streamId?: string | null;
  streamDay?: string | null;
  claimId?: number | null;
  streakBefore?: number;
  streakAfter?: number;
  totalBefore?: number;
  totalAfter?: number;
  reward?: number;
}

async function logAttempt(q: Queryable, a: AttemptLog): Promise<void> {
  await q.query(
    `insert into daily_attempts (attempted_at, twitch_user_id, login, request_id, outcome, stream_id, stream_day,
       claim_id, streak_before, streak_after, total_before, total_after, reward)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      a.attemptedAt,
      a.twitchUserId,
      a.login,
      a.requestId,
      a.outcome,
      a.streamId ?? null,
      a.streamDay ?? null,
      a.claimId ?? null,
      a.streakBefore ?? null,
      a.streakAfter ?? null,
      a.totalBefore ?? null,
      a.totalAfter ?? null,
      a.reward ?? null,
    ],
  );
}
