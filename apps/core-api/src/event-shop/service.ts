import { createHash, randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  DEFAULT_EVENT_RULES,
  type EventShopAckRequest,
  type EventShopConvertRequest,
  type EventShopGrantRequest,
  type EventShopHeartbeat,
  type EventShopItem,
  EventShopItem as EventShopItemSchema,
  type EventShopItemUpdate,
  type EventShopPurchaseRequest,
  type EventShopRules,
  EventShopRules as EventShopRulesSchema,
  type EventShopSettings,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import type {
  PresenceListener,
  ValidatedPresence,
} from '../presence/presence-service.js';
import {
  activeBlock,
  countGlobalRefusal,
  globalState,
} from '../lab-moderation/store.js';
import {
  categoryOf,
  defaultItems,
  editionTitle,
  LATE_ITEMS,
  RETIRED_ITEMS,
  thumbOf,
} from './catalog.js';
import { balanceOf, EventBalanceError, move } from './ledger.js';

// Boutique d'événement (Halloween 2026, docs/HALLOWEEN.md). The Core decides everything: catalogue, prices, the limits
// that keep the stream playable, balances (the event currency's own ledger, ledger.ts), purchases and their fate.
// Studio's overlay only plays what it claimed and reports. Rules:
// - ONE play at a time per channel and no queue: a purchase while another is waiting or playing is refused (busy);
// - a viewer waits `viewer_gap_ms` between purchases; an item has its cooldown; screamers have their own gap and an
//   hourly quota;
// - purchases are admitted only while Studio's overlay is ready and holds the item's media (no Bonbon spent for
//   nothing);
// - debit and admission in ONE transaction; never replayed: not taken / not started in time → failed and refunded
//   once; started and never ended → « unknown », no refund (it was probably seen);
// - admissions of a channel are serialized by its settings row (every limit is checked under that lock).

export const EVENT_SHOP = {
  defaultSeason: 'halloween-2026',
  /** Studio's overlay heartbeat older than this: not ready. */
  readyMs: 10_000,
  /** A purchase nobody claimed within this delay fails (refunded). */
  pickupMs: 20_000,
  /** Claimed, not started within this delay: fails (refunded). */
  startMs: 15_000,
  /** Started, no end within this delay: « unknown » (no refund). */
  maxPlayMs: 90_000,
  hourMs: 3_600_000,
} as const;

export class EventShopError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

interface PurchaseRow {
  purchase_id: string;
  season: string;
  channel_id: string;
  viewer_id: string;
  viewer_name: string;
  item_id: string;
  item_kind: string;
  label: string;
  price: number;
  idempotency_key: string;
  request_hash: string;
  status: string;
  refund_status: string;
  error: string | null;
  studio_instance_id: string | null;
  attempt_id: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
}

interface ItemRow {
  item_id: string;
  kind: EventShopItem['kind'];
  media_id: string | null;
  effect: string | null;
  label: string;
  description: string;
  price: number;
  cooldown_ms: number;
  enabled: boolean;
  sort: number;
  params: EventShopItem['params'];
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Statuses that count for the cooldowns and quotas (a failed, refunded purchase did not play). */
const PLAYED = `status in ('queued', 'executing', 'completed', 'unknown')`;

const toItem = (r: ItemRow): EventShopItem => ({
  item_id: r.item_id,
  kind: r.kind,
  media_id: r.media_id,
  effect: r.effect as EventShopItem['effect'],
  label: r.label,
  description: r.description,
  price: Number(r.price),
  cooldown_ms: Number(r.cooldown_ms),
  enabled: r.enabled,
  sort: Number(r.sort),
  params: r.params ?? {},
});

const view = (r: PurchaseRow) => ({
  purchase_id: r.purchase_id,
  item_id: r.item_id,
  item_kind: r.item_kind,
  label: r.label,
  price: Number(r.price),
  viewer: { id: r.viewer_id, name: r.viewer_name },
  status: r.status,
  refund_status: r.refund_status,
  error: r.error,
  created_at: iso(r.created_at),
  started_at: iso(r.started_at),
  ended_at: iso(r.ended_at),
});
export type EventPurchaseView = ReturnType<typeof view>;

/** « Événements » in the Extension for this viewer: everyone, or the listed testers only (rules.extension_audience). */
export const extensionAllowed = (
  rules: EventShopRules,
  viewerId: string | null,
) =>
  rules.extension_audience !== 'testers' ||
  (!!viewerId && rules.extension_testers.includes(viewerId));

export class EventShopService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** The Jetons side of the conversion (the runtime's economy: Lab test wallet or canonical Wallet). */
    private readonly economy: EconomyPort,
    private readonly opts: {
      /** Lab: simulated Twitch events (source « simulation ») earn Bonbons too. Production: real ones only. */
      rewardSimulations?: boolean;
    } = {},
  ) {}

  private now() {
    return this.clock.now();
  }

  // --- settings & catalogue ----------------------------------------------------------------------------------------

  /** The channel's settings, created closed with the default rules and catalogue on first use. */
  private async ensure(
    q: Queryable,
    channelId: string,
  ): Promise<EventShopSettings> {
    const rows = await q.query<{
      season: string;
      enabled: boolean;
      rules: EventShopRules;
    }>(
      'select season, enabled, rules from event_shop_settings where channel_id = $1',
      [channelId],
    );
    if (rows[0]) {
      if (!this.lateSeeded.has(channelId)) {
        // Items added since the catalogue was created: inserted disabled, never over an existing one (Studio's price,
        // name or state stay as they are). Remembered only once they are SEEN in the base (a rolled-back transaction
        // inserted nothing: the next call does it again).
        // Retired items: gone where never bought, disabled where a purchase refers to them (history intact).
        await q.query(
          `delete from event_shop_items i where i.channel_id = $1 and i.item_id = any($2) and not exists
             (select 1 from event_shop_purchases p where p.channel_id = i.channel_id and p.item_id = i.item_id)`,
          [channelId, RETIRED_ITEMS],
        );
        await q.query(
          'update event_shop_items set enabled = false where channel_id = $1 and item_id = any($2) and enabled',
          [channelId, RETIRED_ITEMS],
        );
        const ids = [...LATE_ITEMS];
        const have = await q.query<{ n: number }>(
          'select count(*)::int as n from event_shop_items where channel_id = $1 and item_id = any($2)',
          [channelId, ids],
        );
        if ((have[0]?.n ?? 0) >= ids.length) this.lateSeeded.add(channelId);
        else
          await this.insertItems(
            q,
            channelId,
            defaultItems().filter((i) => LATE_ITEMS.has(i.item_id)),
          );
      }
      return {
        season: rows[0].season,
        enabled: rows[0].enabled,
        // Rules saved by an older version get the new fields' defaults.
        rules: { ...DEFAULT_EVENT_RULES, ...rows[0].rules },
      };
    }
    const now = this.now();
    const inserted = await q.query(
      `insert into event_shop_settings (channel_id, season, enabled, rules, updated_at) values ($1, $2, false, $3, $4)
       on conflict do nothing returning 1`,
      [
        channelId,
        EVENT_SHOP.defaultSeason,
        JSON.stringify(DEFAULT_EVENT_RULES),
        now,
      ],
    );
    if (inserted.length) await this.insertItems(q, channelId, defaultItems());
    return this.ensure(q, channelId);
  }

  private lateSeeded = new Set<string>();

  private async insertItems(
    q: Queryable,
    channelId: string,
    items: EventShopItem[],
  ) {
    const now = this.now();
    for (const it of items)
      await q.query(
        `insert into event_shop_items (channel_id, item_id, kind, media_id, effect, label, description, price,
             cooldown_ms, enabled, sort, params, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict do nothing`,
        [
          channelId,
          it.item_id,
          it.kind,
          it.media_id,
          it.effect,
          it.label,
          it.description,
          it.price,
          it.cooldown_ms,
          it.enabled,
          it.sort,
          JSON.stringify(it.params),
          now,
        ],
      );
  }

  async settings(channelId: string) {
    return this.db.tx((q) => this.ensure(q, channelId));
  }

  async updateSettings(
    channelId: string,
    patch: { enabled?: boolean; rules?: Partial<EventShopRules> },
  ): Promise<EventShopSettings & { refunded?: number }> {
    return this.db.tx(async (q) => {
      const cur = await this.ensure(q, channelId);
      // Under the admissions' lock: no purchase slips in between the switch and the closing below.
      await q.query(
        'select 1 from event_shop_settings where channel_id = $1 for update',
        [channelId],
      );
      const rules = EventShopRulesSchema.parse({
        ...cur.rules,
        ...(patch.rules ?? {}),
      });
      const enabled = patch.enabled ?? cur.enabled;
      await q.query(
        'update event_shop_settings set enabled = $2, rules = $3, updated_at = $4 where channel_id = $1',
        [channelId, enabled, JSON.stringify(rules), this.now()],
      );
      if (!(cur.enabled && !enabled))
        return { season: cur.season, enabled, rules };
      // Controlled closing: what was bought but not yet handed to Studio is refunded once (event_closed); a purchase
      // already handed over or on screen ends normally (it may be seen). Balances, ledger and catalogue stay.
      const waiting = await q.query<PurchaseRow>(
        `select * from event_shop_purchases where channel_id = $1 and status = 'queued' and attempt_id is null for update`,
        [channelId],
      );
      for (const r of waiting) await this.fail(q, r, 'event_closed', true);
      return { season: cur.season, enabled, rules, refunded: waiting.length };
    });
  }

  private async items(
    q: Queryable,
    channelId: string,
  ): Promise<EventShopItem[]> {
    const rows = await q.query<ItemRow>(
      'select * from event_shop_items where channel_id = $1 order by sort, item_id',
      [channelId],
    );
    return rows.map(toItem);
  }

  async updateItem(
    channelId: string,
    itemId: string,
    patch: EventShopItemUpdate,
  ): Promise<EventShopItem> {
    return this.db.tx(async (q) => {
      await this.ensure(q, channelId);
      const rows = await q.query<ItemRow>(
        'select * from event_shop_items where channel_id = $1 and item_id = $2 for update',
        [channelId, itemId],
      );
      if (!rows[0]) throw new EventShopError(404, 'item_not_found');
      const next = EventShopItemSchema.parse({ ...toItem(rows[0]), ...patch });
      await q.query(
        `update event_shop_items set label = $3, description = $4, price = $5, cooldown_ms = $6, enabled = $7, sort = $8,
           params = $9, updated_at = $10 where channel_id = $1 and item_id = $2`,
        [
          channelId,
          itemId,
          next.label,
          next.description,
          next.price,
          next.cooldown_ms,
          next.enabled,
          next.sort,
          JSON.stringify(next.params),
          this.now(),
        ],
      );
      return next;
    });
  }

  // --- Studio's overlay ------------------------------------------------------------------------------------------

  async heartbeat(h: EventShopHeartbeat) {
    await this.db.query(
      `insert into event_shop_studios (channel_id, studio_instance_id, engine_ready, media, seen_at)
       values ($1, $2, $3, $4, $5)
       on conflict (channel_id, studio_instance_id) do update set engine_ready = excluded.engine_ready,
         media = excluded.media, seen_at = excluded.seen_at`,
      [
        h.channel_id,
        h.studio_instance_id,
        h.engine_ready,
        JSON.stringify(h.media),
        this.now(),
      ],
    );
    return { ok: true as const };
  }

  /** The freshest ready overlay of the channel (null: none), with the media it holds. */
  private async engine(q: Queryable, channelId: string) {
    const rows = await q.query<{ studio_instance_id: string; media: string[] }>(
      `select studio_instance_id, media from event_shop_studios
       where channel_id = $1 and engine_ready and seen_at > $2 order by seen_at desc limit 1`,
      [channelId, new Date(this.now().getTime() - EVENT_SHOP.readyMs)],
    );
    return rows[0]
      ? {
          instance: rows[0].studio_instance_id,
          media: new Set(rows[0].media ?? []),
        }
      : null;
  }

  // --- purchase ----------------------------------------------------------------------------------------------------

  async purchase(req: EventShopPurchaseRequest) {
    try {
      return await this.db.tx((q) => this.purchaseTx(q, req));
    } catch (e) {
      // Refused by the global pause: nothing was stored; the refusal is counted (D4 banner), outside the rolled back tx.
      if (e instanceof EventShopError && e.code === 'raptoru_paused')
        await countGlobalRefusal(this.db, req.channel_id, this.now());
      if (e instanceof EventBalanceError)
        throw new EventShopError(409, 'insufficient_bonbons', {
          balance: e.balance,
          needed: e.needed,
        });
      throw e;
    }
  }

  private async purchaseTx(q: Queryable, req: EventShopPurchaseRequest) {
    const now = this.now();
    const settings = await this.ensure(q, req.channel_id);
    // The channel's admissions, one at a time: every limit below is read under this lock.
    await q.query(
      'select 1 from event_shop_settings where channel_id = $1 for update',
      [req.channel_id],
    );
    const requestHash = hash({ item: req.item_id });
    const prior = (
      await q.query<PurchaseRow>(
        'select * from event_shop_purchases where channel_id = $1 and viewer_id = $2 and idempotency_key = $3',
        [req.channel_id, req.viewer.id, req.idempotency_key],
      )
    )[0];
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw new EventShopError(409, 'idempotency_conflict');
      return {
        purchase: view(prior),
        balance: await balanceOf(
          q,
          prior.season,
          req.channel_id,
          req.viewer.id,
        ),
        replayed: true,
      };
    }
    if (!settings.enabled) throw new EventShopError(409, 'event_closed');
    // Moderation (D4), as for every paid interaction: « Pause Raptoru » refuses it (counted in the banner); a viewer
    // blocked « everywhere » cannot buy. Refused before anything is debited.
    if (
      req.via === 'extension' &&
      !extensionAllowed(settings.rules, req.viewer.id)
    )
      throw new EventShopError(403, 'not_invited');
    if ((await globalState(q, req.channel_id)).paused)
      throw new EventShopError(409, 'raptoru_paused');
    if (await activeBlock(q, req.channel_id, req.viewer.id, 'all', now))
      throw new EventShopError(403, 'viewer_blocked');
    await this.sweep(q, req.channel_id);
    const itemRow = (
      await q.query<ItemRow>(
        'select * from event_shop_items where channel_id = $1 and item_id = $2',
        [req.channel_id, req.item_id],
      )
    )[0];
    if (!itemRow) throw new EventShopError(404, 'item_not_found');
    const item = toItem(itemRow);
    if (!item.enabled) throw new EventShopError(409, 'item_disabled');
    const engine = await this.engine(q, req.channel_id);
    if (!engine) throw new EventShopError(503, 'engine_offline');
    if (item.media_id && !engine.media.has(item.media_id))
      throw new EventShopError(503, 'media_missing');
    const limit = await this.limits(
      q,
      req.channel_id,
      settings,
      item,
      req.viewer.id,
      now,
    );
    if (limit)
      throw new EventShopError(409, limit.code, {
        retry_after_ms: limit.retry_after_ms,
      });
    const purchaseId = randomUUID();
    const debit = await move(q, {
      season: settings.season,
      channelId: req.channel_id,
      viewer: { id: req.viewer.id, name: req.viewer.display_name },
      kind: 'purchase',
      amount: -item.price,
      key: `purchase:${purchaseId}`,
      reference: purchaseId,
      actor: 'viewer',
      reason: item.item_id,
      now,
    });
    await q.query(
      `insert into event_shop_purchases (purchase_id, season, channel_id, viewer_id, viewer_name, item_id, item_kind, label,
         price, idempotency_key, request_hash, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'queued', $12)`,
      [
        purchaseId,
        settings.season,
        req.channel_id,
        req.viewer.id,
        req.viewer.display_name,
        item.item_id,
        item.kind,
        item.label,
        item.price,
        req.idempotency_key,
        requestHash,
        now,
      ],
    );
    return {
      purchase: view((await this.byId(q, purchaseId))!),
      balance: debit.balance_after,
      replayed: false,
    };
  }

  /**
   * The first limit that refuses this purchase now, with when it frees up (null: allowed). Order: one play at a time,
   * the viewer's gap, the item's cooldown, then the screamers' gap and hourly quota.
   */
  private async limits(
    q: Queryable,
    channelId: string,
    s: EventShopSettings,
    item: EventShopItem,
    viewerId: string | null,
    now: Date,
  ): Promise<{ code: string; retry_after_ms: number } | null> {
    const t = now.getTime();
    const busy = (
      await q.query<{ n: number }>(
        `select count(*)::int as n from event_shop_purchases where channel_id = $1 and status in ('queued', 'executing')`,
        [channelId],
      )
    )[0]!.n;
    if (busy) return { code: 'busy', retry_after_ms: 3000 };
    const last = async (where: string, params: unknown[]) => {
      const r = (
        await q.query<{ at: Date | null }>(
          `select max(created_at) as at from event_shop_purchases where channel_id = $1 and ${PLAYED} and ${where}`,
          [channelId, ...params],
        )
      )[0];
      return r?.at ? new Date(r.at).getTime() : null;
    };
    if (viewerId && s.rules.viewer_gap_ms > 0) {
      const at = await last('viewer_id = $2', [viewerId]);
      if (at !== null && t - at < s.rules.viewer_gap_ms)
        return {
          code: 'viewer_cooldown',
          retry_after_ms: at + s.rules.viewer_gap_ms - t,
        };
    }
    if (item.cooldown_ms > 0) {
      const at = await last('item_id = $2', [item.item_id]);
      if (at !== null && t - at < item.cooldown_ms)
        return {
          code: 'item_cooldown',
          retry_after_ms: at + item.cooldown_ms - t,
        };
    }
    if (item.kind === 'screamer') {
      if (s.rules.screamers_per_hour === 0)
        return { code: 'screamers_closed', retry_after_ms: 0 };
      // This viewer's own screamers (31/10): the same refusal as the viewer's gap (every client already shows it).
      const own = s.rules.viewer_screamer_gap_ms ?? 0;
      if (viewerId && own > 0) {
        const at = await last(`viewer_id = $2 and item_kind = 'screamer'`, [
          viewerId,
        ]);
        if (at !== null && t - at < own)
          return { code: 'viewer_cooldown', retry_after_ms: at + own - t };
      }
      if (s.rules.screamer_gap_ms > 0) {
        const at = await last(`item_kind = 'screamer'`, []);
        if (at !== null && t - at < s.rules.screamer_gap_ms)
          return {
            code: 'screamer_cooldown',
            retry_after_ms: at + s.rules.screamer_gap_ms - t,
          };
      }
      const hour = await q.query<{ at: Date }>(
        `select created_at as at from event_shop_purchases where channel_id = $1 and ${PLAYED}
           and item_kind = 'screamer' and created_at > $2 order by created_at`,
        [channelId, new Date(t - EVENT_SHOP.hourMs)],
      );
      if (hour.length >= s.rules.screamers_per_hour)
        return {
          code: 'screamer_quota',
          retry_after_ms:
            new Date(
              hour[hour.length - s.rules.screamers_per_hour]!.at,
            ).getTime() +
            EVENT_SHOP.hourMs -
            t,
        };
    }
    return null;
  }

  // --- execution (Studio) ------------------------------------------------------------------------------------------

  /** The next play for this overlay (one at a time): the purchase, its item and what to play. Null: nothing. */
  async claim(studioInstanceId: string, channelId: string) {
    return this.db.tx(async (q) => {
      await this.sweep(q, channelId);
      // A closed event hands nothing more to Studio (an old request or a late claim never plays a closed shop).
      if (!(await this.ensure(q, channelId)).enabled) return null;
      const engine = await this.engine(q, channelId);
      if (!engine || engine.instance !== studioInstanceId) return null;
      const executing = await q.query(
        `select 1 from event_shop_purchases where channel_id = $1 and (status = 'executing'
           or (status = 'queued' and attempt_id is not null))`,
        [channelId],
      );
      if (executing.length) return null;
      const row = (
        await q.query<PurchaseRow>(
          `select * from event_shop_purchases where channel_id = $1 and status = 'queued' and attempt_id is null
           order by created_at limit 1 for update skip locked`,
          [channelId],
        )
      )[0];
      if (!row) return null;
      const attemptId = randomUUID();
      const now = this.now();
      await q.query(
        `update event_shop_purchases set studio_instance_id = $2, attempt_id = $3, lease_expires_at = $4
         where purchase_id = $1`,
        [
          row.purchase_id,
          studioInstanceId,
          attemptId,
          new Date(now.getTime() + EVENT_SHOP.startMs),
        ],
      );
      const item = (
        await q.query<ItemRow>(
          'select * from event_shop_items where channel_id = $1 and item_id = $2',
          [channelId, row.item_id],
        )
      )[0];
      return {
        purchase: view(row),
        attempt_id: attemptId,
        play: {
          kind: row.item_kind,
          media_id: item?.media_id ?? null,
          effect: item?.effect ?? null,
          params: item?.params ?? {},
          label: row.label,
          viewer_name: row.viewer_name,
        },
      };
    });
  }

  async ack(purchaseId: string, a: EventShopAckRequest) {
    return this.db.tx(async (q) => {
      const row = (
        await q.query<PurchaseRow>(
          'select * from event_shop_purchases where purchase_id = $1 for update',
          [purchaseId],
        )
      )[0];
      if (!row) throw new EventShopError(404, 'purchase_not_found');
      if (
        row.studio_instance_id !== a.studio_instance_id ||
        row.attempt_id !== a.attempt_id
      )
        throw new EventShopError(409, 'not_attempt_holder');
      const now = this.now();
      // Ended already (a repeated report, or the sweep was first): the state as it is.
      if (['completed', 'failed', 'unknown'].includes(row.status))
        return view(row);
      if (a.event === 'started') {
        if (row.status === 'queued')
          await q.query(
            `update event_shop_purchases set status = 'executing', started_at = $2, lease_expires_at = $3
             where purchase_id = $1`,
            [purchaseId, now, new Date(now.getTime() + EVENT_SHOP.maxPlayMs)],
          );
      } else if (a.event === 'completed') {
        await q.query(
          `update event_shop_purchases set status = 'completed', started_at = coalesce(started_at, $2), ended_at = $2
           where purchase_id = $1`,
          [purchaseId, now],
        );
      } else {
        const started = a.started ?? row.status === 'executing';
        await this.fail(q, row, a.error ?? 'play_failed', !started);
      }
      return view((await this.byId(q, purchaseId))!);
    });
  }

  /** Ends a purchase as failed; refunded once when it never played. */
  private async fail(
    q: Queryable,
    row: PurchaseRow,
    error: string,
    refund: boolean,
  ) {
    const now = this.now();
    await q.query(
      `update event_shop_purchases set status = 'failed', error = $2, ended_at = $3 where purchase_id = $1`,
      [row.purchase_id, error.slice(0, 120), now],
    );
    if (refund) await this.refund(q, row, 'system');
  }

  private async refund(q: Queryable, row: PurchaseRow, actor: string) {
    if (row.refund_status === 'refunded') return;
    await move(q, {
      season: row.season,
      channelId: row.channel_id,
      viewer: { id: row.viewer_id, name: row.viewer_name },
      kind: 'refund',
      amount: Number(row.price),
      key: `refund:${row.purchase_id}`,
      reference: row.purchase_id,
      actor,
      reason: row.item_id,
      now: this.now(),
    });
    await q.query(
      `update event_shop_purchases set refund_status = 'refunded' where purchase_id = $1`,
      [row.purchase_id],
    );
  }

  /** Overdue plays of a channel: not taken / not started → failed and refunded; started, never ended → unknown. */
  private async sweep(q: Queryable, channelId: string) {
    const now = this.now();
    const rows = await q.query<PurchaseRow>(
      `select * from event_shop_purchases where channel_id = $1 and status in ('queued', 'executing') for update`,
      [channelId],
    );
    for (const r of rows) {
      const lease = r.lease_expires_at
        ? new Date(r.lease_expires_at).getTime()
        : null;
      if (r.status === 'queued' && r.attempt_id === null) {
        if (
          now.getTime() - new Date(r.created_at).getTime() >
          EVENT_SHOP.pickupMs
        )
          await this.fail(q, r, 'not_taken', true);
      } else if (
        r.status === 'queued' &&
        lease !== null &&
        now.getTime() > lease
      ) {
        await this.fail(q, r, 'not_started', true);
      } else if (
        r.status === 'executing' &&
        lease !== null &&
        now.getTime() > lease
      ) {
        await q.query(
          `update event_shop_purchases set status = 'unknown', error = 'no_end', ended_at = $2 where purchase_id = $1`,
          [r.purchase_id, now],
        );
      }
    }
  }

  /** Periodic sweep of every channel (the main Core's tick): nothing waits for a reader. */
  async sweepAll() {
    const channels = await this.db.query<{ channel_id: string }>(
      `select distinct channel_id from event_shop_purchases where status in ('queued', 'executing')`,
    );
    for (const c of channels)
      await this.db.tx((q) => this.sweep(q, c.channel_id));
    return channels.length;
  }

  /**
   * Studio's STOP ALL: every purchase still waiting is failed and refunded (it will never play); the one playing
   * is ended as stopped (no refund: it was seen). Returns how many were stopped.
   */
  async stopAll(channelId: string) {
    return this.db.tx(async (q) => {
      const rows = await q.query<PurchaseRow>(
        `select * from event_shop_purchases where channel_id = $1 and status in ('queued', 'executing') for update`,
        [channelId],
      );
      for (const r of rows)
        if (r.status === 'queued') await this.fail(q, r, 'stopped', true);
        else
          await q.query(
            `update event_shop_purchases set status = 'completed', error = 'stopped', ended_at = $2 where purchase_id = $1`,
            [r.purchase_id, this.now()],
          );
      return { stopped: rows.length };
    });
  }

  // --- conversion, rewards, grants ---------------------------------------------------------------------------------

  /**
   * REMOVED 30/10 (Antoni): the Jetons → Bonbons exchange is abandoned. Every way in (extension, chat, route) is
   * refused here, whatever the saved rules say; the past conversions stay in the ledger as they were.
   */
  async convert(req: EventShopConvertRequest): Promise<never> {
    void req;
    throw new EventShopError(410, 'conversion_removed');
  }

  /**
   * Bonbons for watching (30/10): the presence tracker's VALIDATED intervals (the same ones as the Jetons, exactly once
   * per cycle) add up per viewer over the season; every `presence_every_min` minutes pays `presence_bonbons`, one ledger
   * movement per block (its key is the block's number: a block is never paid twice). Only while the event is open and
   * the rule is on; the broadcaster and the viewers excluded from the Jetons (bots) earn nothing. Runs in its own
   * savepoint of the cycle's transaction: a failure here is undone alone and logged, never the Jetons or the XP.
   */
  readonly presenceListener: PresenceListener = {
    validated: async (q: Queryable, interval: ValidatedPresence) => {
      await q.query('savepoint event_presence');
      try {
        await this.presence(q, interval);
        await q.query('release savepoint event_presence');
      } catch (e) {
        await q.query('rollback to savepoint event_presence');
        console.error('[event-shop] presence ignored', (e as Error).message);
      }
    },
  };

  private async presence(q: Queryable, interval: ValidatedPresence) {
    if (interval.seconds <= 0 || !interval.viewerIds.length) return;
    const rows = await q.query<{
      channel_id: string;
      season: string;
      rules: EventShopRules;
    }>(
      'select channel_id, season, rules from event_shop_settings where enabled',
    );
    for (const s of rows) {
      const rules = { ...DEFAULT_EVENT_RULES, ...s.rules };
      if (!rules.presence_every_min) continue;
      const block = rules.presence_every_min * 60;
      const excluded = new Set(
        (
          await q.query<{ id: string }>(
            `select twitch_user_id as id from loyalty_exclusions where twitch_user_id = any($1::text[])`,
            [interval.viewerIds],
          )
        ).map((r) => r.id),
      );
      // Sorted: two cycles locking the same viewers always do it in the same order (no deadlock).
      const ids = [...new Set(interval.viewerIds)]
        .filter((id) => id !== s.channel_id && !excluded.has(id))
        .sort();
      if (!ids.length) continue;
      const names = new Map(
        (
          await q.query<{ id: string; name: string | null }>(
            `select twitch_user_id as id, coalesce(display_name, login) as name from viewers
             where twitch_user_id = any($1::text[])`,
            [ids],
          )
        ).map((r) => [r.id, r.name]),
      );
      const now = this.now();
      for (const id of ids) {
        const [p] = await q.query<{ seconds: string; blocks_paid: number }>(
          `insert into event_presence (season, channel_id, viewer_id, seconds, blocks_paid, updated_at)
           values ($1, $2, $3, $4, 0, $5)
           on conflict (season, channel_id, viewer_id)
           do update set seconds = event_presence.seconds + excluded.seconds, updated_at = excluded.updated_at
           returning seconds, blocks_paid`,
          [s.season, s.channel_id, id, interval.seconds, now],
        );
        const blocks = Math.floor(Number(p!.seconds) / block);
        if (blocks <= p!.blocks_paid) continue;
        await move(q, {
          season: s.season,
          channelId: s.channel_id,
          viewer: { id, name: names.get(id) ?? id },
          kind: 'presence',
          amount: (blocks - p!.blocks_paid) * rules.presence_bonbons,
          key: `presence:${s.season}:${s.channel_id}:${id}:${p!.blocks_paid + 1}-${blocks}`,
          reference: interval.streamId,
          actor: 'presence',
          reason: `${blocks - p!.blocks_paid} × ${rules.presence_every_min} min`,
          now,
        });
        await q.query(
          'update event_presence set blocks_paid = $4 where season = $1 and channel_id = $2 and viewer_id = $3',
          [s.season, s.channel_id, id, blocks],
        );
      }
    }
  }

  /**
   * Bonbons for a Twitch sub / gift, inside the alert's reception transaction (called once per NEW event: a
   * redelivered event never reaches here, and every reward key is unique anyway). Closed event: nothing. The giver of
   * a gift is paid on the gift (targeted ×1, community ×count; anonymous: nobody); each recipient on their own gift
   * line (targeted, or `gift_recipient` of a community gift) — never twice.
   */
  async onAlert(q: Queryable, e: AlertEventInput) {
    // Twitch events; a donation comes from its provider (StreamElements, relayed by Studio); Lab: simulations too.
    const trusted =
      e.source === 'twitch' ||
      (e.source === 'external' && e.type === 'donation') ||
      (this.opts.rewardSimulations && e.source === 'simulation');
    if (!trusted) return;
    const rows = await q.query<{
      season: string;
      enabled: boolean;
      rules: EventShopRules;
    }>(
      'select season, enabled, rules from event_shop_settings where channel_id = $1',
      [e.channel_id],
    );
    const s = rows[0];
    if (!s?.enabled) return;
    const rules = { ...DEFAULT_EVENT_RULES, ...s.rules };
    const now = this.now();
    const pay = async (
      who: { id: string; display_name?: string; login?: string } | undefined,
      amount: number,
      role: string,
      kind: 'sub_reward' | 'gift_reward' | 'bits_reward' | 'donation_reward',
    ) => {
      if (!who?.id || amount <= 0) return;
      await move(q, {
        season: s.season,
        channelId: e.channel_id,
        viewer: { id: who.id, name: who.display_name || who.login || who.id },
        kind,
        amount,
        key: `${role}:${e.source}:${e.source_event_id}`,
        reference: e.source_event_id,
        actor: 'twitch',
        reason: e.type,
        now,
      });
    };
    const ev = e as AlertEventInput & {
      actor?: { id: string; display_name?: string; login?: string };
      recipient?: { id: string; display_name?: string; login?: string };
      anonymous?: boolean;
      count?: number;
    };
    const giver = ev.anonymous ? undefined : ev.actor;
    switch (e.type) {
      case 'sub':
        await pay(
          ev.actor,
          e.tier === 'prime'
            ? (rules.prime_reward ?? rules.sub_reward)
            : rules.sub_reward,
          'sub',
          'sub_reward',
        );
        break;
      case 'resub':
        // Same key family as a sub: one Twitch renewal never pays twice (the subscribe event of a resub is a sub).
        await pay(
          ev.actor,
          rules.resub_reward ?? rules.sub_reward,
          'sub',
          'sub_reward',
        );
        break;
      case 'bits':
        // The Twitch cheer event (its id is the key): never a number typed in the chat.
        if (rules.bits_step > 0 && e.source !== 'external')
          await pay(
            ev.actor,
            Math.floor((e.bits ?? 0) / rules.bits_step) * rules.bits_bonbons,
            'bits',
            'bits_reward',
          );
        break;
      case 'donation': {
        const amount = donationBonbons(e, rules);
        if (amount > 0)
          await pay(
            await donorOf(q, ev.actor),
            amount,
            'donation',
            'donation_reward',
          );
        break;
      }
      case 'gift_targeted':
        await pay(giver, rules.gift_giver_per_sub, 'gift-giver', 'gift_reward');
        await pay(
          ev.recipient,
          rules.gift_recipient,
          'gift-recipient',
          'gift_reward',
        );
        break;
      case 'gift_community':
        await pay(
          giver,
          rules.gift_giver_per_sub * Math.max(1, ev.count ?? 1),
          'gift-giver',
          'gift_reward',
        );
        break;
      case 'gift_recipient':
        await pay(
          ev.recipient,
          rules.gift_recipient,
          'gift-recipient',
          'gift_reward',
        );
        break;
      default:
        break;
    }
  }

  /** Studio: give or take Bonbons by hand (never below 0), once per click key. */
  async grant(req: EventShopGrantRequest, actor: string) {
    try {
      return await this.db.tx(async (q) => {
        const s = await this.ensure(q, req.channel_id);
        const viewer = await this.resolveViewer(
          q,
          s.season,
          req.channel_id,
          req.viewer,
        );
        if (!viewer) throw new EventShopError(404, 'viewer_unknown');
        // An automatic reward (a raffle) pays only during the event; Studio's own hand grant stays possible.
        if (!s.enabled && req.reason === 'raffle' && req.amount > 0)
          throw new EventShopError(409, 'event_closed');
        const r = await move(q, {
          season: s.season,
          channelId: req.channel_id,
          viewer,
          kind:
            req.amount > 0
              ? req.reason === 'raffle'
                ? 'raffle'
                : 'grant'
              : 'remove',
          amount: req.amount,
          key: `grant:${req.idempotency_key}`,
          actor,
          reason: req.note ?? req.reason,
          now: this.now(),
        });
        return {
          viewer,
          amount: r.amount,
          balance: r.balance_after,
          replayed: r.replayed,
        };
      });
    } catch (e) {
      if (e instanceof EventBalanceError)
        throw new EventShopError(409, 'insufficient_bonbons', {
          balance: e.balance,
          needed: e.needed,
        });
      throw e;
    }
  }

  /** A viewer named by the streamer: an id, else a known name (this event's wallets, then the Core's viewers). */
  private async resolveViewer(
    q: Queryable,
    season: string,
    channelId: string,
    text: string,
  ) {
    const t = text.trim().replace(/^@/, '');
    const own = await q.query<{ viewer_id: string; viewer_name: string }>(
      `select viewer_id, viewer_name from event_wallets where season = $1 and channel_id = $2
         and (viewer_id = $3 or lower(viewer_name) = lower($3)) limit 2`,
      [season, channelId, t],
    );
    if (own.length === 1)
      return { id: own[0]!.viewer_id, name: own[0]!.viewer_name };
    const hasViewers = (
      await q.query<{ r: string | null }>(
        `select to_regclass('viewers')::text as r`,
      )
    )[0]?.r;
    if (hasViewers) {
      const v = await q.query<{
        twitch_user_id: string;
        display_name: string | null;
        login: string;
      }>(
        `select twitch_user_id, display_name, login from viewers
         where twitch_user_id = $1 or lower(login) = lower($1) or lower(display_name) = lower($1) limit 2`,
        [t],
      );
      if (v.length === 1)
        return {
          id: v[0]!.twitch_user_id,
          name: v[0]!.display_name || v[0]!.login,
        };
    }
    // Every viewer the channel has seen (extension, chat, Lab and main Core alike: the D4 « Viewer… » search's source).
    const seen = await q.query<{ viewer_id: string; display_name: string }>(
      `select viewer_id, display_name from lab_viewers where channel_id = $1
         and (viewer_id = $2 or lower(display_name) = lower($2)) limit 2`,
      [channelId, t],
    );
    if (seen.length === 1)
      return { id: seen[0]!.viewer_id, name: seen[0]!.display_name };
    return /^\d{1,32}$/.test(t) && own.length === 0 ? { id: t, name: t } : null;
  }

  /**
   * Studio › Bonbons « Trouver un viewer »: who has Bonbons, then every viewer seen (D4's source), by name or id —
   * each with their Bonbons balance (0 for one who never had any). Read only.
   */
  async searchViewers(channelId: string, query: string, limit = 12) {
    return this.db.tx(async (q) => {
      const s = await this.ensure(q, channelId);
      const t = query.trim().replace(/^@/, '');
      const like = `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const rows = await q.query<{
        viewer_id: string;
        name: string;
        balance: string | null;
      }>(
        `select id as viewer_id, max(name) as name, max(balance) as balance from (
           select w.viewer_id as id, w.viewer_name as name, w.balance from event_wallets w
           where w.season = $1 and w.channel_id = $2 and ($3 = '' or w.viewer_name ilike $4 or w.viewer_id like $4)
           union all
           select v.viewer_id, v.display_name, null from lab_viewers v
           where v.channel_id = $2 and $3 <> '' and (v.display_name ilike $4 or v.viewer_id like $4)
         ) x group by id order by max(balance) desc nulls last, max(name) limit $5`,
        [s.season, channelId, t, like, limit],
      );
      return rows.map((r) => ({
        viewer_id: r.viewer_id,
        name: r.name,
        balance: Number(r.balance ?? 0),
      }));
    });
  }

  /** One viewer's Bonbons: balance, purchases (effect, when, price, status, refund) and every movement. Read only. */
  async viewerHistory(channelId: string, viewerId: string) {
    return this.db.tx(async (q) => {
      const s = await this.ensure(q, channelId);
      const purchases = await q.query<PurchaseRow>(
        `select * from event_shop_purchases where channel_id = $1 and viewer_id = $2 order by created_at desc limit 100`,
        [channelId, viewerId],
      );
      const ledger = await q.query<{
        kind: string;
        amount: string;
        balance_after: string;
        actor: string;
        reason: string | null;
        created_at: Date;
      }>(
        `select kind, amount, balance_after, actor, reason, created_at from event_ledger
         where season = $1 and channel_id = $2 and viewer_id = $3 order by id desc limit 200`,
        [s.season, channelId, viewerId],
      );
      return {
        viewer_id: viewerId,
        balance: await balanceOf(q, s.season, channelId, viewerId),
        purchases: purchases.map(view),
        ledger: ledger.map((l) => ({
          kind: l.kind,
          amount: Number(l.amount),
          balance_after: Number(l.balance_after),
          actor: l.actor,
          reason: l.reason,
          created_at: iso(l.created_at),
        })),
      };
    });
  }

  // --- reads -------------------------------------------------------------------------------------------------------

  private async byId(q: Queryable, id: string) {
    return (
      (
        await q.query<PurchaseRow>(
          'select * from event_shop_purchases where purchase_id = $1',
          [id],
        )
      )[0] ?? null
    );
  }

  /**
   * What the extension shows to one viewer (null viewer: anonymous, read only): the event, their balance and
   * conversion room, each item with its thumbnail and whether / when it can be bought, the overlay's state.
   */
  async viewerState(channelId: string, viewerId: string | null) {
    return this.db.tx(async (q) => {
      const s = await this.ensure(q, channelId);
      await this.sweep(q, channelId);
      const now = this.now();
      const engine = await this.engine(q, channelId);
      const items = (await this.items(q, channelId)).filter((i) => i.enabled);
      const available = [];
      for (const it of items) {
        const media = !it.media_id || !!engine?.media.has(it.media_id);
        const limit = media
          ? await this.limits(q, channelId, s, it, viewerId, now)
          : null;
        available.push({
          item_id: it.item_id,
          kind: it.kind,
          label: it.label,
          description: it.description,
          price: it.price,
          thumb: thumbOf(it),
          category: categoryOf(it),
          available: !!engine && media && !limit,
          reason: !engine
            ? 'engine_offline'
            : !media
              ? 'media_missing'
              : (limit?.code ?? null),
          retry_after_ms: limit?.retry_after_ms ?? 0,
        });
      }
      const recent = viewerId
        ? (
            await q.query<PurchaseRow>(
              `select * from event_shop_purchases where channel_id = $1 and viewer_id = $2 order by created_at desc limit 5`,
              [channelId, viewerId],
            )
          ).map(view)
        : [];
      return {
        enabled: s.enabled,
        season: s.season,
        edition: { id: s.season, title: editionTitle(s.season) },
        // The Extension's façades show the module (and accept its purchases) only when true.
        extension_allowed: extensionAllowed(s.rules, viewerId),
        engine_ready: !!engine,
        balance: viewerId
          ? await balanceOf(q, s.season, channelId, viewerId)
          : null,
        // No exchange any more (30/10): the published Extension reads « closed » from this.
        conversion: {
          rate: s.rules.conversion_rate,
          cap_per_hour: 0,
          used_last_hour: 0,
          remaining: 0,
          frees_at: null,
        },
        earn: {
          sub_reward: s.rules.sub_reward,
          prime_reward: s.rules.prime_reward ?? s.rules.sub_reward,
          resub_reward: s.rules.resub_reward ?? s.rules.sub_reward,
          gift_giver_per_sub: s.rules.gift_giver_per_sub,
          gift_recipient: s.rules.gift_recipient,
          presence: s.rules.presence_every_min
            ? {
                every_min: s.rules.presence_every_min,
                bonbons: s.rules.presence_bonbons,
              }
            : null,
          bits: s.rules.bits_step
            ? { step: s.rules.bits_step, bonbons: s.rules.bits_bonbons }
            : null,
          donation_per_euro: s.rules.donation_per_euro || null,
          // The Tombola can reward in Bonbons while the event is open (event-shop/raffle-currency.ts).
          raffle: s.enabled,
        },
        items: available,
        recent,
      };
    });
  }

  /**
   * `!solde` during the event: « 17 Bonbons 🍬 » (0 for a viewer who never had any), or null when the event is closed
   * or was never set up. Read-only (creates nothing).
   */
  async balanceLine(
    channelId: string,
    viewerId: string,
  ): Promise<string | null> {
    const s = (
      await this.db.query<{ season: string; enabled: boolean }>(
        'select season, enabled from event_shop_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    if (!s?.enabled) return null;
    const n = await balanceOf(this.db, s.season, channelId, viewerId);
    return `${n.toLocaleString('fr-FR').replace(/\s/g, ' ')} Bonbon${n >= 2 ? 's' : ''} 🍬`;
  }

  /** Studio's panel: settings, the whole catalogue, the overlay, recent purchases and movements, totals. */
  async admin(channelId: string) {
    return this.db.tx(async (q) => {
      const s = await this.ensure(q, channelId);
      await this.sweep(q, channelId);
      const engine = await this.engine(q, channelId);
      const purchases = (
        await q.query<PurchaseRow>(
          'select * from event_shop_purchases where channel_id = $1 order by created_at desc limit 30',
          [channelId],
        )
      ).map(view);
      const ledger = await q.query<{
        id: string;
        viewer_id: string;
        viewer_name: string;
        kind: string;
        amount: string;
        balance_after: string;
        actor: string;
        reason: string | null;
        created_at: Date;
      }>(
        `select l.id, l.viewer_id, w.viewer_name, l.kind, l.amount, l.balance_after, l.actor, l.reason, l.created_at
         from event_ledger l join event_wallets w on w.season = l.season and w.channel_id = l.channel_id
           and w.viewer_id = l.viewer_id
         where l.season = $1 and l.channel_id = $2 order by l.id desc limit 40`,
        [s.season, channelId],
      );
      const totals = (
        await q.query<{ wallets: number; bonbons: string | null }>(
          `select count(*)::int as wallets, sum(balance) as bonbons from event_wallets where season = $1 and channel_id = $2`,
          [s.season, channelId],
        )
      )[0]!;
      return {
        settings: s,
        items: await this.items(q, channelId),
        engine: engine
          ? {
              ready: true,
              studio_instance_id: engine.instance,
              media: [...engine.media],
            }
          : null,
        purchases,
        ledger: ledger.map((l) => ({
          id: Number(l.id),
          viewer: { id: l.viewer_id, name: l.viewer_name },
          kind: l.kind,
          amount: Number(l.amount),
          balance_after: Number(l.balance_after),
          actor: l.actor,
          reason: l.reason,
          created_at: iso(l.created_at),
        })),
        totals: {
          wallets: totals.wallets,
          bonbons: Number(totals.bonbons ?? 0),
        },
      };
    });
  }
}

/** Bonbons for a donation: euros only (no exchange rate is guessed), from the minimum, whole euros × the rate. */
export function donationBonbons(
  e: Pick<AlertEventInput, 'amount'>,
  rules: Pick<EventShopRules, 'donation_per_euro' | 'donation_min_cents'>,
) {
  const a = e.amount;
  if (!rules.donation_per_euro || !a || a.currency !== 'EUR') return 0;
  const cents = Math.round(a.value / 10 ** Math.max(0, a.decimal_place - 2));
  if (cents < rules.donation_min_cents) return 0;
  return Math.floor(cents / 100) * rules.donation_per_euro;
}

/**
 * A tip carries the name typed by the donor, not a Twitch account: it pays the viewer whose Twitch login or display
 * name is EXACTLY that name (any case), and only when exactly one viewer matches; otherwise nobody (never a guess).
 */
async function donorOf(
  q: Queryable,
  actor: { id?: string; display_name?: string; login?: string } | undefined,
) {
  if (actor?.id) return { id: actor.id, display_name: actor.display_name };
  const name = (actor?.login ?? actor?.display_name ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_]{2,25}$/.test(name)) return undefined;
  await q.query('savepoint event_donor');
  try {
    const rows = await q.query<{
      twitch_user_id: string;
      display_name: string | null;
    }>(
      `select twitch_user_id, display_name from viewers where lower(login) = $1 or lower(display_name) = $1 limit 2`,
      [name],
    );
    await q.query('release savepoint event_donor');
    return rows.length === 1
      ? {
          id: rows[0]!.twitch_user_id,
          display_name: rows[0]!.display_name ?? name,
        }
      : undefined;
  } catch {
    // No viewers table (a Lab database without the presence schema): nobody.
    await q.query('rollback to savepoint event_donor');
    return undefined;
  }
}
