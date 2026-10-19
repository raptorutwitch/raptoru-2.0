import { randomUUID } from 'node:crypto';
import type { LabChatMessage } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BONK_LAB_RULES,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import type { Db } from '../src/db/db.js';
import {
  CANONICAL_READY,
  EconomyActivationError,
  selectEconomy,
} from '../src/economy/activation.js';
import { coreWalletEconomy, labEconomy } from '../src/economy/economy.js';
import { MiniGamesService } from '../src/mini-games/service.js';
import type { TwitchUser } from '../src/mini-games/twitch-login.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { WordGameService } from '../src/word-game/service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Phase 2 lot 1: Jeu des mots, Roulette / Slot and Duel on the CANONICAL Core Wallet (Jetons = currency main), with
// their rules unchanged (cooldowns, bets, idempotency per message, all-or-nothing transactions). Test databases only.

const CH = '900800';
const T0 = new Date('2026-10-19T20:00:00Z');
const ALICE = { id: '5001', login: 'alice', name: 'Alice' };
const BOB = { id: '5002', login: 'bob', name: 'Bob' };

let db: Db;
let clock: FakeClock;
let wallet: WalletService;
let rolls: number[];
let games: MiniGamesService;
let words: WordGameService;

const helix = new Map<string, TwitchUser>(
  [ALICE, BOB].map((v) => [
    v.login,
    { id: v.id, login: v.login, display_name: v.name },
  ]),
);
const newGames = (on: Db = db) =>
  new MiniGamesService(
    on,
    clock,
    () => rolls.shift() ?? 0.9,
    async (login) => helix.get(login) ?? null,
    coreWalletEconomy(new WalletService(on)),
  );

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  wallet = new WalletService(db);
  rolls = [];
  games = newGames();
  await games.setEnabled(CH, true);
  words = new WordGameService(
    db,
    clock,
    () => 0.5,
    ['angle', 'requin'],
    coreWalletEconomy(wallet),
  );
});

let n = 0;
const msg = (text: string, v = ALICE, id = `tw-${++n}`): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: { id: v.id, login: v.login, display_name: v.name, role: 'viewer' },
  source: 'twitch',
});
const fund = (v: typeof ALICE, amount: number) =>
  wallet.credit({
    key: `fund-${v.id}-${randomUUID()}`,
    viewer: { twitchUserId: v.id, login: v.login, displayName: v.name },
    amount,
    source: 'test',
  });
const main = async (v: typeof ALICE) =>
  (await wallet.getWallet(v.id))?.balance ?? 0;
