import type { LabChatMessage } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  raffleReservedWords,
  withMiniGameWords,
} from '../src/commands/reserved.js';
import type { Db } from '../src/db/db.js';
import { DEFAULT_LAB_WALLET } from '../src/lab-moderation/store.js';
import { MiniGamesService } from '../src/mini-games/service.js';
import type { TwitchUser } from '../src/mini-games/twitch-login.js';
import { createTestDb, FakeClock } from './helpers.js';

// Duel V1 — the Core service against docs/DUEL_PARITY.md: Twitch IDs, challenge states, one transaction per
// acceptance (two wallets, stable lock order, no token created or lost), idempotency, concurrency, expiry.

const CH = '900600';
const T0 = new Date('2026-10-16T22:00:00Z');
const START = DEFAULT_LAB_WALLET.tokens; // 12 000

interface Viewer {
  id: string;
  login: string;
  name: string;
}
const ALICE: Viewer = { id: '3001', login: 'alice', name: 'Alice' };
const BOB: Viewer = { id: '3002', login: 'bob', name: 'Bob' };
const CARL: Viewer = { id: '3003', login: 'carl', name: 'Carl' };

let db: Db;
let clock: FakeClock;
let rolls: number[];
let helix: Map<string, TwitchUser>;
let helixDown: boolean;
let games: MiniGamesService;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  rolls = [];
  helix = new Map(
    [ALICE, BOB, CARL].map((v) => [
      v.login,
      { id: v.id, login: v.login, display_name: v.name },
    ]),
  );
  helixDown = false;
  // 0.1 → the challenger wins; 0.9 → the target wins (decided by the test only).
  games = new MiniGamesService(
    db,
    clock,
    () => rolls.shift() ?? 0.9,
    async (login) => {
      if (helixDown) throw new Error('twitch_users_503');
      return helix.get(login) ?? null;
    },
  );
  await games.setEnabled(CH, true);
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
const msg = (
  text: string,
  v: Viewer,
  id = `tw-${++n}`,
  source: LabChatMessage['source'] = 'twitch',
): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: { id: v.id, login: v.login, display_name: v.name, role: 'viewer' },
  source,
});
const say = (text: string, v: Viewer, id?: string) =>
  games.chat(msg(text, v, id));
const balance = async (v: Viewer) =>
  Number(
    (
      await db.query<{ tokens: string }>(
        'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
        [CH, v.id],
      )
    )[0]?.tokens ?? START,
  );
const setBalance = (v: Viewer, tokens: number) =>
  db.query(
    `insert into lab_wallets (channel_id, viewer_id, tokens, credits_tts, credits_soundboard, updated_at)
     values ($1, $2, $3, 1, 3, $4) on conflict (channel_id, viewer_id) do update set tokens = excluded.tokens`,
    [CH, v.id, tokens, T0],
  );
const duels = () =>
  db.query<{
    status: string;
    bet: number;
    challenger_id: string;
    target_id: string;
    target_login: string;
    winner_id: string | null;
  }>(
    'select status, bet, challenger_id, target_id, target_login, winner_id from mini_game_duels order by created_at',
  );
const texts = async () =>
  (
    await db.query<{ params: { text: string } }>(
      "select params from cmd_steps where origin = 'mini_game' order by seq_global",
    )
  ).map((s) => s.params.text);
const ledger = async () =>
  (
    await db.query<{ viewer_id: string; amount: string }>(
      "select viewer_id, amount from lab_wallet_ledger where kind = 'mini_game' order by id",
    )
  ).map((l) => [l.viewer_id, Number(l.amount)]);

