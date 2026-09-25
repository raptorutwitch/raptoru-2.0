import type { Viewer } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { ensureViewers } from './wallet-service.js';

// Individual loyalty rate and global temporary boost. Pure resolution only: no feature is wired
// to it yet. Transfers, admin corrections and imports never go through it.

export interface Boost {
  id: number;
  multiplier: number;
  label: string;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  stoppedAt: string | null;
}

/**
 * The individual rate replaces the standard viewer/sub multiplier; the global boost applies on top.
 * e.g. personal x3 and boost x2 → x6.
 */
export function loyaltyMultiplier(input: {
  personalRate: number | null;
  standardRate?: number;
  boost: number | null;
}): number {
  return (input.personalRate ?? input.standardRate ?? 1) * (input.boost ?? 1);
}

/** Gain after multipliers, rounded down to an integer amount. */
export function applyMultiplier(base: number, multiplier: number): number {
  return Math.floor(base * multiplier + 1e-9);
}

export class BoostConflictError extends Error {}

interface BoostRow {
  id: number;
  multiplier: string;
  label: string;
  starts_at: Date;
  ends_at: Date;
  created_by: string;
  stopped_at: Date | null;
}

const toBoost = (r: BoostRow): Boost => ({
  id: r.id,
  multiplier: Number(r.multiplier),
  label: r.label,
  startsAt: r.starts_at.toISOString(),
  endsAt: r.ends_at.toISOString(),
  createdBy: r.created_by,
  stoppedAt: r.stopped_at?.toISOString() ?? null,
});

export class LoyaltyService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async getRate(twitchUserId: string): Promise<number | null> {
    const row = (
      await this.db.query<{ multiplier: string }>(
        'select multiplier from viewer_loyalty_rates where twitch_user_id = $1',
        [twitchUserId],
      )
    )[0];
    return row ? Number(row.multiplier) : null;
  }

  async setRate(
    viewer: Viewer,
    multiplier: number,
    actor: string,
    reason?: string,
  ): Promise<number> {
    await ensureViewers(this.db, [viewer]);
    await this.db.query(
      `insert into viewer_loyalty_rates (twitch_user_id, multiplier, set_by, reason) values ($1, $2, $3, $4)
       on conflict (twitch_user_id) do update set multiplier = excluded.multiplier, set_by = excluded.set_by,
         reason = excluded.reason, updated_at = now()`,
      [viewer.twitchUserId, multiplier, actor, reason ?? null],
    );
    return (await this.getRate(viewer.twitchUserId))!;
  }

  async resetRate(twitchUserId: string): Promise<void> {
    await this.db.query(
      'delete from viewer_loyalty_rates where twitch_user_id = $1',
      [twitchUserId],
    );
  }

  async activeBoost(at: Date = this.clock.now()): Promise<Boost | null> {
    const row = (
      await this.db.query<BoostRow>(
        `select * from loyalty_boosts where starts_at <= $1 and ends_at > $1 and (stopped_at is null or stopped_at > $1)
         order by starts_at desc limit 1`,
        [at],
      )
    )[0];
    return row ? toBoost(row) : null;
  }

  async listBoosts(limit = 20): Promise<Boost[]> {
    return (
      await this.db.query<BoostRow>(
        'select * from loyalty_boosts order by id desc limit $1',
        [limit],
      )
    ).map(toBoost);
  }

  /** One global boost at a time: refused if it overlaps a boost that is not stopped. */
  createBoost(input: {
    multiplier: number;
    label: string;
    startsAt?: Date;
    endsAt: Date;
    actor: string;
  }): Promise<Boost> {
    const startsAt = input.startsAt ?? this.clock.now();
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        'loyalty_boosts',
      ]);
      const overlap = await q.query(
        `select 1 from loyalty_boosts where stopped_at is null and starts_at < $2 and ends_at > $1
           and ends_at > $3 limit 1`,
        [startsAt, input.endsAt, this.clock.now()],
      );
      if (overlap.length)
        throw new BoostConflictError(
          'another boost is active or scheduled in this period',
        );
      const row = (
        await q.query<BoostRow>(
          `insert into loyalty_boosts (multiplier, label, starts_at, ends_at, created_by) values ($1, $2, $3, $4, $5)
           returning *`,
          [input.multiplier, input.label, startsAt, input.endsAt, input.actor],
        )
      )[0]!;
      return toBoost(row);
    });
  }

  async stopBoost(id: number, actor: string): Promise<Boost | null> {
    const row = (
      await this.db.query<BoostRow>(
        `update loyalty_boosts set stopped_at = $2, stopped_by = $3 where id = $1 and stopped_at is null returning *`,
        [id, this.clock.now(), actor],
      )
    )[0];
    return row ? toBoost(row) : null;
  }

  /** Multiplier for a future gain of this viewer (not applied anywhere yet). */
  async resolveMultiplier(
    twitchUserId: string,
    opts: { standardRate?: number; at?: Date } = {},
  ) {
    const personalRate = await this.getRate(twitchUserId);
    const boost = await this.activeBoost(opts.at);
    return {
      personalRate,
      boost: boost?.multiplier ?? null,
      total: loyaltyMultiplier({
        personalRate,
        standardRate: opts.standardRate,
        boost: boost?.multiplier ?? null,
      }),
    };
  }
}
