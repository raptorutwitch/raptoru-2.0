import type { LabChatMessage } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  raffleReservedWords,
  withMiniGameWords,
} from '../src/commands/reserved.js';
import type { Db } from '../src/db/db.js';
import { miniGamesRoutes } from '../src/http/mini-games-routes.js';
import { LabChatRouter } from '../src/lab-chat/router.js';
import { DEFAULT_LAB_WALLET } from '../src/lab-moderation/store.js';
import {
  MiniGamesService,
  OFFLINE_NOTICE_MS,
} from '../src/mini-games/service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Roulette and Slot V1 — the Core service against docs/ROULETTE_SLOT_PARITY.md § 6: Studio switch, one
// transaction per message, Lab wallet, cooldowns, idempotency, silent refusals, rollback, concurrency.

const CH = '900500';
const T0 = new Date('2026-10-16T21:00:00Z');
const START = DEFAULT_LAB_WALLET.tokens; // 12 000

let db: Db;
let clock: FakeClock;
let rolls: number[];
let games: MiniGamesService;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  rolls = [];
  // The test decides every draw (0 → win / cherries; 0.9 → loss / lime).
  games = new MiniGamesService(db, clock, () => rolls.shift() ?? 0.9);
  await goLive();
});

/** The channel's live session (the chat games' single reader): the games play only while it is open. */
const SESSION = '00000000-0000-4000-8000-0000000000a1';
const goLive = () =>
  db.query(
    `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
     values ($1, $2, $3, 'simulated', 'test')
     on conflict (session_id) do update set ended_at = null`,
    [SESSION, CH, clock.now()],
  );
const endLive = () =>
  db.query(
    'update lab_stream_sessions set ended_at = $2 where session_id = $1',
    [SESSION, clock.now()],
  );

let n = 0;
const ALICE = { id: '2001', name: 'Alice' };
const BOB = { id: '2002', name: 'Bob' };
const msg = (
  text: string,
  viewer = ALICE,
  id = `tw-${++n}`,
): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: {
    id: viewer.id,
    login: viewer.name.toLowerCase(),
    display_name: viewer.name,
    role: 'viewer',
  },
  source: 'twitch',
});
const on = () => games.setEnabled(CH, true);
const balance = async (viewer = ALICE) =>
  Number(
    (
      await db.query<{ tokens: string }>(
        'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
        [CH, viewer.id],
      )
    )[0]?.tokens ?? START,
  );
const count = async (table: string) =>
  Number(
    (await db.query<{ n: string }>(`select count(*) as n from ${table}`))[0]!.n,
  );
const answers = async () =>
  (
    await db.query<{ params: { text: string }; origin: string }>(
      `select params, origin from cmd_steps order by seq_global`,
    )
  ).map((s) => [s.origin, s.params.text]);