const count = async (sql: string) =>
  Number(
    (await db.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
  );
/** The Core ledger and the balances agree, and nothing touched the Lab wallet. */
const consistent = async () => {
  expect(
    await count(
      `wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
         where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`,
    ),
  ).toBe(0);
  expect(await count('lab_wallet_ledger')).toBe(0);
};

describe('Roulette / Slot on the canonical Wallet', () => {
  it('a lost and a won bet: exact Jetons, one Core ledger row per message, rules unchanged', async () => {
    await fund(ALICE, 1_000);
    expect(await games.chat(msg('!roulette 100'))).toMatchObject({
      outcome: 'mini_game_played',
    });
    expect(await main(ALICE)).toBe(900); // 0.9 → lost
    clock.advance(10 * 60_000);
    rolls = [0];
    await games.chat(msg('!roulette 100'));
    expect(await main(ALICE)).toBeGreaterThan(900); // won
    expect(await count("wallet_transactions where source = 'mini_game'")).toBe(
      2,
    );
    const plays = await db.query<{ ledger_id: number; balance_after: number }>(
      'select ledger_id, balance_after from mini_game_plays order by created_at',
    );
    for (const p of plays)
      expect(
        await count(`wallet_transactions where id = ${Number(p.ledger_id)}`),
      ).toBe(1);
    await consistent();
  });

  it('insufficient or empty wallet: refused silently as before, nothing written', async () => {
    expect(await games.chat(msg('!roulette 100'))).toMatchObject({
      outcome: 'ignored',
    });
    await fund(ALICE, 50);
    expect(await games.chat(msg('!roulette 100'))).toMatchObject({
      outcome: 'ignored',
    });
    expect(await count('mini_game_plays')).toBe(0);
    expect(await main(ALICE)).toBe(50);
  });

  it('the same message twice (Twitch redelivery, retry): one play, one movement', async () => {
    await fund(ALICE, 1_000);
    const m = msg('!roulette 100', ALICE, 'tw-dup');
    await games.chat(m);
    expect(await games.chat(m)).toMatchObject({
      outcome: 'mini_game_played',
      replayed: true,
    });
    expect(await main(ALICE)).toBe(900);
    expect(await count('mini_game_plays')).toBe(1);
  });

  it('cooldown kept: a second game too soon is ignored, no money moves', async () => {
    await fund(ALICE, 1_000);
    await games.chat(msg('!roulette 20'));
    expect(await games.chat(msg('!roulette 20'))).toMatchObject({
      outcome: 'ignored',
      skipped: 'cooldown',
    });
    expect(await main(ALICE)).toBe(980);
  });

  it('a crash after the payment, before the play is recorded: nothing kept; the retry plays once', async () => {
    await fund(ALICE, 1_000);
    const crashing: Db = {
      ...db,
      tx: (fn) =>
        db.tx((q) =>
          fn({
            query: (sql, params) => {
              if (/insert into mini_game_plays/.test(sql))
                throw new Error('connection lost');
              return q.query(sql, params);
            },
          }),
        ),
    };
    const m = msg('!roulette 100', ALICE, 'tw-crash');
    await expect(newGames(crashing).chat(m)).rejects.toThrow('connection lost');
    expect(await main(ALICE)).toBe(1_000);
    // Restart: a new service instance, the same message redelivered.
    await newGames().chat(m);
    expect(await main(ALICE)).toBe(900);
    expect(await count('mini_game_plays')).toBe(1);
    await consistent();
  });
});

describe('Duel on the canonical Wallet', () => {
  it('accepted: loser → winner exactly, sum zero, two Core ledger rows; accepting again moves nothing', async () => {
    await fund(ALICE, 500);
    await fund(BOB, 500);
    rolls = [0.1]; // the challenger wins
    expect(await games.chat(msg('!duel @bob 200', ALICE))).toMatchObject({
      outcome: 'duel_challenged',
    });
    const accept = msg('!accept', BOB, 'tw-accept');
    expect(await games.chat(accept)).toMatchObject({
      outcome: 'duel_resolved',
    });
    await games.chat(accept);
    expect([await main(ALICE), await main(BOB)]).toEqual([700, 300]);
    expect(
      await count(
        "wallet_transactions where kind in ('transfer_out', 'transfer_in')",
      ),
    ).toBe(2);
    await consistent();
  });

  it('the loser cannot pay at acceptance: refused, nothing moves', async () => {
    await fund(ALICE, 500);
    await fund(BOB, 500);
    rolls = [0.9]; // the target wins (Alice would pay)
    await games.chat(msg('!duel @bob 400', ALICE));
    await wallet.spend({
      key: 'drain',
      viewer: { twitchUserId: ALICE.id, login: 'alice', displayName: 'Alice' },
      amount: 300,
      source: 'test',
    });
    expect(await games.chat(msg('!accept', BOB))).toMatchObject({
      outcome: 'duel_refused',
    });
    expect([await main(ALICE), await main(BOB)]).toEqual([200, 500]);
  });
});

describe('Jeu des mots on the canonical Wallet', () => {
  const live = async () => {
    const id = randomUUID();
    await db.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by) values ($1, $2, $3, 'simulated', 'test')`,
      [id, CH, clock.now()],
    );
    await words.tick();
    await db.query(
      `insert into word_game_words (occurrence_id, channel_id, session_id, word, shuffled, golden, source, status, created_at)
       values ($1, $2, $3, 'angle', 'elgna', false, 'cycle', 'active', $4)`,
      [
        `occ-${randomUUID()}`,
        CH,
        id,
        new Date(clock.now().getTime() - 120_000),
      ],
    );
  };

  it('a found word: ONE Core credit of the gain (500), once even if the message comes back', async () => {
    await live();
    const m = msg('ANGLE !', ALICE, 'tw-word');
    expect(await words.chat(m)).toEqual({ outcome: 'word_game_win' });
    expect(await words.chat(m)).toMatchObject({
      outcome: 'word_game_win',
      replayed: true,
    });
    expect(await main(ALICE)).toBe(500);
    expect(
      await count(
        "wallet_transactions where source = 'word_game' and kind = 'reward'",
      ),
    ).toBe(1);
    await consistent();
  });

  it('the Jetons currency unavailable: the whole message is refused (503) and the word stays findable', async () => {
    await live();
    await db.query("update currencies set active = false where id = 'main'");
    await expect(words.chat(msg('angle', ALICE))).rejects.toMatchObject({
      status: 503,
      code: 'credit_failed',
    });
    expect(await count("word_game_words where status = 'active'")).toBe(1);
    await db.query("update currencies set active = true where id = 'main'");
    expect(await words.chat(msg('angle', ALICE))).toEqual({
      outcome: 'word_game_win',
    });
    expect(await main(ALICE)).toBe(500);
  });
});

describe('several modules on one canonical wallet', () => {
  it('Bonk debits, a roulette and a found word on the same Jetons: one balance, one ledger, nothing lost', async () => {
    await fund(ALICE, 2_000);
    const bonk = new BonkLabService(
      db,
      clock,
      null,
      null,
      coreWalletEconomy(wallet),
    );
    await bonk.heartbeat({
      studio_instance_id: 'studio-A',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    await bonk.admit({
      idempotency_key: 'bonk-1',
      channel_id: CH,
      viewer: { id: ALICE.id, display_name: ALICE.name },
      lab_session_id: 'lab-1',
      emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
    });
    await games.chat(msg('!roulette 100'));
    const id = randomUUID();
    await db.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by) values ($1, $2, $3, 'simulated', 'test')`,
      [id, CH, clock.now()],
    );
    await words.tick();
    await db.query(
      `insert into word_game_words (occurrence_id, channel_id, session_id, word, shuffled, golden, source, status, created_at)
       values ('occ-x', $1, $2, 'angle', 'elgna', false, 'cycle', 'active', $3)`,
      [CH, id, new Date(clock.now().getTime() - 120_000)],
    );
    await words.chat(msg('angle'));
    expect(await main(ALICE)).toBe(
      2_000 - BONK_LAB_RULES.simulatedCost - 100 + 500,
    );
    expect(
      (
        await db.query<{ source: string }>(
          "select source from wallet_transactions where twitch_user_id = $1 and source <> 'test' order by id",
          [ALICE.id],
        )
      ).map((r) => r.source),
    ).toEqual(['bonk', 'mini_game', 'word_game']);
    await consistent();
  });
});

