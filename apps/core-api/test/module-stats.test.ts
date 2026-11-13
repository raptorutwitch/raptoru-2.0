import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/server.js';
import { setup } from './helpers.js';

// Statistiques des modules (raptoru.fr lot 4, docs/MODULE_STATS.md): per-viewer aggregates read from what each module
// already writes (the Wallet's interaction debits, rb_requests, mini-games, Roue du Sub, event shop), exactly the site
// token, nothing counted twice, nothing from another viewer, refunded and test rows excluded.

const CH = '83603689';
const SITE = 'site-token-0123456789abcdef0123456789abcdef';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fixture(siteToken?: string) {
  const core = await setup();
  core.clock.set(new Date());
  const server = createApp({
    ...core,
    labRoutes: false,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
    siteToken,
    cockpit: {
      core: () => Promise.reject(new Error('unused')),
      channelId: CH,
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string, auth?: string) => {
    const res = await fetch(base + path, {
      headers: auth ? { authorization: auth } : {},
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
    return { status: res.status, body: (await res.json()) as any };
  };
  return { core, get };
}

describe('module statistics (owner view, site token)', () => {
  it('counts each module from its own records; refunds, tests, other viewers and other outcomes excluded', async () => {
    const { core, get } = await fixture(SITE);
    const w = core.wallet.wallet;
    const viewer = (id: string) => ({
      twitchUserId: id,
      login: `v${id}`,
      displayName: `V${id}`,
    });
    for (const id of ['1', '2'])
      await w.credit({
        key: `fund-${id}`,
        viewer: viewer(id),
        amount: 1000,
        source: 'test',
      });
    const debit = (id: string, key: string, source: string) =>
      w.spend({ key, viewer: viewer(id), amount: 10, source, reference: key });
    await debit('1', 'interaction:a:debit', 'bonk');
    await debit('1', 'interaction:b:debit', 'bonk');
    await debit('1', 'interaction:c:debit', 'tts');
    await debit('1', 'shop-0001', 'cosmetic_shop'); // not an interaction
    await debit('2', 'interaction:d:debit', 'bonk'); // another viewer
    await w.credit({
      key: 'interaction:b:refund',
      viewer: viewer('1'),
      amount: 10,
      kind: 'refund',
      source: 'interaction_refund',
    });

    const t = new Date('2026-10-25T20:00:00Z');
    const rb = (
      buyer: string,
      status: string,
      target: string | null,
      mode = 'real',
    ) =>
      core.db.query(
        `insert into rb_requests (request_id, channel_id, source, source_ref, mode, buyer_id, buyer_login, buyer_name,
           status, target_id, target_login, target_name, created_at, updated_at)
         values ($1::uuid, $2, 'chat', $1::text, $3, $4, $4, $4, $5, $6, $6, $6, $7, $7)`,
        [randomUUID(), CH, mode, buyer, status, target, t],
      );
    await rb('1', 'confirmed', '2'); // landed
    await rb('1', 'confirmed', '1'); // turned against the buyer
    await rb('1', 'flop', null);
    await rb('1', 'failed', null); // sent, no outcome
    await rb('2', 'confirmed', '1'); // received
    await rb('1', 'simulated', '2', 'animation'); // a Studio test: never counted

    const play = (id: string, game: string, won: boolean) =>
      core.db.query(
        `insert into mini_game_plays (channel_id, message_id, game, viewer_id, viewer_display_name, bet, symbols, won,
           delta, balance_after, ledger_id, created_at)
         values ($1, $2, $3, $4, $4, 10, $5, $6, 0, 100, 1, $7)`,
        [
          CH,
          randomUUID(),
          game,
          id,
          game === 'slot' ? ['a', 'b', 'c'] : null,
          won,
          t,
        ],
      );
    await play('1', 'roulette', true);
    await play('1', 'roulette', false);
    await play('1', 'slot', false);
    await play('2', 'slot', true);

    const duel = (
      a: string,
      b: string,
      status: string,
      winner: string | null,
    ) =>
      core.db.query(
        `insert into mini_game_duels (duel_id, channel_id, challenge_message_id, challenger_id, challenger_name, target_id,
           target_login, target_name, bet, challenger_wins, status, created_at, expires_at, ended_at, winner_id, loser_id)
         values ($1::uuid, $2, $1::text, $3, $3, $4, $4, $4, 10, $5, $6, $7, $7, $8, $9, $10)`,
        [
          randomUUID(),
          CH,
          a,
          b,
          winner === a,
          status,
          t,
          status === 'pending' ? null : t,
          winner,
          winner ? (winner === a ? b : a) : null,
        ],
      );
    await duel('1', '2', 'resolved', '1');
    await duel('2', '1', 'resolved', '2');
    await duel('1', '2', 'refused', null);

    const spin = (id: string, status: string, source = 'twitch') =>
      core.db.query(
        `insert into sw_spins (spin_id, channel_id, source, event_key, type, viewer_id, viewer_name, tier, months, status,
           created_at, updated_at)
         values ($1::uuid, $2, $3, $1::text, 'sub', $4, $4, 1, 1, $5, $6, $6)`,
        [randomUUID(), CH, source, id, status, t],
      );
    await spin('1', 'shown');
    await spin('1', 'failed');
    await spin('1', 'shown', 'simulation');

    const scream = (status: string, refund = 'none') =>
      core.db.query(
        `insert into event_shop_purchases (purchase_id, season, channel_id, viewer_id, viewer_name, item_id, item_kind,
           label, price, idempotency_key, request_hash, status, refund_status, created_at)
         values ($1::uuid, 'halloween-2026', $2, '1', 'V1', 'screamer', 'screamer', 'Screamer', 5, $1::text, 'h', $3, $4, $5)`,
        [randomUUID(), CH, status, refund, t],
      );
    await scream('completed');
    await scream('completed', 'refunded');
    await scream('failed');

    // Exactly the site token.
    expect((await get('/v1/site/modules/viewers/1')).status).toBe(401);
    expect(
      (await get('/v1/site/modules/viewers/1', 'Bearer studio-test-secret'))
        .status,
    ).toBe(401);
    const r = await get('/v1/site/modules/viewers/1', `Bearer ${SITE}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      viewer: '1',
      interactions: { bonk: 1, tts: 1 },
      random_ban: { sent: 4, landed: 1, backfired: 1, flops: 1, received: 1 },
      roulette: { plays: 2, wins: 1 },
      slot: { plays: 1, wins: 0 },
      duels: { played: 2, won: 1 },
      sub_wheel: { spins: 1 },
      screamers: { 'halloween-2026': 1 },
    });
    expect(Object.keys(r.body.interactions)).toEqual(['bonk', 'tts']);
    expect(r.body.since.random_ban).toBe(t.toISOString());
    expect(r.body.since.interactions).not.toBeNull();
    // A viewer with nothing: zeros, never an error.
    const empty = (await get('/v1/site/modules/viewers/3', `Bearer ${SITE}`))
      .body;
    expect(empty).toMatchObject({
      interactions: {},
      random_ban: { sent: 0, received: 0 },
      duels: { played: 0 },
      screamers: {},
    });
  });

  it('without SITE_TOKEN the route does not exist', async () => {
    const { get } = await fixture(undefined);
    expect(
      (await get('/v1/site/modules/viewers/1', `Bearer ${SITE}`)).status,
    ).toBe(404);
  });
});

describe('Random Ban public totals (raptoru.fr, Mini-jeux)', () => {
  it('site token only; channel totals (Sniper, CSC, Jetons), never a viewer; tests and refunded requests excluded', async () => {
    const { core, get } = await fixture(SITE);
    const now = new Date();
    const row = async (
      buyer: string,
      status: string,
      o: {
        target?: string;
        price?: number;
        sniper?: string;
        wish?: string;
        bonus?: number;
        source?: string;
      } = {},
    ) =>
      core.db.query(
        `insert into rb_requests (request_id, channel_id, source, source_ref, mode, buyer_id, buyer_login, buyer_name,
           status, target_id, price_paid, sniper, wish_id, stats, created_at, updated_at)
         values ($1, $2, $3, $12, 'real', $4, $4, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          randomUUID(),
          CH,
          o.source ?? 'extension',
          buyer,
          status,
          o.target ?? null,
          o.price ?? null,
          o.sniper ?? 'none',
          o.wish ?? null,
          o.bonus ? JSON.stringify({ sniper_bonus: o.bonus }) : null,
          now,
          randomUUID(),
        ],
      );
    await row('1', 'confirmed', {
      target: '2',
      price: 25_000,
      sniper: 'hit',
      wish: '2',
      bonus: 2_000,
    });
    await row('1', 'confirmed', { target: '1', price: 30_000 }); // CSC
    await row('3', 'flop', { price: 25_000, sniper: 'miss', wish: '2' });
    await row('3', 'failed', { price: 25_000 }); // refunded: never counted
    await row('4', 'confirmed', { target: '2', source: 'test' }); // a Studio test
    expect((await get('/v1/site/modules/random-ban/public')).status).toBe(401);
    const out = await get(
      '/v1/site/modules/random-ban/public',
      `Bearer ${SITE}`,
    );
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      launched: 3,
      executed: 2,
      distinct_banned: 2,
      self: 1,
      flops: 1,
      sniper_tries: 2,
      sniper_hits: 1,
      tokens_spent: 80_000,
      tokens_won: 2_000,
    });
    expect(JSON.stringify(out.body)).not.toMatch(/buyer|viewer|wish/);
  });
});
