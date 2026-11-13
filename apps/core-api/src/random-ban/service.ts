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
import type { EconomyPort } from '../economy/economy.js';
import { activeBlock } from '../lab-moderation/store.js';
import { avatarUrls } from '../raffle-lab/avatars.js';
import {
  lastCounted,
  quote,
  RB_PRICING_DEFAULT,
  type RbPricing,
  type RbQuote,
} from './pricing.js';
import type { RandomBanModeration } from './moderation.js';
import { buildStrip, REEL_MS, type ReelItem } from './reel.js';
import {
  presenceCandidates,
  cleanWishText,
  exactWish,
  settleSniper,
  sniperWindow,
  type RbCandidates,
} from './sniper.js';

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
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export type RbSource = 'channel_points' | 'chat' | 'test' | 'extension';

interface Row {
  request_id: string;
  channel_id: string;
  source: RbSource;
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
  /** Jetons purchases (extension, `!rb`) since 20261123: the price charged and the series level it was charged at. */
  price_paid: number | null;
  series_level: number | null;
  /** Sniper (extension): the wished viewer frozen at purchase (never read by the draw) and the decision. */
  wish_id: string | null;
  wish_login: string | null;
  wish_name: string | null;
  /** The Sniper as typed (« @Pseudo »), kept even when no account matched for sure (`unresolved`). */
  wish_text: string | null;
  sniper:
    | 'none'
    | 'armed'
    | 'hit'
    | 'miss'
    | 'glory'
    | 'glory_hit'
    | 'void'
    | 'unresolved'
    | 'revoked';
}

const OPEN: RbStatus[] = ['queued', 'searching', 'timeout_requested'];
const stripOf = (r: Row) =>
  (r.stats?.strip as { items: ReelItem[]; stop: number } | undefined) ?? null;

/**
 * V3 (27/10) — the streamer as an exceptional target: no Twitch timeout, his mic muted in OBS by Studio. Such a request
 * keeps the usual states, its `reason` saying what it is: `streamer_mute` while waiting for / running the mute
 * (`timeout_requested`: Studio has to mute; `confirmed`: muted, `lease_expires_at` = the mute's end), then
 * `streamer_mute_caution` once a paid caution ended it early. No new column (no migration).
 */
const STREAMER_MUTE = 'streamer_mute';
const isStreamerMute = (r: { reason: string | null }) =>
  !!r.reason?.startsWith(STREAMER_MUTE);
