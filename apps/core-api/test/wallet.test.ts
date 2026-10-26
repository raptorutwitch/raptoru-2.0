import { describe, expect, it } from 'vitest';
import { applyMultiplier, loyaltyMultiplier } from '../src/wallet/loyalty.js';
import {
  WalletIdempotencyError,
  WalletInputError,
} from '../src/wallet/wallet-service.js';
import { count, HOUR, paris, setup, viewer, type TestCore } from './helpers.js';

const alice = viewer('1001', 'Alice');
const bob = viewer('1002', 'Bob');
const carol = viewer('1003', 'Carol');

let n = 0;
const key = () => `k-${++n}`;

async function give(core: TestCore, v = alice, amount = 1000) {
  return core.wallet.wallet.credit({
    key: key(),
    viewer: v,
    amount,
    source: 'test',
  });
}

async function balance(core: TestCore, id: string, currency?: string) {
  return (await core.wallet.wallet.getWallet(id, currency))!.balance;
}

/** Invariant: every balance equals the sum of its ledger rows. */
async function assertLedgerConsistent(core: TestCore) {
  const drift = await core.db.query(
    `select w.twitch_user_id, w.currency_id, w.balance, coalesce(sum(t.amount), 0)::bigint as ledger
     from wallets w left join wallet_transactions t using (twitch_user_id, currency_id)
     group by w.twitch_user_id, w.currency_id, w.balance having w.balance <> coalesce(sum(t.amount), 0)`,
  );
  expect(drift).toEqual([]);
}

describe('currencies', () => {
  it('has a primary currency and supports secondary ones and a global rename', async () => {
    const core = await setup();
    expect(await core.wallet.currencies.get()).toMatchObject({
      id: 'main',
      singular: 'Jeton',
      plural: 'Jetons',
      isPrimary: true,
    });

    await core.wallet.currencies.create({
      id: 'halloween_2026',
      singular: 'Âme',
      plural: 'Âmes',
      icon: '👻',
      active: true,
      isPrimary: false,
      transferable: false,
      allowNegativeAdmin: false,
    });
    // Crédits TTS / Soundboard: installed secondary currencies (phase 2 lot 4).
    expect((await core.wallet.currencies.list()).map((c) => c.id)).toEqual([
      'main',
      'credits_soundboard',
      'credits_tts',
      'halloween_2026',
    ]);

    await core.wallet.currencies.update('main', {
      singular: 'Bonbon',
      plural: 'Bonbons',
    });
    await give(core, alice, 12430);
    expect((await core.wallet.chat.balance({ viewer: alice })).message).toBe(
      '@Alice - 12 430 Bonbons',
    );
  });

  it('!solde @Pseudo: the target’s balance, answered to whoever asked; asking for oneself = own reply', async () => {
    const core = await setup();
    const bob = { twitchUserId: '9002', login: 'bob', displayName: 'Bob' };
    await give(core, alice, 300);
    await give(core, bob, 4500);
    expect(
      (await core.wallet.chat.balance({ viewer: bob, requester: alice }))
        .message,
    ).toBe('@Alice - @Bob a 4 500 Jetons');
    expect(
      (await core.wallet.chat.balance({ viewer: alice, requester: bob }))
        .message,
    ).toBe('@Bob - @Alice a 300 Jetons');
    expect(
      (await core.wallet.chat.balance({ viewer: alice, requester: alice }))
        .message,
    ).toBe('@Alice - 300 Jetons');
    // Read-only: no balance changed.
    expect((await core.wallet.chat.balance({ viewer: bob })).message).toBe(
      '@Bob - 4 500 Jetons',
    );
  });

  it('switching the primary currency keeps a single primary', async () => {
    const core = await setup();
    await core.wallet.currencies.create({
      id: 'credits',
      singular: 'Crédit',
      plural: 'Crédits',
      icon: null,
      active: true,
      isPrimary: true,
      transferable: true,
      allowNegativeAdmin: true,
    });
    expect(
      (await core.wallet.currencies.list())
        .filter((c) => c.isPrimary)
        .map((c) => c.id),
    ).toEqual(['credits']);
  });
});

