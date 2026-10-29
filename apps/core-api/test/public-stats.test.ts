import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import { publicStatsRoutes } from '../src/http/public-stats-routes.js';
import { createTestDb } from './helpers.js';

// raptoru.fr's public rankings (docs/RAPTORU_FR.md): Jeu des mots per period and Tombola, aggregated from the Core's
// own tables, read-only. PGlite.

const CH = '83603689';
let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  for (const t of [
    'word_game_finds',
    'word_game_messages',
    'word_game_words',
    'lab_raffle_winners',
    'lab_raffle_entries',
    'lab_raffles',
    'viewers',
  ])
    await db.query(`delete from ${t}`);
});

const route = (path: string) => {
  const r = publicStatsRoutes(db).find((x) => x.pattern.test(path))!;
  return (query = '') =>
    r.handle({
      params: [],
      body: undefined,
      url: new URL(`http://core${path}${query}`),
    } as never) as Promise<Record<string, unknown>>;
};

async function viewer(id: string, login: string, name: string) {
  await db.query(
    `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3)
     on conflict (twitch_user_id) do update set login = $2, display_name = $3`,
    [id, login, name],
  );
}

async function find(
  viewerId: string,
  name: string,
  points: number,
  at: Date,
  fast = false,
) {
  const occ = randomUUID();
  const msg = randomUUID();
  const session = randomUUID();
  await db.query(
    `insert into word_game_words (occurrence_id, channel_id, session_id, word, shuffled, golden, source, status, created_at,
       found_at, ended_at) values ($1, $2, $3, 'mot', 'tom', false, 'cycle', 'found', $4, $4, $4)`,
    [occ, CH, session, at],
  );
  await db.query(
    `insert into word_game_messages (channel_id, message_id, session_id, viewer_id, viewer_display_name, words_points,
       combo, breaker, total, ledger_id, created_at) values ($1, $2, $3, $4, $5, $6, 0, 0, $6, 1, $7)`,
    [CH, msg, session, viewerId, name, points, at],
  );
  await db.query(
    `insert into word_game_finds (occurrence_id, channel_id, message_id, session_id, viewer_id, viewer_display_name, word,
       points, fast, golden, streak_after, created_at) values ($1, $2, $3, $4, $5, $6, 'mot', $7, $8, false, 1, $9)`,
    [occ, CH, msg, session, viewerId, name, points, fast, at],
  );
}

describe('raptoru.fr — Jeu des mots ranking', () => {
  it('per period (Paris week / month / all): points, words, fast words; the current Twitch name; ties by words', async () => {
    const now = new Date();
    const old = new Date('2020-01-01T12:00:00Z');
    await viewer('1', 'ana', 'Ana');
    await viewer('2', 'bob_new', 'Bob_New'); // renamed on Twitch: the Core's viewer row has the new name
    await find('1', 'Ana', 10, now, true);
    await find('1', 'Ana', 5, now);
    await find('2', 'Bob', 15, now);
    await find('2', 'Bob', 3, old);
    const week = await route('/v1/word-game/leaderboard')('?period=semaine');
    expect(week.entries).toEqual(
      [
        {
          rank: 1,
          twitchUserId: '2',
          login: 'bob_new',
          displayName: 'Bob_New',
          points: 15,
          words: 1,
          fastWords: 0,
        },
        {
          rank: 2,
          twitchUserId: '1',
          login: 'ana',
          displayName: 'Ana',
          points: 15,
          words: 2,
          fastWords: 1,
        },
      ]
        .sort((a, b) => b.words - a.words)
        .map((e, i) => ({ ...e, rank: i + 1 })),
    );
    const all = await route('/v1/word-game/leaderboard')('?period=all');
    expect(
      (all.entries as { twitchUserId: string; points: number }[]).map((e) => [
        e.twitchUserId,
        e.points,
      ]),
    ).toEqual([
      ['2', 18],
      ['1', 15],
    ]);
    expect(all.firstFindAt).toBe(old.toISOString());
    // One viewer's own row with its rank in the whole ranking (the profile); a bad id is refused.
    expect(
      (await route('/v1/word-game/leaderboard')('?period=all&viewer=1'))
        .entries,
    ).toEqual([
      {
        rank: 2,
        twitchUserId: '1',
        login: 'ana',
        displayName: 'Ana',
        points: 15,
        words: 2,
        fastWords: 1,
      },
    ]);
    expect(
      (await route('/v1/word-game/leaderboard')('?period=all&viewer=999'))
        .entries,
    ).toEqual([]);
    await expect(
      route('/v1/word-game/leaderboard')('?viewer=abc'),
    ).rejects.toMatchObject({ status: 400 });
    // An unknown period is the week; the limit is bounded.
    expect((await route('/v1/word-game/leaderboard')('?period=x')).period).toBe(
      'semaine',
    );
  });
});

describe('raptoru.fr — Tombola ranking', () => {
  async function round(
    status: string,
    entrants: string[],
    winners: [string, number, string][],
  ) {
    const id = randomUUID();
    await db.query(
      `insert into lab_raffles (raffle_id, channel_id, status, jackpot, winners_count, opened_at, ends_at, opened_by, kind,
         currency_id, duration_s, open_at, phase_changed_at, origin)
       values ($1, $2, $3, 1000, 1, now(), now(), 'test', 'normal', 'tokens', 60, now(), now(), 'manual')`,
      [id, CH, status],
    );
    for (const v of entrants)
      await db.query(
        `insert into lab_raffle_entries (entry_id, raffle_id, channel_id, viewer_id, viewer_display_name, idempotency_key,
           created_at, source) values ($1, $2, $3, $4, $5, $6, now(), 'chat')`,
        [randomUUID(), id, CH, v, `V${v}`, randomUUID()],
      );
    for (const [v, amount, currency] of winners)
      await db.query(
        `insert into lab_raffle_winners (raffle_id, viewer_id, viewer_display_name, amount, position, currency_id,
           payout_status) values ($1, $2, $3, $4, 1, $5, 'paid')`,
        [id, v, `V${v}`, amount, currency],
      );
  }

  it('finished rounds only; wins, losses, Jetons won (paid Jetons only); ordered by wins, then Jetons, then entries', async () => {
    await viewer('1', 'ana', 'Ana');
    await round('finished', ['1', '2', '3'], [['1', 500, 'tokens']]);
    await round('finished', ['1', '2'], [['2', 700, 'tokens']]);
    await round('finished', ['2', '3'], [['3', 9, 'bonbons']]); // a win, never Jetons
    await round('cancelled', ['1', '2', '3'], []);
    await round('open', ['1'], []);
    const out = await route('/v1/raffle/leaderboard')();
    expect(out.entries).toEqual([
      {
        rank: 1,
        twitchUserId: '2',
        login: null,
        displayName: 'V2',
        participations: 3,
        wins: 1,
        losses: 2,
        totalWon: 700,
      },
      {
        rank: 2,
        twitchUserId: '1',
        login: 'ana',
        displayName: 'Ana',
        participations: 2,
        wins: 1,
        losses: 1,
        totalWon: 500,
      },
      {
        rank: 3,
        twitchUserId: '3',
        login: null,
        displayName: 'V3',
        participations: 2,
        wins: 1,
        losses: 1,
        totalWon: 0,
      },
    ]);
    expect(
      (await route('/v1/raffle/leaderboard')('?viewer=3')).entries,
    ).toMatchObject([{ rank: 3, twitchUserId: '3' }]);
  });
});
