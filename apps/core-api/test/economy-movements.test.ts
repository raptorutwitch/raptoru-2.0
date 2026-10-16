import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import { coreWalletEconomy, labEconomy } from '../src/economy/economy.js';
import {
  DEFAULT_LAB_WALLET,
  LabWalletError,
} from '../src/lab-moderation/store.js';
import { CurrencyCreditError } from '../src/raffle-lab/currencies.js';
import type { WalletService } from '../src/wallet/wallet-service.js';
import { createTestDb } from './helpers.js';

// Economy unification (16/10/2026): the module movements of EconomyPort (hold / move / transfer) with the REAL
// Lab adapter and the test database — always inside the caller's transaction, refusals before any write.

const CH = '900700';
const NOW = new Date('2026-10-16T23:00:00Z');
const START = DEFAULT_LAB_WALLET.tokens;
const A = '4001';
const B = '4002';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const balance = async (viewer: string) =>
  Number(
    (
      await db.query<{ tokens: string }>(
        'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
        [CH, viewer],
      )
    )[0]?.tokens ?? START,
  );
const ledger = async () =>
  (
    await db.query<{
      viewer_id: string;
      kind: string;
      amount: string;
      reason: string | null;
    }>(
      'select viewer_id, kind, amount, reason from lab_wallet_ledger order by id',
    )
  ).map((l) => [l.viewer_id, l.kind, Number(l.amount), l.reason]);
const cap = (max: number) =>
  db.query(
    "update lab_currencies set max_balance = $1 where currency_id = 'tokens'",
    [max],
  );
const move = (viewerId: string, amount: number, key: string) =>
  db.tx((q) =>
    labEconomy.move(q, NOW, {
      channelId: CH,
      viewerId,
      currency: 'tokens',
      amount,
      kind: 'mini_game',
      key,
    }),
  );

describe('hold', () => {
  it('locks and reads the balances of every viewer and the currency cap', async () => {
    const h = await db.tx((q) =>
      labEconomy.hold(q, NOW, CH, [B, A, B], 'tokens'),
    );
    expect([...h.balances.entries()]).toEqual([
      [A, START],
      [B, START],
    ]); // stable order, duplicates once
    expect(h.maxBalance).toBe(1_000_000_000);
  });

  it('a currency without a Lab wallet column is refused explicitly', async () => {
    await expect(
      db.tx((q) => labEconomy.hold(q, NOW, CH, [A], 'unknown_coin')),
    ).rejects.toMatchObject({
      code: 'economy_unavailable',
      details: { reason: 'currency_not_supported' },
    });
  });
});

describe('move', () => {
  it('credit and debit are exact, each with its ledger row and the balance after', async () => {
    expect(await move(A, 500, 'k1')).toMatchObject({
      balanceAfter: START + 500,
    });
    expect(await move(A, -200, 'k2')).toMatchObject({
      balanceAfter: START + 300,
    });
    expect(await balance(A)).toBe(START + 300);
    expect(await ledger()).toEqual([
      [A, 'mini_game', 500, 'k1'],
      [A, 'mini_game', -200, 'k2'],
    ]);
  });

  it('insufficient balance: refused, nothing written', async () => {
    await expect(move(A, -(START + 1), 'k1')).rejects.toBeInstanceOf(
      LabWalletError,
    );
    expect(await balance(A)).toBe(START);
    expect(await ledger()).toEqual([]);
  });

  it('a credit beyond the cap: refused (CurrencyCreditError), nothing written', async () => {
    await cap(START + 100);
    await expect(move(A, 101, 'k1')).rejects.toBeInstanceOf(
      CurrencyCreditError,
    );
    expect(await move(A, 100, 'k2')).toMatchObject({
      balanceAfter: START + 100,
    }); // exactly at the cap
    expect(await ledger()).toEqual([[A, 'mini_game', 100, 'k2']]);
  });

  it('the same key twice (mini_game / word_game): the second fails, never a second credit', async () => {
    await move(A, 500, 'same');
    await expect(move(A, 500, 'same')).rejects.toThrow();
    expect(await balance(A)).toBe(START + 500);
    expect(await ledger()).toHaveLength(1);
  });

  it('rollback after a business error: the movement is not kept', async () => {
    await expect(
      db.tx(async (q) => {
        await labEconomy.move(q, NOW, {
          channelId: CH,
          viewerId: A,
          currency: 'tokens',
          amount: 700,
          kind: 'word_game',
          key: 'k',
        });
        throw new Error('business refusal after the credit');
      }),
    ).rejects.toThrow('business refusal');
    expect(await balance(A)).toBe(START);
    expect(await ledger()).toEqual([]);
  });

  it('a Tombola win: its currency, module and round on the ledger row', async () => {
    const raffleId = '11111111-1111-4111-8111-111111111111';
    await db.tx((q) =>
      labEconomy.move(q, NOW, {
        channelId: CH,
        viewerId: A,
        currency: 'tokens',
        amount: 5000,
        kind: 'raffle_win',
        moduleId: 'raffle',
        raffleId,
      }),
    );
    const row = (
      await db.query<{ module_id: string; raffle_id: string; reason: null }>(
        "select module_id, raffle_id, reason from lab_wallet_ledger where kind = 'raffle_win'",
      )
    )[0];
    expect(row).toEqual({
      module_id: 'raffle',
      raffle_id: raffleId,
      reason: null,
    });
  });

  it('two concurrent movements on one wallet: both applied, nothing lost', async () => {
    await Promise.all([move(A, 300, 'c1'), move(A, -100, 'c2')]);
    expect(await balance(A)).toBe(START + 200);
  });
});

