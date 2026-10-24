import { randomUUID } from 'node:crypto';
import type { CpTwitchAction, CpTwitchActionReport } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';

// Twitch-side channel points actions (docs/SPOTIFY_V2.md § 7): Core decides, the bot runs each one ONCE with the
// broadcaster's token (`channel:manage:redemptions`).
// - redemption_status: FULFILLED, or CANCELED (Twitch gives the points back). One per redemption (key): never a second
//   refund, never a refund after a fulfilment. Only for a reward created by Raptoru's app (Twitch lets only its creator
//   change its redemptions): any other reward is « unmanaged » and nothing is sent.
// - reward_create: a reward owned by Raptoru's app (asked from Studio, on Antoni's GO). Its id is recorded as managed.
// A claimed action whose report never comes is « unknown » after its lease (it may have applied): never replayed.

export const CP_TWITCH_ACTIONS = {
  leaseMs: 30_000,
} as const;

export class CpTwitchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

interface ActionRow {
  action_id: string;
  channel_id: string;
  kind: 'redemption_status' | 'reward_create';
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed' | 'unknown';
  attempt_id: string | null;
  attempts: number;
  lease_expires_at: Date | null;
  http_status: number | null;
  error: string | null;
  result: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export const twitchActionView = (r: ActionRow) => ({
  action_id: r.action_id,
  kind: r.kind,
  payload: r.payload,
  status: r.status,
  http_status: r.http_status,
  error: r.error,
  result: r.result,
  created_at: new Date(r.created_at).toISOString(),
  updated_at: new Date(r.updated_at).toISOString(),
});

export class CpTwitchActions {
  private readonly listeners: ((
    channelId: string,
    action: ReturnType<typeof twitchActionView>,
  ) => Promise<void>)[] = [];

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Told when an action ends (the Spotify module shows refunds). */
  onResult(
    fn: (
      channelId: string,
      action: ReturnType<typeof twitchActionView>,
    ) => Promise<void>,
  ) {
    this.listeners.push(fn);
  }

  /** Is this reward Raptoru's (created by its app)? Only those redemptions can be fulfilled / refunded. */
  async managed(
    q: Queryable,
    channelId: string,
    rewardId: string | null | undefined,
  ) {
    if (!rewardId) return false;
    const r = await q.query<{ managed_by_raptoru: boolean }>(
      'select managed_by_raptoru from cp_rewards where channel_id = $1 and reward_id = $2',
      [channelId, rewardId],
    );
    return r[0]?.managed_by_raptoru === true;
  }

  /**
   * Asks once for a redemption's status (inside the caller's transaction). Returns `queued` when this call created it,
   * `exists` when the redemption already has one (refund or fulfilment: Twitch accepts a single change).
   */
  async redemptionStatus(
    q: Queryable,
    a: {
      channel_id: string;
      reward_id: string;
      redemption_id: string;
      status: 'FULFILLED' | 'CANCELED';
    },
  ): Promise<'queued' | 'exists'> {
    const now = this.clock.now();
    const rows = await q.query(
      `insert into cp_twitch_actions (action_id, channel_id, kind, idempotency_key, payload, status, created_at, updated_at)
       values ($1, $2, 'redemption_status', $3, $4, 'queued', $5, $5)
       on conflict (idempotency_key) do nothing returning action_id`,
      [
        randomUUID(),
        a.channel_id,
        `status:${a.channel_id}:${a.redemption_id}`,
        JSON.stringify({
          reward_id: a.reward_id,
          redemption_id: a.redemption_id,
          status: a.status,
        }),
        now,
      ],
    );
    return rows.length ? 'queued' : 'exists';
  }