describe('challenge (1, 11, 12)', () => {
  it('creates a pending challenge between two Twitch IDs; invitation; no token moves', async () => {
    expect(await say('!duel @Bob 500', ALICE)).toEqual({
      outcome: 'duel_challenged',
    });
    expect(await duels()).toEqual([
      {
        status: 'pending',
        bet: 500,
        challenger_id: ALICE.id,
        target_id: BOB.id,
        target_login: 'bob',
        winner_id: null,
      },
    ]);
    expect(await texts()).toEqual([
      '@Bob, Alice te défie en duel pour 500 Jetons ! Tape !accept ou !deny (2 minutes).',
    ]);
    expect(await ledger()).toEqual([]);
    expect(await balance(ALICE)).toBe(START);
  });

  it('against oneself: refused (same login, or same Twitch ID behind another login)', async () => {
    expect(await say('!duel alice 10', ALICE)).toEqual({
      outcome: 'duel_refused',
    });
    helix.set('alice_new', {
      id: ALICE.id,
      login: 'alice_new',
      display_name: 'Alice',
    });
    expect(await say('!duel alice_new 10', ALICE)).toEqual({
      outcome: 'duel_refused',
    });
    expect(await duels()).toEqual([]);
    expect(await texts()).toEqual([
      '@Alice, tu ne peux pas te défier toi-même.',
      '@Alice, tu ne peux pas te défier toi-même.',
    ]);
  });

  it('one outgoing challenge per viewer; a target already challenged is refused', async () => {
    await say('!duel bob 10', ALICE);
    expect(await say('!duel carl 10', ALICE)).toEqual({
      outcome: 'duel_refused',
    });
    expect(await say('!duel bob 10', CARL)).toEqual({
      outcome: 'duel_refused',
    });
    expect((await texts()).slice(1)).toEqual([
      "@Alice, tu as déjà un défi en attente (!cancelduel pour l'annuler).",
      '@Carl, Bob a déjà un défi en attente.',
    ]);
    expect(await duels()).toHaveLength(1);
  });

  it('no target, impossible login, invalid bet: ignored silently', async () => {
    for (const t of ['!duel', '!duel bob-x 10', '!duel bob abc'])
      expect(await say(t, ALICE)).toEqual({ outcome: 'ignored' });
    expect(await duels()).toEqual([]);
    expect(await texts()).toEqual([]);
  });
});

describe('identity (Twitch User ID, never the login)', () => {
  it('unknown login or Twitch unreachable: refused, nothing created', async () => {
    expect(await say('!duel inconnu 10', ALICE)).toEqual({
      outcome: 'duel_refused',
    });
    helixDown = true;
    expect(await say('!duel bob 10', ALICE)).toEqual({
      outcome: 'duel_refused',
    });
    expect(await duels()).toEqual([]);
    expect(await texts()).toEqual([
      '@Alice, impossible de trouver inconnu sur Twitch.',
      '@Alice, impossible de trouver bob sur Twitch.',
    ]);
  });

  it('a renamed target still owns the challenge: acceptance is checked on the Twitch ID', async () => {
    rolls = [0.9]; // Bob wins
    await say('!duel bob 100', ALICE);
    const renamed = { ...BOB, login: 'bob_renamed', name: 'BobRenamed' };
    expect(await say('!accept', renamed)).toEqual({ outcome: 'duel_resolved' });
    expect(await balance(BOB)).toBe(START + 100);
    // Somebody who took the old login cannot accept anything.
    await say('!duel carl 10', ALICE);
    expect(
      await say('!accept', { id: '9999', login: 'carl', name: 'Imposteur' }),
    ).toEqual({ outcome: 'ignored' });
  });

  it('simulator: its identities come first (never a real Twitch homonym); the real chat only uses Twitch', async () => {
    const labModo = { id: '900102', login: 'lab_modo', name: 'Modo Lab' };
    const labViewer = { id: '900101', login: 'lab_viewer', name: 'Viewer Lab' };
    helix.set('lab_modo', {
      id: '555',
      login: 'lab_modo',
      display_name: 'Real homonym',
    });
    await games.chat(msg('salut', labModo, 'sim-1', 'simulator')); // the simulator identity is learnt
    expect(
      await games.chat(msg('!duel @lab_modo', labViewer, 'sim-2', 'simulator')),
    ).toEqual({ outcome: 'duel_challenged' });
    expect((await duels())[0]).toMatchObject({ target_id: '900102' });
    // From the real chat, the same login resolves through Twitch only.
    await games.chat(msg('!cancelduel', labViewer, 'sim-3', 'simulator'));
    expect(await say('!duel lab_modo', CARL)).toEqual({
      outcome: 'duel_challenged',
    });
    expect((await duels()).at(-1)).toMatchObject({ target_id: '555' });
  });
});