describe('balances, credits and spends', () => {
  it('an unknown wallet reads as 0 without creating anything', async () => {
    const core = await setup();
    expect(await core.wallet.wallet.getWallet('9999')).toMatchObject({
      balance: 0,
      position: null,
      inDebt: false,
    });
    expect(await count(core.db, 'wallets')).toBe(0);
  });

  it('credits and spends, refuses an insufficient spend without any ledger row', async () => {
    const core = await setup();
    await give(core, alice, 1000);
    expect(
      await core.wallet.wallet.spend({
        key: key(),
        viewer: alice,
        amount: 400,
        source: 'bonk',
      }),
    ).toMatchObject({
      status: 'applied',
      balances: [{ twitchUserId: '1001', balance: 600 }],
    });
    const refused = await core.wallet.wallet.spend({
      key: key(),
      viewer: alice,
      amount: 601,
      source: 'bonk',
    });
    expect(refused).toMatchObject({
      status: 'rejected',
      rejection: 'insufficient_funds',
    });
    expect(await balance(core, '1001')).toBe(600);
    expect(await count(core.db, 'wallet_transactions')).toBe(2);
  });

  it('rejects non-integer, zero or negative amounts', async () => {
    const core = await setup();
    for (const amount of [0, -5, 1.5]) {
      await expect(
        core.wallet.wallet.credit({
          key: key(),
          viewer: alice,
          amount,
          source: 't',
        }),
      ).rejects.toBeInstanceOf(WalletInputError);
    }
  });

  it('two simultaneous spends on the same wallet: only what the balance allows', async () => {
    const core = await setup();
    await give(core, alice, 1000);
    const results = await Promise.all(
      [1, 2].map(() =>
        core.wallet.wallet.spend({
          key: key(),
          viewer: alice,
          amount: 700,
          source: 'shop',
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      'applied',
      'rejected',
    ]);
    expect(await balance(core, '1001')).toBe(300);
    await assertLedgerConsistent(core);
  });

  it('simultaneous credits are all kept', async () => {
    const core = await setup();
    await Promise.all(Array.from({ length: 20 }, () => give(core, alice, 50)));
    expect(await balance(core, '1001')).toBe(1000);
    await assertLedgerConsistent(core);
  });
});

describe('idempotency', () => {
  it('a retry returns the original outcome without a second effect', async () => {
    const core = await setup();
    const first = await core.wallet.wallet.credit({
      key: 'bonk:42',
      viewer: alice,
      amount: 100,
      source: 'bonk',
    });
    const retry = await core.wallet.wallet.credit({
      key: 'bonk:42',
      viewer: alice,
      amount: 100,
      source: 'bonk',
    });
    expect(retry).toEqual({ ...first, replayed: true });
    expect(await balance(core, '1001')).toBe(100);

    // A refused operation is replayed as refused too.
    const refusal = await core.wallet.wallet.spend({
      key: 'spend:1',
      viewer: bob,
      amount: 5,
      source: 't',
    });
    await give(core, bob, 100);
    expect(
      await core.wallet.wallet.spend({
        key: 'spend:1',
        viewer: bob,
        amount: 5,
        source: 't',
      }),
    ).toEqual({ ...refusal, replayed: true });
  });

  it('the same key with a different payload is refused', async () => {
    const core = await setup();
    await core.wallet.wallet.credit({
      key: 'same',
      viewer: alice,
      amount: 100,
      source: 'x',
    });
    await expect(
      core.wallet.wallet.credit({
        key: 'same',
        viewer: alice,
        amount: 999,
        source: 'x',
      }),
    ).rejects.toBeInstanceOf(WalletIdempotencyError);
    expect(await balance(core, '1001')).toBe(100);
  });

  it('concurrent duplicates of the same request apply once', async () => {
    const core = await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        core.wallet.wallet.credit({
          key: 'dup',
          viewer: alice,
          amount: 10,
          source: 'x',
        }),
      ),
    );
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balance(core, '1001')).toBe(10);
  });
});

