import {
  broadcasterMuteSeconds,
  cautionPrice,
  votekickMinutes,
  votekickVerdict,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';

// Votekick V2 rules = the SAMMI deck (VK_FINISH, VK_MUTE_BROADCASTER, CAUTION_START), one case per branch.
// `kick` includes the initiator's automatic KICK (SAMMI `vk_yes` starts at 1).

const heads = () => 0 as const; // the target loses the coin flip
const tails = () => 1 as const; // the initiator loses it
const v = (kick: number, save: number, targetSaved = false, coin = heads) =>
  votekickVerdict({ kick, save, targetSaved }, coin);

describe('votekick rules (SAMMI parity)', () => {
  it('minutes: round(5 + (n − 2) × 25 / 18) within [5, 30]', () => {
    expect([1, 2, 3, 4, 5, 6, 10, 19, 20, 50].map(votekickMinutes)).toEqual([
      5, 5, 6, 8, 9, 11, 16, 29, 30, 30,
    ]);
  });

  it('fewer than 3 votes (initiator included): no quorum, nobody sanctioned', () => {
    expect(v(1, 0)).toEqual({
      outcome: 'no_quorum',
      punished: null,
      minutes: 0,
      durationS: 0,
    });
    expect(v(1, 1).outcome).toBe('no_quorum');
    expect(v(2, 0).outcome).toBe('no_quorum');
  });

  it('KICK majority: the target, minutes of the KICK count', () => {
    expect(v(4, 2)).toEqual({
      outcome: 'target_timeout',
      punished: 'target',
      minutes: 8,
      durationS: 480,
    });
  });

  it('Perfect: no SAVE except the target’s own → double', () => {
    expect(v(3, 0)).toMatchObject({
      outcome: 'target_timeout_perfect',
      minutes: 12,
    });
    // The target's own SAVE does not spoil the Perfect…
    expect(v(5, 1, true)).toMatchObject({
      outcome: 'target_timeout_perfect',
      minutes: 18,
    });
    // …anybody else's does.
    expect(v(5, 1, false)).toMatchObject({
      outcome: 'target_timeout',
      minutes: 9,
    });
    // Capped twice: 30 × 2.
    expect(v(40, 0).minutes).toBe(60);
  });

  it('tie from 4 votes: coin flip, minutes of the KICK count (not doubled)', () => {
    expect(v(2, 2, false, heads)).toMatchObject({
      outcome: 'coinflip_target',
      punished: 'target',
      minutes: 5,
    });
    expect(v(5, 5, false, tails)).toMatchObject({
      outcome: 'coinflip_initiator',
      punished: 'initiator',
      minutes: 9,
    });
  });

  it('Backfire: only the initiator’s KICK against ≥ 2 SAVE → the initiator, double', () => {
    expect(v(1, 2)).toEqual({
      outcome: 'backfire',
      punished: 'initiator',
      minutes: 10,
      durationS: 600,
    });
    expect(v(1, 8)).toMatchObject({ outcome: 'backfire', minutes: 26 });
  });

  it('SAVE majority with other KICK votes: saved, the initiator is not sanctioned', () => {
    expect(v(2, 3)).toEqual({
      outcome: 'no_timeout',
      punished: null,
      minutes: 0,
      durationS: 0,
    });
  });

  it('broadcaster mute: min(300, max(30, timeout s / 12))', () => {
    expect(broadcasterMuteSeconds(5 * 60)).toBe(30);
    expect(broadcasterMuteSeconds(10 * 60)).toBe(50);
    expect(broadcasterMuteSeconds(30 * 60)).toBe(150);
    expect(broadcasterMuteSeconds(60 * 60)).toBe(300);
  });

  it('caution: 1 000 Jetons per started minute', () => {
    expect([0, 1, 59, 60, 61, 125].map(cautionPrice)).toEqual([
      0, 1000, 1000, 1000, 2000, 3000,
    ]);
  });
});