  /** Studio asks for a reward owned by Raptoru (one creation in flight at a time per channel). */
  async createReward(
    channelId: string,
    reward: {
      title: string;
      cost: number;
      prompt: string;
      is_user_input_required: boolean;
    },
  ) {
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `cp_twitch_reward:${channelId}`,
      ]);
      const busy = await q.query(
        `select 1 from cp_twitch_actions where channel_id = $1 and kind = 'reward_create'
           and status in ('queued', 'running')`,
        [channelId],
      );
      if (busy.length)
        throw new CpTwitchError(409, 'reward_create_in_progress');
      const now = this.clock.now();
      const id = randomUUID();
      await q.query(
        `insert into cp_twitch_actions (action_id, channel_id, kind, idempotency_key, payload, status, created_at, updated_at)
         values ($1, $2, 'reward_create', $3, $4, 'queued', $5, $5)`,
        [
          id,
          channelId,
          `reward_create:${channelId}:${id}`,
          JSON.stringify(reward),
          now,
        ],
      );
      return { action_id: id };
    });
  }

  /** The bot takes the next action (once). An expired claim becomes « unknown » (it may have applied). */
  async claim(channelId: string): Promise<{ action: CpTwitchAction | null }> {
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `cp_twitch_actions:${channelId}`,
      ]);
      const now = this.clock.now();
      await q.query(
        `update cp_twitch_actions set status = 'unknown', error = 'no_report', updated_at = $2
         where channel_id = $1 and status = 'running' and lease_expires_at < $2`,
        [channelId, now],
      );
      const row = (
        await q.query<ActionRow>(
          `select * from cp_twitch_actions where channel_id = $1 and status = 'queued'
           order by created_at limit 1 for update`,
          [channelId],
        )
      )[0];
      if (!row) return { action: null };
      const attempt = randomUUID();
      await q.query(
        `update cp_twitch_actions set status = 'running', attempt_id = $2, attempts = attempts + 1,
           lease_expires_at = $3, updated_at = $4 where action_id = $1`,
        [
          row.action_id,
          attempt,
          new Date(now.getTime() + CP_TWITCH_ACTIONS.leaseMs),
          now,
        ],
      );
      const p = row.payload;
      return {
        action:
          row.kind === 'redemption_status'
            ? {
                kind: 'redemption_status',
                action_id: row.action_id,
                attempt_id: attempt,
                reward_id: String(p.reward_id),
                redemption_id: String(p.redemption_id),
                status: p.status as 'FULFILLED' | 'CANCELED',
              }
            : {
                kind: 'reward_create',
                action_id: row.action_id,
                attempt_id: attempt,
                reward: {
                  title: String(p.title),
                  cost: Number(p.cost),
                  prompt: String(p.prompt ?? ''),
                  is_user_input_required: p.is_user_input_required === true,
                },
              },
      };
    });
  }

  async report(channelId: string, actionId: string, r: CpTwitchActionReport) {
    const out = await this.db.tx(async (q) => {
      const row = (
        await q.query<ActionRow>(
          'select * from cp_twitch_actions where channel_id = $1 and action_id = $2 for update',
          [channelId, actionId],
        )
      )[0];
      if (!row) throw new CpTwitchError(404, 'action_not_found');
      if (row.attempt_id !== r.attempt_id)
        throw new CpTwitchError(409, 'stale_attempt');
      if (row.status !== 'running') return { row, changed: false };
      const now = this.clock.now();
      const result =
        row.kind === 'reward_create' && r.reward_id
          ? { reward_id: r.reward_id }
          : null;
      await q.query(
        `update cp_twitch_actions set status = $2, http_status = $3, error = $4, result = $5, lease_expires_at = null,
           updated_at = $6 where action_id = $1`,
        [
          actionId,
          r.outcome,
          r.http_status ?? null,
          r.error?.slice(0, 200) ?? null,
          result ? JSON.stringify(result) : null,
          now,
        ],
      );
      if (row.kind === 'reward_create' && r.outcome === 'done' && r.reward_id) {
        const p = row.payload;
        await q.query(
          `insert into cp_rewards (channel_id, reward_id, title, cost, prompt, is_enabled, user_input_required, source,
             last_seen_at, managed_by_raptoru)
           values ($1, $2, $3, $4, $5, true, $6, 'twitch_api', $7, true)
           on conflict (channel_id, reward_id) do update set managed_by_raptoru = true, last_seen_at = $7`,
          [
            channelId,
            r.reward_id,
            String(p.title),
            Number(p.cost),
            String(p.prompt ?? ''),
            p.is_user_input_required === true,
            now,
          ],
        );
      }
      const fresh = (
        await q.query<ActionRow>(
          'select * from cp_twitch_actions where action_id = $1',
          [actionId],
        )
      )[0]!;
      return { row: fresh, changed: true };
    });
    if (out.changed)
      for (const fn of this.listeners)
        await fn(channelId, twitchActionView(out.row)).catch(() => {});
    return twitchActionView(out.row);
  }

  async list(channelId: string, limit = 30) {
    const rows = await this.db.query<ActionRow>(
      'select * from cp_twitch_actions where channel_id = $1 order by created_at desc limit $2',
      [channelId, limit],
    );
    return rows.map(twitchActionView);
  }

  /** The status action of a redemption, if any (Studio shows « remboursée » / « validée » / échec). */
  async ofRedemption(q: Queryable, channelId: string, redemptionId: string) {
    const r = await q.query<ActionRow>(
      'select * from cp_twitch_actions where idempotency_key = $1',
      [`status:${channelId}:${redemptionId}`],
    );
    return r[0] ? twitchActionView(r[0]) : null;
  }
}