describe('accept, deny, cancel, expiry (2–5)', () => {
  it('only the challenged viewer can accept; nobody else', async () => {
    await say('!duel bob 100', ALICE);
    expect(await say('!accept', CARL)).toEqual({ outcome: 'ignored' });
    expect(await say('!accept', ALICE)).toEqual({ outcome: 'ignored' });
    expect((await duels())[0]!.status).toBe('pending');
    expect(await say('!accept', BOB)).toEqual({ outcome: 'duel_resolved' });
  });

  it('deny: ended, announced, no token moves; the challenger cannot deny', async () => {
    await say('!duel bob 100', ALICE);
    expect(await say('!deny', ALICE)).toEqual({ outcome: 'ignored' });
    expect(await say('!deny', BOB)).toEqual({ outcome: 'duel_denied' });
    expect((await duels())[0]!.status).toBe('denied');
    expect((await texts()).at(-1)).toBe('Bob refuse le duel de Alice.');
    expect(await ledger()).toEqual([]);
    expect(await say('!accept', BOB)).toEqual({ outcome: 'ignored' });
  });

  it('cancel: only the challenger; ended, announced, no token moves', async () => {
    await say('!duel bob 100', ALICE);
    expect(await say('!cancelduel', BOB)).toEqual({ outcome: 'ignored' });
    expect(await say('!cancelduel', ALICE)).toEqual({
      outcome: 'duel_cancelled',
    });
    expect((await texts()).at(-1)).toBe('Alice annule son défi contre Bob.');
    expect(await ledger()).toEqual([]);
    expect(await say('!duel carl 10', ALICE)).toEqual({
      outcome: 'duel_challenged',
    });
  });

  it('expiry after 2 minutes: silent, no token moves, a new challenge is possible', async () => {
    await say('!duel bob 100', ALICE);
    clock.advance(119_999);
    expect((await duels())[0]!.status).toBe('pending');
    clock.advance(1);
    expect(await say('!accept', BOB)).toEqual({ outcome: 'ignored' });
    expect((await duels())[0]!.status).toBe('expired');
    expect(await texts()).toHaveLength(1); // the invitation only
    expect(await ledger()).toEqual([]);
    expect(await say('!duel bob 50', ALICE)).toEqual({
      outcome: 'duel_challenged',
    });
  });
});