describe('transfers', () => {
  it('moves funds atomically, refuses self, excess and debt', async () => {
    const core = await setup();
    await give(core, alice, 1000);
    expect(
      await core.wallet.wallet.transfer({
        key: key(),
        from: alice,
        to: bob,
        amount: 300,
        source: 'test',
      }),
    ).toMatchObject({
      status: 'applied',
      balances: expect.arrayContaining([
        { twitchUserId: '1001', balance: 700 },
        { twitchUserId: '1002', balance: 300 },
      ]),
    });
    expect(
      (
        await core.wallet.wallet.transfer({
          key: key(),
          from: alice,
          to: alice,
          amount: 1,
          source: 't',
        })
      ).rejection,
    ).toBe('self_transfer');
    expect(
      (
        await core.wallet.wallet.transfer({
          key: key(),
          from: bob,
          to: alice,
          amount: 301,
          source: 't',
        })
      ).rejection,
    ).toBe('insufficient_funds');
    await assertLedgerConsistent(core);
  });

  it('crossed simultaneous transfers (A→B and B→A) never deadlock nor lose funds', async () => {
    const core = await setup();
    await give(core, alice, 500);
    await give(core, bob, 500);
    await Promise.all([
      core.wallet.wallet.transfer({
        key: key(),
        from: alice,
        to: bob,
        amount: 200,
        source: 't',
      }),
      core.wallet.wallet.transfer({
        key: key(),
        from: bob,
        to: alice,
        amount: 100,
        source: 't',
      }),
    ]);
    expect([await balance(core, '1001'), await balance(core, '1002')]).toEqual([
      400, 600,
    ]);
    await assertLedgerConsistent(core);
  });

  it('10 concurrent transfers from one wallet never overdraw it', async () => {
    const core = await setup();
    await give(core, alice, 550);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        core.wallet.wallet.transfer({
          key: key(),
          from: alice,
          to: i % 2 ? bob : carol,
          amount: 100,
          source: 't',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'applied')).toHaveLength(5);
    expect(await balance(core, '1001')).toBe(50);
    expect((await balance(core, '1002')) + (await balance(core, '1003'))).toBe(
      500,
    );
    await assertLedgerConsistent(core);
  });

  it('a transfer during a spend keeps the wallet consistent', async () => {
    const core = await setup();
    await give(core, alice, 1000);
    const [spend, transfer] = await Promise.all([
      core.wallet.wallet.spend({
        key: key(),
        viewer: alice,
        amount: 600,
        source: 'tts',
      }),
      core.wallet.wallet.transfer({
        key: key(),
        from: alice,
        to: bob,
        amount: 600,
        source: 't',
      }),
    ]);
    expect([spend.status, transfer.status].sort()).toEqual([
      'applied',
      'rejected',
    ]);
    expect(await balance(core, '1001')).toBe(400);
    await assertLedgerConsistent(core);
  });

  it('transfers never count as earnings (a round trip creates nothing)', async () => {
    const core = await setup();
    await give(core, alice, 1000);
    for (let i = 0; i < 3; i++) {
      await core.wallet.wallet.transfer({
        key: key(),
        from: alice,
        to: bob,
        amount: 1000,
        source: 't',
      });
      await core.wallet.wallet.transfer({
        key: key(),
        from: bob,
        to: alice,
        amount: 1000,
        source: 't',
      });
    }
    await core.wallet.wallet.spend({
      key: key(),
      viewer: alice,
      amount: 250,
      source: 'bonk',
    });
    expect((await core.wallet.wallet.getWallet('1001'))!.stats).toMatchObject({
      earned: 1000,
      spent: 250,
      receivedFromTransfers: 3000,
      sentInTransfers: 3000,
    });
    expect((await core.wallet.wallet.getWallet('1002'))!.stats.earned).toBe(0);
  });

  it('respects non-transferable and inactive currencies, and isolates currencies', async () => {
    const core = await setup();
    await core.wallet.currencies.create({
      id: 'souls',
      singular: 'Âme',
      plural: 'Âmes',
      icon: null,
      active: true,
      isPrimary: false,
      transferable: false,
      allowNegativeAdmin: false,
    });
    await core.wallet.wallet.credit({
      key: key(),
      viewer: alice,
      amount: 50,
      source: 't',
      currencyId: 'souls',
    });
    expect(
      (
        await core.wallet.wallet.transfer({
          key: key(),
          from: alice,
          to: bob,
          amount: 10,
          source: 't',
          currencyId: 'souls',
        })
      ).rejection,
    ).toBe('currency_not_transferable');
    expect(await balance(core, '1001', 'main')).toBe(0);
    expect(await balance(core, '1001', 'souls')).toBe(50);

    await core.wallet.currencies.update('souls', { active: false });
    expect(
      (
        await core.wallet.wallet.credit({
          key: key(),
          viewer: alice,
          amount: 1,
          source: 't',
          currencyId: 'souls',
        })
      ).rejection,
    ).toBe('currency_inactive');
    expect(
      (
        await core.wallet.wallet.credit({
          key: key(),
          viewer: alice,
          amount: 1,
          source: 't',
          currencyId: 'nope',
        })
      ).rejection,
    ).toBe('currency_not_found');
  });
});

