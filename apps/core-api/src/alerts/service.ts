import { randomUUID } from 'node:crypto';
import {
  type AlertAckRequest,
  type AlertEventInput,
  type AlertEventOutcome,
  type AlertFamily,
  alertFamilyOf,
  type AlertStatus,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import {
  alertData,
  type AlertProfile,
  decideAlert,
  type Rng,
} from './rules.js';
import type { AlertVariant } from './variants.js';

// Twitch alerts V1 (Lab) — the durable queue (docs/TWITCH_ALERTS_PARITY_2026-10.md § 7). Conventions of the
// Soundboard / TTS queues: a channel row lock serializes the claims, each claim gets an attempt id and a lease, a
// sweep settles abandoned work, a started alert is never replayed.
//
// Delivery policy (at most once once it started; never « exactly once »):
// - queued → claimed (attempt, 15 s lease to report « started ») → playing (lease = media / timings + 15 s) →
//   completed. A failure reported by the player → failed (kept for diagnosis, not replayed).
// - claimed, lease over, never started (Studio crashed before the player began): back to queued, up to 3 attempts,
//   then expired — the viewer never saw it, so it is offered again.
// - playing, lease over, no « completed »: expired (it may have been seen): never replayed.
// - one alert in flight per channel AND family (unique index, 17/10/2026): follow, subscription (sub + gifts), bits,
//   raid and donation play side by side; inside a family strictly first in, first out (arrival order; the legacy
//   priority is kept on the row for information but no longer lets a later alert overtake an earlier one).
// - freshness (lot 9, OFF unless maxAgeMs is set — no value chosen yet): an event whose Twitch time is older than
//   maxAgeMs at reception, or an alert still waiting maxAgeMs after it, is recorded « expired » (failure « stale »),
//   never animated. Only the animation is dropped: the Roue du Sub gain and Loyalty never depend on it.
// Alerts never touch the wallet, the loyalty engine or any other economy.

export const ALERT_RULES = {
  claimLeaseMs: 15_000,
  playMarginMs: 15_000,
  /** When neither the media length nor the timings are known (raid). */
  defaultPlayMs: 10_000,
  maxAttempts: 3,
} as const;

const STALE_FAILURE = JSON.stringify({
  code: 'stale',
  message: 'older than the freshness limit: recorded, not animated',
});

export class AlertError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

interface ItemRow {
  alert_id: string;
  channel_id: string;
  seq: string | number;
  type: string;
  family: AlertFamily;
  variant_id: string;
  variant: AlertVariant;
  data: Record<string, unknown>;
  priority: number;
  status: AlertStatus;
  consumer_id: string | null;
  attempt_id: string | null;
  attempts: number;
  lease_expires_at: Date | null;
  created_at: Date;
  claimed_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  failure: Record<string, unknown> | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export const alertView = (r: ItemRow) => ({
  alert_id: r.alert_id,
  channel_id: r.channel_id,
  type: r.type,
  family: r.family,
  variant_id: r.variant_id,
  variant: r.variant,
  data: r.data,
  priority: r.priority,
  status: r.status,
  consumer_id: r.consumer_id,
  attempt_id: r.attempt_id,
  attempts: r.attempts,
  lease_expires_at: iso(r.lease_expires_at),
  created_at: iso(r.created_at),
  claimed_at: iso(r.claimed_at),
  started_at: iso(r.started_at),
  ended_at: iso(r.ended_at),
  failure: r.failure,
});
export type AlertView = ReturnType<typeof alertView>;

/** How long the player may take once started: media length or last timing, plus a margin. */
export function playLeaseMs(v: AlertVariant) {
  const base = Math.max(
    v.duration ?? 0,
    v.mediaMs ?? 0,
    v.hideAt ?? 0,
    ...(v.subtitles ?? []).map((s) => s.hideAt),
  );
  return (base || ALERT_RULES.defaultPlayMs) + ALERT_RULES.playMarginMs;
}

/** Called once per NEW event, inside its reception transaction (a redelivered event never reaches it). */
export type AlertListener = (q: Queryable, e: AlertEventInput) => Promise<void>;

const ALL_BALLON = {
  sub: [1, 2, 3, 4],
  prime: [1, 2, 3, 4],
  resub: [1, 2, 3, 4],
};

export class AlertsService {
  private readonly listeners: { name: string; fn: AlertListener }[] = [];

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly rng: Rng = Math.random,
    /** Freshness of the animation (null: off). */
    readonly maxAgeMs: number | null = null,
  ) {}

  /**
   * Boutique d'événement (docs/HALLOWEEN.md): Bonbons for subs / gifts. A listener runs alone in a savepoint: its
   * failure is logged and undone, never the alert's.
   */
  attachListener(name: string, fn: AlertListener) {
    this.listeners.push({ name, fn });
  }

  private async notify(q: Queryable, e: AlertEventInput) {
    for (const [i, l] of this.listeners.entries()) {
      const sp = `alert_listener_${i}`;
      await q.query(`savepoint ${sp}`);
      try {
        await l.fn(q, e);
        await q.query(`release savepoint ${sp}`);
      } catch (error) {
        await q.query(`rollback to savepoint ${sp}`);
        console.error(
          `[alerts] listener ${l.name} failed`,
          (error as Error).message,
        );
      }
    }
  }

  now() {
    return this.clock.now();
  }

  /** Too old to animate (Twitch time, when the source gives it). */
  isStale(e: Pick<AlertEventInput, 'occurred_at'>) {
    return (
      this.maxAgeMs !== null &&
      !!e.occurred_at &&
      this.clock.now().getTime() - Date.parse(e.occurred_at) > this.maxAgeMs
    );
  }

  /**
   * The channel's alert profile: Halloween when the event shop's rules say so (docs/HALLOWEEN.md § 14). No row, no
   * table yet, a read error: the usual alerts (an alert is never lost to its profile).
   */
  private async profile(
    q: Queryable,
    channelId: string,
  ): Promise<AlertProfile> {
    await q.query('savepoint alert_profile');
    try {
      const r = await q.query<{ rules: Record<string, unknown> | null }>(
        'select rules from event_shop_settings where channel_id = $1',
        [channelId],
      );
      await q.query('release savepoint alert_profile');
      const rules = r[0]?.rules ?? {};
      const pool = (v: unknown) => {
        const ok = Array.isArray(v)
          ? v.filter((n) => Number.isInteger(n) && n >= 1 && n <= 4)
          : [];
        return ok.length ? (ok as number[]) : [1, 2, 3, 4];
      };
      const b = (rules.halloween_ballon ?? {}) as Record<string, unknown>;
      return {
        halloween: rules.halloween_alerts === true,
        ballon: {
          sub: pool(b.sub),
          prime: pool(b.prime),
          resub: pool(b.resub),
        },
      };
    } catch {
      await q.query('rollback to savepoint alert_profile');
      return { halloween: false, ballon: ALL_BALLON };
    }
  }

  /** Last event received from a source (Studio: « dernier événement Twitch réel »). */
  async lastReceived(channelId: string, source: AlertEventInput['source']) {
    const r = (
      await this.db.query<{ at: Date | null }>(
        'select max(received_at) as at from alert_events where channel_id = $1 and source = $2',
        [channelId, source],
      )
    )[0];
    return r?.at ? new Date(r.at).toISOString() : null;
  }

  /** One normalized event: deduplicated, decided (variant drawn once), queued when it makes an alert. */
  async receive(e: AlertEventInput): Promise<{
    outcome: AlertEventOutcome;
    alert: AlertView | null;
  }> {
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      const stored = await this.profile(q, e.channel_id);
      // A Studio test may ask for the Halloween variants without switching the channel's profile.
      const profile =
        e.source === 'simulation' && e.test_profile === 'halloween'
          ? { ...stored, halloween: true }
          : stored;
      const decision = decideAlert(e, this.rng, profile);
      const outcome = decision.outcome;
      const inserted = await q.query(
        `insert into alert_events (channel_id, source, source_event_id, type, payload, outcome, received_at)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning 1`,
        [
          e.channel_id,
          e.source,
          e.source_event_id,
          e.type,
          JSON.stringify(e),
          outcome,
          now,
        ],
      );
      if (!inserted.length) {
        // Redelivery: the first reception already decided; nothing new.
        const prior = (
          await q.query<{ alert_id: string | null }>(
            'select alert_id from alert_events where channel_id = $1 and source = $2 and source_event_id = $3',
            [e.channel_id, e.source, e.source_event_id],
          )
        )[0];
        return {
          outcome: 'duplicate' as const,
          alert: prior?.alert_id ? await this.byId(q, prior.alert_id) : null,
        };
      }
      await this.notify(q, e);
      if (decision.outcome !== 'queued') return { outcome, alert: null };
      const alertId = randomUUID();
      // Too old (outbox resumed after a long outage): kept in the history, never animated.
      const stale = this.isStale(e);
      await q.query(
        `insert into alert_items (alert_id, channel_id, type, family, variant_id, variant, data, priority, status,
           created_at, ended_at, failure)
         values ($1, $2, $3, $9, $4, $5, $6, $7, $10, $8, $11, $12)`,
        [
          alertId,
          e.channel_id,
          e.type,
          decision.variant.id,
          JSON.stringify(decision.variant),
          JSON.stringify(alertData(e)),
          decision.variant.priority,
          now,
          alertFamilyOf(e.type),
          stale ? 'expired' : 'queued',
          stale ? now : null,
          stale ? STALE_FAILURE : null,
        ],
      );
      await q.query(
        'update alert_events set alert_id = $4 where channel_id = $1 and source = $2 and source_event_id = $3',
        [e.channel_id, e.source, e.source_event_id, alertId],
      );
      return { outcome, alert: await this.byId(q, alertId) };
    });
  }

  /** Waiting, in flight and the last finished alerts of a channel (Studio supervision). */
  async state(channelId: string) {
    await this.db.tx((q) => this.sweep(q, channelId));
    const rows = await this.db.query<ItemRow>(
      `select * from alert_items where channel_id = $1 and status in ('queued', 'claimed', 'playing')
       order by (status = 'queued'), seq`,
      [channelId],
    );
    const recent = await this.db.query<ItemRow>(
      `select * from alert_items where channel_id = $1 and status in ('completed', 'failed', 'expired')
       order by ended_at desc limit 20`,
      [channelId],
    );
    return {
      channel_id: channelId,
      max_age_ms: this.maxAgeMs,
      in_flight: rows.filter((r) => r.status !== 'queued').map(alertView),
      queued: rows.filter((r) => r.status === 'queued').map(alertView),
      recent: recent.map(alertView),
    };
  }

  async get(alertId: string) {
    const a = await this.byId(this.db, alertId);
    if (!a) throw new AlertError(404, 'alert_not_found');
    return a;
  }

  /**
   * The next alert for this consumer: the oldest waiting one among the families with nothing in flight (one at a time
   * per family), or null. A player playing several families calls again until null.
   */
  async claim(channelId: string, consumerId: string) {
    return this.db.tx(async (q) => {
      await q.query(
        'insert into alert_channels (channel_id) values ($1) on conflict do nothing',
        [channelId],
      );
      await q.query(
        'select 1 from alert_channels where channel_id = $1 for update',
        [channelId],
      );
      await this.sweep(q, channelId);
      const next = (
        await q.query<{ alert_id: string }>(
          `select i.alert_id from alert_items i
           where i.channel_id = $1 and i.status = 'queued'
             and not exists (select 1 from alert_items b where b.channel_id = i.channel_id and b.family = i.family
               and b.status in ('claimed', 'playing'))
           order by i.seq limit 1`,
          [channelId],
        )
      )[0];
      if (!next) return null;
      const now = this.clock.now();
      await q.query(
        `update alert_items set status = 'claimed', consumer_id = $2, attempt_id = $3, attempts = attempts + 1,
           claimed_at = $4, lease_expires_at = $5 where alert_id = $1`,
        [
          next.alert_id,
          consumerId,
          randomUUID(),
          now,
          new Date(now.getTime() + ALERT_RULES.claimLeaseMs),
        ],
      );
      return this.byId(q, next.alert_id);
    });
  }

  /**
   * The player's report for its attempt. Idempotent: the same report twice changes nothing; a late report after the
   * alert ended (expired, other attempt) is refused with 409, the final state is kept.
   */
  async ack(alertId: string, a: AlertAckRequest) {
    return this.db.tx(async (q) => {
      const ch = (
        await q.query<{ channel_id: string }>(
          'select channel_id from alert_items where alert_id = $1',
          [alertId],
        )
      )[0];
      if (!ch) throw new AlertError(404, 'alert_not_found');
      await q.query(
        'select 1 from alert_channels where channel_id = $1 for update',
        [ch.channel_id],
      );
      await this.sweep(q, ch.channel_id);
      const cur = (await this.byId(q, alertId))!;
      const now = this.clock.now();
      const final = ['completed', 'failed', 'expired'].includes(cur.status);
      if (a.family && a.family !== cur.family)
        throw new AlertError(409, 'family_mismatch');
      if (
        cur.attempt_id !== a.attempt_id ||
        cur.consumer_id !== a.consumer_id
      ) {
        // The same final report again (attempt ids are cleared only on requeue): accepted as is.
        throw new AlertError(409, final ? 'alert_ended' : 'attempt_mismatch');
      }
      if (final) {
        const same =
          (a.event === 'completed' && cur.status === 'completed') ||
          (a.event === 'failed' && cur.status === 'failed');
        if (same) return cur;
        throw new AlertError(409, 'alert_ended');
      }
      if (a.event === 'started') {
        if (cur.status === 'playing') return cur;
        await q.query(
          `update alert_items set status = 'playing', started_at = $2, lease_expires_at = $3 where alert_id = $1`,
          [alertId, now, new Date(now.getTime() + playLeaseMs(cur.variant))],
        );
      } else if (a.event === 'completed') {
        await q.query(
          `update alert_items set status = 'completed', ended_at = $2, lease_expires_at = null where alert_id = $1`,
          [alertId, now],
        );
      } else {
        await q.query(
          `update alert_items set status = 'failed', ended_at = $2, lease_expires_at = null, failure = $3 where alert_id = $1`,
          [
            alertId,
            now,
            JSON.stringify({ code: 'player_failed', message: a.error ?? null }),
          ],
        );
      }
      return (await this.byId(q, alertId))!;
    });
  }

  /** Abandoned work (policy at the top): never turned into a success. */
  private async sweep(q: Queryable, channelId: string) {
    const now = this.clock.now();
    await q.query(
      `update alert_items set status = 'expired', ended_at = $2, lease_expires_at = null,
         failure = '{"code":"lease_expired_playing","message":"started, no end report before the lease ended"}'::jsonb
       where channel_id = $1 and status = 'playing' and lease_expires_at < $2`,
      [channelId, now],
    );
    await q.query(
      `update alert_items set status = 'expired', ended_at = $2, lease_expires_at = null,
         failure = '{"code":"never_started","message":"claimed but never started, attempts exhausted"}'::jsonb
       where channel_id = $1 and status = 'claimed' and lease_expires_at < $2 and attempts >= $3`,
      [channelId, now, ALERT_RULES.maxAttempts],
    );
    await q.query(
      `update alert_items set status = 'queued', consumer_id = null, attempt_id = null, lease_expires_at = null
       where channel_id = $1 and status = 'claimed' and lease_expires_at < $2`,
      [channelId, now],
    );
    // Freshness (lot 9): waiting too long — never started, so nothing was seen — is no longer animated.
    if (this.maxAgeMs !== null)
      await q.query(
        `update alert_items set status = 'expired', ended_at = $2, failure = $4
         where channel_id = $1 and status = 'queued' and created_at < $3`,
        [
          channelId,
          now,
          new Date(now.getTime() - this.maxAgeMs),
          STALE_FAILURE,
        ],
      );
  }

  private async byId(q: Queryable, id: string) {
    const r = (
      await q.query<ItemRow>('select * from alert_items where alert_id = $1', [
        id,
      ])
    )[0];
    return r ? alertView(r) : null;
  }
}
