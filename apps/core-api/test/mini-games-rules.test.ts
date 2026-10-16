import { describe, expect, it } from 'vitest';
import {
  draw,
  MINI_GAME_RULES,
  netGain,
  parseCommand,
  resolveBet,
  resultText,
  SLOT_SYMBOLS,
} from '../src/mini-games/rules.js';

// Roulette and Slot V1 — pure rules against docs/ROULETTE_SLOT_PARITY.md.

/** Plays back the given values as the random source. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('commands', () => {
  it('Roulette and Slot words, StreamElements aliases included, any case', () => {
    expect(parseCommand('!roulette 100')).toEqual({
      game: 'roulette',
      arg: '100',
    });
    expect(parseCommand('  !GAMBLE all ')).toEqual({
      game: 'roulette',
      arg: 'all',
    });
    for (const w of ['slots', 'slot', 'slotmachine', 'sm', 'smp'])
      expect(parseCommand(`!${w}`)).toEqual({ game: 'slot', arg: null });
    expect(parseCommand('roulette 100')).toBeNull();
    expect(parseCommand('!roulettes 100')).toBeNull();
    expect(parseCommand('!mots')).toBeNull();
  });
});

describe('bets (§ 4)', () => {
  it('number, %, k / m, rounded down', () => {
    expect(resolveBet('roulette', '100', 1000)).toEqual({
      amount: 100,
      allIn: false,
    });
    expect(resolveBet('roulette', '50%', 45)).toEqual({
      amount: 22,
      allIn: false,
    });
    expect(resolveBet('roulette', '1.5k', 2000)).toEqual({
      amount: 1500,
      allIn: false,
    });
    expect(resolveBet('roulette', '1,5K', 2000)).toEqual({
      amount: 1500,
      allIn: false,
    });
    expect(resolveBet('slot', '1m', 2_000_000)).toEqual({
      amount: 1_000_000,
      allIn: false,
    });
    expect(resolveBet('slot', '100%', 300)).toEqual({
      amount: 300,
      allIn: false,
    });
  });

  it('Roulette « all » = the whole balance, all-in; not for the Slot', () => {
    expect(resolveBet('roulette', 'ALL', 1234)).toEqual({
      amount: 1234,
      allIn: true,
    });
    expect(resolveBet('slot', 'all', 1234)).toEqual({ refused: 'invalid' });
  });

  it('without a bet: Roulette refused, Slot bets the minimum', () => {
    expect(resolveBet('roulette', null, 1000)).toEqual({ refused: 'invalid' });
    expect(resolveBet('slot', null, 1000)).toEqual({
      amount: 20,
      allIn: false,
    });
  });

  it('refusals: invalid, below 20, more than the balance', () => {
    for (const a of ['abc', '-5', '0%', '101%', '1e3', '10 jetons', '5x'])
      expect(resolveBet('roulette', a, 1000)).toEqual({ refused: 'invalid' });
    expect(resolveBet('roulette', '19', 1000)).toEqual({
      refused: 'below_min',
    });
    expect(resolveBet('roulette', '1%', 1000)).toEqual({
      refused: 'below_min',
    });
    expect(resolveBet('roulette', 'all', 10)).toEqual({ refused: 'below_min' });
    expect(resolveBet('slot', null, 10)).toEqual({ refused: 'insufficient' });
    expect(resolveBet('roulette', '1001', 1000)).toEqual({
      refused: 'insufficient',
    });
  });

  it('minimums and cooldowns as configured', () => {
    expect(MINI_GAME_RULES.roulette).toMatchObject({
      minBet: 20,
      cooldownMs: 10_000,
    });
    expect(MINI_GAME_RULES.slot).toMatchObject({
      minBet: 20,
      cooldownMs: 2_000,
    });
  });
});

describe('draws and gains (§§ 2, 3)', () => {
  it('Roulette: win below 0.5 → +1× the bet; loss → −the bet', () => {
    expect(draw('roulette', seq(0.4999))).toEqual({ won: true, symbols: null });
    expect(draw('roulette', seq(0.5))).toEqual({ won: false, symbols: null });
    expect(netGain('roulette', 100, true)).toBe(100);
    expect(netGain('roulette', 100, false)).toBe(-100);
  });

  it('Slot: 3 independent reels; only three identical win (+24×); two of a kind lose', () => {
    expect(draw('slot', seq(0, 0.1, 0.19))).toEqual({
      won: true,
      symbols: ['🍒', '🍒', '🍒'],
    });
    expect(draw('slot', seq(0, 0, 0.2))).toEqual({
      won: false,
      symbols: ['🍒', '🍒', '🍊'],
    });
    expect(draw('slot', seq(0.99, 0.99, 0.99)).symbols).toEqual([
      SLOT_SYMBOLS[4],
      SLOT_SYMBOLS[4],
      SLOT_SYMBOLS[4],
    ]);
    expect(netGain('slot', 20, true)).toBe(480);
    expect(netGain('slot', 20, false)).toBe(-20);
  });

  it('exact odds over every reel combination: Slot 5/125 = 1/25, theoretical return 100 %', () => {
    const n = SLOT_SYMBOLS.length;
    let wins = 0;
    let total = 0;
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++)
        for (let c = 0; c < n; c++) {
          const d = draw(
            'slot',
            seq((a + 0.5) / n, (b + 0.5) / n, (c + 0.5) / n),
          );
          if (d.won) wins++;
          total += netGain('slot', 1, d.won);
        }
    expect(wins).toBe(5);
    expect(n ** 3).toBe(125);
    expect(total).toBe(0); // 5 × (+24) + 120 × (−1)
  });

  it('cryptographic draws stay within the rules', async () => {
    const { cryptoRng } = await import('../src/mini-games/rules.js');
    let rouletteWins = 0;
    for (let i = 0; i < 4000; i++) {
      const r = cryptoRng();
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      if (draw('roulette', cryptoRng).won) rouletteWins++;
    }
    expect(rouletteWins).toBeGreaterThan(1700);
    expect(rouletteWins).toBeLessThan(2300);
  });
});

describe('texts (§ 5, StreamElements verbatim)', () => {
  const base = {
    user: 'Alice',
    bet: 100,
    delta: 100,
    balanceAfter: 1100,
    symbols: null,
    allIn: false,
  };
  it('Roulette: the four channel messages, {points} = balance after, ${pointsname} = Jetons, never /me', () => {
    const texts = [
      resultText({ ...base, game: 'roulette', won: true }),
      resultText({
        ...base,
        game: 'roulette',
        won: false,
        delta: -100,
        balanceAfter: 900,
      }),
      resultText({
        ...base,
        game: 'roulette',
        won: true,
        allIn: true,
        balanceAfter: 200,
      }),
      resultText({
        ...base,
        game: 'roulette',
        won: false,
        allIn: true,
        delta: -100,
        balanceAfter: 0,
      }),
    ];
    expect(texts).toEqual([
      'Alice gagne 100 Jetons à la roulette et possède maintenant 1100 Jetons ! 😎',
      'Alice perd 100 Jetons à la roulette et possède maintenant 900 Jetons ! ;)',
      '✨ Alice a eu uneuuuuh chatte et remporte 100 Jetons ✨ Alice a maintenant 200 Jetons raptor199Pog',
      'Alice a all in et a totu perdu de ses 100 Jetons raptor199Money Gros naze !',
    ]);
    for (const t of texts) {
      expect(t).not.toContain('/me');
      expect(t).not.toMatch(/[{}$]/);
    }
  });

  it('Slot: the channel messages, the three reels, {points} = the amount of the result', () => {
    expect(
      resultText({
        ...base,
        game: 'slot',
        won: true,
        bet: 20,
        delta: 480,
        symbols: ['🍒', '🍒', '🍒'],
      }),
    ).toBe('@Alice 🍒 🍒 🍒 tu remportes 480 Jetons ! 🍀');
    expect(
      resultText({
        ...base,
        game: 'slot',
        won: false,
        bet: 20,
        delta: -20,
        symbols: ['🍒', '🍊', '🍈'],
      }),
    ).toBe('@Alice 🍒 🍊 🍈 tu perds 20 Jetons 😳');
  });

  it('the channel reels, in order: cherries, orange, grapes, watermelon, melon', () => {
    expect(SLOT_SYMBOLS).toEqual(['🍒', '🍊', '🍇', '🍉', '🍈']);
  });
});
