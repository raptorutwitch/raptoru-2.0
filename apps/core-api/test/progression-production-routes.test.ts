import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/server.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
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
    });
    // Revoked: unequipped at once; the ranking no longer shows the title.
    await call(
      '/v1/studio/progression/revoke',
      { reward_id: 'roi-halloween', viewer: '1', reason: 'test' },
      studio,
    );
    v = (await call('/v1/progression/viewers/1')).body;
    expect(v.equipped).toEqual({ title: null, badges: ['citrouille'] });
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
