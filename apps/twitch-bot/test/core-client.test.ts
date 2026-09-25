import { describe, expect, it, vi } from 'vitest';
import { createCoreClient } from '../src/core-client.js';

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
});
