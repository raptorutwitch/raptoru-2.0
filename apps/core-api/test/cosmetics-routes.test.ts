import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/server.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { png } from './cosmetic-shop.suite.js';
import { setup } from './helpers.js';

// Boutique cosmétique V1 on the MAIN Core's HTTP (docs/COSMETIC_SHOP.md): the public catalogue, image and stylesheet;
// Studio's editor for the paired installation only; the site's purchase for the site token only (and absent without
// it); the price is the Core's whatever the body says; a badge image comes back with its type, nosniff and no script.

const CHANNEL = '83603689';
const SITE = 'site-token-0123456789abcdef0123456789abcdef';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fixture(siteToken?: string) {
  const core = await setup();
  core.clock.set(new Date('2026-11-04T19:00:00Z'));
  await core.db.query(
    `insert into viewers (twitch_user_id, login, display_name) values ('1', 'ana', 'Ana') on conflict do nothing`,
  );
  await core.db.query(
    `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
     values ($1, '1', 1000, 0, 0, now())`,
    [CHANNEL],
  );
  const server = createApp({
    ...core,
    labRoutes: false,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
    siteToken,
    cockpit: {
      core: () => Promise.reject(new Error('unused')),
      channelId: CHANNEL,
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  await core.studioInstallations.register(`${id}.${sha256(secret)}`, 'PC test');
  const studio = `Bearer rsi_${id}.${secret}`;
  const call = async (path: string, body?: unknown, auth?: string) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(auth ? { authorization: auth } : {}),
        [STUDIO_PROTOCOL_HEADER]: '1',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return {
      status: res.status,
      headers: res.headers,
      text,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read answers
      body: json as any,
    };
  };
  return { call, studio, core };
}

describe('the cosmetic shop on the main Core HTTP', () => {
  it('Studio creates, uploads, publishes and prices; the site buys for ITS viewer at the Core price; every door checked', async () => {
    const { call, studio } = await fixture(SITE);
    // Public: an empty shop is a normal answer; the stylesheet.
    expect((await call('/v1/cosmetics/catalog')).body.items).toEqual([]);
    const css = await call('/v1/cosmetics/style.css');
    expect([
      css.status,
      css.headers.get('content-type'),
      css.text.includes('.rc-fx-shine'),
    ]).toEqual([200, 'text/css; charset=utf-8', true]);
    // Studio's editor: the installation only.
    const badge = {
      reward_id: 'citrouille',
      kind: 'badge',
      label: 'Citrouille',
      status: 'published',
      style: { color: '#ff8a00', effect: 'glow' },
    };
    expect((await call('/v1/studio/cosmetics/items', badge)).status).toBe(401);
    expect(
      (await call('/v1/studio/cosmetics/items', badge, `Bearer ${SITE}`))
        .status,
    ).toBe(401);
    const img = await call(
      '/v1/studio/cosmetics/images',
      { data_base64: png(24, 24).toString('base64') },
      studio,
    );
    expect(img.body).toMatchObject({ mime: 'image/png', width: 24 });
    expect(
      (
        await call(
          '/v1/studio/cosmetics/items',
          { ...badge, image_id: img.body.image_id },
          studio,
        )
      ).status,
    ).toBe(200);
    expect((await call('/v1/cosmetics/catalog')).body.items).toEqual([]); // published, but nothing on sale yet
    expect(
      (
        await call(
          '/v1/studio/cosmetics/offers',
          {
            offer_id: 'citrouille-j',
            reward_id: 'citrouille',
            currency: 'main',
            price: 400,
            enabled: true,
          },
          studio,
        )
      ).status,
    ).toBe(200);
    const cat = (await call('/v1/cosmetics/catalog')).body;
    expect(cat.items).toMatchObject([
      {
        id: 'citrouille',
        image: `/v1/cosmetics/images/${img.body.image_id}`,
        offers: [{ price: 400 }],
      },
    ]);
    const image = await call(cat.items[0].image);
    expect([
      image.status,
      image.headers.get('content-type'),
      image.headers.get('x-content-type-options'),
    ]).toEqual([200, 'image/png', 'nosniff']);
    expect(image.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
    // The site's purchase: exactly the site token; a price in the body is refused (strict), the Core's is paid.
    const buy = {
      viewer: '1',
      viewer_name: 'Ana',
      offer_id: 'citrouille-j',
      idempotency_key: 'click-http-0001',
    };
    expect((await call('/v1/site/cosmetics/purchase', buy)).status).toBe(401);
    expect(
      (await call('/v1/site/cosmetics/purchase', buy, studio)).status,
    ).toBe(401);
    expect(
      (
        await call(
          '/v1/site/cosmetics/purchase',
          { ...buy, price: 1 },
          `Bearer ${SITE}`,
        )
      ).status,
    ).toBe(400);
    const ok = await call('/v1/site/cosmetics/purchase', buy, `Bearer ${SITE}`);
    expect(ok.body.purchase).toMatchObject({ price: 400, currency: 'main' });
    const side = (
      await call('/v1/site/cosmetics/viewers/1', undefined, `Bearer ${SITE}`)
    ).body;
    expect(side).toMatchObject({
      balances: { main: 600 },
      owned: ['citrouille'],
    });
    const again = await call(
      '/v1/site/cosmetics/purchase',
      { ...buy, idempotency_key: 'click-http-0002' },
      `Bearer ${SITE}`,
    );
    expect([again.status, again.body.error]).toEqual([409, 'already_owned']);
    // Studio sees and refunds.
    const list = (
      await call('/v1/studio/cosmetics/purchases', undefined, studio)
    ).body;
    expect(list).toHaveLength(1);
    expect(
      (
        await call(
          `/v1/studio/cosmetics/purchases/${list[0].purchase_id}/refund`,
          { reason: 'test http' },
          studio,
        )
      ).body,
    ).toMatchObject({ refunded: true });
  });

  it('without SITE_TOKEN the site routes do not exist', async () => {
    const { call } = await fixture(undefined);
    expect(
      (
        await call(
          '/v1/site/cosmetics/purchase',
          {
            viewer: '1',
            viewer_name: 'Ana',
            offer_id: 'x',
            idempotency_key: 'click-0001',
          },
          `Bearer ${SITE}`,
        )
      ).status,
    ).toBe(404);
  });
});
