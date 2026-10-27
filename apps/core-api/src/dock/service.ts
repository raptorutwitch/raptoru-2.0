import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';

// Dock OBS V1 (docs/OBS_DOCK.md) — a READ-ONLY projection of what Raptoru already recorded, for the OBS dock:
// - the projector reads the existing records (alert_events + their alert_items, cp_redemptions) and writes one
//   dock_activity row per source event. It never touches a module's transaction and never calls a module's handler:
//   it can be rebuilt at any time. A source that changes (alert played, redemption done) changes the row's version.
// - the change feed: every written / changed row takes the next `seq` of its channel, given under the channel row's
//   lock (dock_activity_channels … for update) held until commit — so seq order IS commit order, and a reader asking
//   « after N » never misses a row committed later with a smaller number (the trap of identity columns). Only the
//   projector writes it (one at a time per channel: the same lock).
// - the visual replay: a NEW alert item copied from the original's frozen variant and data, queued for the existing
//   alerts player. Never a new reception (no Roue du Sub, no loyalty, no economy, no chat), one replay at a time per
//   original, idempotent per click key; audited in dock_replays.

export const DOCK = {
  /** Routine scan: sources received within this window (statuses settle within minutes). */
  scanWindowMs: 24 * 3600_000,
  /** First scan of a channel by this Core: the whole history kept. */
  historyMs: 30 * 24 * 3600_000,
  /** The projector runs while someone reads the feed, and this long after the last read. */
  idleStopMs: 10 * 60_000,
  scanEveryMs: 1_500,
  /** Long-poll: the longest a feed read waits for something new. */
  maxWaitMs: 20_000,
  maxLimit: 200,
} as const;

export class DockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export type ActivityKind = 'alert' | 'channel_points' | 'interaction';

export interface ActivityRow {
  activity_key: string;
  kind: ActivityKind;
  type: string;
  occurred_at: string;
  data: Record<string, unknown>;
  state: Record<string, unknown>;
  seq: number;
}

interface Projected {
  activity_key: string;
  kind: ActivityKind;
  type: string;
  occurred_at: Date;
  data: Record<string, unknown>;
  state: Record<string, unknown>;
  version: string;
}

/** The display fields of an alert event (validated at reception: AlertEventInput). Never the whole payload. */
const ALERT_FIELDS = [
  'actor',
  'anonymous',
  'recipient',
  'count',
  'community_gift_id',
  'tier',
  'months',
  'bits',
  'viewers',
  'amount',
  'provider',
  'message',
] as const;

const pick = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]),
  );

const iso = (d: Date | string) => new Date(d).toISOString();