/** The `source_ref` prefix of a Studio « Test Caution Random Ban » (a test mute Caution may end). */
const CAUTION_TEST = 'caution-test';

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
  /** A Studio « Test Caution Random Ban »: a test mute Caution may end (real Jetons). */
  caution_test:
    r.source === 'test' && r.source_ref.startsWith(`${CAUTION_TEST}:`),
  /** V3 trace: the streamer decision of this request (absent before 27/10 or when never claimed). */
  streamer_decision: r.stats?.streamer ?? null,
  animation: r.animation,
  animation_status: r.animation_status,
  price_paid: r.price_paid ?? null,
  series_level: r.series_level ?? null,
  wish:
    r.wish_id || r.wish_text
      ? {
          id: r.wish_id,
          login: r.wish_login,
          name: r.wish_name,
          text: r.wish_text ?? null,
        }
      : null,
  /** A channel points redemption (Twitch): its id, for a refund from the moderation (Raptoru's own rewards only). */
  redemption_id:
    r.source === 'channel_points' && r.source_ref.startsWith('twitch:')
      ? r.source_ref.split(':')[1]!
      : null,
  /** The strip the extension's reel scrolls (built AFTER the draw, the target at `stop`); absent before the draw. */
  strip:
    (r.stats?.strip as { items: ReelItem[]; stop: number } | undefined) ?? null,
  sniper: r.sniper ?? 'none',
  sniper_bonus: Number(r.stats?.sniper_bonus ?? 0) || 0,
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

  /** The progressive price and the per-buyer limits (app.ts / lab-core.ts: the module settings). */
  pricing: (q: Queryable, channelId: string) => Promise<RbPricing> = async () =>
    RB_PRICING_DEFAULT;
  /** Sniper: who may be aimed at (present viewers), and the economy that pays the bonus (app.ts / lab-core.ts). */
  candidates: RbCandidates = presenceCandidates;
  economy: EconomyPort | null = null;
  /** The team's Random Ban actions (history, cancel, refunds, pause), set by app.ts / lab-core.ts. */
  moderation: RandomBanModeration | null = null;
  /** Moderation's pause of the Random Ban queue (app.ts / lab-core.ts: the module setting `queue_paused`). */
  paused: (q: Queryable, channelId: string) => Promise<boolean> = async () =>
    false;

  /**
   * The moderation's restrictions of one buyer (any source): the queue paused, a block (module « random_ban » or
   * « all »), a personal cooldown (D4: `delay_s` between two counted Random Ban during its span). Null: free.
   */
  async restriction(
    q: Queryable,
    channelId: string,
    buyerId: string,
  ): Promise<{
    code: 'rb_paused' | 'viewer_blocked' | 'viewer_cooldown';
    wait_ms?: number;
  } | null> {
    if (await this.paused(q, channelId)) return { code: 'rb_paused' };
    const now = this.now();
    if (await activeBlock(q, channelId, buyerId, 'random_ban', now))
      return { code: 'viewer_blocked' };
    const cd = (
      await q.query<{ delay_s: number; until: Date }>(
        `select delay_s, until from lab_viewer_cooldowns where channel_id = $1 and viewer_id = $2
           and module_id = 'random_ban' and until > $3`,
        [channelId, buyerId, now],
      )
    )[0];
    if (!cd) return null;
    const last = (
      await q.query<{ created_at: Date }>(
        `select created_at from rb_requests where channel_id = $1 and buyer_id = $2 and source <> 'test'
           and status not in ('failed', 'canceled') order by seq desc limit 1`,
        [channelId, buyerId],
      )
    )[0];
    if (!last) return null;
    const next = Math.min(
      new Date(last.created_at).getTime() + cd.delay_s * 1000,
      new Date(cd.until).getTime(),
    );
    return next > now.getTime()
      ? { code: 'viewer_cooldown', wait_ms: next - now.getTime() }
      : null;
  }

  /** A moderation decision ended a request outside the executor: the refund paths follow at once. */
  async notifySettled(channelId: string, requestId: string) {
    for (const fn of this.settledListeners)
      await fn(channelId, requestId).catch((e) =>
        console.error('[random-ban] settle failed', requestId, e),
      );
  }

  /** Decides the Sniper of an ended request, once (inside the caller's transaction). */
  private async sniper(q: Queryable, requestId: string, channelId: string) {
    const p = await this.pricing(q, channelId);
    await settleSniper(q, requestId, {
      economy: this.economy,
      bonus: p.sniperBonus,
      windowMs: p.sniperWindowMs,
      now: this.now(),
    });
  }

  private now() {
    return this.clock.now();
  }

  /** One buyer's purchases, one at a time (price, pending cap, cooldown): the second sees the first. */
  async lockBuyer(q: Queryable, channelId: string, buyerId: string) {
    await q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `random_ban:buyer:${channelId}:${buyerId}`,
    ]);
  }

  private async pending(q: Queryable, channelId: string, buyerId: string) {
    return Number(
      (
        await q.query<{ n: number | string }>(
          `select count(*) as n from rb_requests where channel_id = $1 and buyer_id = $2 and source <> 'test'
             and status = any($3::text[])`,
          [channelId, buyerId, OPEN],
        )
      )[0]?.n ?? 0,
    );
  }

  /** The buyer's price now (call inside the transaction that will charge it, after lockBuyer). */
  async quoteFor(q: Queryable, channelId: string, buyerId: string) {
    const p = await this.pricing(q, channelId);
    return {
      pricing: p,
      quote: quote(p, await lastCounted(q, channelId, buyerId), this.now()),
    };
  }

  /**
   * A Jetons purchase (extension or `!rb`) — the ONE place that prices and charges a Random Ban. Inside the caller's
   * transaction, under the buyer's lock: the same trigger again is the same request (nothing more debited); more than
   * `maxPending` open requests → `too_many_pending`; a current price above `ceiling` → `price_changed` (nothing
   * debited: never more than the amount the buyer confirmed; a lower price is charged as it is); else the request and
   * its debit (a refused debit — balance — rolls the request back).
   */
  async buy(
    q: Queryable,
    economy: EconomyPort,
    r: {
      channel_id: string;
      source: 'chat' | 'extension';
      source_ref: string;
      mode: 'real' | 'dry_run';
      buyer: RbTwitchUser;
      /** The highest price the buyer confirmed (`normal`: the normal price only, a bare `!rb`). */
      ceiling: number | 'normal';
      /**
       * Sniper (extension only): the viewer the buyer predicts — frozen here, never given to the draw. `id`: an account
       * the buyer picked in the suggestions; `text` alone: what he typed, matched only when exact, else kept unresolved.
       */
      wish?: { id?: string | null; text?: string | null } | null;
    },
  ): Promise<{
    request: ReturnType<typeof rbView>;
    created: boolean;
    quote: RbQuote;
    sniper_ready?: boolean;
  }> {
    await this.lockBuyer(q, r.channel_id, r.buyer.id);
    const prior = (
      await q.query<Row>(
        'select * from rb_requests where channel_id = $1 and source = $2 and source_ref = $3',
        [r.channel_id, r.source, r.source_ref.slice(0, 200)],
      )
    )[0];
    const { pricing, quote: price } = await this.quoteFor(
      q,
      r.channel_id,
      r.buyer.id,
    );
    if (prior) return { request: rbView(prior), created: false, quote: price };
    const restricted = await this.restriction(q, r.channel_id, r.buyer.id);
    if (restricted) throw new RbError(409, restricted.code, restricted);
    if ((await this.pending(q, r.channel_id, r.buyer.id)) >= pricing.maxPending)
      throw new RbError(409, 'too_many_pending', {
        max_pending: pricing.maxPending,
      });
    if (price.price > (r.ceiling === 'normal' ? price.normal_price : r.ceiling))
      throw new RbError(409, 'price_changed', {
        price: price.price,
        quote: price,
      });
    let wish: {
      wish_id: string | null;
      wish_login: string | null;
      wish_name: string | null;
      wish_text: string | null;
      sniper: 'armed' | 'unresolved';
    } | null = null;
    let sniperReady = false;
    const typed = cleanWishText(r.wish?.text);
    if (r.wish?.id || typed) {
      const streamer = this.v3.streamer?.();
      const pool = (await this.candidates(q, r.channel_id)).filter(
        (x) => x.id !== r.buyer.id && x.id !== streamer?.id,
      );
      const c = r.wish?.id
        ? pool.find((x) => x.id === r.wish!.id)
        : exactWish(pool, typed!);
      // A picked account must still be aimable; a typed name with no exact account is kept for the moderation.
      if (r.wish?.id && !c) throw new RbError(400, 'wish_unknown');
      wish = c
        ? {
            wish_id: c.id,
            wish_login: c.login,
            wish_name: c.name,
            wish_text: typed ?? c.name,
            sniper: 'armed',
          }
        : {
            wish_id: null,
            wish_login: null,
            wish_name: null,
            wish_text: typed,
            sniper: 'unresolved',
          };
      sniperReady = (
        await sniperWindow(
          q,
          r.channel_id,
          r.buyer.id,
          this.now(),
          pricing.sniperWindowMs,
        )
      ).ready;
    }
    const { request, created } = await this.requestIfNew(r, q);
    await this.set(q, request.request_id, {
      price_paid: price.price,
      series_level: price.level,
      ...(wish ?? {}),
    });
    await economy.debit(q, this.now(), {
      channelId: r.channel_id,
      viewer: { id: r.buyer.id, display_name: r.buyer.name },
      currency: 'tokens',
      amount: price.price,
      module: 'random_ban',
      interactionId: request.request_id,
    });
    return {
      request: {
        ...rbView(await this.row(q, request.request_id)),
      },
      created,
      quote: (await this.quoteFor(q, r.channel_id, r.buyer.id)).quote,
      /** Shown at purchase only: the final decision is taken at the result (§ 4.2). */
      sniper_ready: sniperReady,
    };
  }

  /**
   * Channel points: the buyer's last ACCEPTED redemption (a request) that still counts — failed / canceled ones never
   * hold the cooldown. Returns the ms left (0: free).
   */
  async cpCooldownLeft(q: Queryable, channelId: string, buyerId: string) {
    const { cpCooldownMs } = await this.pricing(q, channelId);
    if (cpCooldownMs <= 0) return 0;
    const last = (
      await q.query<{ created_at: Date }>(
        `select created_at from rb_requests where channel_id = $1 and buyer_id = $2 and source = 'channel_points'
           and status not in ('failed', 'canceled') order by seq desc limit 1`,
        [channelId, buyerId],
      )
    )[0];
    if (!last) return 0;
    return Math.max(
      0,
      new Date(last.created_at).getTime() + cpCooldownMs - this.now().getTime(),
    );
  }

  /**
   * A channel points redemption asks for a Random Ban (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 3): the same redemption
   * again is its request; a buyer under his personal cooldown gets NO request (`cooling_ms` > 0: the caller refunds and
   * explains) — the other viewers are never held. Serialized per buyer: two redemptions at once, one request.
   */
  async requestChannelPoints(r: {
    channel_id: string;
    source_ref: string;
    mode: 'real' | 'dry_run';
    buyer: RbTwitchUser;
    /** false: no cooldown for this redemption (a reward whose points Raptoru cannot give back). */
    cooldown?: boolean;
  }) {
    const { cooldown = true, ...req } = r;
    return this.db.tx(async (q) => {
      await this.lockBuyer(q, r.channel_id, r.buyer.id);
      const prior = (
        await q.query<Row>(
          `select * from rb_requests where channel_id = $1 and source = 'channel_points' and source_ref = $2`,
          [r.channel_id, r.source_ref.slice(0, 200)],
        )
      )[0];
      if (prior)
        return { request: rbView(prior), cooling_ms: 0, refused: null };
      const restricted = await this.restriction(q, r.channel_id, r.buyer.id);
      if (restricted?.code === 'viewer_cooldown')
        return {
          request: null,
          cooling_ms: restricted.wait_ms ?? 0,
          refused: 'cooldown' as const,
        };
      if (restricted)
        return {
          request: null,
          cooling_ms: 0,
          refused:
            restricted.code === 'rb_paused'
              ? ('paused' as const)
              : ('blocked' as const),
        };
      // The personal cooldown only where a refused redemption can be refunded (docs/RECOMPENSES_TWITCH.md).
      const left = cooldown
        ? await this.cpCooldownLeft(q, r.channel_id, r.buyer.id)
        : 0;
      if (left > 0)
        return {
          request: null,
          cooling_ms: left,
          refused: 'cooldown' as const,
        };
      const { request } = await this.requestIfNew(
        { ...req, source: 'channel_points' },
        q,
      );
      return { request, cooling_ms: 0, refused: null };
    });
  }

  /** The buyer's own Random Ban figures (the extension's « Mes stats »: this viewer only). */
  private async personalStats(
    q: Queryable,
    channelId: string,
    viewerId: string,
  ) {
    const r =
      (
        await q.query<Record<string, number | string | null>>(
          `select
           count(*) filter (where buyer_id = $2 and status not in ('failed', 'canceled')) as launched,
           count(*) filter (where buyer_id = $2 and status = 'confirmed' and target_id <> buyer_id) as landed,
           count(*) filter (where buyer_id = $2 and status = 'confirmed' and target_id = buyer_id) as self,
           count(*) filter (where buyer_id = $2 and status = 'flop') as flops,
           count(*) filter (where buyer_id <> $2 and status = 'confirmed' and target_id = $2) as received,
           count(*) filter (where buyer_id = $2 and wish_id is not null and sniper <> 'void') as sniper_tries,
           count(*) filter (where buyer_id = $2 and sniper in ('hit', 'glory_hit')) as sniper_hits,
           coalesce(sum(price_paid) filter (where buyer_id = $2 and status not in ('failed', 'canceled')), 0) as spent,
           coalesce(sum((stats->>'sniper_bonus')::int) filter (where buyer_id = $2 and sniper = 'hit'), 0) as earned
         from rb_requests where channel_id = $1 and source <> 'test' and (buyer_id = $2 or target_id = $2)`,
          [channelId, viewerId],
        )
      )[0] ?? {};
    return Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, Number(v ?? 0)]),
    );
  }

  /** What the extension shows one buyer: the price and its gauge, the pending cap, the last own requests. */
  async buyerState(channelId: string, buyerId: string) {
    return this.db.tx(async (q) => {
      const { pricing, quote: price } = await this.quoteFor(
        q,
        channelId,
        buyerId,
      );
      const mine = await q.query<Row>(
        `select * from rb_requests where channel_id = $1 and buyer_id = $2 and source <> 'test'
           order by seq desc limit 10`,
        [channelId, buyerId],
      );
      // The channel's last results (the extension's « Historique »: public — a ban is seen in the chat anyway).
      const recent = await q.query<Row>(
        `select * from rb_requests where channel_id = $1 and source <> 'test'
           and status not in ('queued', 'searching') order by seq desc limit 12`,
        [channelId],
      );
      const streamer = this.v3.streamer?.();
      const window = await sniperWindow(
        q,
        channelId,
        buyerId,
        this.now(),
        pricing.sniperWindowMs,
      );
      const pool = await this.candidates(q, channelId);
      // Who may be aimed at: present viewers, never yourself nor the streamer (identity checked again at purchase).
      const candidates = pool.filter(
        (c) => c.id !== buyerId && c.id !== streamer?.id,
      );
      // Pictures: the cache only (never a Twitch call on a read); the missing ones are fetched in the background.
      const shown = mine.slice(0, 3).flatMap((m) => stripOf(m)?.items ?? []);
      const ids = [
        ...new Set([...candidates.map((c) => c.id), ...shown.map((x) => x.id)]),
      ].slice(0, 300);
      void this.avatars?.ensure(ids.slice(0, 100)).catch(() => {});
      const pics = await this.avatarsOf(q, ids);
      const withPic = <T extends { id: string }>(x: T) => ({
        ...x,
        avatar: pics.get(x.id) ?? null,
      });
      const view = (m: Row, i: number) => {
        const v = rbView(m);
        return i < 3 && v.strip
          ? { ...v, strip: { ...v.strip, items: v.strip.items.map(withPic) } }
          : { ...v, strip: null };
      };
      return {
        price,
        tiers: pricing.tiers,
        step_ms: pricing.stepMs,
        pending: mine.filter((m) => OPEN.includes(m.status)).length,
        max_pending: pricing.maxPending,
        mine: mine.map(view),
        recent: recent.map((m) => ({
          ...rbView(m),
          strip: null,
          stats: null,
          redemption_id: null,
        })),
        sniper: {
          ready: window.ready,
          ready_at: window.ready_at,
          bonus: pricing.sniperBonus,
          window_ms: pricing.sniperWindowMs,
        },
        candidates: candidates.map((c) =>
          withPic({ id: c.id, login: c.login, name: c.name }),
        ),
        // Kept for raptoru.fr (the game screen no longer shows them).
        stats: await this.personalStats(q, channelId, buyerId),
      };
    });
  }

  /** The Twitch profile pictures (the Tombola's cache, lab_viewer_avatars), set by the Core's host. */
  private avatars: { ensure(ids: string[]): Promise<unknown> } | null = null;
  attachAvatars(cache: { ensure(ids: string[]): Promise<unknown> }) {
    this.avatars = cache;
  }
  /** Lab demo: its own fictional pictures (no Twitch). */
  avatarsOf: (q: Queryable, ids: string[]) => Promise<Map<string, string>> =
    async (q, ids) => {
      const ok = (
        await q.query<{ ok: boolean }>(
          `select to_regclass('lab_viewer_avatars') is not null as ok`,
        )
      )[0]?.ok;
      return ok ? avatarUrls(q, ids) : new Map();
    };

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
      source: RbSource;
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
      source: RbSource;
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
  async testStreamerMute(
    channelId: string,
    trigger = 'Test Studio',
    /**
     * « Test Caution Random Ban » (27/10): the same test mute, but a REAL sanction for Caution — `!caution raptoru_`
     * quotes it, `oui` debits the payer's Jetons once and ends it. Refused unless Studio said « OBS ready, mic free »
     * within studioReadyMs. Still never a Twitch call, never in the draw statistics, no chat line, no animation.
     */
    opts: { caution?: boolean } = {},
  ) {
    const streamer = this.v3.streamer?.();
    if (!streamer) throw new RbError(409, 'streamer_unknown');
    if (opts.caution) {
      const s = this.studios.get(channelId);
      if (!s || this.now().getTime() - s.at > RANDOM_BAN.studioReadyMs)
        throw new RbError(409, 'studio_silent');
      if (!s.obs_ready) throw new RbError(409, 'obs_not_ready');
      if (s.mic_held) throw new RbError(409, 'mic_held');
    }
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
          source_ref: `${opts.caution ? CAUTION_TEST : 'streamer'}:${randomUUID()}`,
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
    // Sniper catch-up: an ended request whose prediction is still open (ended by this sweep, a claim refusal, a mute).
    const undecided = await q.query<{ request_id: string }>(
      `select request_id from rb_requests where channel_id = $1 and sniper = 'armed'
         and status <> all($2::text[]) order by seq limit 20`,
      [channelId, OPEN],
    );
    for (const o of undecided) await this.sniper(q, o.request_id, channelId);
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
      // Moderation paused the queue: nothing is handed out (the 2-min expiry refunds what waits too long).
      if (await this.paused(q, channelId))
        return { request: null, reason: 'idle' };
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
      if (r.status === 'timeout_requested' && r.target_id === t.target.id) {
        // The same report again: the same answer, the strike time unchanged (never a new delay).
        const at = (r.stats?.reel as { strike_at?: string } | undefined)
          ?.strike_at;
        const left = at
          ? Math.max(0, Date.parse(at) - this.now().getTime())
          : 0;
        return {
          proceed: true,
          duration_s: r.duration_s!,
          reason: r.reason!,
          ...(left ? { delay_ms: left } : {}),
        };
      }
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
      // Le Viseur (reveal_first): the target is frozen; Studio's reel stops on it, the timeout follows the stop. Only
      // while Studio said it is there (else the historical order: timeout at once, the video after).
      // The strip the extension's reel scrolls (Mini-jeux), built AFTER the draw: the target is frozen, the strip only
      // dresses it (the Sniper's wish is never right beside it). Studio's reel, when on, scrolls the same strip.
      const strip = buildStrip(
        (await this.candidates(q, r.channel_id)).map((c) => ({
          id: c.id,
          name: c.name,
        })),
        { id: t.target.id, name: t.target.name },
        r.wish_id,
        this.draw,
      );
      fields.stats = { ...fields.stats, strip };
      const reel = await this.reelFor(q, r, strip);
      if (reel) fields.stats = { ...fields.stats, reel };
      if (r.mode !== 'real') {
        const done = { ...r, ...fields } as Row;
        await this.set(q, id, {
          ...fields,
          status: 'simulated',
          lease_expires_at: null,
          ended_at: this.now(),
          ...this.animated(r, this.animationFor(done)),
        });
        await this.sniper(q, id, r.channel_id);
        return { proceed: false as const };
      }
      const delay = reel
        ? Date.parse(reel.strike_at) - this.now().getTime()
        : 0;
      await this.set(q, id, {
        ...fields,
        status: 'timeout_requested',
        lease_expires_at: new Date(
          this.now().getTime() + delay + RANDOM_BAN.timeoutLeaseMs,
        ),
      });
      return {
        proceed: true as const,
        duration_s: duration,
        reason,
        ...(delay > 0 ? { delay_ms: delay } : {}),
      };
    });
  }

  /** The reel of a request whose target was just drawn, or null (sequence off, Studio absent, the streamer). */
  private async reelFor(
    q: Queryable,
    r: Row,
    strip: { items: ReelItem[]; stop: number },
  ) {
    const p = await this.pricing(q, r.channel_id);
    if (!p.revealFirst) return null;
    const studio = this.studios.get(r.channel_id);
    if (!studio || this.now().getTime() - studio.at > RANDOM_BAN.studioReadyMs)
      return null;
    return {
      ...strip,
      status: 'pending' as const,
      duration_ms: REEL_MS,
      strike_at: new Date(
        this.now().getTime() + REEL_MS + p.strikeOffsetMs,
      ).toISOString(),
    };
  }

  /** Updates the reel's state (or its dodge card) in the request's stats. */
  private async setReel(
    q: Queryable,
    id: string,
    patch: Record<string, unknown>,
  ) {
    await q.query(
      `update rb_requests set stats = jsonb_set(stats, '{reel}', coalesce(stats->'reel', '{}'::jsonb) || $2::jsonb),
         updated_at = $3 where request_id = $1`,
      [id, JSON.stringify(patch), this.now()],
    );
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
      else if (o.event === 'refused' && settles) {
        await this.set(q, id, {
          status: 'failed',
          error: (o.error ?? 'refused').slice(0, 300),
          refund: 'needed',
          lease_expires_at: null,
          ended_at: now,
        });
        // The reel already showed the drawn viewer: the stream sees « Esquivé ! » (never « BANNI »), refunded.
        if (r.stats?.reel) await this.setReel(q, id, { dodge: 'pending' });
      } else if (o.event === 'uncertain' && r.status === 'timeout_requested')
        await this.set(q, id, {
          status: 'uncertain',
          error: (o.error ?? 'uncertain').slice(0, 300),
          refund: 'to_verify',
          lease_expires_at: null,
          ended_at: now,
        });
      await this.sniper(q, id, r.channel_id);
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
      const viseur = await this.claimReel(q, channelId, consumerId);
      if (viseur) return { animation: viseur };
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

  /**
   * Le Viseur: a reel to play now (before the strike; too late → skipped, never a reel after the fact), or a dodge
   * card. One at a time; the reel's state lives in the request's stats (no column).
   */
  private async claimReel(q: Queryable, channelId: string, consumerId: string) {
    const r = (
      await q.query<Row>(
        `select * from rb_requests where channel_id = $1
           and (stats->'reel'->>'status' = 'pending' or stats->'reel'->>'dodge' = 'pending')
         order by seq limit 1 for update`,
        [channelId],
      )
    )[0];
    if (!r) return null;
    const reel = r.stats!.reel as {
      items: ReelItem[];
      stop: number;
      status: string;
      dodge?: string;
      duration_ms: number;
      strike_at: string;
    };
    const base = {
      request_id: r.request_id,
      trigger: r.buyer_name,
      banned: r.target_name,
    };
    if (reel.status === 'pending') {
      if (this.now().getTime() > Date.parse(reel.strike_at)) {
        await this.setReel(q, r.request_id, { status: 'skipped' });
        return null;
      }
      await this.setReel(q, r.request_id, {
        status: 'playing',
        consumer: consumerId,
      });
      return {
        ...base,
        animation: 'reel' as const,
        reel: {
          target: { id: r.target_id!, name: r.target_name ?? '' },
          items: reel.items,
          stop: reel.stop,
          self: r.target_id === r.buyer_id,
          wish: r.wish_name,
          duration_ms: reel.duration_ms,
        },
      };
    }
    await this.setReel(q, r.request_id, {
      dodge: 'playing',
      consumer: consumerId,
    });
    return {
      ...base,
      animation: 'dodge' as const,
      reel: {
        target: { id: r.target_id!, name: r.target_name ?? '' },
        items: [],
        stop: 0,
        self: false,
        wish: null,
        duration_ms: 2_500,
      },
    };
  }

  async reportAnimation(id: string, a: RbAnimationReport) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, id, true);
      // Le Viseur: the reel's or the dodge's report (its own state, not the result's animation).
      const reel = r.stats?.reel as
        { status?: string; dodge?: string; consumer?: string } | undefined;
      if (
        reel &&
        reel.consumer === a.consumer_id &&
        (reel.status === 'playing' || reel.dodge === 'playing')
      ) {
        await this.setReel(
          q,
          id,
          reel.status === 'playing' ? { status: a.event } : { dodge: a.event },
        );
        return { animation_status: a.event };
      }
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

  /**
   * Caution (CautionMutes): the streamer's running Random Ban mute — never a plain Studio test, but a « Test Caution
   * Random Ban » is one (decided 27/10); its id is `rb:<request>`.
   */
  readonly mutes = {
    kind: 'random_ban' as const,
    label: 'Random Ban',
    active: async (q: Queryable, channelId: string) => {
      const m = (
        await q.query<Row>(
          `select * from rb_requests where channel_id = $1 and reason = $2 and status = 'confirmed'
             and lease_expires_at > $3 and (source <> 'test' or source_ref like $4) order by seq limit 1`,
          [channelId, STREAMER_MUTE, this.now(), `${CAUTION_TEST}:%`],
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
