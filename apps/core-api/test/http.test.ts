import type { AddressInfo } from 'node:net';
import {
  DailyClaimResponse,
  DailyLeaderboard,
  DailyStatus,
  DailyStreakResponse,
} from '@raptoru/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/server.js';
import { paris, setup, type TestCore } from './helpers.js';

const BOT = 'bot-secret-0123456789';
const STUDIO = 'studio-secret-0123456789';

let core: TestCore;
let base: string;
let close: () => Promise<void>;

beforeEach(async () => {
  core = await setup();
  const server = createApp({
    daily: core.daily,
    streams: core.streams,
    botSecret: BOT,
    studioSecret: STUDIO,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});
afterEach(() => close());

const post = (path: string, body: unknown, secret: string | null = BOT) =>
  fetch(base + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });

const chatter = { twitchUserId: '1001', login: 'alice', displayName: 'Alice' };

describe('core-api HTTP', () => {
  it('rejects bot routes without the bot secret, and admin routes without the Studio secret', async () => {
    expect(
      (
        await post(
          '/v1/bot/daily/claim',
          { viewer: chatter, requestId: 'm1' },
          null,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          '/v1/bot/daily/claim',
          { viewer: chatter, requestId: 'm1' },
          STUDIO,
        )
      ).status,
    ).toBe(401);
    const admin = (secret: string) =>
      fetch(`${base}/v1/admin/daily/viewers/1001`, {
        headers: { authorization: `Bearer ${secret}` },
      });
    expect((await admin(BOT)).status).toBe(401);
    expect((await admin(STUDIO)).status).toBe(200);
  });

  it('validates payloads with the shared schemas', async () => {
    const res = await post('/v1/bot/daily/claim', {
      viewer: { ...chatter, twitchUserId: 'alice' },
      requestId: 'm1',
    });
    expect(res.status).toBe(400);
    expect(
      (
        await post('/v1/bot/stream/online', {
          streamId: 's1',
          startedAt: 'yesterday',
        })
      ).status,
    ).toBe(400);
  });

  it('runs a Daily end to end: online → claim → streak → public status and leaderboard', async () => {
    core.clock.set(paris('2026-09-24', 20));
    const online = await post('/v1/bot/stream/online', {
      streamId: 's1',
      startedAt: paris('2026-09-24', 20).toISOString(),
    });
    expect(await online.json()).toEqual({
      live: true,
      streamId: 's1',
      streamDay: '2026-09-24',
    });

    core.clock.set(paris('2026-09-24', 21));
    const claim = DailyClaimResponse.parse(
      await (
        await post('/v1/bot/daily/claim', { viewer: chatter, requestId: 'm1' })
      ).json(),
    );
    expect(claim).toMatchObject({ outcome: 'claimed', reward: 500 });

    const streak = DailyStreakResponse.parse(
      await (await post('/v1/bot/daily/streak', { viewer: chatter })).json(),
    );
    expect(streak.status.totalDaily).toBe(1);

    const status = DailyStatus.parse(
      await (await fetch(`${base}/v1/daily/viewers/1001`)).json(),
    );
    expect(status).toMatchObject({
      currentStreak: 1,
      claimedCurrentStreamDay: true,
    });
    const board = DailyLeaderboard.parse(
      await (await fetch(`${base}/v1/daily/leaderboard`)).json(),
    );
    expect(board.total[0]).toMatchObject({ twitchUserId: '1001', value: 1 });

    const offline = await post('/v1/bot/stream/sync', { live: null });
    expect(await offline.json()).toEqual({
      live: false,
      streamId: null,
      streamDay: null,
    });
  });

  it('answers 404 / 405 for unknown routes and methods', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/v1/bot/daily/claim`)).status).toBe(405);
  });
});