export class DockActivityService {
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly loops = new Map<
    string,
    {
      timer: ReturnType<typeof setInterval>;
      lastRead: number;
      scanned: boolean;
    }
  >();
  private readonly scanning = new Map<string, Promise<number>>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly opts: { autoScan?: boolean } = {},
  ) {}

  private now() {
    return this.clock.now();
  }

  // --- the projector ---------------------------------------------------------------------------------------------

  /**
   * Projects what changed since the last scan (one at a time per channel). Returns how many rows were written. The
   * first scan of a channel covers the whole kept history; the next ones the recent window.
   */
  scan(channelId: string, opts: { full?: boolean } = {}): Promise<number> {
    const running = this.scanning.get(channelId);
    if (running) return running.then(() => this.scan(channelId, opts));
    const run = this.scanOnce(channelId, opts.full ?? false).finally(() =>
      this.scanning.delete(channelId),
    );
    this.scanning.set(channelId, run);
    return run;
  }

  private async scanOnce(channelId: string, full: boolean) {
    const since = new Date(
      this.now().getTime() - (full ? DOCK.historyMs : DOCK.scanWindowMs),
    );
    const written = await this.db.tx(async (q) => {
      await q.query(
        'insert into dock_activity_channels (channel_id) values ($1) on conflict do nothing',
        [channelId],
      );
      // The channel's lock, held until commit: the seq given below follow the commit order (header).
      const seq0 = Number(
        (
          await q.query<{ seq: string }>(
            'select seq from dock_activity_channels where channel_id = $1 for update',
            [channelId],
          )
        )[0]!.seq,
      );
      const changed = [
        ...(await this.alertChanges(q, channelId, since)),
        ...(await this.pointsChanges(q, channelId, since)),
        ...(await this.interactionChanges(q, channelId, since)),
      ].sort(
        (a, b) =>
          a.occurred_at.getTime() - b.occurred_at.getTime() ||
          a.activity_key.localeCompare(b.activity_key),
      );
      let seq = seq0;
      const now = this.now();
      for (const p of changed) {
        seq += 1;
        await q.query(
          `insert into dock_activity (channel_id, activity_key, kind, type, occurred_at, data, state, version, seq,
             updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (channel_id, activity_key) do update set data = excluded.data, state = excluded.state,
             version = excluded.version, seq = excluded.seq, updated_at = excluded.updated_at`,
          [
            channelId,
            p.activity_key,
            p.kind,
            p.type,
            p.occurred_at,
            JSON.stringify(p.data),
            JSON.stringify(p.state),
            p.version,
            seq,
            now,
          ],
        );
      }
      if (seq !== seq0)
        await q.query(
          'update dock_activity_channels set seq = $2 where channel_id = $1',
          [channelId, seq],
        );
      // Retention: older than the kept history, a few at a time (never a big delete in the middle of a live).
      await q.query(
        `delete from dock_activity where ctid in (select ctid from dock_activity where channel_id = $1
           and occurred_at < $2 limit 200)`,
        [channelId, new Date(this.now().getTime() - DOCK.historyMs)],
      );
      return changed.length;
    });
    if (written) this.wake(channelId);
    return written;
  }

  /** Alert events whose projection is missing or out of date (outcome, the alert's status, its replays). */
  private async alertChanges(q: Queryable, channelId: string, since: Date) {
    const rows = await q.query<{
      key: string;
      type: string;
      payload: Record<string, unknown>;
      outcome: string;
      received_at: Date;
      alert_id: string | null;
      alert_status: string | null;
      failure: { code?: string } | null;
      replay_alert_id: string | null;
      replay_status: string | null;
      replays: number;
      version: string;
    }>(
      `with src as (
         select 'alert:' || e.source || ':' || e.source_event_id as key, e.type, e.payload, e.outcome, e.received_at,
           e.alert_id, i.status as alert_status, i.failure,
           r.replay_alert_id, ri.status as replay_status,
           (select count(*)::int from dock_replays x where x.original_alert_id = e.alert_id) as replays
         from alert_events e
         left join alert_items i on i.alert_id = e.alert_id
         left join lateral (select replay_alert_id from dock_replays d where d.original_alert_id = e.alert_id
           order by requested_at desc limit 1) r on true
         left join alert_items ri on ri.alert_id = r.replay_alert_id
         where e.channel_id = $1 and e.received_at >= $2
       )
       select src.*, concat_ws('|', src.outcome, coalesce(src.alert_status, '-'), coalesce(src.replay_status, '-'),
         src.replays) as version
       from src left join dock_activity a on a.channel_id = $1 and a.activity_key = src.key
       where a.version is distinct from concat_ws('|', src.outcome, coalesce(src.alert_status, '-'),
         coalesce(src.replay_status, '-'), src.replays)
       order by src.received_at, src.key limit 2000`,
      [channelId, since],
    );
    return rows.map((r): Projected => ({
      activity_key: r.key,
      kind: 'alert',
      type: r.type,
      occurred_at: new Date(
        typeof r.payload.occurred_at === 'string'
          ? r.payload.occurred_at
          : r.received_at,
      ),
      data: {
        ...pick(r.payload, ALERT_FIELDS),
        source: r.payload.source,
      },
      state: {
        outcome: r.outcome,
        alert_id: r.alert_id,
        alert_status: r.alert_status,
        failure: r.failure?.code ?? null,
        replay: r.replay_alert_id
          ? {
              alert_id: r.replay_alert_id,
              status: r.replay_status,
              count: r.replays,
            }
          : null,
      },
      version: r.version,
    }));
  }

  /** Channel points redemptions whose projection is missing or out of date (Raptoru's status, Twitch's status). */
  private async pointsChanges(q: Queryable, channelId: string, since: Date) {
    const rows = await q.query<{
      key: string;
      source: string;
      reward_id: string;
      reward_title: string;
      reward_cost: number;
      user_id: string;
      user_login: string;
      user_name: string;
      user_input: string | null;
      twitch_status: string | null;
      redeemed_at: Date;
      status: string;
      reason: string | null;
      version: string;
    }>(
      `with src as (
         select 'cp:' || c.source || ':' || c.redemption_id as key, c.*,
           concat_ws('|', c.status, coalesce(c.twitch_status, '-'), coalesce(c.reason, '-'), md5(c.results::text))
             as version
         from cp_redemptions c where c.channel_id = $1 and c.received_at >= $2
       )
       select src.* from src left join dock_activity a on a.channel_id = $1 and a.activity_key = src.key
       where a.version is distinct from src.version
       order by src.received_at, src.key limit 2000`,
      [channelId, since],
    );
    return rows.map((r): Projected => ({
      activity_key: r.key,
      kind: 'channel_points',
      type: 'reward',
      occurred_at: new Date(r.redeemed_at),
      data: {
        actor: { id: r.user_id, login: r.user_login, name: r.user_name },
        reward: { id: r.reward_id, title: r.reward_title, cost: r.reward_cost },
        ...(r.user_input ? { message: r.user_input } : {}),
        source: r.source,
      },
      state: {
        status: r.status,
        reason: r.reason,
        twitch_status: r.twitch_status,
      },
      version: r.version,
    }));
  }

  /**
   * V1.1 — Raptoru's own interactions, from their canonical tables (one row per business trigger, updated in place;
   * never a second activity for a status change): Bonk (each shot of a salve is its own row, with its volley), the
   * Soundboard (the sound's name), TTS (its text, cut, and its review), Tombola entries, `!rb` Random Bans (the channel
   * points ones are already their redemption). Read only, like the rest of the projection.
   */
  private async interactionChanges(
    q: Queryable,
    channelId: string,
    since: Date,
  ) {
    const rows = await q.query<{
      key: string;
      type: string;
      created_at: Date;
      viewer_id: string;
      viewer_name: string;
      status: string;
      refund_status: string | null;
      review_status: string | null;
      detail: string | null;
      extra: Record<string, unknown> | null;
      version: string;
    }>(
      `with src as (
         select 'ix:bonk:' || b.interaction_id as key, 'bonk' as type, b.created_at, b.viewer_id,
           b.viewer_display_name as viewer_name, b.status, b.refund_status, null::text as review_status,
           coalesce(b.emote_glyph, b.emote_id) as detail,
           jsonb_build_object('volley_id', b.volley_id, 'volley_index', b.volley_index, 'volley_count', b.volley_count,
             'error', b.error->>'code') as extra,
           concat_ws('|', b.status, b.refund_status) as version
         from bonk_lab_interactions b where b.channel_id = $1 and b.created_at >= $2
         union all
         select 'ix:soundboard:' || s.interaction_id, 'soundboard', s.created_at, s.viewer_id, s.viewer_display_name,
           s.status, s.refund_status, null, s.sound_label, jsonb_build_object('sound_id', s.sound_id),
           concat_ws('|', s.status, s.refund_status)
         from sound_lab_interactions s where s.channel_id = $1 and s.created_at >= $2
         union all
         select 'ix:tts:' || t.interaction_id, 'tts', t.created_at, t.viewer_id, t.viewer_display_name, t.status,
           t.refund_status, t.review_status, left(t.message, 500), null,
           concat_ws('|', t.status, t.refund_status, t.review_status)
         from tts_lab_interactions t where t.channel_id = $1 and t.created_at >= $2
         union all
         select 'ix:raffle:' || e.entry_id, 'raffle', e.created_at, e.viewer_id, e.viewer_display_name, 'completed',
           null, null, null, null, 'completed'
         from lab_raffle_entries e where e.channel_id = $1 and e.created_at >= $2
         union all
         select 'ix:random_ban:' || r.request_id, 'random_ban', r.created_at, r.buyer_id, r.buyer_name, r.status,
           r.refund, null, r.target_name,
           jsonb_build_object('streamer_mute', coalesce(r.reason like 'streamer_mute%', false)),
           concat_ws('|', r.status, r.refund, coalesce(r.target_id, '-'), coalesce(r.reason, '-'))
         from rb_requests r where r.channel_id = $1 and r.source = 'chat' and r.created_at >= $2
       )
       select src.* from src left join dock_activity a on a.channel_id = $1 and a.activity_key = src.key
       where a.version is distinct from src.version
       order by src.created_at, src.key limit 2000`,
      [channelId, since],
    );
    return rows.map((r): Projected => {
      const actor = { id: r.viewer_id, name: r.viewer_name };
      const x = r.extra ?? {};
      const data: Record<string, unknown> =
        r.type === 'bonk'
          ? {
              actor,
              emote: r.detail,
              ...(x.volley_id
                ? {
                    volley: {
                      id: x.volley_id,
                      index: x.volley_index,
                      count: x.volley_count,
                    },
                  }
                : {}),
            }
          : r.type === 'soundboard'
            ? { actor, sound: { id: x.sound_id, label: r.detail } }
            : r.type === 'tts'
              ? { actor, message: r.detail }
              : r.type === 'random_ban'
                ? {
                    actor,
                    ...(r.detail ? { target: r.detail } : {}),
                    streamer_mute: !!x.streamer_mute,
                  }
                : { actor };
      return {
        activity_key: r.key,
        kind: 'interaction',
        type: r.type,
        occurred_at: new Date(r.created_at),
        data,
        state: {
          status: r.status,
          refund_status: r.refund_status,
          ...(r.review_status && r.review_status !== 'none'
            ? { review_status: r.review_status }
            : {}),
          ...(x.error ? { error: x.error } : {}),
        },
        version: r.version,
      };
    });
  }

  // --- the feed ----------------------------------------------------------------------------------------------------

  private toRow(r: {
    activity_key: string;
    kind: ActivityKind;
    type: string;
    occurred_at: Date;
    data: Record<string, unknown>;
    state: Record<string, unknown>;
    seq: string | number;
  }): ActivityRow {
    return {
      activity_key: r.activity_key,
      kind: r.kind,
      type: r.type,
      occurred_at: iso(r.occurred_at),
      data: r.data,
      state: r.state,
      seq: Number(r.seq),
    };
  }

  private async cursor(q: Queryable, channelId: string) {
    return Number(
      (
        await q.query<{ seq: string }>(
          'select seq from dock_activity_channels where channel_id = $1',
          [channelId],
        )
      )[0]?.seq ?? 0,
    );
  }

  /**
   * The most recent activities (newest first) and the cursor to follow the changes from: both read in one snapshot,
   * so « recent, then changes after cursor » leaves no gap. `before` (the last row's time and seq) pages back.
   */
  async recent(
    channelId: string,
    o: { limit?: number; before?: { at: string; seq: number } } = {},
  ) {
    this.touch(channelId);
    const limit = Math.min(Math.max(o.limit ?? 100, 1), DOCK.maxLimit);
    return this.db.tx(async (q) => {
      await q
        .query('set transaction isolation level repeatable read')
        .catch(() => {});
      const cursor = await this.cursor(q, channelId);
      const rows = await q.query<Parameters<DockActivityService['toRow']>[0]>(
        `select activity_key, kind, type, occurred_at, data, state, seq from dock_activity
         where channel_id = $1 and ($2::timestamptz is null or (occurred_at, seq) < ($2, $4))
         order by occurred_at desc, seq desc limit $3`,
        [channelId, o.before?.at ?? null, limit, o.before?.seq ?? 0],
      );
      return {
        cursor,
        activities: rows.map((r) => this.toRow(r)),
        more: rows.length === limit,
      };
    });
  }

  /**
   * The changes after `after` (commit order), waiting up to `waitMs` for one when there is none yet (long-poll).
   * `reset`: the cursor is ahead of this channel's (another database, a rebuild) — start again from recent().
   */
  async changes(
    channelId: string,
    o: { after: number; limit?: number; waitMs?: number },
  ): Promise<{ cursor: number; activities: ActivityRow[]; reset?: true }> {
    this.touch(channelId);
    const limit = Math.min(Math.max(o.limit ?? 100, 1), DOCK.maxLimit);
    const read = async () => {
      const cursor = await this.cursor(this.db, channelId);
      if (o.after > cursor)
        return { cursor, activities: [], reset: true as const };
      const rows = await this.db.query<
        Parameters<DockActivityService['toRow']>[0]
      >(
        `select activity_key, kind, type, occurred_at, data, state, seq from dock_activity
         where channel_id = $1 and seq > $2 order by seq limit $3`,
        [channelId, o.after, limit],
      );
      const activities = rows.map((r) => this.toRow(r));
      return {
        cursor: activities.length
          ? activities.at(-1)!.seq
          : Math.max(o.after, 0),
        activities,
      };
    };
    const first = await read();
    const wait = Math.min(Math.max(o.waitMs ?? 0, 0), DOCK.maxWaitMs);
    if (first.activities.length || first.reset || !wait) return first;
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(channelId) ?? new Set();
      this.waiters.set(channelId, set);
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        resolve();
      };
      const timer = setTimeout(done, wait);
      timer.unref?.();
      set.add(done);
    });
    return read();
  }

  private wake(channelId: string) {
    for (const w of [...(this.waiters.get(channelId) ?? [])]) w();
  }

  /** Someone reads this channel: keep its projector running (first time: a full scan of the kept history). */
  private touch(channelId: string) {
    if (this.opts.autoScan === false) return;
    const loop = this.loops.get(channelId);
    if (loop) {
      loop.lastRead = Date.now();
      return;
    }
    const entry = {
      lastRead: Date.now(),
      scanned: false,
      timer: setInterval(() => {
        if (Date.now() - entry.lastRead > DOCK.idleStopMs) {
          clearInterval(entry.timer);
          this.loops.delete(channelId);
          return;
        }
        void this.scan(channelId, { full: !entry.scanned })
          .then(() => (entry.scanned = true))
          .catch((e) =>
            console.error(
              '[dock] scan failed',
              channelId,
              (e as Error).message,
            ),
          );
      }, DOCK.scanEveryMs),
    };
    entry.timer.unref?.();
    this.loops.set(channelId, entry);
  }

  /** Tests / shutdown. */
  stop() {
    for (const l of this.loops.values()) clearInterval(l.timer);
    this.loops.clear();
    for (const set of this.waiters.values()) for (const w of [...set]) w();
  }

  // --- the visual replay -------------------------------------------------------------------------------------------

  /**
   * Replays an alert's ANIMATION: a new item of the alerts queue with the original's frozen variant and data, played by
   * the existing player like any alert. Never a new reception: no Roue du Sub, loyalty, wallet, chat or any handler.
   * - `replayKey` (the click): the same key again returns the same replay (double click, retried request);
   * - one replay at a time per original: while one waits or plays, a new key gets that one back (`already_pending`);
   * - refused while the original itself has not played yet, and for an event with no animation (absorbed, below the
   *   threshold) — nothing to replay.
   */
  async replayAlert(channelId: string, alertId: string, replayKey: string) {
    const out = await this.db.tx(async (q) => {
      // The alerts claim lock of the channel: a replay and a claim never interleave.
      await q.query(
        'insert into alert_channels (channel_id) values ($1) on conflict do nothing',
        [channelId],
      );
      await q.query(
        'select 1 from alert_channels where channel_id = $1 for update',
        [channelId],
      );
      const done = (
        await q.query<{
          original_alert_id: string;
          replay_alert_id: string;
          channel_id: string;
        }>(
          'select original_alert_id, replay_alert_id, channel_id from dock_replays where replay_key = $1',
          [replayKey],
        )
      )[0];
      if (done) {
        if (done.original_alert_id !== alertId || done.channel_id !== channelId)
          throw new DockError(409, 'replay_key_reused');
        return { replay_alert_id: done.replay_alert_id, created: false };
      }
      const original = (
        await q.query<{
          alert_id: string;
          type: string;
          family: string;
          variant_id: string;
          variant: unknown;
          data: unknown;
          priority: number;
          status: string;
        }>(
          `select i.alert_id, i.type, i.family, i.variant_id, i.variant, i.data, i.priority, i.status
           from alert_items i join alert_events e on e.alert_id = i.alert_id
           where i.alert_id = $1 and i.channel_id = $2`,
          [alertId, channelId],
        )
      )[0];
      if (!original) throw new DockError(404, 'alert_not_replayable');
      if (['queued', 'claimed', 'playing'].includes(original.status))
        throw new DockError(409, 'original_not_played_yet');
      const pending = (
        await q.query<{ replay_alert_id: string }>(
          `select d.replay_alert_id from dock_replays d join alert_items i on i.alert_id = d.replay_alert_id
           where d.original_alert_id = $1 and i.status in ('queued', 'claimed', 'playing')
           order by d.requested_at desc limit 1`,
          [alertId],
        )
      )[0];
      if (pending)
        return {
          replay_alert_id: pending.replay_alert_id,
          created: false,
          already_pending: true,
        };
      const replayId = randomUUID();
      const now = this.now();
      await q.query(
        `insert into alert_items (alert_id, channel_id, type, family, variant_id, variant, data, priority, status,
           created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9)`,
        [
          replayId,
          channelId,
          original.type,
          original.family,
          original.variant_id,
          JSON.stringify(original.variant),
          JSON.stringify(original.data),
          original.priority,
          now,
        ],
      );
      await q.query(
        `insert into dock_replays (replay_key, channel_id, original_alert_id, replay_alert_id, requested_at)
         values ($1, $2, $3, $4, $5)`,
        [replayKey, channelId, alertId, replayId, now],
      );
      return { replay_alert_id: replayId, created: true };
    });
    // The dock shows « replay queued » at once.
    await this.scan(channelId).catch(() => {});
    return out;
  }
}