describe('results and wallets (6–10)', () => {
  it('free duel: the channel’s win message, no token moves', async () => {
    rolls = [0.1];
    await say('!duel bob', ALICE);
    expect((await texts())[0]).toBe(
      '@Bob, Alice te défie en duel ! Tape !accept ou !deny (2 minutes).',
    );
    await say('!accept', BOB);
    expect((await texts()).at(-1)).toBe(
      'Alice a gagné contre Bob ! GG à Alice 💪 //',
    );
    expect(await ledger()).toEqual([]);
    expect([await balance(ALICE), await balance(BOB)]).toEqual([START, START]);
  });

  it('with a stake, challenger wins: the loser pays the winner, nothing created or lost', async () => {
    rolls = [0.1];
    await say('!duel bob 500', ALICE);
    await say('!accept', BOB);
    expect([await balance(ALICE), await balance(BOB)]).toEqual([
      START + 500,
      START - 500,
    ]);
    expect(await ledger()).toEqual([
      [BOB.id, -500],
      [ALICE.id, 500],
    ]);
    expect((await texts()).at(-1)).toBe(
      'Alice a gagné le duel contre Bob | Alice remporte 500 Jetons !',
    );
    expect((await duels())[0]).toMatchObject({
      status: 'resolved',
      winner_id: ALICE.id,
    });
  });

  it('with a stake, target wins', async () => {
    rolls = [0.9];
    await say('!duel bob 1k', ALICE);
    await say('!accept', BOB);
    expect([await balance(ALICE), await balance(BOB)]).toEqual([
      START - 1000,
      START + 1000,
    ]);
    expect((await texts()).at(-1)).toBe(
      'Bob a gagné le duel contre Alice | Bob remporte 1000 Jetons !',
    );
  });

  it('insufficient: the challenger is refused at once; the target at the acceptance (cancelled, nothing moves)', async () => {
    await setBalance(ALICE, 100);
    expect(await say('!duel bob 500', ALICE)).toEqual({
      outcome: 'duel_refused',
    });
    expect((await texts()).at(-1)).toBe(
      "@Alice, tu n'as pas assez de Jetons pour ce duel.",
    );
    await setBalance(ALICE, START);
    await setBalance(BOB, 200);
    await say('!duel bob 500', ALICE);
    expect(await say('!accept', BOB)).toEqual({ outcome: 'duel_refused' });
    expect((await duels()).at(-1)!.status).toBe('refused');
    expect((await texts()).at(-1)).toBe(
      "Duel annulé : Bob n'a pas assez de Jetons (500 Jetons).",
    );
    expect([await balance(ALICE), await balance(BOB)]).toEqual([START, 200]);
    expect(await ledger()).toEqual([]);
  });

  it('the challenger spent the stake meanwhile: refused at the acceptance', async () => {
    await say('!duel bob 500', ALICE);
    await setBalance(ALICE, 10);
    expect(await say('!accept', BOB)).toEqual({ outcome: 'duel_refused' });
    expect((await texts()).at(-1)).toBe(
      "Duel annulé : Alice n'a pas assez de Jetons (500 Jetons).",
    );
    expect(await ledger()).toEqual([]);
  });

  it('maximum 100 000; above it, brought back to 100 000', async () => {
    await setBalance(ALICE, 500_000);
    await setBalance(BOB, 500_000);
    await say('!duel bob 100000', ALICE);
    expect((await duels())[0]!.bet).toBe(100000);
    await say('!cancelduel', ALICE);
    rolls = [0.1];
    await say('!duel bob 250k', ALICE);
    expect((await duels())[1]!.bet).toBe(100000);
    await say('!accept', BOB);
    expect([await balance(ALICE), await balance(BOB)]).toEqual([
      600_000, 400_000,
    ]);
  });

  it('a win the Lab wallet could not hold: refused at the acceptance, nothing moves', async () => {
    await db.query(
      "update lab_currencies set max_balance = $1 where currency_id = 'tokens'",
      [START + 100],
    );
    await say('!duel bob 500', ALICE);
    expect(await say('!accept', BOB)).toEqual({ outcome: 'duel_refused' });
    expect(await ledger()).toEqual([]);
  });

  it('cooldown 30 s after a finished duel, for both participants (silent)', async () => {
    await say('!duel bob', ALICE);
    await say('!accept', BOB);
    clock.advance(29_999);
    expect(await say('!duel carl', ALICE)).toEqual({ outcome: 'ignored' });
    expect(await say('!duel carl', BOB)).toEqual({ outcome: 'ignored' });
    clock.advance(1);
    expect(await say('!duel carl', ALICE)).toEqual({
      outcome: 'duel_challenged',
    });
  });

  it('switch « Mini-jeux » OFF: nothing happens', async () => {
    await games.setEnabled(CH, false);
    expect(await say('!duel bob 10', ALICE)).toEqual({
      outcome: 'ignored',
      skipped: 'disabled',
    });
    expect(await duels()).toEqual([]);
  });
});

