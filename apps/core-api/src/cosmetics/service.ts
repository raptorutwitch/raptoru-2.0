import { randomUUID } from 'node:crypto';
import type {
  CosmeticAwardRequest,
  CosmeticItemInput,
  CosmeticOfferInput,
  CosmeticStyle,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import {
  balanceOf,
  EventBalanceError,
  move as bonbonsMove,
} from '../event-shop/ledger.js';
import { EVENT_SHOP } from '../event-shop/service.js';
import { LabWalletError } from '../lab-moderation/store.js';
import type { ProgressionService } from '../progression/service.js';
import { checkImage, CosmeticImageError } from './images.js';

// Boutique cosmétique V1 (docs/COSMETIC_SHOP.md). The titles and badges ARE the progression's catalogue and inventory
// (progression_rewards / progression_grants / progression_equipped): this module adds their look, their state, the
// offers that sell them and the purchases. No second economy: Jetons through the economy port (the Lab test wallet in
// the Lab, the canonical Wallet in production), Bonbons through the event ledger — both INSIDE the purchase's own
// transaction (debit + item + purchase row commit or roll back together).
// - publication (draft / published / hidden / archived), visibility and sale (an offer: on, dates, event open) are
//   separate; an item withdrawn from sale or archived stays in every inventory;
// - a purchase: the signed-in viewer (the site's session, never the browser's word), the price and the balance read by
//   the Core, one viewer at a time (lock), one purchase per click (idempotency key), never an item owned twice;
// - a refund gives the money back and takes the item back, once, journaled; a module awards once per key.

export class CosmeticError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const JETONS = 'tokens';
type Currency = 'main' | 'bonbons';

interface ItemRow {
  reward_id: string;
  kind: 'title' | 'badge';
  label: string;
  description: string;
  rarity: string;
  category: string;
  unlock_level: number | null;
  active: boolean;
  sort: number;
  status: 'draft' | 'published' | 'hidden' | 'archived';
  style: CosmeticStyle | Record<string, never>;
  image_id: string | null;
  event_key: string | null;
}

interface OfferRow {
  offer_id: string;
  reward_id: string;
  currency: Currency;
  price: string | number;
  enabled: boolean;
  opens_at: Date | null;
  closes_at: Date | null;
  event_key: string | null;
  sort: number;
}

interface PurchaseRow {
  purchase_id: string;
  viewer_id: string;
  viewer_name: string;
  offer_id: string;
  reward_id: string;
  currency: Currency;
  price: string | number;
  status: 'completed' | 'refunded';
  created_at: Date;
  refunded_at: Date | null;
  refunded_by: string | null;
  refund_reason: string | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
export const imageUrl = (id: string | null) =>
  id ? `/v1/cosmetics/images/${id}` : null;

const itemView = (r: ItemRow) => ({
  reward_id: r.reward_id,
  kind: r.kind,
  label: r.label,
  description: r.description,
  rarity: r.rarity,
  category: r.category,
  unlock_level: r.unlock_level,
  active: r.active,
  sort: r.sort,
  status: r.status,
  style: r.style ?? {},
  image_id: r.image_id,
  image: imageUrl(r.image_id),
  event_key: r.event_key,
});
const offerView = (o: OfferRow) => ({
  offer_id: o.offer_id,
  reward_id: o.reward_id,
  currency: o.currency,
  price: Number(o.price),
  enabled: o.enabled,
  opens_at: iso(o.opens_at),
  closes_at: iso(o.closes_at),
  event_key: o.event_key,
  sort: o.sort,
});
const purchaseView = (p: PurchaseRow) => ({
  purchase_id: p.purchase_id,
  viewer_id: p.viewer_id,
  viewer_name: p.viewer_name,
  offer_id: p.offer_id,
  reward_id: p.reward_id,
  currency: p.currency,
  price: Number(p.price),
  status: p.status,
  created_at: iso(p.created_at),
  refunded_at: iso(p.refunded_at),
  refunded_by: p.refunded_by,
  refund_reason: p.refund_reason,
});

export class CosmeticShopService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly progression: ProgressionService,
    /** Jetons: the Lab test wallet in the Lab, the canonical Wallet in production (economy/activation.ts). */
    private readonly economy: EconomyPort,
  ) {}

  private now() {
    return this.clock.now();
  }

  /** The Bonbons season of the channel and whether that event is open (none configured: the default season, closed). */
  private async event(q: Queryable, channelId: string) {
    const r = (
      await q.query<{ season: string; enabled: boolean }>(
        'select season, enabled from event_shop_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    return {
      season: r?.season ?? EVENT_SHOP.defaultSeason,
      open: r?.enabled === true,
    };
  }

  // --- Studio: the editor -------------------------------------------------------------------------------------------

  /** Every item (drafts too), with its offers and how many own it. */
  async items(channelId: string) {
    const [items, offers, owners] = await Promise.all([
      this.db.query<ItemRow>(
        `select reward_id, kind, label, description, rarity, category, unlock_level, active, sort, status, style, image_id,
           event_key
         from progression_rewards where channel_id = $1 order by kind, sort, label`,
        [channelId],
      ),
      this.db.query<OfferRow>(
        'select * from cosmetic_offers where channel_id = $1 order by sort, offer_id',
        [channelId],
      ),
      this.db.query<{ reward_id: string; n: string }>(
        `select reward_id, count(*) as n from progression_grants where channel_id = $1 and revoked_at is null
         group by reward_id`,
        [channelId],
      ),
    ]);
    const owned = new Map(owners.map((o) => [o.reward_id, Number(o.n)]));
    return items.map((i) => ({
      ...itemView(i),
      owners: owned.get(i.reward_id) ?? 0,
      offers: offers.filter((o) => o.reward_id === i.reward_id).map(offerView),
    }));
  }

  /**
   * Creates or updates an item. Its kind never changes; a published item's id never changes (rename refuses it). A level
   * reward that becomes published reaches the viewers already at that level (the progression's own rule).
   */
  async upsertItem(channelId: string, input: CosmeticItemInput) {
    return this.db.tx(async (q) => {
      const prior = (
        await q.query<{ kind: string }>(
          'select kind from progression_rewards where channel_id = $1 and reward_id = $2 for update',
          [channelId, input.reward_id],
        )
      )[0];
      if (prior && prior.kind !== input.kind)
        throw new CosmeticError(409, 'kind_locked');
      if (input.image_id) {
        const img = await q.query(
          'select 1 from cosmetic_images where image_id = $1',
          [input.image_id],
        );
        if (!img.length) throw new CosmeticError(404, 'unknown_image');
      }
      const now = this.now();
      await q.query(
        `insert into progression_rewards (channel_id, reward_id, kind, label, description, rarity, category, unlock_level,
           active, sort, status, style, image_id, event_key, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12, $13, $14, $14)
         on conflict (channel_id, reward_id) do update set label = $4, description = $5, rarity = $6, category = $7,
           unlock_level = $8, sort = $9, status = $10, style = $11, image_id = $12, event_key = $13, updated_at = $14`,
        [
          channelId,
          input.reward_id,
          input.kind,
          input.label,
          input.description,
          input.rarity,
          input.category,
          input.unlock_level,
          input.sort,
          input.status,
          JSON.stringify(input.style),
          input.image_id,
          input.event_key,
          now,
        ],
      );
      if (input.unlock_level !== null && input.status !== 'draft') {
        const ids = await q.query<{ id: string }>(
          'select twitch_user_id as id from progression_accounts where channel_id = $1 and level >= $2',
          [channelId, input.unlock_level],
        );
        for (const { id } of ids)
          await this.progression.insertGrant(
            q,
            channelId,
            id,
            input.reward_id,
            'level',
            `level:${input.unlock_level}`,
            'progression',
            false,
          );
      }
      return (await this.itemsIn(q, channelId, input.reward_id))[0]!;
    });
  }

  private async itemsIn(q: Queryable, channelId: string, rewardId: string) {
    return (
      await q.query<ItemRow>(
        `select reward_id, kind, label, description, rarity, category, unlock_level, active, sort, status, style, image_id,
           event_key from progression_rewards where channel_id = $1 and reward_id = $2`,
        [channelId, rewardId],
      )
    ).map(itemView);
  }

  /** A draft's id, changed (its offers follow); refused once it left the draft state or anyone owns it. */
  async renameDraft(channelId: string, from: string, to: string) {
    return this.db.tx(async (q) => {
      const r = (
        await q.query<{ status: string }>(
          'select status from progression_rewards where channel_id = $1 and reward_id = $2 for update',
          [channelId, from],
        )
      )[0];
      if (!r) throw new CosmeticError(404, 'unknown_item');
      if (r.status !== 'draft') throw new CosmeticError(409, 'id_locked');
      const used = await q.query(
        `select 1 from progression_grants where channel_id = $1 and reward_id = $2
         union all select 1 from cosmetic_purchases where channel_id = $1 and reward_id = $2
         union all select 1 from progression_rewards where channel_id = $1 and reward_id = $3`,
        [channelId, from, to],
      );
      if (used.length) throw new CosmeticError(409, 'id_in_use');
      // The offers point at the item: the new row first, the offers moved, then the old row gone.
      await q.query(
        `insert into progression_rewards (channel_id, reward_id, kind, label, description, rarity, category, unlock_level,
           active, sort, status, style, image_id, event_key, created_at, updated_at)
         select channel_id, $3, kind, label, description, rarity, category, unlock_level, active, sort, status, style,
           image_id, event_key, created_at, $4
         from progression_rewards where channel_id = $1 and reward_id = $2`,
        [channelId, from, to, this.now()],
      );
      await q.query(
        'update cosmetic_offers set reward_id = $3 where channel_id = $1 and reward_id = $2',
        [channelId, from, to],
      );
      await q.query(
        'delete from progression_rewards where channel_id = $1 and reward_id = $2',
        [channelId, from],
      );
      return (await this.itemsIn(q, channelId, to))[0]!;
    });
  }

  /** A copy of an item as a new DRAFT (a variant): its look and texts, never its offers nor its owners. */
  async duplicate(channelId: string, from: string, to: string, label?: string) {
    return this.db.tx(async (q) => {
      const exists = await q.query(
        'select 1 from progression_rewards where channel_id = $1 and reward_id = $2',
        [channelId, to],
      );
      if (exists.length) throw new CosmeticError(409, 'id_in_use');
      const done = await q.query(
        `insert into progression_rewards (channel_id, reward_id, kind, label, description, rarity, category, unlock_level,
           active, sort, status, style, image_id, event_key, created_at, updated_at)
         select channel_id, $3, kind, coalesce($4, label), description, rarity, category, null, true, sort, 'draft', style,
           image_id, event_key, $5, $5
         from progression_rewards where channel_id = $1 and reward_id = $2 returning 1`,
        [channelId, from, to, label ?? null, this.now()],
      );
      if (!done.length) throw new CosmeticError(404, 'unknown_item');
      return (await this.itemsIn(q, channelId, to))[0]!;
    });
  }

  /** A badge image, checked on its bytes, stored once by content hash. */
  async uploadImage(base64: string) {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch {
      throw new CosmeticError(400, 'image_invalid');
    }
    let img;
    try {
      img = checkImage(bytes);
    } catch (e) {
      if (e instanceof CosmeticImageError) throw new CosmeticError(400, e.code);
      throw e;
    }
    await this.db.query(
      `insert into cosmetic_images (image_id, mime, width, height, size, bytes, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (image_id) do nothing`,
      [
        img.imageId,
        img.mime,
        img.width,
        img.height,
        img.size,
        bytes,
        this.now(),
      ],
    );
    return {
      image_id: img.imageId,
      image: imageUrl(img.imageId),
      mime: img.mime,
      width: img.width,
      height: img.height,
      size: img.size,
    };
  }

  async image(imageId: string) {
    const r = (
      await this.db.query<{ mime: string; bytes: Buffer | Uint8Array }>(
        'select mime, bytes from cosmetic_images where image_id = $1',
        [imageId],
      )
    )[0];
    return r ? { mime: r.mime, bytes: Buffer.from(r.bytes) } : null;
  }

  /** Creates or updates an offer (how an item is sold). Its currency and its item never change once someone bought it. */
  async upsertOffer(channelId: string, input: CosmeticOfferInput) {
    return this.db.tx(async (q) => {
      const item = (
        await q.query<{ status: string }>(
          'select status from progression_rewards where channel_id = $1 and reward_id = $2',
          [channelId, input.reward_id],
        )
      )[0];
      if (!item) throw new CosmeticError(404, 'unknown_item');
      if (
        input.opens_at &&
        input.closes_at &&
        new Date(input.closes_at) <= new Date(input.opens_at)
      )
        throw new CosmeticError(400, 'closes_before_opening');
      const prior = (
        await q.query<{
          channel_id: string;
          reward_id: string;
          currency: string;
        }>(
          'select channel_id, reward_id, currency from cosmetic_offers where offer_id = $1 for update',
          [input.offer_id],
        )
      )[0];
      if (prior && prior.channel_id !== channelId)
        throw new CosmeticError(409, 'offer_id_in_use');
      if (
        prior &&
        (prior.reward_id !== input.reward_id ||
          prior.currency !== input.currency)
      ) {
        const sold = await q.query(
          'select 1 from cosmetic_purchases where offer_id = $1 limit 1',
          [input.offer_id],
        );
        if (sold.length) throw new CosmeticError(409, 'offer_locked');
      }
      const now = this.now();
      await q.query(
        `insert into cosmetic_offers (offer_id, channel_id, reward_id, currency, price, enabled, opens_at, closes_at,
           event_key, sort, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         on conflict (offer_id) do update set reward_id = $3, currency = $4, price = $5, enabled = $6, opens_at = $7,
           closes_at = $8, event_key = $9, sort = $10, updated_at = $11`,
        [
          input.offer_id,
          channelId,
          input.reward_id,
          input.currency,
          input.price,
          input.enabled,
          input.opens_at,
          input.closes_at,
          input.event_key,
          input.sort,
          now,
        ],
      );
      return offerView(
        (
          await q.query<OfferRow>(
            'select * from cosmetic_offers where offer_id = $1',
            [input.offer_id],
          )
        )[0]!,
      );
    });
  }

  /** Why an offer cannot be bought now (null: it can). The same rules for the catalogue and for the purchase. */
  private availability(
    o: OfferRow,
    item: { status: string; active: boolean },
    event: { season: string; open: boolean },
    now: Date,
  ) {
    if (!item.active || item.status !== 'published') return 'item_unavailable';
    if (!o.enabled) return 'offer_disabled';
    if (o.opens_at && now < new Date(o.opens_at)) return 'offer_not_open';
    if (o.closes_at && now >= new Date(o.closes_at)) return 'offer_closed';
    if (o.event_key && (o.event_key !== event.season || !event.open))
      return 'event_closed';
    return null;
  }

  // --- raptoru.fr: the catalogue, a viewer's side, the purchase ----------------------------------------------------

  /** The public catalogue: published items with the offers on sale now (an empty shop is a normal answer). */
  async catalog(channelId: string) {
    const now = this.now();
    const event = await this.event(this.db, channelId);
    const items = await this.db.query<ItemRow>(
      `select reward_id, kind, label, description, rarity, category, unlock_level, active, sort, status, style, image_id,
         event_key from progression_rewards where channel_id = $1 and status = 'published' and active
       order by kind, sort, label`,
      [channelId],
    );
    const offers = await this.db.query<OfferRow>(
      'select * from cosmetic_offers where channel_id = $1 order by sort, price, offer_id',
      [channelId],
    );
    const out = [];
    for (const i of items) {
      const onSale = offers.filter(
        (o) =>
          o.reward_id === i.reward_id &&
          this.availability(o, i, event, now) === null,
      );
      if (!onSale.length) continue;
      const v = itemView(i);
      out.push({
        id: v.reward_id,
        kind: v.kind,
        label: v.label,
        description: v.description,
        rarity: v.rarity,
        category: v.category,
        style: v.style,
        image: v.image,
        event_key: v.event_key,
        offers: onSale.map((o) => ({
          offer_id: o.offer_id,
          currency: o.currency,
          price: Number(o.price),
          closes_at: iso(o.closes_at),
        })),
      });
    }
    return {
      now: now.toISOString(),
      event: { key: event.season, open: event.open },
      items: out,
    };
  }

  /** The signed-in viewer's side: balances in both currencies, what they own, their purchases. */
  async viewerShop(channelId: string, viewerId: string) {
    const event = await this.event(this.db, channelId);
    const [jetons, bonbons, owned, purchases] = await Promise.all([
      this.economy
        .balances(this.db, channelId, viewerId)
        .then((b) => b.tokens)
        .catch(() => null),
      balanceOf(this.db, event.season, channelId, viewerId),
      this.db.query<{ reward_id: string }>(
        `select reward_id from progression_grants where channel_id = $1 and twitch_user_id = $2 and revoked_at is null`,
        [channelId, viewerId],
      ),
      this.db.query<PurchaseRow>(
        `select * from cosmetic_purchases where channel_id = $1 and viewer_id = $2 order by created_at desc limit 50`,
        [channelId, viewerId],
      ),
    ]);
    return {
      balances: { main: jetons, bonbons },
      owned: owned.map((o) => o.reward_id),
      purchases: purchases.map(purchaseView),
    };
  }

  /**
   * One purchase, all or nothing: the viewer's lock, the replay of the same click, the offer's CURRENT state and price,
   * ownership, the debit in the offer's currency, the item in the inventory, the purchase row.
   */
  async purchase(
    channelId: string,
    req: {
      viewer: string;
      viewer_name: string;
      offer_id: string;
      idempotency_key: string;
    },
  ) {
    try {
      return await this.db.tx((q) => this.purchaseTx(q, channelId, req));
    } catch (e) {
      if (e instanceof EventBalanceError)
        throw new CosmeticError(409, 'insufficient_funds', {
          currency: 'bonbons',
          balance: e.balance,
          needed: e.needed,
        });
      if (e instanceof LabWalletError)
        throw new CosmeticError(
          e.code === 'insufficient_tokens' ? 409 : 503,
          e.code === 'insufficient_tokens'
            ? 'insufficient_funds'
            : 'wallet_unavailable',
          { currency: 'main', ...(e.details ?? {}) },
        );
      throw e;
    }
  }

  private async purchaseTx(
    q: Queryable,
    channelId: string,
    req: {
      viewer: string;
      viewer_name: string;
      offer_id: string;
      idempotency_key: string;
    },
  ) {
    await q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `cosmetic:${channelId}:${req.viewer}`,
    ]);
    const prior = (
      await q.query<PurchaseRow>(
        'select * from cosmetic_purchases where channel_id = $1 and viewer_id = $2 and idempotency_key = $3',
        [channelId, req.viewer, req.idempotency_key],
      )
    )[0];
    if (prior) {
      if (prior.offer_id !== req.offer_id)
        throw new CosmeticError(409, 'idempotency_conflict');
      return { purchase: purchaseView(prior), replayed: true };
    }
    const now = this.now();
    const offer = (
      await q.query<OfferRow>(
        'select * from cosmetic_offers where offer_id = $1 and channel_id = $2',
        [req.offer_id, channelId],
      )
    )[0];
    if (!offer) throw new CosmeticError(404, 'unknown_offer');
    const item = (
      await q.query<{ status: string; active: boolean; label: string }>(
        'select status, active, label from progression_rewards where channel_id = $1 and reward_id = $2',
        [channelId, offer.reward_id],
      )
    )[0]!;
    const event = await this.event(q, channelId);
    const why = this.availability(offer, item, event, now);
    if (why) throw new CosmeticError(409, why);
    const owned = await q.query(
      `select 1 from progression_grants where channel_id = $1 and twitch_user_id = $2 and reward_id = $3
         and revoked_at is null`,
      [channelId, req.viewer, offer.reward_id],
    );
    if (owned.length) throw new CosmeticError(409, 'already_owned');
    const price = Number(offer.price);
    const purchaseId = randomUUID();
    const key = `cosmetic:${purchaseId}`;
    if (offer.currency === 'bonbons')
      await bonbonsMove(q, {
        season: event.season,
        channelId,
        viewer: { id: req.viewer, name: req.viewer_name },
        kind: 'purchase',
        amount: -price,
        key,
        reference: purchaseId,
        actor: 'viewer',
        reason: `cosmétique ${offer.reward_id}`,
        now,
      });
    else
      await this.economy.move(q, now, {
        channelId,
        viewerId: req.viewer,
        currency: JETONS,
        amount: -price,
        kind: 'cosmetic',
        key,
        moduleId: 'cosmetic_shop',
      });
    await this.progression.insertGrant(
      q,
      channelId,
      req.viewer,
      offer.reward_id,
      'purchase',
      purchaseId,
      'boutique',
      true,
    );
    await q.query(
      `insert into cosmetic_purchases (purchase_id, channel_id, viewer_id, viewer_name, offer_id, reward_id, currency,
         price, idempotency_key, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10)`,
      [
        purchaseId,
        channelId,
        req.viewer,
        req.viewer_name.slice(0, 64),
        offer.offer_id,
        offer.reward_id,
        offer.currency,
        price,
        req.idempotency_key,
        now,
      ],
    );
    return {
      purchase: purchaseView(
        (
          await q.query<PurchaseRow>(
            'select * from cosmetic_purchases where purchase_id = $1',
            [purchaseId],
          )
        )[0]!,
      ),
      replayed: false,
    };
  }

  // --- Studio: purchases, refunds, awards -------------------------------------------------------------------------

  async purchases(channelId: string, limit = 100) {
    return (
      await this.db.query<PurchaseRow>(
        'select * from cosmetic_purchases where channel_id = $1 order by created_at desc limit $2',
        [channelId, Math.min(limit, 500)],
      )
    ).map(purchaseView);
  }

  /** A refund: the price back in its currency (a credit: never a negative balance), the item taken back, once. */
  async refund(
    channelId: string,
    purchaseId: string,
    reason: string,
    actor: string,
  ) {
    return this.db.tx(async (q) => {
      const p = (
        await q.query<PurchaseRow>(
          'select * from cosmetic_purchases where purchase_id = $1 and channel_id = $2 for update',
          [purchaseId, channelId],
        )
      )[0];
      if (!p) throw new CosmeticError(404, 'unknown_purchase');
      if (p.status === 'refunded')
        return { refunded: false, purchase: purchaseView(p) };
      const now = this.now();
      const key = `cosmetic-refund:${purchaseId}`;
      if (p.currency === 'bonbons') {
        const season = (
          await q.query<{ season: string }>(
            `select season from event_ledger where key = $1`,
            [`cosmetic:${purchaseId}`],
          )
        )[0]?.season;
        await bonbonsMove(q, {
          season: season ?? (await this.event(q, channelId)).season,
          channelId,
          viewer: { id: p.viewer_id, name: p.viewer_name },
          kind: 'refund',
          amount: Number(p.price),
          key,
          reference: purchaseId,
          actor: actor.slice(0, 64),
          reason,
          now,
        });
      } else
        await this.economy.move(q, now, {
          channelId,
          viewerId: p.viewer_id,
          currency: JETONS,
          amount: Number(p.price),
          kind: 'cosmetic',
          key,
          moduleId: 'cosmetic_shop',
        });
      await this.progression
        .revokeIn(
          q,
          channelId,
          {
            reward_id: p.reward_id,
            viewer: p.viewer_id,
            reason: `remboursement : ${reason}`,
          },
          { id: actor, name: actor },
        )
        .catch(() => undefined); // already taken back by hand: the refund still goes through
      await q.query(
        `update cosmetic_purchases set status = 'refunded', refunded_at = $2, refunded_by = $3, refund_reason = $4
         where purchase_id = $1`,
        [purchaseId, now, actor.slice(0, 64), reason],
      );
      return {
        refunded: true,
        purchase: purchaseView(
          (
            await q.query<PurchaseRow>(
              'select * from cosmetic_purchases where purchase_id = $1',
              [purchaseId],
            )
          )[0]!,
        ),
      };
    });
  }

  /**
   * A module's reward (a mini-game, an event, Studio): an item, Bonbons or Jetons, once per key — the stable contract
   * future modules plug into. Replayed key: the first award, nothing more.
   */
  async award(channelId: string, req: CosmeticAwardRequest) {
    try {
      return await this.db.tx(async (q) => {
        const now = this.now();
        const inserted = await q.query(
          `insert into cosmetic_awards (channel_id, award_key, module, viewer_id, kind, reward_id, amount, reference,
             created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (channel_id, award_key) do nothing returning 1`,
          [
            channelId,
            `${req.module}:${req.key}`,
            req.module,
            req.viewer,
            req.item.kind,
            req.item.kind === 'reward' ? req.item.reward_id : null,
            req.item.kind === 'reward' ? null : req.item.amount,
            req.reference,
            now,
          ],
        );
        if (!inserted.length) return { awarded: false, replayed: true };
        const key = `award:${req.module}:${req.key}`;
        if (req.item.kind === 'reward') {
          const r = (
            await q.query<{ status: string; active: boolean }>(
              'select status, active from progression_rewards where channel_id = $1 and reward_id = $2',
              [channelId, req.item.reward_id],
            )
          )[0];
          if (!r) throw new CosmeticError(404, 'unknown_item');
          if (!r.active || r.status === 'draft')
            throw new CosmeticError(409, 'item_unavailable');
          await this.progression.insertGrant(
            q,
            channelId,
            req.viewer,
            req.item.reward_id,
            'reward',
            `${req.module}:${req.key}`.slice(0, 120),
            req.module,
            true,
          );
        } else if (req.item.kind === 'bonbons')
          await bonbonsMove(q, {
            season: (await this.event(q, channelId)).season,
            channelId,
            viewer: { id: req.viewer, name: req.viewer_name },
            kind: 'grant',
            amount: req.item.amount,
            key,
            reference: req.reference,
            actor: req.module,
            reason: `récompense ${req.module}`,
            now,
          });
        else
          await this.economy.move(q, now, {
            channelId,
            viewerId: req.viewer,
            currency: JETONS,
            amount: req.item.amount,
            kind: 'mini_game',
            key,
            moduleId: req.module,
          });
        return { awarded: true, replayed: false };
      });
    } catch (e) {
      if (e instanceof LabWalletError)
        throw new CosmeticError(503, 'wallet_unavailable', e.details ?? {});
      throw e;
    }
  }
}