describe('admin corrections and debt', () => {
  it('add, remove and set (set writes the difference, never overwrites)', async () => {
    const core = await setup();
    const adj = (op: 'add' | 'remove' | 'set', amount: number) =>
      core.wallet.wallet.adminAdjust({
        key: key(),
        actor: 'studio:raptoru',
        target: alice,
        op,
        amount,
        reason: 'test',
      });
    await adj('add', 3000);
    await adj('remove', 500);
    const set = await adj('set', 5000);
    expect(set.amounts).toEqual([
      { twitchUserId: '1001', amount: 2500, kind: 'admin_set_adjustment' },
    ]);
    expect((await adj('set', 5000)).rejection).toBe('no_change');
    const history = await core.wallet.wallet.history('1001');
    expect(
      history.map((h) => [h.kind, h.amount, h.balanceAfter, h.actor]),
    ).toEqual([
      ['admin_set_adjustment', 2500, 5000, 'studio:raptoru'],
      ['admin_remove', -500, 2500, 'studio:raptoru'],
      ['admin_add', 3000, 3000, 'studio:raptoru'],
    ]);
  });

  it('admin debt: gains reduce it, spends and transfers are refused while negative', async () => {
    const core = await setup();
    await core.wallet.wallet.adminAdjust({
      key: key(),
      actor: 'studio',
      target: alice,
      op: 'remove',
      amount: 2000,
      reason: 'malus',
    });
    expect(await balance(core, '1001')).toBe(-2000);
    await core.wallet.wallet.credit({
      key: key(),
      viewer: alice,
      amount: 900,
      source: 'daily',
    });
    expect(await balance(core, '1001')).toBe(-1100);
    expect(
      (
        await core.wallet.wallet.spend({
          key: key(),
          viewer: alice,
          amount: 1,
          source: 'bonk',
        })
      ).rejection,
    ).toBe('in_debt');
    expect(
      (
        await core.wallet.wallet.transfer({
          key: key(),
          from: alice,
          to: bob,
          amount: 1,
          source: 't',
        })
      ).rejection,
    ).toBe('in_debt');
    expect((await core.wallet.chat.balance({ viewer: alice })).message).toBe(
      '@Alice - dette actuelle : 1 100 Jetons',
    );
  });

  it('no administrative debt on a currency that forbids it; penalty follows the same rule', async () => {
    const core = await setup();
    await core.wallet.currencies.create({
      id: 'strict',
      singular: 'Pièce',
      plural: 'Pièces',
      icon: null,
      active: true,
      isPrimary: false,
      transferable: true,
      allowNegativeAdmin: false,
    });
    expect(
      (
        await core.wallet.wallet.adminAdjust({
          key: key(),
          actor: 's',
          target: alice,
          op: 'remove',
          amount: 1,
          currencyId: 'strict',
        })
      ).rejection,
    ).toBe('negative_not_allowed');
    expect(
      (
        await core.wallet.wallet.penalty({
          key: key(),
          viewer: alice,
          amount: 1,
          source: 'votekick',
          reason: 'lost',
          currencyId: 'strict',
        })
      ).rejection,
    ).toBe('negative_not_allowed');
    expect(
      (
        await core.wallet.wallet.penalty({
          key: key(),
          viewer: alice,
          amount: 300,
          source: 'votekick',
          reason: 'lost',
        })
      ).status,
    ).toBe('applied');
    expect((await core.wallet.wallet.getWallet('1001'))!.stats.penalties).toBe(
      300,
    );
  });

  it('the ledger is append-only', async () => {
    const core = await setup();
    await give(core, alice, 10);
    await expect(
      core.db.query('update wallet_transactions set amount = 1000000'),
    ).rejects.toThrow(/append-only/);
    await expect(
      core.db.query('delete from wallet_transactions'),
    ).rejects.toThrow(/append-only/);
  });

  it('chat admin commands require an internal Owner/Supermod role', async () => {
    const core = await setup();
    const req = {
      requestId: 'm1',
      actor: bob,
      target: alice,
      op: 'add' as const,
      amount: 500,
    };
    expect(await core.wallet.chat.admin(req)).toMatchObject({
      result: null,
      message: expect.stringMatching(/réservée/),
    });
    await core.wallet.staff.grant(bob, 'supermod', 'studio');
    expect(
      (await core.wallet.chat.admin({ ...req, requestId: 'm2' })).message,
    ).toBe('🛠️ @Alice : +500 Jetons (solde : 500 Jetons).');
  });
});

