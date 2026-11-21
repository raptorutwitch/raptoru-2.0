import { describe, expect, it } from 'vitest';
import {
  mainResult,
  sessionSummary,
} from '../extension/shared/casino/blackjack.js';

// Post-live audit BJ-01/BJ-07 (21/11/2026): after a Split, two hands can settle with opposite verdicts for a net
// that falls back to zero. The old code picked `push` whenever the net was zero and the verdicts weren't all
// equal, so the screen said "Égalité" — exactly the misleading label the audit caught on a bust + 21 split.

describe('mainResult — a seat’s main-hand result, Split included', () => {
  const hand = (verdict, stake, payout) => ({ verdict, stake, payout });

  it('a single hand: the kind is just its own verdict', () => {
    expect(mainResult({ hands: [hand('win', 100, 200)] })).toMatchObject({
      kind: 'win',
      net: 100,
    });
    expect(mainResult({ hands: [hand('push', 100, 100)] })).toMatchObject({
      kind: 'push',
      net: 0,
    });
    expect(mainResult({ hands: [hand('bust', 100, 0)] })).toMatchObject({
      kind: 'bust',
      net: -100,
    });
  });

  it('a Split, both hands the same verdict: that verdict, not "mixed"', () => {
    expect(
      mainResult({ hands: [hand('win', 100, 200), hand('win', 100, 200)] }),
    ).toMatchObject({ kind: 'win', net: 200 });
    expect(
      mainResult({ hands: [hand('lose', 100, 0), hand('lose', 100, 0)] }),
    ).toMatchObject({ kind: 'lose', net: -200 });
  });

  it('a Split, opposite verdicts, net zero: "mixed" — never "push" (BJ-07)', () => {
    const r = mainResult({
      hands: [hand('lose', 100, 0), hand('win', 100, 200)],
    });
    expect(r.kind).toBe('mixed');
    expect(r.net).toBe(0);
  });

  it('a Split, opposite verdicts, net not zero: still "mixed" (the net alone must not imply a real push)', () => {
    const r = mainResult({
      hands: [hand('bust', 100, 0), hand('blackjack', 100, 250)],
    });
    expect(r.kind).toBe('mixed');
    expect(r.net).toBe(50); // 250 paid − 200 staked (both hands)
  });

  it('even money after a Split aces natural: "even" wins over "mixed"', () => {
    const r = mainResult({
      hands: [hand('even', 100, 200), hand('lose', 100, 0)],
    });
    expect(r.kind).toBe('even');
  });

  it('no hand yet (spectator, or before the deal): neutral, net zero', () => {
    expect(mainResult({ hands: [] })).toMatchObject({
      kind: undefined,
      net: 0,
      stake: 0,
      paid: 0,
    });
  });
});

describe('sessionSummary — "Mes manches" (A9): a local counter, never a Wallet operation', () => {
  const round = (net, agoMs) => ({
    net,
    created_at: new Date(1_000_000 - agoMs).toISOString(),
  });

  it('everything since resetAt = 0: the full history', () => {
    const rounds = [round(100, 0), round(-40, 1000), round(20, 2000)];
    expect(sessionSummary(rounds, 0)).toEqual({ count: 3, net: 80 });
  });

  it('a reset point in the middle: only the rounds played after it count', () => {
    const rounds = [round(100, 0), round(-40, 1000), round(20, 5000)]; // the last one before the reset
    const resetAt = 1_000_000 - 3000; // between the 2nd and 3rd round
    expect(sessionSummary(rounds, resetAt)).toEqual({ count: 2, net: 60 });
  });

  it('a reset right now: zero rounds, zero net — the Wallet is never touched by this (no round is deleted)', () => {
    const rounds = [round(500, 0)];
    expect(sessionSummary(rounds, Date.now() + 60_000)).toEqual({
      count: 0,
      net: 0,
    });
    expect(rounds).toHaveLength(1); // the source history is untouched
  });
});
