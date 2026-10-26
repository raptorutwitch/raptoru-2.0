import { describe, expect, it, vi } from 'vitest';
import {
  CoreHttpError,
  createCoreClient,
  notLeaseHolder,
} from '../src/core-client.js';

const status = {
  twitchUserId: '1001',
  login: 'alice',
  displayName: 'Alice',
  totalDaily: 1,
  currentStreak: 1,
  bestStreak: 1,
  live: true,
  currentStreamDay: '2026-09-24',
  claimedCurrentStreamDay: true,
  lastClaim: null,
  nextReward: 650,
};
const claimed = {
  outcome: 'claimed',
  replayed: true,
  reward: 500,
  status,
  message: 'ok',
};
const body = {
  viewer: { twitchUserId: '1001', login: 'alice', displayName: 'Alice' },
  requestId: 'msg-1',
};

describe('core client', () => {
  it('retries a lost call once with the same requestId, authenticated with BOT_SECRET', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify(claimed)));
    const client = createCoreClient(
      'http://core',
      'secret-secret-secret',
      fetchImpl,
    );

    expect((await client.dailyClaim(body)).message).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(String(url)).toBe('http://core/v1/bot/daily/claim');
      expect(JSON.parse(init.body)).toEqual(body);
      expect(init.headers.authorization).toBe('Bearer secret-secret-secret');
    }
  });

  it('does not retry client errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 401 }));
    const client = createCoreClient(
      'http://core',
      'secret-secret-secret',
      fetchImpl,
    );
    await expect(client.dailyClaim(body)).rejects.toThrow('401');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('RV2-3 — a 409 carries the Core code: not_lease_holder (the lease changing hands) is told apart from a real conflict', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'not_lease_holder', holder: 'pc-1' }),
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'event_conflict' }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(new Response('not json', { status: 409 }));
    const client = createCoreClient(
      'http://core',
      'secret-secret-secret',
      fetchImpl,
    );
    const fenced = await client.dailyClaim(body).catch((e) => e);
    expect(fenced).toBeInstanceOf(CoreHttpError);
    expect(fenced).toMatchObject({ status: 409, code: 'not_lease_holder' });
    expect(notLeaseHolder(fenced)).toBe(true);
    const conflict = await client.dailyClaim(body).catch((e) => e);
    expect(conflict).toMatchObject({ status: 409, code: 'event_conflict' });
    expect(notLeaseHolder(conflict)).toBe(false);
    const bare = await client.dailyClaim(body).catch((e) => e);
    expect(bare).toMatchObject({ status: 409, code: undefined });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // never retried here: the caller decides
  });
});
