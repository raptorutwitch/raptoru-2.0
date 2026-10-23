import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCautionExecutor,
  fileCautionJournal,
  memoryCautionJournal,
  readSanction,
  releaseOnce,
  type CautionTwitch,
} from '../src/caution-executor.js';
import { HelixError } from '../src/twitch/helix.js';

// Caution — the Twitch executor (docs/CAUTION.md) against a SIMULATED Twitch (never a real call, never a real unban):
// the sanction read (timeout / permanent / none / elapsed), Unban User once with every answer class, retries that
// cannot apply twice, what its tokens allow, the journal written before the call. The full chain with the real Core
// is in apps/core-api/test/caution-chain.test.ts.

const NOW = Date.parse('2026-10-23T20:00:00Z');
const now = () => NOW;
const pause = async () => {};
const T = '9002';

function twitch(o: {
  bans?: Record<string, string>;
  unban?: (() => Promise<void>)[];
}) {
  const calls: string[] = [];
  const bans = new Map(Object.entries(o.bans ?? {}));
  const unbans = [...(o.unban ?? [])];
  const t: CautionTwitch & { calls: string[]; bansMap: Map<string, string> } = {
    calls,
    bansMap: bans,
    user: async (login) =>
      login === 'viewer2' ? { id: T, login, name: 'Viewer2' } : null,
    bans: async (ids) => {
      calls.push('bans');
      return ids
        .filter((i) => bans.has(i))
        .map((i) => ({ user_id: i, expires_at: bans.get(i)! }));
    },
    unban: async (id) => {
      calls.push(`unban ${id}`);
      const next = unbans.shift();
      if (next) return next();
      bans.delete(id);
    },
  };
  return t;
}
const later = (ms: number) => new Date(NOW + ms).toISOString();

describe('readSanction', () => {
  it('timeout with its end, permanent, none, and an elapsed timeout counts as none', async () => {
    const t = twitch({ bans: { a: later(60_000), b: '', c: later(-1) } });
    expect(await readSanction(t, 'a', now, pause)).toEqual({
      kind: 'timeout',
      ends_at: later(60_000),
    });
    expect(await readSanction(t, 'b', now, pause)).toEqual({
      kind: 'permanent',
    });
    expect(await readSanction(t, 'c', now, pause)).toEqual({ kind: 'none' });
    expect(await readSanction(t, 'z', now, pause)).toEqual({ kind: 'none' });
  });

  it('a 4xx read is final (scope), 5xx retried then failed', async () => {
    const t = twitch({});
    let n = 0;
    t.bans = async () => {
      n++;
      throw new HelixError(403, 'missing scope');
    };
    await expect(readSanction(t, 'a', now, pause)).rejects.toThrow(
      'Twitch 403',
    );
    expect(n).toBe(1);
    t.bans = async () => {
      n++;
      throw new HelixError(503, 'x');
    };
    await expect(readSanction(t, 'a', now, pause)).rejects.toThrow(
      'Twitch 503',
    );
    expect(n).toBe(4);
  });
});

describe('releaseOnce', () => {
  const fail = (e: unknown) => async () => {
    throw e;
  };
  it('204 and gone from the list: released', async () => {
    const t = twitch({ bans: { [T]: later(60_000) } });
    expect(await releaseOnce({ twitch: t, target: T, pause, now })).toEqual({
      event: 'released',
    });
    expect(t.calls.filter((c) => c.startsWith('unban'))).toHaveLength(1);
  });

  it('204 but still listed after several reads: uncertain (never refunded)', async () => {
    const t = twitch({ bans: { [T]: later(60_000) }, unban: [async () => {}] });
    expect(
      await releaseOnce({ twitch: t, target: T, pause, now }),
    ).toMatchObject({ event: 'uncertain' });
  });

  it('403 (LeCroupier_ not allowed): not applied', async () => {
    const t = twitch({
      bans: { [T]: later(60_000) },
      unban: [fail(new HelixError(403, 'forbidden'))],
    });
    expect(
      await releaseOnce({ twitch: t, target: T, pause, now }),
    ).toMatchObject({ event: 'not_applied' });
  });

  it('400 « not banned » and free: not_banned; 400 but still listed: not applied', async () => {
    let t = twitch({ unban: [fail(new HelixError(400, 'not banned'))] });
    expect(
      await releaseOnce({ twitch: t, target: T, pause, now }),
    ).toMatchObject({ event: 'not_banned' });
    t = twitch({
      bans: { [T]: later(60_000) },
      unban: [fail(new HelixError(400, 'bad request'))],
    });
    expect(
      await releaseOnce({ twitch: t, target: T, pause, now }),
    ).toMatchObject({ event: 'not_applied' });
  });

  it('409 / 429 / never sent: retried (never applied twice); exhausted and still listed: not applied', async () => {
    const t = twitch({
      bans: { [T]: later(60_000) },
      unban: [
        fail(new HelixError(409, 'conflict')),
        fail(new HelixError(429, 'slow down', NOW + 1000)),
      ],
    });
    expect(await releaseOnce({ twitch: t, target: T, pause, now })).toEqual({
      event: 'released',
    });
    expect(t.calls.filter((c) => c.startsWith('unban'))).toHaveLength(3);
    const net = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    const u = twitch({
      bans: { [T]: later(60_000) },
      unban: [fail(net), fail(net), fail(net)],
    });
    expect(
      await releaseOnce({ twitch: u, target: T, pause, now }),
    ).toMatchObject({ event: 'not_applied' });
  });

  it('5xx / no answer: the list decides — free → released (verified); listed or unreadable → uncertain', async () => {
    const lifted = twitch({
      unban: [fail(new HelixError(502, 'bad gateway'))],
    });
    expect(
      await releaseOnce({ twitch: lifted, target: T, pause, now }),
    ).toEqual({ event: 'released', verified: true });
    const listed = twitch({
      bans: { [T]: later(60_000) },
      unban: [fail(Object.assign(new Error('t'), { name: 'TimeoutError' }))],
    });
    expect(
      await releaseOnce({ twitch: listed, target: T, pause, now }),
    ).toMatchObject({ event: 'uncertain' });
    const blind = twitch({ unban: [fail(new HelixError(500, 'x'))] });
    blind.bans = async () => {
      throw new HelixError(503, 'down');
    };
    expect(
      await releaseOnce({ twitch: blind, target: T, pause, now }),
    ).toMatchObject({ event: 'uncertain' });
  });
});

