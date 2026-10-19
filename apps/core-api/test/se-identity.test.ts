import { describe, expect, it } from 'vitest';
import {
  reconcileSeIdentities,
  summarizeSeIdentities,
} from '../src/wallet/se-identity.js';

// Twitch ID is the identity; only unambiguous evidence attributes a balance, everything else is quarantined.
const acc = (username: string, points = 100) => ({ username, points });
const cur = (pairs: [string, string][]) =>
  new Map(
    pairs.map(([login, id]) => [
      login,
      { id, created_at: '2020-01-01T00:00:00Z' },
    ]),
  );
const h = (id: string, login: string) => ({
  id,
  login,
  source: 'players',
  last_seen: '2026-07-01',
});

describe('SE identity reconciliation', () => {
  const rows = reconcileSeIdentities({
    accounts: [
      acc('alice'), // history = today
      acc('oldbob'), // Bob renamed to newbob, the old name is free
      acc('carol'), // only today
      acc('dave'), // name taken by someone else since
      acc('eve'), // two holders in the history
      acc('frank'), // historical holder deleted
      acc('ghost'), // nothing
      acc('jean pierre', 500), // display name
      acc('newbob', 50), // Bob's second SE account under the new name
    ],
    current: cur([
      ['alice', '1'],
      ['carol', '3'],
      ['dave', '99'],
      ['eve', '5'],
      ['newbob', '2'],
    ]),
    currentById: new Map([
      ['1', 'alice'],
      ['2', 'newbob'],
      ['4', 'dave_renamed'],
      ['5', 'eve'],
    ]),
    history: [
      h('1', 'Alice'),
      h('2', 'oldbob'),
      h('2', 'newbob'),
      h('4', 'dave'),
      h('5', 'eve'),
      h('6', 'eve'),
      h('7', 'frank'),
      h('x', 'carol'),
      h('0', 'alice'), // a legacy smoke test row: not a Twitch ID
    ],
  });
  const by = Object.fromEntries(rows.map((r) => [r.username, r]));

  it('attributes only unambiguous cases', () => {
    expect(by.alice).toMatchObject({
      status: 'confirmed',
      twitch_user_id: '1',
    });
    expect(by.oldbob).toMatchObject({ status: 'renamed', twitch_user_id: '2' });
    expect(by.carol).toMatchObject({
      status: 'current_only',
      twitch_user_id: '3',
    });
    expect(by.newbob).toMatchObject({
      status: 'confirmed',
      twitch_user_id: '2',
    });
  });

  it('never gives a reassigned, shared or vanished name to anybody', () => {
    expect(by.dave).toMatchObject({
      status: 'ambiguous',
      twitch_user_id: null,
      candidates: ['4', '99'],
    });
    expect(by.eve).toMatchObject({ status: 'ambiguous', twitch_user_id: null });
    expect(by.frank).toMatchObject({
      status: 'ambiguous',
      twitch_user_id: null,
    });
    expect(by.ghost).toMatchObject({
      status: 'unresolved',
      twitch_user_id: null,
    });
    expect(by['jean pierre']).toMatchObject({
      status: 'invalid',
      twitch_user_id: null,
    });
  });

  it('flags two SE accounts of one Twitch ID, and sums per status without names', () => {
    expect(by.oldbob!.shares_id_with).toEqual(['newbob']);
    const s = summarizeSeIdentities(rows);
    expect(s.total).toEqual({ accounts: 9, points: 1250 });
    expect(s.by_status.ambiguous).toEqual({ accounts: 3, points: 300 });
    expect(s.shared_ids).toBe(2);
    expect(JSON.stringify(s)).not.toMatch(/alice|bob/);
  });
});