describe('loyalty rate and boost', () => {
  it('personal rate replaces the standard rate, the boost multiplies on top', () => {
    expect(loyaltyMultiplier({ personalRate: 3, boost: 2 })).toBe(6);
    expect(
      loyaltyMultiplier({ personalRate: null, standardRate: 2, boost: null }),
    ).toBe(2);
    expect(
      loyaltyMultiplier({ personalRate: 3, standardRate: 2, boost: null }),
    ).toBe(3);
    expect(applyMultiplier(125, 1.5)).toBe(188);
  });

  it('stores, resolves and resets a personal rate; one active boost at a time', async () => {
    const core = await setup();
    core.clock.set(paris('2026-09-26', 20));
    await core.wallet.loyalty.setRate(alice, 3, 'studio', 'VIP');
    const boost = await core.wallet.loyalty.createBoost({
      multiplier: 2,
      label: 'Anniversaire',
      endsAt: paris('2026-09-26', 23),
      actor: 'studio',
    });
    expect(await core.wallet.loyalty.resolveMultiplier('1001')).toEqual({
      personalRate: 3,
      boost: 2,
      total: 6,
    });
    await expect(
      core.wallet.loyalty.createBoost({
        multiplier: 3,
        label: 'x',
        endsAt: paris('2026-09-26', 22),
        actor: 's',
      }),
    ).rejects.toThrow(/another boost/);

    core.clock.set(new Date(paris('2026-09-26', 23).getTime() + HOUR)); // boost over
    expect(await core.wallet.loyalty.resolveMultiplier('1001')).toMatchObject({
      boost: null,
      total: 3,
    });

    core.clock.set(paris('2026-09-26', 21));
    await core.wallet.loyalty.stopBoost(boost.id, 'studio');
    expect(await core.wallet.loyalty.activeBoost()).toBeNull();
    await core.wallet.loyalty.resetRate('1001');
    expect(await core.wallet.loyalty.resolveMultiplier('1001')).toMatchObject({
      personalRate: null,
      total: 1,
    });
  });

  it('boosts and rates never touch transfers or admin corrections', async () => {
    const core = await setup();
    await core.wallet.loyalty.setRate(alice, 3, 'studio');
    await core.wallet.loyalty.createBoost({
      multiplier: 2,
      label: 'x',
      endsAt: new Date(core.clock.now().getTime() + HOUR),
      actor: 's',
    });
    await core.wallet.wallet.adminAdjust({
      key: key(),
      actor: 's',
      target: alice,
      op: 'add',
      amount: 100,
    });
    await core.wallet.wallet.transfer({
      key: key(),
      from: alice,
      to: bob,
      amount: 40,
      source: 't',
    });
    expect([await balance(core, '1001'), await balance(core, '1002')]).toEqual([
      60, 40,
    ]);
  });
});

