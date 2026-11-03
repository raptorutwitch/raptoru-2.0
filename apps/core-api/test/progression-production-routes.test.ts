import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/server.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { png } from './cosmetic-shop.suite.js';
import { setup } from './helpers.js';

// Progression native on the MAIN Core's HTTP (docs/PROGRESSION.md): the public reads need nothing; Studio's routes the
// paired installation's credential; the site's equip route exactly the site token (SITE_TOKEN) and is absent without
// it. The whole chain: Studio grants → the site equips for its viewer → the public reads show it.

const CHANNEL = '83603689';
const SITE = 'site-token-0123456789abcdef0123456789abcdef';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fixture(siteToken?: string) {
  const core = await setup();
  core.clock.set(new Date());
  await core.db.query(
    `insert into viewers (twitch_user_id, login, display_name) values ('1', 'ana', 'Ana'), ('2', 'bob', 'Bob')
     on conflict do nothing`,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
    return { status: res.status, body: (await res.json()) as any };
  };
  return { call, studio };
}

describe('progression on the main Core HTTP', () => {
  it('Studio grants, the site equips for ITS viewer, the public reads show it; every door checked', async () => {
    const { call, studio } = await fixture(SITE);
    // Public reads: no credential.
    expect((await call('/v1/progression/leaderboard')).status).toBe(200);
    expect((await call('/v1/progression/catalog')).status).toBe(200);
    // Studio's routes: the installation only.
    expect((await call('/v1/studio/progression/settings')).status).toBe(401);
    expect(
      (
        await call(
          '/v1/studio/progression/settings',
          undefined,
          `Bearer ${SITE}`,
        )
      ).status,
    ).toBe(401);
    expect(
      (await call('/v1/studio/progression/settings', { enabled: true }, studio))
        .status,
    ).toBe(200);
    for (const r of [
      {
        reward_id: 'roi-halloween',
        kind: 'title',
        label: 'Roi d’Halloween',
        rarity: 'event',
      },
      {
        reward_id: 'citrouille',
        kind: 'badge',
        label: 'Citrouille',
        rarity: 'event',
      },
    ])
      expect(
        (await call('/v1/studio/progression/rewards', r, studio)).status,
      ).toBe(200);
    const g = await call(
      '/v1/studio/progression/grant',
      {
        reward_id: 'roi-halloween',
        viewers: ['1'],
        source: 'event',
        reference: 'halloween-2026',
      },
      studio,
    );
    expect(g.body.granted).toEqual(['1']);
    await call(
      '/v1/studio/progression/grant',
      { reward_id: 'citrouille', viewers: ['1'], source: 'manual' },
      studio,
    );
    // The site's equip route: exactly the site token.
    const equip = {
      viewer: '1',
      title_id: 'roi-halloween',
      badge_ids: ['citrouille'],
    };
    expect((await call('/v1/site/progression/equip', equip)).status).toBe(401);
    expect(
      (
        await call(
          '/v1/site/progression/equip',
          equip,
          'Bearer wrong-token-0123456789abcdef0123456789',
        )
      ).status,
    ).toBe(401);
    expect(
      (await call('/v1/site/progression/equip', equip, studio)).status,
    ).toBe(401);
    expect(
      (
        await call(
          '/v1/site/progression/equip',
          equip,
          'Bearer bot-test-secret',
        )
      ).status,
    ).toBe(401);
    expect(
      (await call('/v1/site/progression/equip', equip, `Bearer ${SITE}`))
        .status,
    ).toBe(200);
    // Sign-in on the site: the site token only.
    const who = { viewer: '3', login: 'cleo', display_name: 'Cleo' };
    expect(
      (await call('/v1/site/progression/identify', who, studio)).status,
    ).toBe(401);
    expect(
      (await call('/v1/site/progression/identify', who, `Bearer ${SITE}`)).body,
    ).toEqual({ attached: 0 });
    // Studio's adjustment: the installation only, journaled.
    expect(
      (
        await call(
          '/v1/studio/progression/adjust',
          {
            viewer: '2',
            mode: 'add',
            value: 50,
            reason: 'test http',
            request_id: 'req-0001-abcd',
          },
          `Bearer ${SITE}`,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          '/v1/studio/progression/adjust',
          {
            viewer: '2',
            mode: 'add',
            value: 50,
            reason: 'test http',
            request_id: 'req-0001-abcd',
          },
          studio,
        )
      ).body,
    ).toMatchObject({ changed: true, xp: 50 });
    // Bob owns nothing: refused, whatever the site asks.
    const bob = await call(
      '/v1/site/progression/equip',
      { ...equip, viewer: '2' },
      `Bearer ${SITE}`,
    );
    expect([bob.status, bob.body.error]).toEqual([403, 'title_not_owned']);
    let v = (await call('/v1/progression/viewers/1')).body;
    expect(v.equipped).toEqual({
      title: 'roi-halloween',
      badges: ['citrouille'],
      frame: null,
      banner: null,
    });
    // Revoked: unequipped at once; the ranking no longer shows the title.
    await call(
      '/v1/studio/progression/revoke',
      { reward_id: 'roi-halloween', viewer: '1', reason: 'test' },
      studio,
    );
    v = (await call('/v1/progression/viewers/1')).body;
    expect(v.equipped).toEqual({
      title: null,
      badges: ['citrouille'],
      frame: null,
      banner: null,
    });
    expect(v.inventory.map((i: { id: string }) => i.id)).toEqual([
      'citrouille',
    ]);
  });

  it('the ranking carries the equipped title (owned and active only)', async () => {
    const { call, studio } = await fixture(SITE);
    await call('/v1/studio/progression/settings', { enabled: true }, studio);
    await call(
      '/v1/studio/progression/rewards',
      { reward_id: 'veteran', kind: 'title', label: 'Vétéran', rarity: 'rare' },
      studio,
    );
    await call(
      '/v1/studio/progression/import',
      {
        source: 'wizebot',
        rows: [{ twitch_user_id: '1', login: 'ana', level: 5 }],
      },
      studio,
    );
    await call(
      '/v1/studio/progression/grant',
      { reward_id: 'veteran', viewers: ['1'] },
      studio,
    );
    await call(
      '/v1/site/progression/equip',
      { viewer: '1', title_id: 'veteran', badge_ids: [] },
      `Bearer ${SITE}`,
    );
    const board = (await call('/v1/progression/leaderboard')).body;
    expect(board.entries[0]).toMatchObject({
      twitchUserId: '1',
      level: 5,
      title: { id: 'veteran', label: 'Vétéran' },
    });
  });

  it('the ranking carries the equipped badges in one grouped read (owned, active, published only; chosen order)', async () => {
    const { call, studio } = await fixture(SITE);
    await call('/v1/studio/progression/settings', { enabled: true }, studio);
    for (const r of [
      { reward_id: 'etoile', kind: 'badge', label: 'Étoile', rarity: 'rare' },
      { reward_id: 'lune', kind: 'badge', label: 'Lune', rarity: 'epic' },
      { reward_id: 'soleil', kind: 'badge', label: 'Soleil', rarity: 'common' },
    ])
      expect(
        (await call('/v1/studio/progression/rewards', r, studio)).status,
      ).toBe(200);
    await call(
      '/v1/studio/progression/import',
      {
        source: 'wizebot',
        rows: [
          { twitch_user_id: '1', login: 'ana', level: 5 },
          { twitch_user_id: '2', login: 'bob', level: 3 },
        ],
      },
      studio,
    );
    for (const id of ['etoile', 'lune', 'soleil'])
      await call(
        '/v1/studio/progression/grant',
        { reward_id: id, viewers: ['1'] },
        studio,
      );
    expect(
      (
        await call(
          '/v1/site/progression/equip',
          {
            viewer: '1',
            title_id: null,
            badge_ids: ['lune', 'etoile', 'soleil'],
          },
          `Bearer ${SITE}`,
        )
      ).status,
    ).toBe(200);
    let board = (await call('/v1/progression/leaderboard')).body;
    expect(board.entries[0].badges.map((b: { id: string }) => b.id)).toEqual([
      'lune',
      'etoile',
      'soleil',
    ]);
    expect(board.entries[0].badges[0]).toEqual({
      id: 'lune',
      label: 'Lune',
      rarity: 'epic',
      image: null,
    });
    expect(board.entries[1]).toMatchObject({
      twitchUserId: '2',
      badges: [],
      title: null,
    });
    // Revoked: gone from the ranking at once; the others keep the viewer's order.
    await call(
      '/v1/studio/progression/revoke',
      { reward_id: 'etoile', viewer: '1', reason: 'test' },
      studio,
    );
    board = (await call('/v1/progression/leaderboard')).body;
    expect(board.entries[0].badges.map((b: { id: string }) => b.id)).toEqual([
      'lune',
      'soleil',
    ]);
  });

  it('frames and banners (lot 3): a banner upload passes the larger body; equipped, ranked, kept by an older site, revoked', async () => {
    const { call, studio } = await fixture(SITE);
    await call('/v1/studio/progression/settings', { enabled: true }, studio);
    // A real-size banner body (> 64 Ko of JSON) reaches its route; any other route keeps the 64 Ko limit.
    const big = Buffer.concat([png(1024, 256), Buffer.alloc(120 * 1024)]);
    const banner = await call(
      '/v1/studio/cosmetics/images',
      { purpose: 'banner', data_base64: big.toString('base64') },
      studio,
    );
    expect([banner.status, banner.body.width]).toEqual([200, 1024]);
    const frame = await call(
      '/v1/studio/cosmetics/images',
      { purpose: 'frame', data_base64: png(256, 256).toString('base64') },
      studio,
    );
    expect(
      (
        await call(
          '/v1/studio/progression/adjust',
          {
            viewer: '2',
            mode: 'add',
            value: 1,
            reason: 'x'.repeat(70 * 1024),
            request_id: 'req-big-0001',
          },
          studio,
        )
      ).status,
    ).toBe(413);
    for (const r of [
      {
        reward_id: 'givre',
        kind: 'frame',
        label: 'Givre',
        rarity: 'epic',
        image_id: frame.body.image_id,
      },
      {
        reward_id: 'aurore',
        kind: 'banner',
        label: 'Aurore',
        image_id: banner.body.image_id,
      },
    ])
      expect(
        (
          await call(
            '/v1/studio/cosmetics/items',
            { ...r, status: 'published' },
            studio,
          )
        ).status,
      ).toBe(200);
    await call(
      '/v1/studio/progression/import',
      {
        source: 'wizebot',
        rows: [
          { twitch_user_id: '1', login: 'ana', level: 5 },
          { twitch_user_id: '2', login: 'bob', level: 3 },
        ],
      },
      studio,
    );
    for (const id of ['givre', 'aurore'])
      await call(
        '/v1/studio/progression/grant',
        { reward_id: id, viewers: ['1'] },
        studio,
      );
    const site = (b: unknown) =>
      call('/v1/site/progression/equip', b, `Bearer ${SITE}`);
    // Not owned, or the wrong kind in a slot: refused.
    expect(
      (
        await site({
          viewer: '2',
          title_id: null,
          badge_ids: [],
          frame_id: 'givre',
        })
      ).body.error,
    ).toBe('frame_not_owned');
    expect(
      (
        await site({
          viewer: '1',
          title_id: null,
          badge_ids: [],
          frame_id: 'aurore',
        })
      ).body.error,
    ).toBe('frame_not_owned');
    expect(
      (
        await site({
          viewer: '1',
          title_id: null,
          badge_ids: [],
          banner_id: 'givre',
        })
      ).body.error,
    ).toBe('banner_not_owned');
    expect(
      (
        await site({
          viewer: '1',
          title_id: null,
          badge_ids: [],
          frame_id: 'givre',
          banner_id: 'aurore',
        })
      ).body,
    ).toMatchObject({ frame_id: 'givre', banner_id: 'aurore' });
    // An older site (no frame_id / banner_id) never clears them.
    expect(
      (await site({ viewer: '1', title_id: null, badge_ids: [] })).body,
    ).toMatchObject({ frame_id: 'givre', banner_id: 'aurore' });
    let board = (await call('/v1/progression/leaderboard')).body;
    expect(board.entries[0]).toMatchObject({
      twitchUserId: '1',
      frame: {
        id: 'givre',
        label: 'Givre',
        rarity: 'epic',
        image: `/v1/cosmetics/images/${frame.body.image_id}`,
      },
      banner: {
        id: 'aurore',
        image: `/v1/cosmetics/images/${banner.body.image_id}`,
      },
    });
    expect(board.entries[1]).toMatchObject({
      twitchUserId: '2',
      frame: null,
      banner: null,
    });
    expect(
      (await call('/v1/progression/viewers/1')).body.equipped,
    ).toMatchObject({ frame: 'givre', banner: 'aurore' });
    // null removes; a revocation unequips at once.
    await site({ viewer: '1', title_id: null, badge_ids: [], banner_id: null });
    await call(
      '/v1/studio/progression/revoke',
      { reward_id: 'givre', viewer: '1', reason: 'test' },
      studio,
    );
    board = (await call('/v1/progression/leaderboard')).body;
    expect(board.entries[0]).toMatchObject({ frame: null, banner: null });
    expect(
      (await call('/v1/progression/viewers/1')).body.equipped,
    ).toMatchObject({ frame: null, banner: null });
  });

  it('without SITE_TOKEN the equip route does not exist', async () => {
    const { call } = await fixture(undefined);
    expect(
      (
        await call(
          '/v1/site/progression/equip',
          { viewer: '1', title_id: null, badge_ids: [] },
          `Bearer ${SITE}`,
        )
      ).status,
    ).toBe(404);
  });
});