describe('the executor', () => {
  it('tells Core what its tokens allow (read: broadcaster moderation:read; release: LeCroupier_ banned_users)', async () => {
    const make = (bot: string[], broadcaster: string[] | null) =>
      createCautionExecutor({
        core: async () => ({ status: 200, body: { job: null } }),
        channelId: '1',
        broadcasterId: '1',
        executorId: 'x',
        login: 'lecroupier_',
        botScopes: bot,
        broadcasterScopes: broadcaster,
        twitch: twitch({}),
        journal: memoryCautionJournal(),
      }).ready;
    expect(
      make(['moderator:manage:banned_users'], ['moderation:read']),
    ).toEqual({ canRead: true, canRelease: true, missing: [] });
    expect(make([], null)).toEqual({
      canRead: false,
      canRelease: false,
      missing: [
        'broadcaster: jeton absent',
        'lecroupier_: moderator:manage:banned_users',
      ],
    });
  });

  it('release job: the journal holds « about to release » before Unban User is called', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'caution-j-'));
    try {
      const path = join(dir, 'j.json');
      const journal = fileCautionJournal(path);
      const t = twitch({ bans: { [T]: later(300_000) } });
      let seenAtUnban: unknown = null;
      t.unban = async () => {
        seenAtUnban = JSON.parse(readFileSync(path, 'utf8'));
      };
      const posts: string[] = [];
      const ex = createCautionExecutor({
        core: async (p) => {
          posts.push(p.split('/').pop()!);
          if (p.endsWith('/claim'))
            return {
              status: 200,
              body: {
                job:
                  posts.filter((x) => x === 'claim').length === 1
                    ? {
                        request_id: '00000000-0000-4000-8000-000000000001',
                        attempt_id: '00000000-0000-4000-8000-000000000002',
                        phase: 'release',
                        mode: 'real',
                        target_login: 'viewer2',
                        target_id: T,
                      }
                    : null,
              },
            };
          if (p.endsWith('/recheck'))
            return { status: 200, body: { proceed: true, target_id: T } };
          return { status: 200, body: {} };
        },
        channelId: '1',
        broadcasterId: '1',
        executorId: 'x',
        login: 'lecroupier_',
        botScopes: ['moderator:manage:banned_users'],
        broadcasterScopes: ['moderation:read'],
        twitch: t,
        journal,
        pause,
        now,
        log: () => {},
      });
      await ex.tick();
      expect(seenAtUnban).toMatchObject({
        entries: [{ state: 'about_to_release', target_id: T }],
      });
      expect(posts).toEqual(['claim', 'recheck', 'result']);
      expect(journal.entries()).toEqual([]); // delivered, removed
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Core does not say « proceed » (refused / dry run): never an unban', async () => {
    const t = twitch({ bans: { [T]: later(300_000) } });
    let claims = 0;
    const ex = createCautionExecutor({
      core: async (p) =>
        p.endsWith('/claim')
          ? {
              status: 200,
              body: {
                job:
                  ++claims === 1
                    ? {
                        request_id: '00000000-0000-4000-8000-000000000001',
                        attempt_id: '00000000-0000-4000-8000-000000000002',
                        phase: 'release',
                        mode: 'real',
                        target_login: 'viewer2',
                        target_id: T,
                      }
                    : null,
              },
            }
          : { status: 200, body: { proceed: false, reason: 'debit_refused' } },
      channelId: '1',
      broadcasterId: '1',
      executorId: 'x',
      login: 'lecroupier_',
      botScopes: ['moderator:manage:banned_users'],
      broadcasterScopes: ['moderation:read'],
      twitch: t,
      journal: memoryCautionJournal(),
      pause,
      now,
    });
    await ex.tick();
    expect(t.calls.filter((c) => c.startsWith('unban'))).toEqual([]);
  });
});