describe('ranking', () => {
  it('top N and viewer position (ties share a rank)', async () => {
    const core = await setup();
    await give(core, alice, 300);
    await give(core, bob, 500);
    await give(core, carol, 300);
    const board = (await core.wallet.wallet.leaderboard())!;
    expect(
      board.entries.map((e) => [e.rank, e.displayName, e.balance]),
    ).toEqual([
      [1, 'Bob', 500],
      [2, 'Alice', 300],
      [2, 'Carol', 300],
    ]);
    expect((await core.wallet.wallet.getWallet('1001'))!.position).toBe(2);
  });
});

describe('chat layer (!solde / !give / !wallet)', () => {
  it('transfer via chat: applied, self-transfer and insufficient-funds messages', async () => {
    const core = await setup();
    await give(core, alice, 1000);
    expect(
      (
        await core.wallet.chat.transfer({
          requestId: 'msg-1',
          from: alice,
          to: bob,
          amount: 300,
        })
      ).message,
    ).toBe('✅ @Alice → @Bob : 300 Jetons envoyés.');
    expect(
      (
        await core.wallet.chat.transfer({
          requestId: 'msg-2',
          from: alice,
          to: alice,
          amount: 1,
        })
      ).message,
    ).toMatch(/toi-même/);
    expect(
      (
        await core.wallet.chat.transfer({
          requestId: 'msg-3',
          from: bob,
          to: alice,
          amount: 99999,
        })
      ).message,
    ).toMatch(/solde insuffisant/);
  });

  it('the same chat message id received twice replays the outcome without a second transfer', async () => {
    const core = await setup();
    await give(core, alice, 1000);
    const req = {
      requestId: 'twitch-msg-42',
      from: alice,
      to: bob,
      amount: 300,
    };
    const first = await core.wallet.chat.transfer(req);
    const second = await core.wallet.chat.transfer(req);
    expect(second.message).toBe(first.message);
    expect(second.result?.replayed).toBe(true);
    expect(await balance(core, '1001')).toBe(700);
    expect(await balance(core, '1002')).toBe(300);
  });
});

describe('viewer identity', () => {
  it('a login change keeps the same wallet under the canonical twitch_user_id', async () => {
    const core = await setup();
    await give(core, viewer('1001', 'OldName'), 500);
    const renamed = {
      twitchUserId: '1001',
      login: 'newname',
      displayName: 'NewName',
    };
    // The next write (any wallet op) refreshes the cached identity from the fresh Viewer.
    expect(
      (
        await core.wallet.chat.transfer({
          requestId: 'rename-1',
          from: renamed,
          to: bob,
          amount: 100,
        })
      ).message,
    ).toBe('✅ @NewName → @Bob : 100 Jetons envoyés.');
    const rows = await core.db.query<{ login: string; display_name: string }>(
      'select login, display_name from viewers where twitch_user_id = $1',
      ['1001'],
    );
    expect(rows[0]).toEqual({ login: 'newname', display_name: 'NewName' });
    // Same Twitch ID, same wallet: the balance is unaffected by the login change itself.
    expect(await balance(core, '1001')).toBe(400);
  });
});

describe('isolation from other slices', () => {
  it('wallet operations never touch Daily or presence tables', async () => {
    const core = await setup();
    await give(core, alice, 100);
    await core.wallet.wallet.transfer({
      key: key(),
      from: alice,
      to: bob,
      amount: 50,
      source: 't',
    });
    for (const t of [
      'daily_claims',
      'daily_credits',
      'daily_stats',
      'presence_cycles',
      'presence_viewer_streams',
    ]) {
      expect(await count(core.db, t)).toBe(0);
    }
  });
});
