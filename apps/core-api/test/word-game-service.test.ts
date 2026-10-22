import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LabChatMessage, WordGameWinEvent } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import {
  serveWordGameEvents,
  wordGameRoutes,
} from '../src/http/word-game-routes.js';
import { HttpError } from '../src/http/server.js';
import { mappedModeration } from '../src/http/lab-moderation-routes.js';
import { LabChatRouter } from '../src/lab-chat/router.js';
import { DEFAULT_LAB_WALLET } from '../src/lab-moderation/store.js';
import {
  CYCLE_ANNOUNCEMENT,
  WORD_INTERVAL_MS,
} from '../src/word-game/rules.js';
import { WordGameService } from '../src/word-game/service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Jeu des mots V1, Lot 3 — the Core service against docs/WORD_GAME_PARITY.md: live session, cycle,
// Studio actions, one transaction per winning message, ONE Wallet credit, idempotency, chat output
// through cmd_steps. The rule values themselves are tested in word-game-rules.test.ts.

const CH = '900300';
const T0 = new Date('2026-10-16T20:00:00Z');
const SEC = 1000;
const MIN = 60 * SEC;
const BANK = ['angle', 'requin', 'tournis', 'rouble', 'crâne'];

let db: Db;
let clock: FakeClock;
let rngValue: number;
let game: WordGameService;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  rngValue = 0.5;
  game = new WordGameService(db, clock, () => rngValue, BANK);
});

const openSession = async (id: string = randomUUID()) => {
  await db.query(
    `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
     values ($1, $2, $3, 'simulated', 'test')`,
    [id, CH, clock.now()],
  );
  return id;
};
const endSession = (id: string) =>
  db.query(
    'update lab_stream_sessions set ended_at = $2 where session_id = $1',
    [id, clock.now()],
  );
