import { randomInt, randomUUID } from 'node:crypto';
import {
  RANDOM_BAN,
  RANDOM_BAN_DRAW,
  type RandomBanAnimationId,
  type RbAnimationReport,
  type RbClaimRequest,
  type RbMode,
  type RbResultReport,
  type RbStatus,
  type RbTargetReport,
  type RbTestRequest,
  type RbTwitchUser,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
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
  stats: Record<string, number> | null;
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

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Tests only: a deterministic draw (default: crypto, never predictable by a viewer). */
    private readonly draw: (n: number) => number = (n) => randomInt(n),
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
        stats: t.stats,
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
          stats: o.stats ?? r.stats,
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
          stats: o.stats ?? r.stats,
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

  // --- reading ---------------------------------------------------------------------------------------------------

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
      },
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
