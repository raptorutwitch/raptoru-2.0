import {
  BOT_LEASE_RENEW_SECONDS,
  BOT_LEASE_TTL_SECONDS,
  type BotFlags,
  type BotHealth,
  type BotLeaseRequest,
  type BotLeaseResponse,
  type BotStatus,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';

// Single active production bot (docs/PLAN_POST_LIVE_2026-10-21.md, lot 1). One lease for the channel: the holder renews
// it with its health; anyone else is told to wait (standby) and recorded so Studio can show it. A holder that stops
// renewing frees the lease after BOT_LEASE_TTL_SECONDS; a clean stop frees it at once (release).

const CHANNEL = 'default';
const TTL_MS = BOT_LEASE_TTL_SECONDS * 1000;
/** A refused instance stays listed this long after its last attempt. */
const STANDBY_VISIBLE_MS = 2 * 60 * 1000;

interface LeaseRow {
  instance_id: string;
  acquired_at: Date;
  expires_at: Date;
}

interface InstanceRow {
  instance_id: string;
  host: string;
  version: string;
  started_at: Date;
  state: 'active' | 'standby' | 'released';
  health: BotHealth;
  flags: BotFlags;
  last_seen_at: Date;
}

const iso = (d: Date) => d.toISOString();

async function lock(q: Queryable) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', ['bot_lease']);
}

export class BotInstanceService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Grants or renews the lease unless another instance holds a live one (then: standby, recorded). */
  lease(r: BotLeaseRequest): Promise<BotLeaseResponse> {
    return this.db.tx(async (q) => {
      await lock(q);
      const now = this.clock.now();
      const current = (
        await q.query<LeaseRow>(
          'select instance_id, acquired_at, expires_at from bot_lease where channel = $1',
          [CHANNEL],
        )
      )[0];
      const other =
        current &&
        current.instance_id !== r.instanceId &&
        current.expires_at > now;
      const expiresAt = new Date(now.getTime() + TTL_MS);
      let holder: LeaseRow;
      if (other) {
        holder = current;
      } else {
        // A renewal keeps its start; a takeover (expired or released lease) starts now.
        const since =
          current?.instance_id === r.instanceId ? current.acquired_at : now;
        await q.query(
          `insert into bot_lease (channel, instance_id, acquired_at, expires_at) values ($1, $2, $3, $4)
           on conflict (channel) do update set instance_id = excluded.instance_id,
             acquired_at = excluded.acquired_at, expires_at = excluded.expires_at`,
          [CHANNEL, r.instanceId, since, expiresAt],
        );
        holder = {
          instance_id: r.instanceId,
          acquired_at: since,
          expires_at: expiresAt,
        };
      }
      await q.query(
        `insert into bot_instances (instance_id, host, version, started_at, state, health, flags, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (instance_id) do update set host = excluded.host, version = excluded.version,
           started_at = excluded.started_at, state = excluded.state, health = excluded.health,
           flags = excluded.flags, last_seen_at = excluded.last_seen_at`,
        [
          r.instanceId,
          r.host,
          r.version,
          new Date(r.startedAt),
          other ? 'standby' : 'active',
          JSON.stringify(r.health),
          JSON.stringify(r.flags),
          now,
        ],
      );
      const holderHost = other
        ? ((
            await q.query<{ host: string }>(
              'select host from bot_instances where instance_id = $1',
              [holder.instance_id],
            )
          )[0]?.host ?? 'unknown')
        : r.host;
      return {
        granted: !other,
        holder: {
          instanceId: holder.instance_id,
          host: holderHost,
          since: iso(holder.acquired_at),
          expiresAt: iso(holder.expires_at),
        },
        ttlSeconds: BOT_LEASE_TTL_SECONDS,
        renewSeconds: BOT_LEASE_RENEW_SECONDS,
      };
    });
  }

  /**
   * Server-side fencing of the bot routes: while a live lease exists, only its holder may act (an unnamed caller —
   * an older bot — neither). No live lease (none yet, released or expired): nobody is protected, every bot passes.
   */
  async writer(
    instanceId: string | undefined,
  ): Promise<{ allowed: true } | { allowed: false; holder: string }> {
    let lease: LeaseRow | undefined;
    try {
      lease = (
        await this.db.query<LeaseRow>(
          'select instance_id, acquired_at, expires_at from bot_lease where channel = $1',
          [CHANNEL],
        )
      )[0];
    } catch (e) {
      // Deploy window: this code runs before its migration (applied from the new container). No table = no lease
      // yet = nobody to protect: today's bot keeps working instead of getting 500 on every route.
      if ((e as { code?: string }).code === '42P01') return { allowed: true };
      throw e;
    }
    if (
      !lease ||
      lease.expires_at <= this.clock.now() ||
      lease.instance_id === instanceId
    )
      return { allowed: true };
    return { allowed: false, holder: lease.instance_id };
  }

  /** Clean stop: frees the lease at once if this instance holds it. */
  release(instanceId: string): Promise<{ released: boolean }> {
    return this.db.tx(async (q) => {
      await lock(q);
      const now = this.clock.now();
      const done = await q.query(
        'delete from bot_lease where channel = $1 and instance_id = $2 returning instance_id',
        [CHANNEL, instanceId],
      );
      await q.query(
        `update bot_instances set state = 'released', last_seen_at = $2 where instance_id = $1`,
        [instanceId, now],
      );
      return { released: done.length > 0 };
    });
  }

  async status(): Promise<BotStatus> {
    const now = this.clock.now();
    const lease = (
      await this.db.query<LeaseRow>(
        'select instance_id, acquired_at, expires_at from bot_lease where channel = $1',
        [CHANNEL],
      )
    )[0];
    const rows = await this.db.query<InstanceRow>(
      'select * from bot_instances order by last_seen_at desc limit 20',
    );
    const holder = lease
      ? rows.find((r) => r.instance_id === lease.instance_id)
      : undefined;
    const live = lease && lease.expires_at > now;
    return {
      now: iso(now),
      state: live ? 'active' : rows.length ? 'stale' : 'none',
      active:
        lease && holder
          ? {
              instanceId: holder.instance_id,
              host: holder.host,
              version: holder.version,
              startedAt: iso(holder.started_at),
              since: iso(lease.acquired_at),
              lastSeenAt: iso(holder.last_seen_at),
              expiresAt: iso(lease.expires_at),
              health: holder.health,
              flags: holder.flags,
            }
          : null,
      lastSeen: rows[0]
        ? {
            instanceId: rows[0].instance_id,
            host: rows[0].host,
            version: rows[0].version,
            state: rows[0].state,
            lastSeenAt: iso(rows[0].last_seen_at),
          }
        : null,
      standby: rows
        .filter(
          (r) =>
            r.state === 'standby' &&
            r.instance_id !== lease?.instance_id &&
            now.getTime() - r.last_seen_at.getTime() < STANDBY_VISIBLE_MS,
        )
        .map((r) => ({
          instanceId: r.instance_id,
          host: r.host,
          version: r.version,
          lastSeenAt: iso(r.last_seen_at),
        })),
    };
  }
}