/** Opens a live session and aligns the game on it (as the Lab Core tick does). */
const live = async () => {
  const id = await openSession();
  await game.tick();
  return id;
};
const addWord = async (
  session: string,
  word: string,
  o: { golden?: boolean; ageSeconds?: number; shuffled?: string } = {},
) => {
  const id = `occ-${word}-${randomUUID().slice(0, 8)}`;
  await db.query(
    `insert into word_game_words (occurrence_id, channel_id, session_id, word, shuffled, golden, source, status, created_at)
     values ($1, $2, $3, $4, $5, $6, 'cycle', 'active', $7)`,
    [
      id,
      CH,
      session,
      word,
      o.shuffled ?? [...word].reverse().join(''),
      o.golden ?? false,
      new Date(clock.now().getTime() - (o.ageSeconds ?? 120) * SEC),
    ],
  );
  return id;
};
let n = 0;
const msg = (
  text: string,
  viewer = { id: '1001', name: 'Alice' },
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
const ALICE = { id: '1001', name: 'Alice' };
const BOB = { id: '1002', name: 'Bob' };
const steps = () =>
  db.query<{
    idempotency_key: string;
    params: { mode: string; text: string };
    available_at: Date;
  }>(
    `select idempotency_key, params, available_at from cmd_steps where origin = 'word_game' order by seq_global`,
  );
const texts = async () =>
  (await steps()).map((s) => [s.params.mode, s.params.text]);
const balance = async (viewer: string) =>
  Number(
    (
      await db.query<{ tokens: string }>(
        'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
        [CH, viewer],
      )
    )[0]?.tokens ?? DEFAULT_LAB_WALLET.tokens,
  );
const gain = async (viewer: string) =>
  (await balance(viewer)) - DEFAULT_LAB_WALLET.tokens;
/** Words drawn by the service itself (helpers insert occ-… words). */
const DRAWN_CYCLE =
  "word_game_words where source = 'cycle' and occurrence_id like 'jdm-%'";
const count = async (table: string) =>
  Number(
    (await db.query<{ n: string }>(`select count(*) as n from ${table}`))[0]!.n,
  );
const channelRow = async () =>
  (
    await db.query<{
      session_id: string | null;
      stopped: boolean;
      next_word_at: Date | null;
      streak_holder_id: string | null;
      streak_count: number;
    }>('select * from word_game_channels where channel_id = $1', [CH])
  )[0];
const wordsOf = (status = 'active') =>
  db.query<{
    word: string;
    source: string;
    session_id: string;
    golden: boolean;
    shuffled: string;
  }>('select * from word_game_words where status = $1 order by created_at', [
    status,
  ]);

describe('offline (§ 14)', () => {
  it('a plain message, the tick and Studio do nothing while no live session is open', async () => {
    expect(await game.chat(msg('angle'))).toEqual({ outcome: 'ignored' });
    expect(await game.tick()).toBe(0);
    await expect(
      game.act(CH, { action: 'new_word', request_id: randomUUID() }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'offline',
    });
    expect(await count('word_game_channels')).toBe(0);
    expect(await count('word_game_words')).toBe(0);
    expect(await count('cmd_steps')).toBe(0);
    expect(await game.state(CH)).toMatchObject({
      live: false,
      running: false,
      active: [],
    });
  });

  it('a session that ends stops detection and generation; its words are not active any more', async () => {
    const s = await live();
    await addWord(s, 'angle');
    await endSession(s);
    expect(await game.chat(msg('angle'))).toEqual({ outcome: 'ignored' });
    clock.advance(60 * MIN);
    await game.tick();
    expect(await count('word_game_messages')).toBe(0);
    expect((await game.state(CH)).active).toEqual([]);
  });
});

describe('cycle (§§ 13–16)', () => {
  it('a new session: zero word, the first one 5–15 min later, then one word per due time', async () => {
    rngValue = 0; // 300 000 ms
    const s = await live();
    expect(await channelRow()).toMatchObject({
      session_id: s,
      stopped: false,
      next_word_at: new Date(T0.getTime() + WORD_INTERVAL_MS.min),
    });
    expect(await count('word_game_words')).toBe(0);
    clock.advance(5 * MIN - 1);
    await game.tick();
    expect(await count('word_game_words')).toBe(0);
    clock.advance(1);
    await game.tick();
    const [w] = await wordsOf();
    expect(w).toMatchObject({ source: 'cycle', session_id: s });
    // Cycle word: the announcement, then ONE publication message 500 ms later (rng 0 → golden roll 1).
    const st = await steps();
    expect(
      st.map((x) => [
        x.params.mode,
        x.params.text,
        x.available_at.getTime() - clock.now().getTime(),
      ]),
    ).toEqual([
      ['announce', CYCLE_ANNOUNCEMENT, 0],
      ['normal', `🔸 ${w!.shuffled} 🔸`, 500],
    ]);
    expect(
      st.map((x) => x.idempotency_key.replace(/jdm-[0-9a-f-]+/, 'X')),
    ).toEqual(['jdm:word:X:cycle', 'jdm:word:X:publish']);
    expect((await channelRow())!.next_word_at).toEqual(
      new Date(clock.now().getTime() + 300_000),
    );
    await game.tick();
    expect(await count('word_game_words')).toBe(1);
  });

  it('the next word is drawn uniformly 5–15 min later and is never an active word', async () => {
    rngValue = 0.999_999_999; // 900 000 ms, last word of the free list
    const s = await live();
    expect((await channelRow())!.next_word_at).toEqual(
      new Date(T0.getTime() + WORD_INTERVAL_MS.max),
    );
    for (const w of ['angle', 'requin', 'tournis', 'rouble'])
      await addWord(s, w);
    clock.advance(15 * MIN);
    await game.tick();
    expect((await wordsOf()).map((w) => w.word)).toContain('crâne');
  });

  it('a golden word is published in ONE message (§ 12.2)', async () => {
    rngValue = 0; // golden roll 1, delay 300 s
    await live();
    clock.advance(5 * MIN);
    await game.tick();
    const [w] = await wordsOf();
    expect(w!.golden).toBe(true);
    expect((await texts()).filter(([mode]) => mode === 'normal')).toEqual([
      ['normal', `🔸 ${w!.shuffled} 🔸`],
    ]);
  });

  it('a new session abandons the words of the previous one and resets streak and « Arrêter »', async () => {
    const s1 = await live();
    await addWord(s1, 'angle');
    await addWord(s1, 'requin');
    await game.chat(msg('requin'));
    await game.act(CH, { action: 'stop' });
    await endSession(s1);
    clock.advance(10 * MIN);
    const s2 = await live();
    expect(await wordsOf()).toEqual([]);
    expect((await wordsOf('abandoned')).map((w) => w.word)).toEqual(['angle']);
    expect(await channelRow()).toMatchObject({
      session_id: s2,
      stopped: false,
      streak_holder_id: null,
      streak_count: 0,
    });
    expect(await game.chat(msg('angle'))).toEqual({ outcome: 'ignored' });
  });

  it('a restart within the same session restores words, streak and due time; overdue → ONE word', async () => {
    rngValue = 0;
    const s = await live();
    await addWord(s, 'angle');
    await addWord(s, 'requin');
    await game.chat(msg('requin'));
    // Core restarts (new service instance) two hours later.
    clock.advance(120 * MIN);
    game = new WordGameService(db, clock, () => rngValue, BANK);
    expect(await game.chat(msg('angle'))).toEqual({ outcome: 'word_game_win' });
    expect((await channelRow())!.streak_count).toBe(2);
    await game.tick();
    await game.tick();
    expect(await count(DRAWN_CYCLE)).toBe(1);
    expect((await channelRow())!.next_word_at).toEqual(
      new Date(clock.now().getTime() + 300_000),
    );
  });

  it('the same live seen again (session reopened) keeps its words', async () => {
    const s = await live();
    await addWord(s, 'angle');
    await endSession(s);
    await db.query(
      'update lab_stream_sessions set ended_at = null where session_id = $1',
      [s],
    );
    expect(await game.chat(msg('angle'))).toEqual({ outcome: 'word_game_win' });
  });
});

describe('Studio actions (§ 14)', () => {
  it('« Nouveau mot »: now, no announcement, one message, once per request id, cycle unchanged', async () => {
    await live();
    const before = (await channelRow())!.next_word_at;
    const request_id = randomUUID();
    const state = await game.act(CH, { action: 'new_word', request_id });
    await game.act(CH, { action: 'new_word', request_id });
    expect(state.active).toHaveLength(1);
    expect(state.active[0]).toMatchObject({ source: 'manual', age_seconds: 0 });
    expect(await texts()).toEqual([
      ['normal', `-> ${state.active[0]!.shuffled} <-`],
    ]);
    expect((await channelRow())!.next_word_at).toEqual(before);
  });

  it('« Arrêter »: no new word, active words stay findable; resuming waits 5–15 min', async () => {
    rngValue = 0;
    const s = await live();
    await addWord(s, 'angle');
    expect(await game.act(CH, { action: 'stop' })).toMatchObject({
      running: false,
      stopped: true,
      next_word_at: null,
    });
    clock.advance(60 * MIN);
    await game.tick();
    expect(await count(DRAWN_CYCLE)).toBe(0);
    expect(await game.chat(msg('angle'))).toEqual({ outcome: 'word_game_win' });
    // « Nouveau mot » still works while stopped (the legacy button was independent of the loop).
    await game.act(CH, { action: 'new_word', request_id: randomUUID() });
    expect(await count("word_game_words where source = 'manual'")).toBe(1);
    const resumed = await game.act(CH, { action: 'start' });
    expect(resumed).toMatchObject({ running: true, stopped: false });
    expect(resumed.next_word_at).toBe(
      new Date(clock.now().getTime() + 300_000).toISOString(),
    );
  });

  it('routes: state, actions, 409 offline', async () => {
    const [state, actions] = wordGameRoutes(game);
    const url = new URL('http://x');
    expect(await state!.handle({ params: [CH], url } as never)).toMatchObject({
      live: false,
    });
    const offline = await Promise.resolve(
      actions!.handle({ params: [CH], url, body: { action: 'stop' } } as never),
    ).catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(HttpError);
    expect(offline).toMatchObject({ status: 409, body: { error: 'offline' } });
    await live();
    expect(
      await actions!.handle({
        params: [CH],
        url,
        body: { action: 'stop' },
      } as never),
    ).toMatchObject({ live: true, stopped: true });
    expect(state!.pattern.test(`/v1/lab/word-game/${CH}/state`)).toBe(true);
  });
});

describe('a winning message (§§ 4–10, 12, 21, 22)', () => {
  it('a message without active word writes nothing', async () => {
    const s = await live();
    await addWord(s, 'angle');
    const before = await count('cmd_steps');
    expect(await game.chat(msg('bonjour tout le monde'))).toEqual({
      outcome: 'ignored',
    });
    expect(await count('word_game_messages')).toBe(0);
    expect(await count('cmd_steps')).toBe(before);
  });

  it('one word: found, recorded, credited once, announced', async () => {
    const s = await live();
    await addWord(s, 'angle', { ageSeconds: 120 });
    expect(await game.chat(msg('ANGLE !', ALICE, 'tw-a'))).toEqual({
      outcome: 'word_game_win',
    });
    expect(await wordsOf()).toEqual([]);
    expect(await gain(ALICE.id)).toBe(500);
    expect(
      await db.query(
        'select viewer_id, word, points, fast, golden, streak_after, message_id from word_game_finds',
      ),
    ).toEqual([
      {
        viewer_id: '1001',
        word: 'angle',
        points: 500,
        fast: false,
        golden: false,
        streak_after: 1,
        message_id: 'tw-a',
      },
    ]);
    expect(
      await db.query(
        'select words_points, combo, breaker, total, (ledger_id is not null) as paid from word_game_messages',
      ),
    ).toEqual([
      {
        words_points: 500,
        combo: 0,
        breaker: 0,
        total: 500,
        paid: true,
      },
    ]);
    expect(
      await db.query(
        "select kind, currency, amount, reason from lab_wallet_ledger where kind = 'word_game'",
      ),
    ).toEqual([
      {
        kind: 'word_game',
        currency: 'tokens',
        amount: 500,
        reason: `jdm:${CH}:tw-a`,
      },
    ]);
    const st = await steps();
    expect(
      st.map((x) => [x.idempotency_key, x.params.mode, x.params.text]),
    ).toEqual([
      [
        'jdm:msg:tw-a:find',
        'announce',
        '@Alice a trouvé le mot "angle" ! +500 Jetons',
      ],
    ]);
    expect(await channelRow()).toMatchObject({
      streak_holder_id: ALICE.id,
      streak_count: 1,
    });
  });

  it('several words: one credit of the total (combo included), one find per word', async () => {
    const s = await live();
    await addWord(s, 'angle', { ageSeconds: 10 });
    await addWord(s, 'requin', { ageSeconds: 200 });
    await game.chat(msg('requin et angle', ALICE, 'tw-b'));
    // angle: 10 s → ×3 = 1 500 ; requin: 200 s → 600 ; combo 500.
    expect(await gain(ALICE.id)).toBe(2600);
    expect(await count("lab_wallet_ledger where kind = 'word_game'")).toBe(1);
    expect(await count('word_game_finds')).toBe(2);
    expect((await texts())[0]).toEqual([
      'announce',
      // Newest word first (§ 12.3): angle (10 s) before requin (200 s).
      '🔥 @Alice a trouvé 2 mots: ⚡angle⚡, "requin" ! +2 600 Jetons (⚡ +500 combo) 🔥',
    ]);
    expect((await channelRow())!.streak_count).toBe(2);
  });

  it('the same message_id replayed changes nothing (no second credit, find, or message)', async () => {
    const s = await live();
    await addWord(s, 'angle');
    await game.chat(msg('angle', ALICE, 'tw-r'));
    const steps1 = await count('cmd_steps');
    expect(await game.chat(msg('angle', ALICE, 'tw-r'))).toEqual({
      outcome: 'word_game_win',
      replayed: true,
    });
    expect(await gain(ALICE.id)).toBe(500);
    expect(await count("lab_wallet_ledger where kind = 'word_game'")).toBe(1);
    expect(await count('word_game_finds')).toBe(1);
    expect(await count('word_game_messages')).toBe(1);
    expect(await count('cmd_steps')).toBe(steps1);
  });

  it('two messages for the same word: one winner only', async () => {
    const s = await live();
    await addWord(s, 'angle');
    const [a, b] = await Promise.all([
      game.chat(msg('angle', ALICE, 'tw-1x')),
      game.chat(msg('angle', BOB, 'tw-2x')),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(['ignored', 'word_game_win']);
    expect(await count('word_game_finds')).toBe(1);
    expect((await gain(ALICE.id)) + (await gain(BOB.id))).toBe(500);
  });

  it('streak: +1 per word of the same viewer; announced at 3 (variant 1), 2 s after the find', async () => {
    rngValue = 0;
    const s = await live();
    for (const w of ['angle', 'requin', 'tournis']) await addWord(s, w);
    await game.chat(msg('angle', ALICE, 'tw-s1'));
    await game.chat(msg('requin', ALICE, 'tw-s2'));
    expect(await count("cmd_steps where idempotency_key like '%:streak'")).toBe(
      0,
    );
    await game.chat(msg('tournis', ALICE, 'tw-s3'));
    expect(await channelRow()).toMatchObject({
      streak_holder_id: ALICE.id,
      streak_count: 3,
    });
    const streak = (await steps()).find(
      (x) => x.idempotency_key === 'jdm:msg:tw-s3:streak',
    )!;
    expect(streak.params).toEqual({
      mode: 'announce',
      text: '🔥 @Alice est EN FEU ! 3 mots d’affilée !',
    });
    expect(streak.available_at.getTime() - clock.now().getTime()).toBe(2000);
  });

  it('breaker: another viewer breaks a streak of 3 → +500 in the same credit, ONE announcement', async () => {
    const s = await live();
    for (const w of ['angle', 'requin', 'tournis', 'rouble'])
      await addWord(s, w);
    await game.chat(msg('angle', ALICE));
    await game.chat(msg('requin', ALICE));
    await game.chat(msg('tournis', ALICE));
    await game.chat(msg('rouble', BOB, 'tw-break'));
    expect(await gain(BOB.id)).toBe(600 + 500);
    expect(await channelRow()).toMatchObject({
      streak_holder_id: BOB.id,
      streak_count: 1,
    });
    const mine = (await steps()).filter((x) =>
      x.idempotency_key.startsWith('jdm:msg:tw-break'),
    );
    expect(
      mine.map((x) => [
        x.idempotency_key,
        x.params.text,
        x.available_at.getTime() - clock.now().getTime(),
      ]),
    ).toEqual([
      [
        'jdm:msg:tw-break:find',
        '@Bob a trouvé le mot "rouble" ! +600 Jetons et brise la streak de 3 d\'Alice 💥 +500 breaker !',
        0,
      ],
    ]);
    // The same message delivered again: no second credit, no second announcement.
    await game.chat(msg('rouble', BOB, 'tw-break'));
    expect(await gain(BOB.id)).toBe(600 + 500);
    expect(
      (await steps()).filter((x) =>
        x.idempotency_key.startsWith('jdm:msg:tw-break'),
      ),
    ).toHaveLength(1);
    expect(
      await db.query(
        'select broken_viewer_id, broken_count, breaker from word_game_messages where message_id = $1',
        ['tw-break'],
      ),
    ).toEqual([{ broken_viewer_id: ALICE.id, broken_count: 3, breaker: 500 }]);
  });

  it('a failure inside the transaction rolls everything back (words, wallet, finds, chat)', async () => {
    const s = await live();
    await addWord(s, 'angle');
    // A ledger row already holding the Wallet key makes the credit insert fail after the word update.
    await db.query(
      `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, actor, reason, created_at)
       values ($1, '9', 'word_game', 'tokens', 1, 'system', $2, $3)`,
      [CH, `jdm:${CH}:tw-boom`, T0],
    );
    await expect(game.chat(msg('angle', ALICE, 'tw-boom'))).rejects.toThrow();
    expect((await wordsOf()).map((w) => w.word)).toEqual(['angle']);
    expect(await gain(ALICE.id)).toBe(0);
    expect(await count('word_game_messages')).toBe(0);
    expect(await count('word_game_finds')).toBe(0);
    expect(await count('cmd_steps')).toBe(0);
    expect((await channelRow())!.streak_count).toBe(0);
  });
});

describe('a refused Wallet credit (rollback of the whole message)', () => {
  /** Lab balance cap just above the default wallet: a 500 credit is refused, 50 would pass. */
  const capTokens = (max: number) =>
    db.query(
      "update lab_currencies set max_balance = $1 where currency_id = 'tokens'",
      [max],
    );

  it('consumes no word, records nothing, keeps the streak, queues no announcement; a later retry pays once', async () => {
    const s = await live();
    await addWord(s, 'requin');
    await addWord(s, 'angle');
    await game.chat(msg('requin', ALICE, 'tw-ok')); // Alice holds a streak of 1
    const before = {
      steps: await count('cmd_steps'),
      gain: await gain(ALICE.id),
      ledger: await count("lab_wallet_ledger where kind = 'word_game'"),
    };
    await capTokens(DEFAULT_LAB_WALLET.tokens + 700);
    const failure = await game
      .chat(msg('angle', ALICE, 'tw-cap'))
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({ status: 503, code: 'credit_failed' });
    // Nothing of the message survives the rollback.
    expect((await wordsOf()).map((w) => w.word)).toEqual(['angle']);
    expect(await count("word_game_finds where message_id = 'tw-cap'")).toBe(0);
    expect(await count("word_game_messages where message_id = 'tw-cap'")).toBe(
      0,
    );
    expect(await channelRow()).toMatchObject({
      streak_holder_id: ALICE.id,
      streak_count: 1,
    });
    expect(await count('cmd_steps')).toBe(before.steps);
    expect(
      await count("cmd_steps where idempotency_key like 'jdm:msg:tw-cap:%'"),
    ).toBe(0);
    expect(await gain(ALICE.id)).toBe(before.gain);
    expect(await count("lab_wallet_ledger where kind = 'word_game'")).toBe(
      before.ledger,
    );
    // The same message is processed again once the credit can pass: one gain, one credit, announced once.
    await capTokens(1_000_000_000);
    expect(await game.chat(msg('angle', ALICE, 'tw-cap'))).toEqual({
      outcome: 'word_game_win',
    });
    expect(await game.chat(msg('angle', ALICE, 'tw-cap'))).toEqual({
      outcome: 'word_game_win',
      replayed: true,
    });
    expect(await gain(ALICE.id)).toBe(before.gain + 500);
    expect(
      await count(
        `lab_wallet_ledger where kind = 'word_game' and reason = 'jdm:${CH}:tw-cap'`,
      ),
    ).toBe(1);
    expect(await count("word_game_finds where message_id = 'tw-cap'")).toBe(1);
    expect(
      await count("cmd_steps where idempotency_key = 'jdm:msg:tw-cap:find'"),
    ).toBe(1);
    expect(await channelRow()).toMatchObject({
      streak_holder_id: ALICE.id,
      streak_count: 2,
    });
  });

  it('the Lab chat ingress answers 503 (transient: the adapter sends the message again)', async () => {
    const s = await live();
    await addWord(s, 'angle');
    await capTokens(DEFAULT_LAB_WALLET.tokens + 1);
    const e = await mappedModeration(() =>
      game.chat(msg('angle', ALICE, 'tw-503')),
    ).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toMatchObject({ status: 503, body: { error: 'credit_failed' } });
  });
});

describe('chat commands (§§ 11, 12.7, 12.8)', () => {
  it('!mots lists the shuffled active words (newest first), 1 s for the whole channel', async () => {
    const s = await live();
    await addWord(s, 'angle', { shuffled: 'lagne', ageSeconds: 300 });
    await addWord(s, 'requin', { shuffled: 'quiner', ageSeconds: 60 });
    expect(await game.chat(msg('!mots', ALICE, 'tw-m1'))).toEqual({
      outcome: 'word_game_command',
    });
    clock.advance(999);
    expect(await game.chat(msg('!MOTS', BOB, 'tw-m2'))).toEqual({
      outcome: 'ignored',
    });
    clock.advance(1);
    await game.chat(msg('!mots', BOB, 'tw-m3'));
    expect(
      (await steps()).map((x) => [
        x.idempotency_key,
        x.params.mode,
        x.params.text,
      ]),
    ).toEqual([
      ['jdm:cmd:tw-m1', 'announce', '🎲 Mots restants : quiner | lagne'],
      ['jdm:cmd:tw-m3', 'announce', '🎲 Mots restants : quiner | lagne'],
    ]);
  });

  it('!mots without word, and offline: « Aucun mot en cours ! »', async () => {
    expect(await game.chat(msg('!mots', ALICE, 'tw-o1'))).toEqual({
      outcome: 'word_game_command',
    });
    await live();
    clock.advance(SEC);
    await game.chat(msg('!mots', ALICE, 'tw-o2'));
    expect(await texts()).toEqual([
      ['announce', 'Aucun mot en cours !'],
      ['announce', 'Aucun mot en cours !'],
    ]);
  });

  it('!streakmot: none, 1 or 2, en feu', async () => {
    const s = await live();
    for (const w of ['angle', 'requin', 'tournis']) await addWord(s, w);
    await game.chat(msg('!streakmot', BOB, 'tw-k0'));
    await game.chat(msg('angle', ALICE));
    await game.chat(msg('!streakmot', BOB, 'tw-k1'));
    await game.chat(msg('requin', ALICE));
    await game.chat(msg('tournis', ALICE));
    await game.chat(msg('!streakmot', BOB, 'tw-k3'));
    const cmd = (await steps()).filter((x) =>
      x.idempotency_key.startsWith('jdm:cmd:'),
    );
    expect(cmd.map((x) => x.params.text)).toEqual([
      '🔥 Aucune streak du Jeu des mots en cours.',
      '🔥 @Alice est à 1 mots d’affilée.',
      '🔥 @Alice est actuellement EN FEU : 3 mots d’affilée !',
    ]);
  });
});

describe('Lab chat router (§ 20)', () => {
  it('a plain message only reaches the modules that read the whole chat', async () => {
    const seen: string[] = [];
    const router = new LabChatRouter([
      {
        name: 'raffle',
        chat: async (m) => (
          seen.push(`raffle:${m.text}`),
          { outcome: 'ignored' }
        ),
      },
      {
        name: 'commands',
        chat: async (m) => (
          seen.push(`commands:${m.text}`),
          { outcome: 'ignored' }
        ),
      },
      {
        name: 'word_game',
        plainText: true,
        chat: async (m) => (
          seen.push(`word_game:${m.text}`),
          { outcome: 'ignored' }
        ),
      },
    ]);
    await router.message(msg('bonjour'));
    await router.message(msg('  !join'));
    expect(seen).toEqual([
      'word_game:bonjour',
      'raffle:  !join',
      'commands:  !join',
      'word_game:  !join',
    ]);
  });
});

// The OBS sound is pushed, never polled: one event per COMMITTED winning message (after words, streak,
// Wallet credit and win are written), nothing for a replay, a rollback, a command or a new word.
describe('win events (OBS sound push)', () => {
  const events = () => {
    const seen: WordGameWinEvent[] = [];
    game.onWin((w) => seen.push(w));
    return seen;
  };

  it('a committed win → one event (channel, Twitch message id, time); a replay → none', async () => {
    const s = await live();
    await addWord(s, 'angle');
    const seen = events();
    await game.chat(msg('angle', ALICE, 'tw-win'));
    await game.chat(msg('angle', ALICE, 'tw-win'));
    expect(seen).toEqual([
      { channel_id: CH, message_id: 'tw-win', created_at: T0.toISOString() },
    ]);
  });

  it('a refused Wallet credit (rollback) → no event; the later successful retry → one', async () => {
    const s = await live();
    await addWord(s, 'angle');
    const seen = events();
    await db.query(
      "update lab_currencies set max_balance = $1 where currency_id = 'tokens'",
      [DEFAULT_LAB_WALLET.tokens + 1],
    );
    await expect(game.chat(msg('angle', ALICE, 'tw-cap'))).rejects.toThrow();
    expect(seen).toEqual([]);
    await db.query(
      "update lab_currencies set max_balance = $1 where currency_id = 'tokens'",
      [1_000_000_000],
    );
    await game.chat(msg('angle', ALICE, 'tw-cap'));
    expect(seen.map((w) => w.message_id)).toEqual(['tw-cap']);
  });

  it('!mots, !streakmot, « Nouveau mot », Arrêter / Reprendre and a plain miss → no event', async () => {
    const s = await live();
    await addWord(s, 'angle');
    const seen = events();
    await game.chat(msg('!mots'));
    await game.chat(msg('!streakmot'));
    await game.chat(msg('bonjour'));
    await game.act(CH, { action: 'new_word', request_id: randomUUID() });
    await game.act(CH, { action: 'stop' });
    await game.act(CH, { action: 'start' });
    expect(await count('cmd_steps')).toBeGreaterThan(0); // the commands did answer
    expect(seen).toEqual([]);
  });

  it('two winning messages → two events, in order', async () => {
    const s = await live();
    await addWord(s, 'angle');
    await addWord(s, 'requin');
    const seen = events();
    await game.chat(msg('angle', ALICE, 'tw-a'));
    await game.chat(msg('requin', BOB, 'tw-b'));
    expect(seen.map((w) => w.message_id)).toEqual(['tw-a', 'tw-b']);
  });

  it('the events stream: only this channel’s new wins, nothing replayed on connection, unsubscribed on close', async () => {
    const s = await live();
    await addWord(s, 'angle');
    await addWord(s, 'requin');
    await game.chat(msg('angle', ALICE, 'tw-old')); // before the connection: never sent
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://core');
      if (!serveWordGameEvents(game, req, res, url)) res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/v1/lab/word-game/${CH}/state`)).status).toBe(
        404,
      );
      const ac = new AbortController();
      const res = await fetch(`${base}/v1/lab/word-game/${CH}/events`, {
        signal: ac.signal,
      });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      let text = '';
      const until = async (needle: string) => {
        while (!text.includes(needle))
          text += new TextDecoder().decode((await reader.read()).value);
      };
      await until(': connected');
      game.onWin(() => {}); // another listener does not change the stream
      await game.chat(msg('requin', BOB, 'tw-new'));
      await until('tw-new');
      expect(text).not.toContain('tw-old');
      expect(text).toContain(
        `event: win\ndata: ${JSON.stringify({ channel_id: CH, message_id: 'tw-new', created_at: T0.toISOString() })}\n\n`,
      );
      ac.abort();
      await new Promise((r) => setTimeout(r, 50));
      expect(
        (game as unknown as { winListeners: Set<unknown> }).winListeners.size,
      ).toBe(1);
    } finally {
      server.close();
    }
  });
});