describe('idempotency, concurrency, rollback (13–15)', () => {
  it('resent messages: one challenge, one transfer, one answer each', async () => {
    rolls = [0.1, 0.1];
    await say('!duel bob 500', ALICE, 'tw-ch');
    expect(await say('!duel bob 500', ALICE, 'tw-ch')).toEqual({
      outcome: 'duel_challenged',
      replayed: true,
    });
    await say('!accept', BOB, 'tw-acc');
    expect(await say('!accept', BOB, 'tw-acc')).toEqual({
      outcome: 'ignored',
      replayed: true,
    });
    expect(await duels()).toHaveLength(1);
    expect(await ledger()).toHaveLength(2);
    expect(await balance(ALICE)).toBe(START + 500);
    expect(await texts()).toHaveLength(2);
  });

  it('two acceptances at once: one transfer only', async () => {
    rolls = [0.1];
    await say('!duel bob 500', ALICE);
    const out = await Promise.all([say('!accept', BOB), say('!accept', BOB)]);
    expect(out.map((o) => o.outcome).sort()).toEqual([
      'duel_resolved',
      'ignored',
    ]);
    expect(await ledger()).toHaveLength(2);
    expect([await balance(ALICE), await balance(BOB)]).toEqual([
      START + 500,
      START - 500,
    ]);
  });

  it('two crossed duels accepted at once (stable lock order): both settle, totals kept', async () => {
    rolls = [0.1, 0.1];
    await say('!duel bob 100', ALICE);
    await say('!duel alice 200', CARL);
    await Promise.all([say('!accept', BOB), say('!accept', ALICE)]);
    const total =
      (await balance(ALICE)) + (await balance(BOB)) + (await balance(CARL));
    expect(total).toBe(3 * START);
    expect((await duels()).map((d) => d.status)).toEqual([
      'resolved',
      'resolved',
    ]);
  });

  it('a wallet failure rolls the acceptance back; the retry gives the same result (never drawn again)', async () => {
    rolls = [0.9]; // Bob wins, fixed at the challenge
    await say('!duel bob 500', ALICE);
    const duelId = (
      await db.query<{ duel_id: string }>('select duel_id from mini_game_duels')
    )[0]!.duel_id;
    // A ledger row already holding the winner key makes the transfer fail after the debit.
    await db.query(
      `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, actor, reason, created_at)
       values ($1, '9', 'mini_game', 'tokens', 1, 'system', $2, $3)`,
      [CH, `mg:duel:${duelId}:winner`, T0],
    );
    await expect(say('!accept', BOB, 'tw-boom')).rejects.toThrow();
    expect([await balance(ALICE), await balance(BOB)]).toEqual([START, START]);
    expect((await duels())[0]!.status).toBe('pending');
    expect(await texts()).toHaveLength(1);
    await db.query("delete from lab_wallet_ledger where viewer_id = '9'");
    rolls = [0.1]; // a new draw would make Alice win: it must not happen
    expect(await say('!accept', BOB, 'tw-boom')).toEqual({
      outcome: 'duel_resolved',
    });
    expect([await balance(ALICE), await balance(BOB)]).toEqual([
      START - 500,
      START + 500,
    ]);
  });
});

describe('Commands V2 (16)', () => {
  it('!duel, !accept, !deny, !cancelduel are reserved by « Mini-jeux »', async () => {
    const words = await withMiniGameWords(
      raffleReservedWords({
        config: async () =>
          ({ join_commands: ['!join'], cancel_commands: [] }) as never,
      }),
    )(db, CH);
    for (const w of [
      'duel',
      'accept',
      'deny',
      'cancelduel',
      'roulette',
      'slots',
    ])
      expect(words).toContainEqual({ word: w, module: 'Mini-jeux' });
  });
});

describe('off live', () => {
  it('a challenge pending when the live ends cannot be accepted: no token moves, it expires; no new challenge off live; live again: playable', async () => {
    await setBalance(ALICE, 1000);
    await setBalance(BOB, 1000);
    await say('!duel bob 100', ALICE);
    expect((await duels())[0]!.status).toBe('pending');
    await endLive();
    expect(await say('!accept', BOB)).toEqual({
      outcome: 'ignored',
      skipped: 'offline',
    });
    expect(await say('!duel carl 50', ALICE)).toMatchObject({
      skipped: 'offline',
    });
    expect((await duels())[0]!.status).toBe('pending');
    expect(await duels()).toHaveLength(1);
    expect(await ledger()).toEqual([]);
    expect(await balance(ALICE)).toBe(1000);
    expect(await balance(BOB)).toBe(1000);
    expect((await texts()).at(-1)).toBe(
      '@Alice - les mini-jeux sont disponibles pendant le live.',
    );
    // Live again after the challenge expired: a new one plays normally.
    clock.advance(3 * 60_000);
    await goLive();
    expect(await say('!accept', BOB)).toEqual({ outcome: 'ignored' });
    expect(await say('!duel bob 100', ALICE)).toMatchObject({
      outcome: 'duel_challenged',
    });
  });
});
