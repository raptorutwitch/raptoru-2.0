import { createHash } from 'node:crypto';
import type {
  LoyaltyConfig,
  LoyaltyEvent,
  LoyaltyEventResponse,
  SubscriptionSnapshot,
  Viewer,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type {
  PresenceListener,
  ValidatedPresence,
} from '../presence/presence-service.js';
import { ensureViewers, type WalletService } from '../wallet/wallet-service.js';
import {
  passiveReward,
  progressiveReward,
  subgiftReward,
  subReward,
} from './calc.js';
import { loadLoyaltyConfig, saveLoyaltyConfig } from './config.js';
import { buildLoyaltyReport, latestLoyaltyStreamId } from './report.js';
import {
  applySnapshot,
  endSubscription,
  resolveTiers,
  setSubscription,
} from './tiers.js';

// source event → Loyalty calculation → Wallet. Presence and Twitch never see amounts; the Wallet
// never sees Twitch or presence. Three modes per family (passive / events):
//   shadow  (no flag)          : nothing computed;
//   preview (LOYALTY_PREVIEW)  : reward computed and stored with its breakdown, no Wallet write;
//   credit  (*_CREDITS flags)  : same, then an idempotent Wallet credit.

export interface LoyaltyModes {
  preview: boolean;
  passiveCredits: boolean;
  eventCredits: boolean;
}

export const SHADOW_MODES: LoyaltyModes = {
  preview: false,
  passiveCredits: false,
  eventCredits: false,
};

export type RewardMode = 'shadow' | 'preview' | 'credit';

export function rewardMode(
  family: 'passive' | 'event',
  m: LoyaltyModes,
): RewardMode {
  if (family === 'passive' ? m.passiveCredits : m.eventCredits) return 'credit';
  return m.preview ? 'preview' : 'shadow';
}

export class LoyaltyIdempotencyError extends Error {}

type RewardStatus =
  'preview' | 'pending' | 'credited' | 'excluded' | 'tier_unknown' | 'rejected';
type RewardSource =
  'passive_watch' | 'sub' | 'resub' | 'subgift' | 'bits' | 'tip' | 'follow';

interface NewReward {
  key: string;
  hashPayload: unknown;
  source: RewardSource;
  viewerId: string;
  streamId: string | null;
  currencyId: string;
  amount: number | null;
  status: RewardStatus;
  breakdown: unknown;
}

/** Whether the event happened at or before the cutoff of the applied opening import of the currency. */
async function occurredBeforeCutover(
  q: Queryable,
  currencyId: string,
  occurredAt: string,
) {
  const cutoff = (
    await q.query<{ cutoff: Date }>(
      'select cutoff from wallet_imports where currency_id = $1',
      [currencyId],
    )
  )[0]?.cutoff;
  return (
    !!cutoff && new Date(occurredAt).getTime() <= new Date(cutoff).getTime()
  );
}

const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function insertReward(
  q: Queryable,
  r: NewReward,
): Promise<{
  id: number;
  status: RewardStatus;
  amount: number | null;
  replayed: boolean;
}> {
  const requestHash = hash([r.source, r.hashPayload]);
  const inserted = (
    await q.query<{ id: number }>(
      `insert into loyalty_rewards (idempotency_key, request_hash, source, twitch_user_id, stream_id, currency_id,
         amount, status, breakdown)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (idempotency_key) do nothing returning id`,
      [
        r.key,
        requestHash,
        r.source,
        r.viewerId,
        r.streamId,
        r.currencyId,
        r.amount,
        r.status,
        JSON.stringify(r.breakdown),
      ],
    )
  )[0];
  if (inserted)
    return {
      id: inserted.id,
      status: r.status,
      amount: r.amount,
      replayed: false,
    };
  const prior = (
    await q.query<{
      id: number;
      request_hash: string;
      status: RewardStatus;
      amount: number | null;
    }>(
      'select id, request_hash, status, amount from loyalty_rewards where idempotency_key = $1',
      [r.key],
    )
  )[0]!;
  if (prior.request_hash !== requestHash) {
    throw new LoyaltyIdempotencyError(
      `reward key ${r.key} already used for a different event`,
    );
  }
  return {
    id: prior.id,
    status: prior.status,
    amount: prior.amount,
    replayed: true,
  };
}

export class LoyaltyEngine {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly wallet: WalletService,
    readonly modes: LoyaltyModes,
    private readonly log: (...args: unknown[]) => void = console.error,
  ) {}

  // --- passive (presence) ---------------------------------------------------------------------

  /** Listener given to the Presence tracker: runs inside the presence cycle transaction. */
  readonly presenceListener: PresenceListener = {
    validated: (q, v) => this.onValidatedPresence(q, v),
    committed: () => this.processPending().then(() => undefined),
  };

  /**
   * Accumulates validated presence per stream and viewer; each full interval becomes one passive
   * tick with a durable key (passive:{stream}:{viewer}:{n}): restarts and replays never pay twice,
   * unobserved gaps never count (only validated intervals reach this point).
   */
  async onValidatedPresence(q: Queryable, v: ValidatedPresence): Promise<void> {
    const mode = rewardMode('passive', this.modes);
    if (mode === 'shadow' || v.viewerIds.length === 0 || v.seconds <= 0) return;
    // Excluded accounts (system bots…) never enter the passive aggregation: no progress, no tick.
    // Their presence stays recorded by the Presence tracker for diagnostics.
    const excluded = new Set(
      (
        await q.query<{ twitch_user_id: string }>(
          'select twitch_user_id from loyalty_exclusions where twitch_user_id = any($1::text[])',
          [v.viewerIds],
        )
      ).map((r) => r.twitch_user_id),
    );
    const eligible = v.viewerIds.filter((id) => !excluded.has(id));
    if (!eligible.length) return;
    const config = await loadLoyaltyConfig(q);
    const intervalSeconds = config.passive.intervalMinutes * 60;

    const progress = await q.query<{
      twitch_user_id: string;
      validated_seconds: number;
      ticks: number;
    }>(
      `insert into loyalty_passive_progress as p (stream_id, twitch_user_id, validated_seconds)
       select $1, id, $2 from unnest($3::text[]) as id
       on conflict (stream_id, twitch_user_id) do update set
         validated_seconds = p.validated_seconds + excluded.validated_seconds, updated_at = now()
       returning twitch_user_id, validated_seconds, ticks`,
      [v.streamId, v.seconds, eligible],
    );
    const due = progress
      .map((p) => ({
        ...p,
        reached: Math.floor(p.validated_seconds / intervalSeconds),
      }))
      .filter((p) => p.reached > p.ticks);
    if (!due.length) return;

    const ids = due.map((d) => d.twitch_user_id);
    const tiers = await resolveTiers(q, ids, v.at);
    const overrides = new Map(
      (
        await q.query<{ twitch_user_id: string; multiplier: string }>(
          'select twitch_user_id, multiplier from viewer_loyalty_rates where twitch_user_id = any($1::text[])',
          [ids],
        )
      ).map((r) => [r.twitch_user_id, Number(r.multiplier)]),
    );

    for (const d of due) {
      const breakdown = passiveReward(
        config,
        tiers.get(d.twitch_user_id)!,
        overrides.get(d.twitch_user_id) ?? null,
        false,
      );
      const status: RewardStatus =
        breakdown.final === null
          ? 'tier_unknown'
          : mode === 'credit'
            ? 'pending'
            : 'preview';
      for (let tick = d.ticks + 1; tick <= d.reached; tick++) {
        await insertReward(q, {
          key: `passive:${v.streamId}:${d.twitch_user_id}:${tick}`,
          hashPayload: { stream: v.streamId, viewer: d.twitch_user_id, tick },
          source: 'passive_watch',
          viewerId: d.twitch_user_id,
          streamId: v.streamId,
          currencyId: config.currencyId,
          amount: breakdown.final,
          status,
          breakdown: { ...breakdown, tick, mode },
        });
      }
      await q.query(
        'update loyalty_passive_progress set ticks = $3 where stream_id = $1 and twitch_user_id = $2',
        [v.streamId, d.twitch_user_id, d.reached],
      );
    }
  }

  // --- Twitch / tip events --------------------------------------------------------------------

  async handleEvent(event: LoyaltyEvent): Promise<LoyaltyEventResponse> {
    const mode = rewardMode('event', this.modes);
    const skipped = (reason: string): LoyaltyEventResponse => ({
      rewardId: null,
      status: 'skipped',
      amount: null,
      replayed: false,
      reason,
    });

    const response = await this.db.tx(async (q) => {
      // Subscription state is kept in every mode (it is not economy).
      if (event.type === 'sub' || event.type === 'resub') {
        await setSubscription(
          q,
          event.viewer,
          event.tier,
          event.type === 'sub' && event.isGift,
        );
      }
      if (event.type === 'subscription_end') {
        await endSubscription(q, event.viewer.twitchUserId);
        return skipped('state_only');
      }
      if (mode === 'shadow') return skipped('shadow_mode');
      const config = await loadLoyaltyConfig(q);
      const reward = this.eventReward(config, event);
      if ('skip' in reward) return skipped(reward.skip);

      await ensureViewers(q, [reward.viewer]);
      // Cutover boundary (Astra B5): an event that happened before the opening snapshot of the currency was paid by
      // the previous economy (its balance is in the opening) — recorded, never paid again here.
      const beforeCutover =
        mode === 'credit' &&
        !!event.occurredAt &&
        (await occurredBeforeCutover(q, config.currencyId, event.occurredAt));
      const r = await insertReward(q, {
        key: reward.key,
        hashPayload: reward.hashPayload,
        source: reward.source,
        viewerId: reward.viewer.twitchUserId,
        streamId: null,
        currencyId: config.currencyId,
        amount: reward.amount,
        status: beforeCutover
          ? 'excluded'
          : mode === 'credit'
            ? 'pending'
            : 'preview',
        breakdown: {
          ...reward.breakdown,
          mode,
          eventId: event.eventId,
          ...(beforeCutover ? { excluded: 'before_cutover' } : {}),
        },
      });
      return {
        rewardId: r.id,
        status: r.status,
        amount: r.amount,
        replayed: r.replayed,
        reason: r.status === 'excluded' ? 'before_cutover' : null,
      };
    });

    if (response.status === 'pending' && !response.replayed)
      await this.processPending();
    return response;
  }

  private eventReward(
    config: LoyaltyConfig,
    e: LoyaltyEvent,
  ):
    | { skip: string }
    | {
        key: string;
        hashPayload: unknown;
        source: RewardSource;
        viewer: Viewer;
        amount: number;
        breakdown: object;
      } {
    switch (e.type) {
      case 'sub':
        if (e.isGift) return { skip: 'gift_recipient' }; // the gifter is rewarded by the subgift event
        return this.oneOff(e, 'sub', e.viewer, {
          source: 'sub',
          ...subReward(config, e.tier),
        });
      case 'resub':
        return this.oneOff(e, 'resub', e.viewer, {
          source: 'resub',
          ...subReward(config, e.tier),
        });
      case 'subgift':
        if (!e.gifter) return { skip: 'anonymous_gift' };
        return this.oneOff(e, 'subgift', e.gifter, {
          source: 'subgift',
          ...subgiftReward(config, e.tier, e.count),
        });
      case 'bits':
        if (!e.viewer) return { skip: 'anonymous_bits' };
        return this.oneOff(e, 'bits', e.viewer, {
          source: 'bits',
          ...progressiveReward(e.bits, config.bits.brackets),
        });
      case 'tip':
        if (!e.viewer) return { skip: 'anonymous_tip' };
        return this.oneOff(e, 'tip', e.viewer, {
          source: 'tip',
          provider: e.provider,
          currency: e.currency,
          ...progressiveReward(e.amountCents, config.tips.brackets),
        });
      case 'follow':
        // Once per Twitch identity, ever: an unfollow/refollow replays the first reward.
        return {
          key: `follow:${e.viewer.twitchUserId}`,
          hashPayload: { viewer: e.viewer.twitchUserId },
          source: 'follow',
          viewer: e.viewer,
          amount: config.follow.amount,
          breakdown: {
            source: 'follow',
            base: config.follow.amount,
            final: config.follow.amount,
          },
        };
      case 'subscription_end':
        return { skip: 'state_only' };
    }
  }

  private oneOff(
    e: LoyaltyEvent,
    source: RewardSource,
    viewer: Viewer,
    breakdown: { source: string; final: number; [detail: string]: unknown },
  ) {
    // The Twitch time is not the event's identity (a redelivery may carry another one).
    const { eventId, type, ...payload } = e;
    delete payload.occurredAt;
    return {
      key: `twitch:${type}:${eventId}`,
      hashPayload: payload,
      source,
      viewer,
      amount: breakdown.final,
      breakdown,
    };
  }

  async applySubscriptionSnapshot(
    snapshot: SubscriptionSnapshot,
  ): Promise<{ subscribers: number }> {
    return { subscribers: await this.db.tx((q) => applySnapshot(q, snapshot)) };
  }

  // --- Wallet credits -------------------------------------------------------------------------

  /**
   * Sends pending rewards to the Wallet (idempotent key per reward). Safe to run concurrently from
   * several Core instances: the Wallet key makes a duplicate call a replay.
   */
  async processPending(): Promise<number> {
    const sources = [
      ...(this.modes.passiveCredits ? ['passive_watch'] : []),
      ...(this.modes.eventCredits
        ? ['sub', 'resub', 'subgift', 'bits', 'tip', 'follow']
        : []),
    ];
    if (!sources.length) return 0;
    let done = 0;
    for (;;) {
      const batch = await this.db.query<{
        id: number;
        idempotency_key: string;
        source: RewardSource;
        twitch_user_id: string;
        login: string;
        display_name: string;
        currency_id: string;
        amount: number;
      }>(
        `select r.id, r.idempotency_key, r.source, r.twitch_user_id, v.login, v.display_name, r.currency_id, r.amount
         from loyalty_rewards r join viewers v using (twitch_user_id)
         where r.status = 'pending' and r.source = any($1::text[]) order by r.id limit 100`,
        [sources],
      );
      if (!batch.length) return done;
      for (const r of batch) {
        try {
          if (r.amount === 0) {
            await this.markCredited(r.id, null);
          } else {
            const result = await this.wallet.credit({
              key: `loyalty:${r.idempotency_key}`,
              viewer: {
                twitchUserId: r.twitch_user_id,
                login: r.login,
                displayName: r.display_name,
              },
              amount: r.amount,
              kind: 'reward',
              source: `loyalty:${r.source}`,
              reference: r.idempotency_key,
              currencyId: r.currency_id,
            });
            if (result.status === 'applied')
              await this.markCredited(r.id, result.operationId);
            else {
              await this.db.query(
                "update loyalty_rewards set status = 'rejected', error = $2 where id = $1 and status = 'pending'",
                [r.id, result.rejection],
              );
            }
          }
          done++;
        } catch (error) {
          this.log(
            '[loyalty] credit failed, will retry',
            r.idempotency_key,
            (error as Error).message,
          );
          return done;
        }
      }
    }
  }

  private async markCredited(id: number, operationId: number | null) {
    await this.db.query(
      "update loyalty_rewards set status = 'credited', wallet_operation_id = $2, credited_at = now() where id = $1 and status = 'pending'",
      [id, operationId],
    );
  }

  // --- admin ----------------------------------------------------------------------------------

  getConfig() {
    return loadLoyaltyConfig(this.db);
  }

  setConfig(config: LoyaltyConfig, actor: string) {
    return saveLoyaltyConfig(this.db, config, actor);
  }

  listExclusions() {
    return this.db.query(
      `select e.twitch_user_id, v.login, e.reason, e.created_by, e.created_at from loyalty_exclusions e
       join viewers v using (twitch_user_id) order by v.login`,
    );
  }

  async exclude(viewer: Viewer, reason: string, actor: string): Promise<void> {
    await ensureViewers(this.db, [viewer]);
    await this.db.query(
      `insert into loyalty_exclusions (twitch_user_id, reason, created_by) values ($1, $2, $3)
       on conflict (twitch_user_id) do update set reason = excluded.reason, created_by = excluded.created_by`,
      [viewer.twitchUserId, reason, actor],
    );
  }

  async unexclude(twitchUserId: string): Promise<void> {
    await this.db.query(
      'delete from loyalty_exclusions where twitch_user_id = $1',
      [twitchUserId],
    );
  }

  /** Preview/credit report of a stream (or the latest one with passive data). */
  async report(streamId: string | 'latest') {
    const id =
      streamId === 'latest' ? await latestLoyaltyStreamId(this.db) : streamId;
    return id ? buildLoyaltyReport(this.db, id, this.clock.now()) : null;
  }

  /** Full breakdowns (Studio/admin only, never in chat). */
  async rewardsOf(twitchUserId: string, limit = 100) {
    return {
      tier: (await resolveTiers(this.db, [twitchUserId], this.clock.now())).get(
        twitchUserId,
      ),
      rewards: await this.db.query(
        `select id, source, stream_id, amount, status, breakdown, wallet_operation_id, error, created_at, credited_at
         from loyalty_rewards where twitch_user_id = $1 order by id desc limit $2`,
        [twitchUserId, limit],
      ),
    };
  }
}
