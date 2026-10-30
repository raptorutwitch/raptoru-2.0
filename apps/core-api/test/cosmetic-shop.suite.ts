import { CosmeticItemInput, CosmeticOfferInput } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { CosmeticShopService } from '../src/cosmetics/service.js';
import type { Db } from '../src/db/db.js';
import { labEconomy } from '../src/economy/economy.js';
import { ProgressionService } from '../src/progression/service.js';
import { FakeClock } from './helpers.js';

// Boutique cosmétique V1 (docs/COSMETIC_SHOP.md), on the Lab test wallet and the event ledger only (never a real
// economy): the editor (draft → published, ids, duplicates, looks as data), badge images checked on their bytes, the
// catalogue's rules (publication, sale, dates, event), purchases in Jetons and Bonbons (all or nothing, once per click,
// one viewer at a time, never owned twice, the Core's price), a crash in the middle, refunds, module awards, the inventory
// kept after a withdrawal or an archive. Run on PGlite (cosmetic-shop.test.ts) and on a real Postgres (….integration).

const CH = '83603689';
const T0 = new Date('2026-11-04T19:00:00Z');
const ANA = { viewer: '1', viewer_name: 'Ana' };

/** A minimal PNG (signature, IHDR, optional extra chunk, IEND) of the given size: what the checker reads. */
export function png(width: number, height: number, extra?: string) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([
      len,
      Buffer.from(type, 'latin1'),
      data,
      Buffer.alloc(4),
    ]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(extra ? [chunk(extra, Buffer.alloc(8))] : []),
    chunk('IDAT', Buffer.alloc(16)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function cosmeticShopSuite(freshDb: () => Promise<Db>) {
  let db: Db;
  let clock: FakeClock;
  let progression: ProgressionService;
  let shop: CosmeticShopService;

  beforeEach(async () => {
    db = await freshDb();
    clock = new FakeClock(T0);
    progression = new ProgressionService(db, clock, () => CH);
    shop = new CosmeticShopService(db, clock, progression, labEconomy);
    for (const [id, login] of [
      ['1', 'ana'],
      ['2', 'bob'],
    ])
      await db.query(
        'insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2)',
        [id, login],
      );
    // The Lab test wallet: 1 000 test Jetons each. The event (Bonbons): open, season halloween-2026.
    for (const id of ['1', '2'])
      await db.query(
        `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
         values ($1, $2, 1000, 0, 0, $3)`,
        [CH, id, T0],
      );
    await db.query(
      `insert into event_shop_settings (channel_id, season, enabled, rules, updated_at)
       values ($1, 'halloween-2026', true, '{}', $2)`,
      [CH, T0],
    );
  });

  const item = (over: Partial<Record<string, unknown>> = {}) =>
    shop.upsertItem(
      CH,
      CosmeticItemInput.parse({
        reward_id: 'roi-citrouille',
        kind: 'title',
        label: 'Roi Citrouille',
        status: 'published',
        style: {
          color: '#ff8a00',
          gradient: { from: '#ff8a00', to: '#ffd36b', angle: 45 },
          effect: 'shine',
        },
        ...over,
      }),
    );
  const offer = (over: Partial<Record<string, unknown>> = {}) =>
    shop.upsertOffer(
      CH,
      CosmeticOfferInput.parse({
        offer_id: 'roi-jetons',
        reward_id: 'roi-citrouille',
        currency: 'main',
        price: 300,
        enabled: true,
        ...over,
      }),
    );
  const jetons = async (id: string) =>
    (await labEconomy.balances(db, CH, id)).tokens;
  const bonbons = async (id: string) =>
    Number(
      (
        await db.query<{ balance: string }>(
          `select balance from event_wallets where season = 'halloween-2026' and channel_id = $1 and viewer_id = $2`,
          [CH, id],
        )
      )[0]?.balance ?? 0,
    );
  const buy = (offer_id: string, key: string, who = ANA) =>
    shop.purchase(CH, { ...who, offer_id, idempotency_key: key });
  const owns = async (id: string, reward = 'roi-citrouille') =>
    (await shop.viewerShop(CH, id)).owned.includes(reward);

  describe('the editor', () => {
    it('a draft is invisible and its id can change; once published the id is fixed; a duplicate is a new draft', async () => {
      await item({ reward_id: 'brouillon', status: 'draft' });
      await offer({ offer_id: 'b-jetons', reward_id: 'brouillon' });
      expect((await shop.catalog(CH)).items).toEqual([]);
      // Nor in the public progression catalogue (raptoru.fr); Studio's full list shows it as a draft.
      expect(await progression.catalog(CH)).toEqual([]);
      expect(await progression.catalog(CH, true)).toMatchObject([
        { reward_id: 'brouillon', status: 'draft' },
      ]);
      await shop.renameDraft(CH, 'brouillon', 'roi-citrouille'); // its offer follows
      expect((await shop.items(CH))[0]).toMatchObject({
        reward_id: 'roi-citrouille',
        status: 'draft',
        offers: [{ offer_id: 'b-jetons' }],
      });
      await item(); // published
      await expect(
        shop.renameDraft(CH, 'roi-citrouille', 'autre'),
      ).rejects.toMatchObject({ code: 'id_locked' });
      const copy = await shop.duplicate(
        CH,
        'roi-citrouille',
        'roi-citrouille-or',
        'Roi Citrouille d’or',
      );
      expect(copy).toMatchObject({
        status: 'draft',
        label: 'Roi Citrouille d’or',
        style: { effect: 'shine' },
      });
      await expect(item({ kind: 'badge' })).rejects.toMatchObject({
        code: 'kind_locked',
      });
      // A look is data: no CSS, no script.
      expect(() =>
        CosmeticItemInput.parse({
          reward_id: 'x1',
          kind: 'title',
          label: 'X',
          style: { color: 'red;background:url(x)' },
        }),
      ).toThrow();
      expect(() =>
        CosmeticItemInput.parse({
          reward_id: 'x1',
          kind: 'title',
          label: 'X',
          style: { effect: 'javascript' },
        }),
      ).toThrow();
    });

    it('badge images: a small PNG kept once by content; SVG, too big, animated, oversized refused', async () => {
      const ok = await shop.uploadImage(png(32, 32).toString('base64'));
      expect(ok).toMatchObject({ mime: 'image/png', width: 32, height: 32 });
      expect(
        (await shop.uploadImage(png(32, 32).toString('base64'))).image_id,
      ).toBe(ok.image_id);
      expect((await shop.image(ok.image_id))?.mime).toBe('image/png');
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      for (const [bytes, code] of [
        [svg, 'image_type'],
        [png(200, 32), 'image_dimensions'],
        [png(32, 32, 'acTL'), 'image_animated'],
        [
          Buffer.concat([png(32, 32), Buffer.alloc(41 * 1024)]),
          'image_too_large',
        ],
      ] as const)
        await expect(
          shop.uploadImage(bytes.toString('base64')),
        ).rejects.toMatchObject({ code });
      const vp8x = Buffer.alloc(30);
      vp8x.write('RIFF', 0, 'latin1');
      vp8x.write('WEBP', 8, 'latin1');
      vp8x.write('VP8X', 12, 'latin1');
      vp8x[20] = 0x02; // the animation flag
      await expect(
        shop.uploadImage(vp8x.toString('base64')),
      ).rejects.toMatchObject({ code: 'image_animated' });
      await shop.upsertItem(
        CH,
        CosmeticItemInput.parse({
          reward_id: 'citrouille',
          kind: 'badge',
          label: 'Citrouille',
          image_id: ok.image_id,
          status: 'published',
        }),
      );
      await expect(
        shop.upsertItem(
          CH,
          CosmeticItemInput.parse({
            reward_id: 'fantome',
            kind: 'badge',
            label: 'Fantôme',
            image_id: 'f'.repeat(64),
          }),
        ),
      ).rejects.toMatchObject({ code: 'unknown_image' });
    });
  });

  describe('the catalogue: publication, sale, dates and event are separate', () => {
    it('only a published item with an offer on sale now; an empty shop is a normal answer', async () => {
      expect(await shop.catalog(CH)).toMatchObject({ items: [] });
      await item();
      await offer({ enabled: false });
      expect((await shop.catalog(CH)).items).toEqual([]);
      await offer();
      expect((await shop.catalog(CH)).items).toMatchObject([
        {
          id: 'roi-citrouille',
          style: { effect: 'shine' },
          offers: [{ offer_id: 'roi-jetons', currency: 'main', price: 300 }],
        },
      ]);
      await offer({ opens_at: '2026-11-05T00:00:00+01:00' }); // tomorrow, Paris
      expect((await shop.catalog(CH)).items).toEqual([]);
      await offer({ opens_at: null, closes_at: '2026-11-04T19:00:00Z' }); // closed this very instant
      expect((await shop.catalog(CH)).items).toEqual([]);
      await offer({ closes_at: null, event_key: 'halloween-2026' });
      expect((await shop.catalog(CH)).items.length).toBe(1);
      await db.query(
        'update event_shop_settings set enabled = false where channel_id = $1',
        [CH],
      );
      expect((await shop.catalog(CH)).items).toEqual([]);
      await item({ status: 'hidden' });
      await offer({ event_key: null });
      expect((await shop.catalog(CH)).items).toEqual([]); // hidden: not in the shop
    });
  });

  describe('purchases', () => {
    it('Jetons: debited at the Core price, owned, journaled; the same click again is the same purchase; a second click is refused', async () => {
      await item();
      await offer();
      await offer({ price: 250 }); // changed after the page was loaded: the Core's price counts
      const a = await buy('roi-jetons', 'click-0001');
      expect(a).toMatchObject({
        replayed: false,
        purchase: { price: 250, currency: 'main', status: 'completed' },
      });
      expect(await jetons('1')).toBe(750);
      expect(await owns('1')).toBe(true);
      expect(await buy('roi-jetons', 'click-0001')).toMatchObject({
        replayed: true,
        purchase: { purchase_id: a.purchase.purchase_id },
      });
      await expect(buy('roi-jetons', 'click-0002')).rejects.toMatchObject({
        code: 'already_owned',
      });
      expect(await jetons('1')).toBe(750);
      await expect(
        buy('roi-jetons', 'click-0001'.replace('1', '9')),
      ).rejects.toMatchObject({ code: 'already_owned' });
      expect((await shop.purchases(CH)).length).toBe(1);
    });

    it('not enough: refused with the balance and the price, nothing written; unknown offer, closed offer refused', async () => {
      await item();
      await offer({ price: 5000 });
      await expect(buy('roi-jetons', 'click-0003')).rejects.toMatchObject({
        code: 'insufficient_funds',
        details: { currency: 'main', balance: 1000, needed: 5000 },
      });
      expect([
        await jetons('1'),
        await owns('1'),
        (await shop.purchases(CH)).length,
      ]).toEqual([1000, false, 0]);
      await expect(buy('nope', 'click-0004')).rejects.toMatchObject({
        code: 'unknown_offer',
      });
      await offer({ price: 10, closes_at: '2026-11-01T00:00:00Z' });
      await expect(buy('roi-jetons', 'click-0005')).rejects.toMatchObject({
        code: 'offer_closed',
      });
    });

    it('two purchases at once (two clicks, two keys): one item, one debit', async () => {
      await item();
      await offer();
      const out = await Promise.allSettled([
        buy('roi-jetons', 'click-a001'),
        buy('roi-jetons', 'click-b001'),
      ]);
      expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await jetons('1')).toBe(700);
    });

    it('Bonbons: from the event ledger, refused when the linked event is closed; a crash in the middle keeps nothing', async () => {
      await item();
      await shop.award(CH, {
        module: 'studio',
        key: 'grant-ana-1',
        viewer: '1',
        viewer_name: 'Ana',
        item: { kind: 'bonbons', amount: 20 },
        reference: null,
      });
      await offer({
        offer_id: 'roi-bonbons',
        currency: 'bonbons',
        price: 12,
        event_key: 'halloween-2026',
      });
      await buy('roi-bonbons', 'click-0006');
      expect([await bonbons('1'), await owns('1')]).toEqual([8, true]);
      // Bob, the event closed: refused.
      await shop.award(CH, {
        module: 'studio',
        key: 'grant-bob-1',
        viewer: '2',
        viewer_name: 'Bob',
        item: { kind: 'bonbons', amount: 20 },
        reference: null,
      });
      await db.query(
        'update event_shop_settings set enabled = false where channel_id = $1',
        [CH],
      );
      await expect(
        buy('roi-bonbons', 'click-0007', { viewer: '2', viewer_name: 'Bob' }),
      ).rejects.toMatchObject({ code: 'event_closed' });
      // The event open again; the server « stops » after the debit (the purchase row cannot be written): nothing kept.
      await db.query(
        'update event_shop_settings set enabled = true where channel_id = $1',
        [CH],
      );
      await db.query(
        'alter table cosmetic_purchases rename to cosmetic_purchases_off',
      );
      await expect(
        buy('roi-bonbons', 'click-0008', { viewer: '2', viewer_name: 'Bob' }),
      ).rejects.toThrow();
      await db.query(
        'alter table cosmetic_purchases_off rename to cosmetic_purchases',
      );
      expect([await bonbons('2'), await owns('2')]).toEqual([20, false]);
    });
  });

  describe('after a purchase', () => {
    it('refund: the price back, the item taken back and unequipped, once; bought again afterwards', async () => {
      await item();
      await offer();
      const p = (await buy('roi-jetons', 'click-0009')).purchase;
      await progression.equip(CH, {
        viewer: '1',
        title_id: 'roi-citrouille',
        badge_ids: [],
      });
      expect(
        await shop.refund(CH, p.purchase_id, 'test remboursement', 'Studio'),
      ).toMatchObject({
        refunded: true,
        purchase: { status: 'refunded', refunded_by: 'Studio' },
      });
      expect([await jetons('1'), await owns('1')]).toEqual([1000, false]);
      expect((await progression.viewer(CH, '1')).equipped.title).toBeNull();
      expect(
        await shop.refund(CH, p.purchase_id, 'encore', 'Studio'),
      ).toMatchObject({ refunded: false });
      expect(await jetons('1')).toBe(1000);
      await buy('roi-jetons', 'click-0010');
      expect(await owns('1')).toBe(true);
    });

    it('a withdrawn offer, an archived item: still owned, still equippable, never in the shop', async () => {
      await item();
      await offer();
      await buy('roi-jetons', 'click-0011');
      await offer({ enabled: false });
      await item({ status: 'archived' });
      expect((await shop.catalog(CH)).items).toEqual([]);
      expect(await owns('1')).toBe(true);
      await progression.equip(CH, {
        viewer: '1',
        title_id: 'roi-citrouille',
        badge_ids: [],
      });
      const v = await progression.viewer(CH, '1');
      expect(v.equipped.title).toBe('roi-citrouille');
      expect(v.inventory[0]).toMatchObject({
        id: 'roi-citrouille',
        status: 'archived',
        style: { effect: 'shine' },
      });
    });

    it('module awards: an item, Bonbons, Jetons — once per key; a draft is never awarded', async () => {
      await item();
      await item({ reward_id: 'secret', label: 'Secret', status: 'draft' });
      const award = (key: string, it: Record<string, unknown>) =>
        shop.award(CH, {
          module: 'quiz',
          key,
          viewer: '2',
          viewer_name: 'Bob',
          item: it as never,
          reference: 'manche 3',
        });
      expect(
        await award('round-3', { kind: 'reward', reward_id: 'roi-citrouille' }),
      ).toEqual({ awarded: true, replayed: false });
      expect(
        await award('round-3', { kind: 'reward', reward_id: 'roi-citrouille' }),
      ).toEqual({ awarded: false, replayed: true });
      expect(await owns('2')).toBe(true);
      await award('round-4', { kind: 'bonbons', amount: 5 });
      await award('round-5', { kind: 'jetons', amount: 40 });
      expect([await bonbons('2'), await jetons('2')]).toEqual([5, 1040]);
      await expect(
        award('round-6', { kind: 'reward', reward_id: 'secret' }),
      ).rejects.toMatchObject({ code: 'item_unavailable' });
      expect((await progression.viewer(CH, '2')).inventory[0]).toMatchObject({
        source: 'reward',
        reference: 'quiz:round-3',
      });
    });
  });
}
