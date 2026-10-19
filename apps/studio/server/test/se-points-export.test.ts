import { describe, expect, it } from 'vitest';
import {
  exportSePoints,
  SeExportError,
  summarizeSeExport,
} from '../src/economy/se-points-export.js';

// A fake StreamElements: a leaderboard capped at 3 rows per page, an ignored viewer absent from it, a zero.
const CH = 'a'.repeat(24);
const board = [
  { username: 'Alice', points: 900 },
  { username: 'bob', points: 500 },
  { username: 'carol', points: 200 },
  { username: 'dan', points: 100 },
  { username: 'eve', points: 0 },
];
const sheets: Record<string, number> = {
  alice: 900,
  bob: 500,
  carol: 200,
  dan: 100,
  eve: 0,
  ghost: 4242,
};

function fakeSe(
  opts: { failAt?: string; once429?: boolean; channel?: string } = {},
) {
  const calls: { url: string; method: string; auth: string }[] = [];
  let limited = opts.once429;
  const fetch: typeof globalThis.fetch = (async (
    url: string,
    init: RequestInit,
  ) => {
    const u = new URL(url);
    calls.push({
      url: u.pathname + u.search,
      method: init.method ?? 'GET',
      auth: String((init.headers as Record<string, string>).authorization),
    });
    const json = (
      status: number,
      body: unknown,
      headers: Record<string, string> = {},
    ) => new Response(JSON.stringify(body), { status, headers });
    if (limited && u.pathname.includes('/top')) {
      limited = false;
      return json(429, {}, { 'retry-after': '0' });
    }
    if (opts.failAt && u.search.includes(opts.failAt))
      return json(500, { error: 'boom' });
    if (u.pathname === '/kappa/v2/channels/me')
      return json(200, {
        _id: opts.channel ?? CH,
        username: 'raptoru_',
        provider: 'twitch',
      });
    if (u.pathname === `/kappa/v2/loyalty/${CH}`)
      return json(200, {
        loyalty: { enabled: true, amount: 50, ignored: ['Ghost'] },
      });
    if (u.pathname === `/kappa/v2/points/${CH}/top`) {
      const limit = Math.min(3, Number(u.searchParams.get('limit')));
      const offset = Number(u.searchParams.get('offset'));
      return json(200, {
        _total: board.length,
        users: board.slice(offset, offset + limit),
      });
    }
    const name = decodeURIComponent(u.pathname.split('/').pop()!);
    return name in sheets
      ? json(200, {
          username: name,
          points: sheets[name],
          pointsAlltime: sheets[name],
          rank: 1,
        })
      : json(404, { message: 'not found' });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('StreamElements export (read only)', () => {
  it('pages through a capped leaderboard twice, checks sheets and the ignored viewers, GET only', async () => {
    const se = fakeSe({ once429: true });
    const x = await exportSePoints({
      token: 'jwt-secret',
      channel: CH,
      fetch: se.fetch,
      base: 'http://se',
      delayMs: 0,
      sample: 2,
    });
    expect(se.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(se.calls.every((c) => c.auth === 'Bearer jwt-secret')).toBe(true);
    const s = summarizeSeExport(x);
    expect(s).toMatchObject({
      channel_matches: true,
      page_size_returned: 3,
      announced_total: 5,
      pass1: { rows: 5, distinct: 5, sum: 1700, zeros: 1, negatives: 0 },
      pass2: { rows: 5, sum: 1700 },
      changed_between_passes: 0,
      ignored: {
        count: 1,
        in_leaderboard: 0,
        sheet_found: 1,
        sheet_positive: 1,
      },
      sheets: { different: 0, errors: 0 },
    });
    // The summary never carries a username nor the token.
    expect(JSON.stringify(s)).not.toMatch(/alice|ghost|jwt-secret/i);
  });

  it('an API error is never « no more accounts »: the export stops', async () => {
    const se = fakeSe({ failAt: 'offset=3' });
    await expect(
      exportSePoints({
        token: 't',
        channel: CH,
        fetch: se.fetch,
        base: 'http://se',
        delayMs: 0,
      }),
    ).rejects.toThrow(SeExportError);
  });

  it('refuses a token of another channel before reading any balance', async () => {
    const se = fakeSe({ channel: 'b'.repeat(24) });
    await expect(
      exportSePoints({
        token: 't',
        channel: CH,
        fetch: se.fetch,
        base: 'http://se',
        delayMs: 0,
      }),
    ).rejects.toThrow(/canal/);
    expect(se.calls).toHaveLength(1);
  });
});