describe('Studio switch « Mini-jeux »', () => {
  it('OFF by default: a game command writes nothing', async () => {
    expect(await games.chat(msg('!roulette 100'))).toEqual({
      outcome: 'ignored',
      skipped: 'disabled',
    });
    expect(await count('mini_game_plays')).toBe(0);
    expect(await count('lab_wallets')).toBe(0);
    expect(await count('cmd_steps')).toBe(0);
  });

  it('routes: state and settings (on / off)', async () => {
    const routes = miniGamesRoutes(games);
    const get = routes.find((r) => r.method === 'GET')!;
    const post = routes.find((r) => r.method === 'POST')!;
    const call = (r: typeof get, path: string, body?: unknown) =>
      r.handle({
        params: r.pattern.exec(path)!.slice(1),
        body,
        url: new URL(`http://x${path}`),
      });
    expect(await call(get, `/v1/lab/mini-games/${CH}/state`)).toEqual({
      channel_id: CH,
      enabled: false,
      recent: [],
    });
    expect(
      await call(post, `/v1/lab/mini-games/${CH}/settings`, { enabled: true }),
    ).toMatchObject({ enabled: true });
    await expect(
      call(post, `/v1/lab/mini-games/${CH}/settings`, { enabled: 'yes' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('Roulette (§ 2)', () => {
  it('win: +1× the bet, one ledger row, one play, one LeCroupier_ answer', async () => {
    await on();
    rolls = [0.1];
    expect(await games.chat(msg('!roulette 100', ALICE, 'tw-r1'))).toEqual({
      outcome: 'mini_game_played',
    });
    expect(await balance()).toBe(START + 100);
    const ledger = await db.query<{ amount: string; reason: string }>(
      "select amount, reason from lab_wallet_ledger where kind = 'mini_game'",
    );
    expect(ledger.map((l) => [Number(l.amount), l.reason])).toEqual([
      [100, `mg:${CH}:tw-r1`],
    ]);
    expect(await answers()).toEqual([
      [
        'mini_game',
        `Alice gagne 100 Jetons à la roulette et possède maintenant ${START + 100} Jetons ! 😎`,
      ],
    ]);
    const state = await games.state(CH);
    expect(state.recent).toEqual([
      expect.objectContaining({
        message_id: 'tw-r1',
        game: 'roulette',
        bet: 100,
        won: true,
        delta: 100,
        balance_after: START + 100,
        symbols: null,
      }),
    ]);
  });

  it('loss: −the bet', async () => {
    await on();
    rolls = [0.9];
    await games.chat(msg('!gamble 1k'));
    expect(await balance()).toBe(START - 1000);
    expect((await answers())[0]![1]).toBe(
      `Alice perd 1000 Jetons à la roulette et possède maintenant ${START - 1000} Jetons ! ;)`,
    );
  });

  it('all-in: the whole balance, all-in messages (win doubles, loss empties)', async () => {
    await on();
    rolls = [0.1];
    await games.chat(msg('!roulette all'));
    expect(await balance()).toBe(START * 2);
    clock.advance(10_000);
    rolls = [0.9];
    await games.chat(msg('!roulette ALL'));
    expect(await balance()).toBe(0);
    const [win, loss] = (await answers()).map((a) => a[1]);
    expect(win).toBe(
      `✨ Alice a eu uneuuuuh chatte et remporte ${START} Jetons ✨ Alice a maintenant ${START * 2} Jetons raptor199Pog`,
    );
    expect(loss).toBe(
      `Alice a all in et a totu perdu de ses ${START * 2} Jetons raptor199Money Gros naze !`,
    );
    clock.advance(10_000);
    expect(await games.chat(msg('!roulette all'))).toMatchObject({
      skipped: 'below_min',
    });
  });
});

describe('Slot (§ 3)', () => {
  it('three identical: +24× the bet; `!slots` alone bets the minimum', async () => {
    await on();
    rolls = [0, 0, 0];
    await games.chat(msg('!slots'));
    expect(await balance()).toBe(START + 480);
    expect(await answers()).toEqual([
      ['mini_game', '@Alice 🍒 🍒 🍒 tu remportes 480 Jetons ! 🍀'],
    ]);
    expect((await games.state(CH)).recent[0]).toMatchObject({
      game: 'slot',
      bet: 20,
      symbols: ['🍒', '🍒', '🍒'],
      won: true,
      delta: 480,
    });
  });

  it('two of a kind: loss of the bet', async () => {
    await on();
    rolls = [0, 0, 0.45];
    await games.chat(msg('!sm 100'));
    expect(await balance()).toBe(START - 100);
    expect((await answers())[0]![1]).toBe(
      '@Alice 🍒 🍒 🍇 tu perds 100 Jetons 😳',
    );
  });
});

describe('cooldowns, refusals, idempotency', () => {
  it('Roulette 10 s and Slot 2 s per viewer, per game; other viewers unaffected', async () => {
    await on();
    expect(await games.chat(msg('!roulette 20'))).toMatchObject({
      outcome: 'mini_game_played',
    });
    clock.advance(9_999);
    expect(await games.chat(msg('!roulette 20'))).toEqual({
      outcome: 'ignored',
      skipped: 'cooldown',
    });
    expect(await games.chat(msg('!roulette 20', BOB))).toMatchObject({
      outcome: 'mini_game_played',
    });
    expect(await games.chat(msg('!slots 20'))).toMatchObject({
      outcome: 'mini_game_played',
    });
    clock.advance(1_999);
    expect(await games.chat(msg('!slots 20'))).toMatchObject({
      skipped: 'cooldown',
    });
    clock.advance(1);
    expect(await games.chat(msg('!slots 20'))).toMatchObject({
      outcome: 'mini_game_played',
    });
    expect(await games.chat(msg('!roulette 20'))).toMatchObject({
      outcome: 'mini_game_played',
    });
    expect(await count('mini_game_plays')).toBe(5);
  });

  it('invalid, below 20, more than the balance: silent, nothing written', async () => {
    await on();
    for (const [text, skipped] of [
      ['!roulette', 'invalid'],
      ['!roulette abc', 'invalid'],
      ['!slots all', 'invalid'],
      ['!roulette 19', 'below_min'],
      ['!slots 12001', 'insufficient'],
    ] as const)
      expect(await games.chat(msg(text))).toEqual({
        outcome: 'ignored',
        skipped,
      });
    expect(await count('mini_game_plays')).toBe(0);
    expect(await count("lab_wallet_ledger where kind = 'mini_game'")).toBe(0);
    expect(await count('cmd_steps')).toBe(0);
    expect(await balance()).toBe(START);
    // Not a game: ignored without a reason.
    expect(await games.chat(msg('!mots'))).toEqual({ outcome: 'ignored' });
    expect(await games.chat(msg('roulette 100'))).toEqual({
      outcome: 'ignored',
    });
  });

  it('a win the Lab wallet could not hold is refused before the draw', async () => {
    await on();
    await db.query(
      "update lab_currencies set max_balance = $1 where currency_id = 'tokens'",
      [START + 400],
    );
    rolls = [0, 0, 0];
    expect(await games.chat(msg('!slots 20'))).toEqual({
      outcome: 'ignored',
      skipped: 'balance_cap',
    });
    expect(rolls).toEqual([0, 0, 0]); // nothing drawn
    expect(await balance()).toBe(START);
    expect(await games.chat(msg('!roulette 300'))).toMatchObject({
      outcome: 'mini_game_played',
    });
  });

  it('the same message_id resent: played once, paid once, answered once', async () => {
    await on();
    rolls = [0.1, 0.1];
    await games.chat(msg('!roulette 100', ALICE, 'tw-dup'));
    clock.advance(60_000);
    expect(await games.chat(msg('!roulette 100', ALICE, 'tw-dup'))).toEqual({
      outcome: 'mini_game_played',
      replayed: true,
    });
    expect(await balance()).toBe(START + 100);
    expect(await count('mini_game_plays')).toBe(1);
    expect(await count('cmd_steps')).toBe(1);
  });

  it('a failure inside the transaction rolls everything back', async () => {
    await on();
    // A ledger row already holding the key makes the ledger insert fail after the balance change.
    await db.query(
      `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, actor, reason, created_at)
       values ($1, '9', 'mini_game', 'tokens', 1, 'system', $2, $3)`,
      [CH, `mg:${CH}:tw-boom`, T0],
    );
    rolls = [0.1];
    await expect(
      games.chat(msg('!roulette 500', ALICE, 'tw-boom')),
    ).rejects.toThrow();
    expect(await balance()).toBe(START);
    expect(await count('mini_game_plays')).toBe(0);
    expect(await count('cmd_steps')).toBe(0);
  });
});

describe('concurrency', () => {
  it('two messages of the same viewer at once: one game, the other in cooldown', async () => {
    await on();
    rolls = [0.1, 0.1];
    const out = await Promise.all([
      games.chat(msg('!roulette 100')),
      games.chat(msg('!roulette 100')),
    ]);
    expect(out.map((o) => o.outcome).sort()).toEqual([
      'ignored',
      'mini_game_played',
    ]);
    expect(await balance()).toBe(START + 100);
    expect(await count('mini_game_plays')).toBe(1);
  });

  it('the same message delivered twice at once: one effect', async () => {
    await on();
    rolls = [0.9, 0.9];
    await Promise.all([
      games.chat(msg('!roulette 100', ALICE, 'tw-race')),
      games.chat(msg('!roulette 100', ALICE, 'tw-race')),
    ]);
    expect(await balance()).toBe(START - 100);
    expect(await count('mini_game_plays')).toBe(1);
    expect(await count('cmd_steps')).toBe(1);
  });
});

describe('integration', () => {
  it('the chat router hands game commands to the module, never plain messages', async () => {
    await on();
    const router = new LabChatRouter([
      { name: 'mini_games', chat: (m) => games.chat(m) },
    ]);
    expect(await router.message(msg('roulette 100'))).toEqual({ handled: [] });
    rolls = [0.1];
    expect(await router.message(msg('!roulette 100'))).toEqual({
      handled: [{ module: 'mini_games', outcome: 'mini_game_played' }],
    });
  });

  it('Commands V2 cannot use the game words (reserved by « Mini-jeux »)', async () => {
    const reserved = withMiniGameWords(
      raffleReservedWords({
        config: async () =>
          ({ join_commands: ['!join'], cancel_commands: [] }) as never,
      }),
    );
    const words = await reserved(db, CH);
    expect(words).toContainEqual({ word: 'join', module: 'raffle' });
    for (const w of [
      'roulette',
      'gamble',
      'slots',
      'slot',
      'slotmachine',
      'sm',
      'smp',
    ])
      expect(words).toContainEqual({ word: w, module: 'Mini-jeux' });
  });
});

describe('off live: nothing played, one short answer per viewer per minute', () => {
  it('Roulette and Slot off live: no bet, no debit, no play; one answer, the next attempts silent; live again: plays', async () => {
    await on();
    await endLive();
    rolls = [0];
    expect(await games.chat(msg('!roulette 100'))).toEqual({
      outcome: 'ignored',
      skipped: 'offline',
    });
    expect(await games.chat(msg('!slots 100'))).toEqual({
      outcome: 'ignored',
      skipped: 'offline',
    });
    expect(await games.chat(msg('!roulette 50', BOB))).toMatchObject({
      skipped: 'offline',
    });
    expect(await count('mini_game_plays')).toBe(0);
    expect(await count("lab_wallet_ledger where kind = 'mini_game'")).toBe(0);
    expect(await balance()).toBe(START);
    expect(await answers()).toEqual([
      ['mini_game', '@Alice - les mini-jeux sont disponibles pendant le live.'],
      ['mini_game', '@Bob - les mini-jeux sont disponibles pendant le live.'],
    ]);
    // A minute later the same viewer is told again (once).
    clock.advance(OFFLINE_NOTICE_MS);
    await games.chat(msg('!roulette 100'));
    expect(await count('cmd_steps')).toBe(3);
    // The same Twitch message resent: nothing new.
    const again = msg('!roulette 100', ALICE, 'tw-resent');
    clock.advance(OFFLINE_NOTICE_MS);
    await games.chat(again);
    games = new MiniGamesService(db, clock, () => rolls.shift() ?? 0.9);
    await games.chat(again);
    expect(await count('cmd_steps')).toBe(4);
    // Back in live: the game plays as before.
    await goLive();
    rolls = [0];
    expect(await games.chat(msg('!roulette 100'))).toMatchObject({
      outcome: 'mini_game_played',
    });
    expect(await count('mini_game_plays')).toBe(1);
  });

  it('switch OFF and off live: silent (the switch first)', async () => {
    await endLive();
    expect(await games.chat(msg('!roulette 100'))).toEqual({
      outcome: 'ignored',
      skipped: 'disabled',
    });
    expect(await count('cmd_steps')).toBe(0);
  });
});