describe('transfer', () => {
  const transfer = (from: string, to: string, amount: number, id: string) =>
    db.tx((q) =>
      labEconomy.transfer(q, NOW, {
        channelId: CH,
        from,
        to,
        currency: 'tokens',
        amount,
        kind: 'mini_game',
        keys: { from: `${id}:loser`, to: `${id}:winner` },
      }),
    );

  it('sum zero, two ledger rows (sender first)', async () => {
    await transfer(A, B, 400, 'd1');
    expect([await balance(A), await balance(B)]).toEqual([
      START - 400,
      START + 400,
    ]);
    expect(await ledger()).toEqual([
      [A, 'mini_game', -400, 'd1:loser'],
      [B, 'mini_game', 400, 'd1:winner'],
    ]);
  });

  it('the sender cannot pay: refused, nothing moves', async () => {
    await expect(transfer(A, B, START + 1, 'd1')).rejects.toBeInstanceOf(
      LabWalletError,
    );
    expect([await balance(A), await balance(B)]).toEqual([START, START]);
    expect(await ledger()).toEqual([]);
  });

  it('the receiver would exceed the cap: the sender’s debit is rolled back too', async () => {
    await cap(START + 100);
    await expect(transfer(A, B, 500, 'd1')).rejects.toBeInstanceOf(
      CurrencyCreditError,
    );
    expect([await balance(A), await balance(B)]).toEqual([START, START]);
    expect(await ledger()).toEqual([]);
  });

  it('crossed transfers at once (stable lock order): both settle, total kept', async () => {
    await Promise.all([transfer(A, B, 100, 'x1'), transfer(B, A, 300, 'x2')]);
    expect((await balance(A)) + (await balance(B))).toBe(2 * START);
    expect(await balance(A)).toBe(START + 200);
  });
});

describe('canonical adapter', () => {
  it('module movements are not wired yet: explicit refusal, never a silent success', async () => {
    const port = coreWalletEconomy({} as WalletService);
    for (const call of [
      () => port.hold(db, NOW, CH, [A], 'tokens'),
      () =>
        port.move(db, NOW, {
          channelId: CH,
          viewerId: A,
          currency: 'tokens',
          amount: 1,
          kind: 'mini_game',
        }),
      () =>
        port.transfer(db, NOW, {
          channelId: CH,
          from: A,
          to: B,
          currency: 'tokens',
          amount: 1,
          kind: 'mini_game',
          keys: { from: 'f', to: 't' },
        }),
    ])
      await expect(call()).rejects.toMatchObject({
        code: 'economy_unavailable',
        details: { reason: 'canonical_not_wired' },
      });
  });
});
