import { randomInt, randomUUID } from 'node:crypto';
import {
  RANDOM_BAN,
  RANDOM_BAN_DRAW,
  type RandomBanAnimationId,
  type RbAnimationReport,
  type RbClaimRequest,
  type RbMode,
  type RbMuteClaim,
  type RbMuteReport,
  type RbResultReport,
  type RbStatus,
  type RbTargetReport,
  type RbTestRequest,
  type RbTwitchUser,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';

// Random Ban V2 (docs/RANDOM_BAN_V2.md) — the ONE implementation (Lab Core and production Core; the channel points
// reward today, `!rb` with the economy later). Core holds the truth: one request per trigger (dedup), one Random Ban
// at a time per channel, the state of each one, the refund still owed, the animation. The Twitch executor (the bot,
// LeCroupier_'s and the broadcaster's tokens) claims a request, searches a target (Twitch reads only), tells Core the
// target BEFORE any timeout (Core answers the sanction), times it out once, then reports. Studio plays the animation
// once Core holds the result (never for a timeout not confirmed). Never replayed:
// - a search that never reported (executor lost before any timeout) is offered again (bounded);
// - a timeout requested whose answer never came is « uncertain » (refund to verify): never sent again.

export class RbError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

interface Row {
  request_id: string;
  channel_id: string;
  source: 'channel_points' | 'chat' | 'test';
  source_ref: string;
  mode: RbMode;
  buyer_id: string;
  buyer_login: string;
  buyer_name: string;
  status: RbStatus;
  target_id: string | null;
  target_login: string | null;
  target_name: string | null;
  target_is_sub: boolean | null;
  duration_s: number | null;
  reason: string | null;
  error: string | null;
  refund: 'none' | 'needed' | 'to_verify';
  /** Search counts, and `streamer`: the streamer decision of this request (V3 trace, 27/10). */
  stats: (Record<string, unknown> & { streamer?: StreamerDecision }) | null;
  executor_id: string | null;
  attempt_id: string | null;
  attempts: number;
  lease_expires_at: Date | null;
  animation: RandomBanAnimationId | null;
  animation_status:
    | 'none'
    | 'pending'
    | 'playing'
    | 'completed'
    | 'failed'
    | 'unknown'
    | 'skipped';
  animation_consumer: string | null;
  animation_lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  ended_at: Date | null;
}

const OPEN: RbStatus[] = ['queued', 'searching', 'timeout_requested'];

/**
 * V3 (27/10) — the streamer as an exceptional target: no Twitch timeout, his mic muted in OBS by Studio. Such a request
 * keeps the usual states, its `reason` saying what it is: `streamer_mute` while waiting for / running the mute
 * (`timeout_requested`: Studio has to mute; `confirmed`: muted, `lease_expires_at` = the mute's end), then
 * `streamer_mute_caution` once a paid caution ended it early. No new column (no migration).
 */
const STREAMER_MUTE = 'streamer_mute';
const isStreamerMute = (r: { reason: string | null }) =>
  !!r.reason?.startsWith(STREAMER_MUTE);

/**
 * V3 trace (27/10): why the streamer was or was not the target of a request, recorded in its `stats.streamer` (no new
 * column) — enough to tell a run of bad luck (eligible, drawn ≥ 20 each time) from a real exclusion (never eligible).
 */
export type StreamerDecision = {
  decision:
    | 'drawn' // eligible, draw < streamerPerMille: the streamer is the target
    | 'not_drawn' // eligible, draw ≥ streamerPerMille: a viewers' search
    | 'no_streamer' // this Core does not know its streamer
    | 'dry_run' // a dry run (Studio test of the search): never the streamer
    | 'studio_silent' // Studio did not say « ready » within studioReadyMs (closed, Core unreachable from it…)
    | 'obs_not_ready' // Studio said OBS is not connected
    | 'mic_held' // another effect (BRB, a Votekick or Random Ban mute) holds the mic
    | 'votekick_mute' // a Votekick mute of the streamer runs
    | 'streamer_muted'; // a Random Ban mute of the streamer runs or waits for Studio
  /** The draw (0–999) when eligible. */
  draw?: number;
  /** Age of Studio's last signal (ms) when it was too old or absent (null: never seen by this Core). */
  studio_age_ms?: number | null;
  /** The mute Studio could not start (then a viewers' search followed), kept across the re-draw. */
  obs_failed?: string;
  at: string;
};

/** Another effect muting the streamer (Votekick): no streamer draw while it runs. */
export interface StreamerMuteSource {
  active(
    q: Queryable,
    channelId: string,
  ): Promise<{ id: string; endsAt: Date } | null>;
}
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export const rbView = (r: Row) => ({
  request_id: r.request_id,
  source: r.source,
  mode: r.mode,
  buyer: { id: r.buyer_id, login: r.buyer_login, name: r.buyer_name },
  status: r.status,
  target: r.target_id
    ? {
        id: r.target_id,
        login: r.target_login,
        name: r.target_name,
        is_sub: r.target_is_sub,
      }
    : null,
  duration_s: r.duration_s,
  error: r.error,
  refund: r.refund,
  stats: r.stats,
  attempts: r.attempts,
  /** V3: the streamer drawn — his mic muted for duration_s (never a Twitch timeout). */
  streamer_mute: isStreamerMute(r),
  /** V3 trace: the streamer decision of this request (absent before 27/10 or when never claimed). */
  streamer_decision: r.stats?.streamer ?? null,
  animation: r.animation,
  animation_status: r.animation_status,
  created_at: iso(r.created_at),
  ended_at: iso(r.ended_at),
});

/** What the Twitch executor last told Core about itself (memory: a status, not a record). */
type Executor = {
  login: string;
  can_search: boolean;
  can_timeout: boolean;
  missing: string[];
  at: number;
};

export class RandomBanService {
  private readonly executors = new Map<string, Executor>();
  /** What Studio last said about the streamer's mic (memory: a status, not a record). */
  private readonly studios = new Map<
    string,
    { obs_ready: boolean; mic_held: boolean; at: number }
  >();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Tests only: a deterministic draw (default: crypto, never predictable by a viewer). */
    private readonly draw: (n: number) => number = (n) => randomInt(n),
    private readonly v3: {
      /** The channel's streamer (absent: never a streamer draw). */
      streamer?: () => { id: string; login: string } | null;
      /** Votekick's mute of the streamer: no streamer draw while it runs. */
      otherMutes?: StreamerMuteSource | null;
    } = {},
  ) {}

  private now() {
    return this.clock.now();
  }

  private async lock(q: Queryable, channelId: string) {
    await q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `random_ban:${channelId}`,
    ]);
  }

  private async row(q: Queryable, id: string, forUpdate = false) {
    const r = (
      await q.query<Row>(
        `select * from rb_requests where request_id = $1${forUpdate ? ' for update' : ''}`,
        [id],
      )
    )[0];
    if (!r) throw new RbError(404, 'random_ban_not_found');
    return r;
  }

  private async set(q: Queryable, id: string, fields: Partial<Row>) {
    const entries = Object.entries({ ...fields, updated_at: this.now() });
    await q.query(
      `update rb_requests set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(', ')} where request_id = $1`,
      [
        id,
        ...entries.map(([, v]) =>
          v !== null && typeof v === 'object' && !(v instanceof Date)
            ? JSON.stringify(v)
            : v,
        ),
      ],
    );
  }

  /** The animation of a confirmed ban: CSC when the buyer banned himself, else one of the nine at random. */
  private animationFor(r: Row): RandomBanAnimationId {
    if (r.target_id && r.target_id === r.buyer_id) return 'ban_csc';
    return RANDOM_BAN_DRAW[this.draw(RANDOM_BAN_DRAW.length)]!;
  }

  /** Animation of a result: pending, unless the result came too late to be shown (never an old animation). */
  private animated(r: Row, animation: RandomBanAnimationId): Partial<Row> {
    const late =
      this.now().getTime() - new Date(r.created_at).getTime() >
      RANDOM_BAN.animationMaxAgeMs;
    return { animation, animation_status: late ? 'skipped' : 'pending' };
  }

  // --- triggers --------------------------------------------------------------------------------------------------

  /**
   * A trigger asks for a Random Ban. The same trigger twice (same source + reference) is the same request: never two.
   */
  async request(
    r: {
      channel_id: string;
      source: 'channel_points' | 'chat' | 'test';
      source_ref: string;
      mode: 'real' | 'dry_run';
      buyer: RbTwitchUser;
    },
    q: Queryable = this.db,
  ) {
    return (await this.requestIfNew(r, q)).request;
  }

  /**
   * `request`, telling whether this call created it (`!rb` pays only for a new one). A concurrent insert of the same
   * trigger waits for the first transaction, then finds it: `created` is true for exactly one caller.
   */
  async requestIfNew(
    r: {
      channel_id: string;
      source: 'channel_points' | 'chat' | 'test';
      source_ref: string;
      mode: 'real' | 'dry_run';
      buyer: RbTwitchUser;
    },
    q: Queryable = this.db,
  ) {
    const now = this.now();
    const inserted = await q.query(
      `insert into rb_requests (request_id, channel_id, source, source_ref, mode, buyer_id, buyer_login, buyer_name,
         status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9, $9)
       on conflict (channel_id, source, source_ref) do nothing
       returning request_id`,
      [
        randomUUID(),
        r.channel_id,
        r.source,
        r.source_ref.slice(0, 200),
        r.mode,
        r.buyer.id,
        r.buyer.login,
        r.buyer.name,
        now,
      ],
    );
    const request = rbView(
      (
        await q.query<Row>(
          'select * from rb_requests where channel_id = $1 and source = $2 and source_ref = $3',
          [r.channel_id, r.source, r.source_ref.slice(0, 200)],
        )
      )[0]!,
    );
    return { request, created: inserted.length > 0 };
  }

  /** The Twitch executor told Core recently that it can search and time out (memory: this Core only). */
  executorReady(channelId: string) {
    const e = this.executors.get(channelId);
    return (
      !!e &&
      this.now().getTime() - e.at < 15_000 &&
      e.can_search &&
      e.can_timeout
    );
  }

  /** Paid from the chat and refunded in Jetons: nothing is owed for this request any more. */
  async markRefunded(q: Queryable, requestId: string) {
    await q.query(
      `update rb_requests set refund = 'none', updated_at = $2 where request_id = $1 and refund = 'needed'`,
      [requestId, this.now()],
    );
  }

  /** Studio « Tester »: never a real timeout — the real search without timeout, or the animation alone. */
  /**
   * Studio « Tester le mute du streamer »: ONLY the streamer's mic muted in OBS for the mute's length, handed to Studio
   * at once. Never a Twitch call (never offered to the executor, even when Studio fails), nothing debited, no channel
   * points, no chat line, no animation, no caution possible. Refused while another mute of him runs.
   */
  async testStreamerMute(channelId: string, trigger = 'Test Studio') {
    const streamer = this.v3.streamer?.();
    if (!streamer) throw new RbError(409, 'streamer_unknown');
    const id = await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      await this.sweep(q, channelId);
      if (
        (await this.v3.otherMutes?.active(q, channelId)) ||
        (await this.streamerMuteOpen(q, channelId))
      )
        throw new RbError(409, 'streamer_already_muted');
      const { request } = await this.requestIfNew(
        {
          channel_id: channelId,
          source: 'test',
          source_ref: `streamer:${randomUUID()}`,
          mode: 'real',
          buyer: { id: '0', login: 'test_studio', name: trigger.slice(0, 25) },
        },
        q,
      );
      await this.set(q, request.request_id, {
        status: 'timeout_requested',
        target_id: streamer.id,
        target_login: streamer.login,
        target_name: streamer.login,
        duration_s: RANDOM_BAN.streamerMuteS,
        reason: STREAMER_MUTE,
        lease_expires_at: new Date(
          this.now().getTime() + RANDOM_BAN.studioMuteLeaseMs,
        ),
      });
      return request.request_id;
    });
    return rbView(await this.row(this.db, id));
  }

  async test(channelId: string, t: RbTestRequest) {
    const buyer = {
      id: '0',
      login: 'test_studio',
      name: t.trigger ?? 'Test Studio',
    };
    if (t.mode === 'dry_run')
      return this.request({
        channel_id: channelId,
        source: 'test',
        source_ref: randomUUID(),
        mode: 'dry_run',
        buyer,
      });
    const outcome = t.outcome ?? 'ban';
    const id = randomUUID();
    const now = this.now();
    const target =
      outcome === 'flop'
        ? null
        : outcome === 'csc'
          ? buyer
          : { id: '1', login: 'viewer_test', name: t.banned ?? 'Viewer' };
    await this.db.query(
      `insert into rb_requests (request_id, channel_id, source, source_ref, mode, buyer_id, buyer_login, buyer_name,
         status, target_id, target_login, target_name, target_is_sub, animation, animation_status, created_at,
         updated_at, ended_at)
       values ($1, $2, 'test', $11, 'animation', $3, $4, $5, 'simulated', $6, $7, $8, false, $9, 'pending', $10, $10,
         $10)`,
      [
        id,
        channelId,
        buyer.id,
        buyer.login,
        buyer.name,
        target?.id ?? null,
        target?.login ?? null,
        target?.name ?? null,
        outcome === 'flop'
          ? 'flop'
          : outcome === 'csc'
            ? 'ban_csc'
            : RANDOM_BAN_DRAW[this.draw(RANDOM_BAN_DRAW.length)],
        now,
        id,
      ],
    );
    return rbView(await this.row(this.db, id));
  }

  // --- the Twitch executor ---------------------------------------------------------------------------------------

  /** Requests ended outside `result` (sweep, claim refusal): told to the listeners after their commit. */
  private ended: string[] = [];

  /** Requests and animations left behind: decided once, never replayed. */
  private async sweep(q: Queryable, channelId: string) {
    const now = this.now();
    const open = await q.query<Row>(
      `select * from rb_requests where channel_id = $1 and (status = any($2::text[]) or animation_status in
         ('pending', 'playing'))`,
      [channelId, OPEN],
    );
    for (const r of open) {
      const leaseOver =
        r.lease_expires_at && new Date(r.lease_expires_at) < now;
      if (
        r.status === 'queued' &&
        now.getTime() - new Date(r.created_at).getTime() > RANDOM_BAN.pickupMs
      ) {
        await this.set(q, r.request_id, {
          status: 'failed',
          error: 'executor_absent',
          refund: r.mode === 'real' ? 'needed' : 'none',
          ended_at: now,
        });
        this.ended.push(r.request_id);
      } else if (r.status === 'searching' && leaseOver) {
        if (r.attempts >= RANDOM_BAN.maxAttempts) this.ended.push(r.request_id);
        // Nothing was sent (the target is told to Core before any timeout): safe to offer again, a few times.
        await this.set(
          q,
          r.request_id,
          r.attempts < RANDOM_BAN.maxAttempts
            ? {
                status: 'queued',
                executor_id: null,
                attempt_id: null,
                lease_expires_at: null,
              }
            : {
                status: 'failed',
                error: 'executor_lost',
                refund: r.mode === 'real' ? 'needed' : 'none',
                lease_expires_at: null,
                ended_at: now,
              },
        );
      } else if (
        r.status === 'timeout_requested' &&
        leaseOver &&
        isStreamerMute(r)
      ) {
        // Studio never confirmed the streamer's mute (OBS lost, Studio closed): nothing was paid for in vain — back
        // to a viewers' draw (Studio releases a hold Core does not list as running).
        await this.set(q, r.request_id, this.notMuted(r, 'studio_silent'));
      } else if (r.status === 'timeout_requested' && leaseOver) {
        // The timeout may have been sent: never again, the refund waits for a check.
        await this.set(q, r.request_id, {
          status: 'uncertain',
          error: 'no_answer_after_timeout_request',
          refund: 'to_verify',
          lease_expires_at: null,
          ended_at: now,
        });
        this.ended.push(r.request_id);
      }
      if (
        r.animation_status === 'playing' &&
        r.animation_lease_expires_at &&
        new Date(r.animation_lease_expires_at) < now
      )
        await this.set(q, r.request_id, {
          animation_status: 'unknown',
          animation_lease_expires_at: null,
        });
      else if (
        r.animation_status === 'pending' &&
        now.getTime() - new Date(r.ended_at ?? r.created_at).getTime() >
          RANDOM_BAN.animationMaxAgeMs
      )
        await this.set(q, r.request_id, { animation_status: 'skipped' });
    }
  }

  /**
   * The executor asks for work (its capabilities with it). One Random Ban at a time: nothing while one is being
   * searched or timed out. A request this executor cannot serve fails at once with a readable reason.
   */
  async claim(channelId: string, c: RbClaimRequest) {
    this.executors.set(channelId, {
      login: c.login,
      can_search: c.can_search,
      can_timeout: c.can_timeout,
      missing: c.missing,
      at: this.now().getTime(),
    });
    const out = await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      await this.sweep(q, channelId);
      const busy = await q.query(
        `select 1 from rb_requests where channel_id = $1 and status in ('searching', 'timeout_requested')`,
        [channelId],
      );
      if (busy.length) return { request: null, reason: 'busy' };
      const r = (
        await q.query<Row>(
          `select * from rb_requests where channel_id = $1 and status = 'queued' order by seq limit 1 for update`,
          [channelId],
        )
      )[0];
      if (!r) return { request: null, reason: 'idle' };
      const lacks = !c.can_search
        ? 'search'
        : r.mode === 'real' && !c.can_timeout
          ? 'timeout'
          : null;
      if (lacks) {
        await this.set(q, r.request_id, {
          status: 'failed',
          error: `missing_scope_${lacks}: ${c.missing.join(', ')}`.slice(
            0,
            300,
          ),
          refund: r.mode === 'real' ? 'needed' : 'none',
          ended_at: this.now(),
        });
        this.ended.push(r.request_id);
        return { request: null, reason: 'refused' };
      }
      const { streamer, trace } = await this.streamerDrawn(q, channelId, r);
      await this.set(q, r.request_id, {
        stats: { ...(r.stats ?? {}), streamer: trace },
      });
      r.stats = { ...(r.stats ?? {}), streamer: trace };
      console.log(
        `[random-ban] ${r.request_id.slice(0, 8)} streamer: ${trace.decision}${trace.draw !== undefined ? ` (tirage ${trace.draw}/1000, gagnant < ${RANDOM_BAN.streamerPerMille})` : ''}${trace.studio_age_ms !== undefined ? ` (Studio vu il y a ${trace.studio_age_ms ?? '∞'} ms)` : ''}`,
      );
      if (streamer) {
        // No Twitch call for him: Studio mutes his mic (claimMute); the executor goes on with the next request after.
        await this.set(q, r.request_id, {
          status: 'timeout_requested',
          target_id: streamer.id,
          target_login: streamer.login,
          target_name: streamer.login,
          target_is_sub: null,
          duration_s: RANDOM_BAN.streamerMuteS,
          reason: STREAMER_MUTE,
          executor_id: null,
          attempt_id: null,
          lease_expires_at: new Date(
            this.now().getTime() + RANDOM_BAN.studioMuteLeaseMs,
          ),
        });
        return { request: null, reason: 'busy' };
      }
      const attempt = randomUUID();
      await this.set(q, r.request_id, {
        status: 'searching',
        executor_id: c.executor_id,
        attempt_id: attempt,
        attempts: r.attempts + 1,
        lease_expires_at: new Date(
          this.now().getTime() + RANDOM_BAN.searchLeaseMs,
        ),
      });
      return {
        request: {
          request_id: r.request_id,
          attempt_id: attempt,
          mode: r.mode,
          buyer: { id: r.buyer_id, login: r.buyer_login, name: r.buyer_name },
        },
      };
    });
    await this.tellEnded(channelId);
    return out;
  }

  /** After a commit: every request the sweep or a claim ended is told to the listeners (refunds, history). */
  private async tellEnded(channelId: string) {
    const ids = this.ended.splice(0);
    for (const id of ids)
      for (const fn of this.settledListeners)
        await fn(channelId, id).catch((e) =>
          console.error('[random-ban] settle failed', id, e),
        );
  }

  private current(r: Row, executorId: string, attemptId: string) {
    if (r.executor_id !== executorId || r.attempt_id !== attemptId)
      throw new RbError(409, 'not_current_attempt');
  }

  /**
   * The search found its target. Recorded BEFORE any timeout; Core answers the sanction (sub 3 min, else 5 min). A dry
   * run ends here (simulated, animation). A repeated report of the same target gets the same answer.
   */
  async target(id: string, t: RbTargetReport) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, id, true);
      this.current(r, t.executor_id, t.attempt_id);
      if (r.status === 'timeout_requested' && r.target_id === t.target.id)
        return {
          proceed: true,
          duration_s: r.duration_s!,
          reason: r.reason!,
        };
      if (r.status !== 'searching') throw new RbError(409, 'not_searching');
      const duration = t.is_sub
        ? RANDOM_BAN.durationSubS
        : RANDOM_BAN.durationNonSubS;
      const reason = t.is_sub ? RANDOM_BAN.reasonSub : RANDOM_BAN.reasonNonSub;
      const fields: Partial<Row> = {
        target_id: t.target.id,
        target_login: t.target.login,
        target_name: t.target.name,
        target_is_sub: t.is_sub,
        duration_s: duration,
        reason,
        stats: { ...t.stats, streamer: r.stats?.streamer },
      };
      if (r.mode !== 'real') {
        const done = { ...r, ...fields } as Row;
        await this.set(q, id, {
          ...fields,
          status: 'simulated',
          lease_expires_at: null,
          ended_at: this.now(),
          ...this.animated(r, this.animationFor(done)),
        });
        return { proceed: false as const };
      }
      await this.set(q, id, {
        ...fields,
        status: 'timeout_requested',
        lease_expires_at: new Date(
          this.now().getTime() + RANDOM_BAN.timeoutLeaseMs,
        ),
      });
      return { proceed: true as const, duration_s: duration, reason };
    });
  }

  /** The outcome (idempotent: a final result stays; only an « uncertain » can still be settled by the executor). */
  async result(id: string, o: RbResultReport) {
    const { view, channelId } = await this.db.tx(async (q) => {
      const r = await this.row(q, id, true);
      this.current(r, o.executor_id, o.attempt_id);
      const now = this.now();
      const settles =
        r.status === 'timeout_requested' || r.status === 'uncertain';
      if (o.event === 'flop' && r.status === 'searching')
        await this.set(q, id, {
          status: 'flop',
          stats: o.stats
            ? { ...o.stats, streamer: r.stats?.streamer }
            : r.stats,
          lease_expires_at: null,
          ended_at: now,
          ...this.animated(r, 'flop'),
        });
      else if (
        o.event === 'failed' &&
        (r.status === 'searching' || r.status === 'timeout_requested')
      )
        await this.set(q, id, {
          status: 'failed',
          error: (o.error ?? 'failed').slice(0, 300),
          refund: r.mode === 'real' ? 'needed' : 'none',
          stats: o.stats
            ? { ...o.stats, streamer: r.stats?.streamer }
            : r.stats,
          lease_expires_at: null,
          ended_at: now,
        });
      else if (o.event === 'confirmed' && settles)
        await this.set(q, id, {
          status: 'confirmed',
          error: o.verified ? 'verified_after_ambiguous_answer' : null,
          refund: 'none',
          lease_expires_at: null,
          ended_at: now,
          ...this.animated(r, this.animationFor(r)),
        });
      else if (o.event === 'refused' && settles)
        await this.set(q, id, {
          status: 'failed',
          error: (o.error ?? 'refused').slice(0, 300),
          refund: 'needed',
          lease_expires_at: null,
          ended_at: now,
        });
      else if (o.event === 'uncertain' && r.status === 'timeout_requested')
        await this.set(q, id, {
          status: 'uncertain',
          error: (o.error ?? 'uncertain').slice(0, 300),
          refund: 'to_verify',
          lease_expires_at: null,
          ended_at: now,
        });
      return { view: rbView(await this.row(q, id)), channelId: r.channel_id };
    });
    // After the commit: the channel points redemption follows its result now, not at Studio's next read (live of
    // 21/10: 6 confirmed Random Bans left « pending »). Its failure never fails the executor's report.
    for (const fn of this.settledListeners)
      await fn(channelId, id).catch((e) =>
        console.error('[random-ban] redemption settle failed', id, e),
      );
    return view;
  }

  private readonly settledListeners: ((
    channelId: string,
    requestId: string,
  ) => Promise<void>)[] = [];

  /** Channel points: told after each executor result (outside its transaction). */
  onResult(fn: (channelId: string, requestId: string) => Promise<void>) {
    this.settledListeners.push(fn);
  }

  // --- the animation (Studio's effects player) -------------------------------------------------------------------

  /** The next animation to show (one at a time, in order); never one already handed out. */
  async claimAnimation(channelId: string, consumerId: string) {
    const out = await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      await this.sweep(q, channelId);
      const playing = await q.query(
        `select 1 from rb_requests where channel_id = $1 and animation_status = 'playing'`,
        [channelId],
      );
      if (playing.length) return { animation: null };
      const r = (
        await q.query<Row>(
          `select * from rb_requests where channel_id = $1 and animation_status = 'pending'
           order by ended_at, seq limit 1 for update`,
          [channelId],
        )
      )[0];
      if (!r) return { animation: null };
      await this.set(q, r.request_id, {
        animation_status: 'playing',
        animation_consumer: consumerId,
        animation_lease_expires_at: new Date(
          this.now().getTime() + RANDOM_BAN.animationLeaseMs,
        ),
      });
      return {
        animation: {
          request_id: r.request_id,
          animation: r.animation!,
          trigger: r.buyer_name,
          banned: r.target_name,
        },
      };
    });
    await this.tellEnded(channelId);
    return out;
  }

  async reportAnimation(id: string, a: RbAnimationReport) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, id, true);
      if (r.animation_consumer !== a.consumer_id)
        throw new RbError(409, 'not_current_consumer');
      if (r.animation_status !== 'playing')
        return { animation_status: r.animation_status };
      await this.set(q, id, {
        animation_status: a.event,
        animation_lease_expires_at: null,
        ...(a.error && a.event !== 'completed'
          ? { error: r.error ?? `animation: ${a.error}`.slice(0, 300) }
          : {}),
      });
      return { animation_status: a.event };
    });
  }

  // --- V3: the streamer's mute (Studio) ---------------------------------------------------------------------------

  /**
   * Studio did not mute (failed or silent): a real request goes back to a viewers' draw (nothing lost); a Studio TEST
   * ends there — never handed to the Twitch executor (a test never times anyone out).
   */
  private notMuted(r: Row, error: string): Partial<Row> {
    // The trace keeps why the streamer's mute did not happen (then the viewers' search's own decision follows).
    const stats = r.stats?.streamer
      ? {
          stats: {
            ...r.stats,
            streamer: { ...r.stats.streamer, obs_failed: error.slice(0, 200) },
          },
        }
      : {};
    return r.source === 'test'
      ? {
          ...stats,
          status: 'failed',
          error,
          refund: 'none',
          executor_id: null,
          attempt_id: null,
          lease_expires_at: null,
          ended_at: this.now(),
        }
      : { ...this.backToViewers(), ...stats };
  }

  private backToViewers(): Partial<Row> {
    return {
      status: 'queued',
      target_id: null,
      target_login: null,
      target_name: null,
      target_is_sub: null,
      duration_s: null,
      reason: null,
      executor_id: null,
      attempt_id: null,
      lease_expires_at: null,
    };
  }

  /** The streamer's running mute (confirmed, not yet over), or the one Studio has to start. */
  private async streamerMuteOpen(q: Queryable, channelId: string) {
    return (
      await q.query(
        `select 1 from rb_requests where channel_id = $1 and reason = $2
           and (status = 'timeout_requested' or (status = 'confirmed' and lease_expires_at > $3))`,
        [channelId, STREAMER_MUTE, this.now()],
      )
    ).length;
  }

  /**
   * Is the streamer the target of this request? Only a real one, with the streamer known, Studio ready to mute (OBS
   * connected, the mic held by no other effect, said within studioReadyMs), no Votekick or Random Ban mute of him
   * running — then streamerPerMille ‰.
   */
  private async streamerDrawn(
    q: Queryable,
    channelId: string,
    r: Row,
  ): Promise<{
    streamer: { id: string; login: string } | null;
    trace: StreamerDecision;
  }> {
    const at = this.now().toISOString();
    const previous = r.stats?.streamer?.obs_failed;
    const no = (
      decision: StreamerDecision['decision'],
      more: Partial<StreamerDecision> = {},
    ) => ({
      streamer: null,
      trace: {
        decision,
        ...more,
        ...(previous ? { obs_failed: previous } : {}),
        at,
      },
    });
    const streamer = this.v3.streamer?.();
    if (!streamer) return no('no_streamer');
    if (r.mode !== 'real') return no('dry_run');
    const s = this.studios.get(channelId);
    const age = s ? this.now().getTime() - s.at : null;
    if (age === null || age > RANDOM_BAN.studioReadyMs)
      return no('studio_silent', { studio_age_ms: age });
    if (!s!.obs_ready) return no('obs_not_ready');
    if (s!.mic_held) return no('mic_held');
    if (await this.v3.otherMutes?.active(q, channelId))
      return no('votekick_mute');
    if (await this.streamerMuteOpen(q, channelId)) return no('streamer_muted');
    const draw = this.draw(1000);
    const won = draw < RANDOM_BAN.streamerPerMille;
    return {
      streamer: won ? streamer : null,
      trace: {
        decision: won ? 'drawn' : 'not_drawn',
        draw,
        ...(previous ? { obs_failed: previous } : {}),
        at,
      },
    };
  }

  /**
   * Studio's poll (every 500 ms with the animations): it says whether it could mute now, gets the streamer's mute to
   * start (one at a time, leased) and the list of the mutes still running (one missing → its hold is released).
   */
  async claimMute(channelId: string, c: RbMuteClaim) {
    this.studios.set(channelId, {
      obs_ready: c.obs_ready,
      mic_held: c.mic_held,
      at: this.now().getTime(),
    });
    const out = await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      await this.sweep(q, channelId);
      const now = this.now();
      const running = await q.query<Row>(
        `select * from rb_requests where channel_id = $1 and reason = $2 and status = 'confirmed'
           and lease_expires_at > $3 order by seq`,
        [channelId, STREAMER_MUTE, now],
      );
      const r = (
        await q.query<Row>(
          `select * from rb_requests where channel_id = $1 and reason = $2 and status = 'timeout_requested'
             and executor_id is null order by seq limit 1 for update`,
          [channelId, STREAMER_MUTE],
        )
      )[0];
      const active = running.map((m) => ({
        request_id: m.request_id,
        ends_at: iso(m.lease_expires_at)!,
      }));
      if (!r) return { mute: null, active };
      const attempt = randomUUID();
      await this.set(q, r.request_id, {
        executor_id: c.consumer_id,
        attempt_id: attempt,
        lease_expires_at: new Date(
          now.getTime() + RANDOM_BAN.studioMuteLeaseMs,
        ),
      });
      return {
        mute: {
          request_id: r.request_id,
          attempt_id: attempt,
          seconds: r.duration_s!,
          buyer: r.buyer_name,
          streamer: r.target_name,
        },
        active,
      };
    });
    await this.tellEnded(channelId);
    return out;
  }

  /**
   * Studio muted the mic (the mute runs from now) or could not (back to a viewers' draw: nothing lost). Idempotent:
   * a repeated report answers the state; a stale attempt is refused (409) and Studio releases its hold.
   */
  async reportMute(id: string, rep: RbMuteReport) {
    const { view, channelId, settled } = await this.db.tx(async (q) => {
      const r = await this.row(q, id, true);
      if (r.executor_id !== rep.consumer_id || r.attempt_id !== rep.attempt_id)
        throw new RbError(409, 'not_current_attempt');
      if (r.status !== 'timeout_requested' || !isStreamerMute(r))
        return { view: rbView(r), channelId: r.channel_id, settled: false };
      const now = this.now();
      if (rep.event === 'failed') {
        await this.set(
          q,
          id,
          this.notMuted(
            r,
            `studio: ${rep.error ?? 'mute impossible'}`.slice(0, 300),
          ),
        );
        return {
          view: rbView(await this.row(q, id)),
          channelId: r.channel_id,
          settled: false,
        };
      }
      const test = r.source === 'test';
      await this.set(q, id, {
        status: 'confirmed',
        refund: 'none',
        lease_expires_at: new Date(now.getTime() + r.duration_s! * 1000),
        ended_at: now,
        // A Studio test is the mic only: no animation, no chat line, no redemption to settle.
        ...(test ? {} : this.animated(r, this.animationFor(r))),
      });
      if (test)
        return {
          view: rbView(await this.row(q, id)),
          channelId: r.channel_id,
          settled: false,
        };
      await insertWordGameSteps(q, {
        channelId: r.channel_id,
        now,
        origin: 'mini_game',
        drafts: [
          {
            idempotencyKey: `rb:streamer:${id}`,
            mode: 'normal',
            text: `🔇 ${r.buyer_name} a coupé le micro de ${r.target_name} pendant ${r.duration_s} s !`,
          },
        ],
      });
      return {
        view: rbView(await this.row(q, id)),
        channelId: r.channel_id,
        settled: true,
      };
    });
    if (settled)
      for (const fn of this.settledListeners)
        await fn(channelId, id).catch((e) =>
          console.error('[random-ban] redemption settle failed', id, e),
        );
    return view;
  }

  /** Caution (CautionMutes): the streamer's running Random Ban mute (never a Studio test); its id is `rb:<request>`. */
  readonly mutes = {
    kind: 'random_ban' as const,
    label: 'Random Ban',
    active: async (q: Queryable, channelId: string) => {
      const m = (
        await q.query<Row>(
          `select * from rb_requests where channel_id = $1 and reason = $2 and status = 'confirmed'
             and lease_expires_at > $3 and source <> 'test' order by seq limit 1`,
          [channelId, STREAMER_MUTE, this.now()],
        )
      )[0];
      return m
        ? { id: `rb:${m.request_id}`, endsAt: new Date(m.lease_expires_at!) }
        : null;
    },
    /** A paid caution ends it now (inside Caution's transaction); Studio releases its hold at its next poll. */
    end: async (q: Queryable, channelId: string, muteId: string) => {
      await q.query(
        `update rb_requests set reason = $4, lease_expires_at = $3, updated_at = $3
          where request_id = $1 and channel_id = $2 and reason = $5 and status = 'confirmed' and lease_expires_at > $3`,
        [
          muteId.replace(/^rb:/, ''),
          channelId,
          this.now(),
          `${STREAMER_MUTE}_caution`,
          STREAMER_MUTE,
        ],
      );
    },
  };

  // --- reading ---------------------------------------------------------------------------------------------------

  /**
   * V3 trace summary over the last real Random Bans (tests excluded): how often the streamer was eligible, why not,
   * how often drawn — and, since his last draw, the chance of that run happening by luck alone (0.98^eligible).
   */
  private async streamerTrace(channelId: string, limit = 500) {
    const rows = await this.db.query<{ streamer: StreamerDecision | null }>(
      `select stats->'streamer' as streamer from rb_requests
        where channel_id = $1 and mode = 'real' and source <> 'test'
        order by seq desc limit $2`,
      [channelId, limit],
    );
    const traced = rows.map((r) => r.streamer).filter((s) => !!s?.decision);
    const by: Record<string, number> = {};
    for (const t of traced) by[t!.decision] = (by[t!.decision] ?? 0) + 1;
    const eligible = (by.drawn ?? 0) + (by.not_drawn ?? 0);
    const sinceDrawn = traced.findIndex((t) => t!.decision === 'drawn');
    const run = (sinceDrawn < 0 ? traced : traced.slice(0, sinceDrawn)).filter(
      (t) => t!.decision === 'not_drawn',
    ).length;
    return {
      requests: rows.length,
      traced: traced.length,
      by_decision: by,
      eligible,
      drawn: by.drawn ?? 0,
      obs_failed: traced.filter((t) => t!.obs_failed).length,
      /** Eligible draws lost since the last win (or since the trace began). */
      eligible_since_last_drawn: run,
      /** The chance of that run by bad luck alone, in % (100: nothing unusual yet). */
      luck_pct:
        Math.round(
          1000 * Math.pow(1 - RANDOM_BAN.streamerPerMille / 1000, run) * 100,
        ) / 1000,
    };
  }

  /** Outcome of a request for the channel points history (null while it runs). */
  async outcome(id: string) {
    const r = (
      await this.db.query<Row>(
        'select * from rb_requests where request_id = $1',
        [id],
      )
    )[0];
    return r ? rbView(r) : null;
  }

  async state(channelId: string) {
    await this.db.tx(async (q) => {
      await this.lock(q, channelId);
      await this.sweep(q, channelId);
    });
    await this.tellEnded(channelId);
    const recent = await this.db.query<Row>(
      'select * from rb_requests where channel_id = $1 order by created_at desc limit 15',
      [channelId],
    );
    const e = this.executors.get(channelId);
    return {
      rules: {
        duration_sub_s: RANDOM_BAN.durationSubS,
        duration_non_sub_s: RANDOM_BAN.durationNonSubS,
        buyer_weight: RANDOM_BAN.buyerWeight,
        streamer_per_mille: this.v3.streamer?.()
          ? RANDOM_BAN.streamerPerMille
          : 0,
        streamer_mute_s: RANDOM_BAN.streamerMuteS,
      },
      streamer_trace: await this.streamerTrace(channelId),
      studio: (() => {
        const s = this.studios.get(channelId);
        return s && this.now().getTime() - s.at < RANDOM_BAN.studioReadyMs
          ? { obs_ready: s.obs_ready, mic_held: s.mic_held }
          : null;
      })(),
      executor:
        e && this.now().getTime() - e.at < 15_000
          ? {
              login: e.login,
              can_search: e.can_search,
              can_timeout: e.can_timeout,
              missing: e.missing,
            }
          : null,
      recent: recent.map(rbView),
    };
  }
}
