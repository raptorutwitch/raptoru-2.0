import { describe, expect, it } from 'vitest';
import {
  DUEL_RULES,
  duelText,
  parseDuelCommand,
  resolveDuelBet,
} from '../src/mini-games/duel-rules.js';

// Duel V1 — pure rules against docs/DUEL_PARITY.md.

describe('commands', () => {
  it('!duel <pseudo> [mise], « @ » and case accepted; !accept / !deny / !cancelduel', () => {
    expect(parseDuelCommand('!duel @Bob_42 500')).toEqual({
      kind: 'challenge',
      target: 'bob_42',
      arg: '500',
    });
    expect(parseDuelCommand('!DUEL bob')).toEqual({
      kind: 'challenge',
      target: 'bob',
      arg: null,
    });
    expect(parseDuelCommand('!accept')).toEqual({ kind: 'accept' });
    expect(parseDuelCommand('!deny maintenant')).toEqual({ kind: 'deny' });
    expect(parseDuelCommand('!cancelduel')).toEqual({ kind: 'cancel' });
  });

  it('a missing or impossible login → target null; other messages → null', () => {
    expect(parseDuelCommand('!duel')).toMatchObject({ target: null });
    expect(parseDuelCommand('!duel bob-le-fou 10')).toMatchObject({
      target: null,
    });
    expect(parseDuelCommand('!duel @')).toMatchObject({ target: null });
    expect(parseDuelCommand('duel bob')).toBeNull();
    expect(parseDuelCommand('!roulette 100')).toBeNull();
  });
});

describe('bets (§§ 2, 4)', () => {
  it('no bet = free duel (0); number, k, m, %, all of the challenger’s balance, rounded down', () => {
    expect(resolveDuelBet(null, 50)).toEqual({ amount: 0, capped: false });
    expect(resolveDuelBet('0', 50)).toEqual({ amount: 0, capped: false });
    expect(resolveDuelBet('500', 1000)).toEqual({ amount: 500, capped: false });
    expect(resolveDuelBet('1.5k', 2000)).toEqual({
      amount: 1500,
      capped: false,
    });
    expect(resolveDuelBet('50%', 45)).toEqual({ amount: 22, capped: false });
    expect(resolveDuelBet('ALL', 1234)).toEqual({
      amount: 1234,
      capped: false,
    });
  });

  it('above 100 000: brought back to 100 000 (StreamElements); exactly 100 000 is kept', () => {
    expect(DUEL_RULES.maxBet).toBe(100_000);
    expect(resolveDuelBet('100000', 500_000)).toEqual({
      amount: 100_000,
      capped: false,
    });
    expect(resolveDuelBet('1m', 500_000)).toEqual({
      amount: 100_000,
      capped: true,
    });
    expect(resolveDuelBet('all', 500_000)).toEqual({
      amount: 100_000,
      capped: true,
    });
    // Capped first, then checked against the balance.
    expect(resolveDuelBet('200000', 150_000)).toEqual({
      amount: 100_000,
      capped: true,
    });
  });

  it('refusals: invalid format, more than the challenger’s balance', () => {
    for (const a of ['abc', '-5', '0%', '101%', '1e3'])
      expect(resolveDuelBet(a, 1000)).toEqual({ refused: 'invalid' });
    expect(resolveDuelBet('1001', 1000)).toEqual({ refused: 'insufficient' });
  });

  it('cooldown 30 s, expiry 2 min', () => {
    expect(DUEL_RULES).toMatchObject({
      cooldownMs: 30_000,
      expiresMs: 120_000,
    });
  });
});

describe('texts (§ 5)', () => {
  it('the channel’s win / points won messages, verbatim, without /me', () => {
    expect(duelText('win', { winner: 'Alice', loser: 'Bob' })).toBe(
      'Alice a gagné contre Bob ! GG à Alice 💪 //',
    );
    expect(
      duelText('points_won', { winner: 'Bob', loser: 'Alice', points: 500 }),
    ).toBe('Bob a gagné le duel contre Alice | Bob remporte 500 Jetons !');
  });

  it('V1 texts: challenge (bet / free), refusals', () => {
    expect(
      duelText('challenge_bet', {
        target: 'Bob',
        challenger: 'Alice',
        points: 500,
      }),
    ).toBe(
      '@Bob, Alice te défie en duel pour 500 Jetons ! Tape !accept ou !deny (2 minutes).',
    );
    expect(
      duelText('challenge_free', { target: 'Bob', challenger: 'Alice' }),
    ).toBe('@Bob, Alice te défie en duel ! Tape !accept ou !deny (2 minutes).');
    expect(duelText('insufficient', { user: 'Alice' })).toBe(
      "@Alice, tu n'as pas assez de Jetons pour ce duel.",
    );
    for (const k of [
      'denied',
      'cancelled',
      'self',
      'pending',
      'target_busy',
      'unknown_target',
      'insufficient_at_accept',
    ] as const)
      expect(
        duelText(k, { user: 'A', target: 'B', challenger: 'C', points: 1 }),
      ).not.toMatch(/[{}$]|\/me/);
  });
});