describe('activation (one decision point, never automatic)', () => {
  it('lab by default; canonical refused without an opening import and for a module not proven', async () => {
    expect(
      await selectEconomy({
        mode: 'lab',
        q: db,
        wallet,
        modules: ['word_game', 'raffle'],
      }),
    ).toBe(labEconomy);
    await expect(
      selectEconomy({
        mode: 'canonical',
        q: db,
        wallet,
        modules: ['word_game', 'mini_games'],
      }),
    ).rejects.toThrow(/aucun import d'ouverture/);
    await db.query(
      `insert into wallet_imports (id, currency_id, source, cutoff, snapshot_sha256, accounts, total) values ('se-x', 'main', 'test', now(), $1, 0, 0)`,
      ['a'.repeat(64)],
    );
    expect(
      await selectEconomy({
        mode: 'canonical',
        q: db,
        wallet,
        modules: ['word_game', 'mini_games', 'bonk'],
      }),
    ).not.toBe(labEconomy);
    for (const m of [
      'soundboard',
      'tts',
      'raffle',
      'moderation_wallet',
      'inconnu',
    ]) {
      await expect(
        selectEconomy({
          mode: 'canonical',
          q: db,
          wallet,
          modules: ['word_game', m],
        }),
      ).rejects.toBeInstanceOf(EconomyActivationError);
      expect(CANONICAL_READY[m]).not.toBe(true);
    }
  });
});
