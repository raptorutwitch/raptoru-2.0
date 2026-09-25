import { describe, expect, it, vi } from 'vitest';
import {
  handleLoyaltyMessage,
  parseLoyaltyCommand,
} from '../src/loyalty-commands.js';

const alice = { twitchUserId: '1001', login: 'alice', displayName: 'Alice' };
const bob = { twitchUserId: '1002', login: 'bob', displayName: 'Bob' };

describe('loyalty command parser', () => {
  it('balance aliases (no !points)', () => {
    for (const c of ['!solde', '!balance', '!COMPTE'])
      expect(parseLoyaltyCommand(c)).toEqual({ kind: 'balance' });
    expect(parseLoyaltyCommand('!points')).toBeNull();
    expect(parseLoyaltyCommand('bonjour')).toBeNull();
  });

  it('!give / !trade accept both argument orders', () => {
    expect(parseLoyaltyCommand('!give @Bob 500')).toEqual({
      kind: 'give',
      target: 'bob',
      amount: 500,
    });
    expect(parseLoyaltyCommand('!trade 500 @Bob')).toEqual({
      kind: 'give',
      target: 'bob',
      amount: 500,
    });
    expect(parseLoyaltyCommand('!give bob 1')).toEqual({
      kind: 'give',
      target: 'bob',
      amount: 1,
    });
  });

  it('rejects zero, negative, decimal or missing amounts with a usage hint', () => {
    for (const bad of [
      '!give @Bob 0',
      '!give @Bob -5',
      '!give @Bob 1.5',
      '!give @Bob 10k',
      '!give @Bob',
      '!give 500',
    ]) {
      expect(parseLoyaltyCommand(bad)).toMatchObject({ kind: 'usage' });
    }
  });

  it('!wallet add|remove|set with optional reason; set accepts a negative target', () => {
    expect(parseLoyaltyCommand('!wallet add @Bob 500 bonus event')).toEqual({
      kind: 'admin',
      op: 'add',
      target: 'bob',
      amount: 500,
      reason: 'bonus event',
    });
    expect(parseLoyaltyCommand('!wallet set 5000 @Bob')).toEqual({
      kind: 'admin',
      op: 'set',
      target: 'bob',
      amount: 5000,
    });
    expect(parseLoyaltyCommand('!wallet set @Bob -200')).toEqual({
      kind: 'admin',
      op: 'set',
      target: 'bob',
      amount: -200,
    });
    expect(parseLoyaltyCommand('!wallet remove @Bob -5')).toMatchObject({
      kind: 'usage',
    });
    expect(parseLoyaltyCommand('!wallet steal @Bob 5')).toMatchObject({
      kind: 'usage',
    });
  });
});

function deps() {
  return {
    core: {
      walletBalance: vi.fn(async () => ({
        message: 'balance reply',
        result: null,
      })),
      walletTransfer: vi.fn(async () => ({
        message: 'transfer reply',
        result: null,
      })),
      walletAdmin: vi.fn(async () => ({
        message: 'admin reply',
        result: null,
      })),
    },
    say: vi.fn(async () => {}),
    lookupLogin: vi.fn(async (login: string) => (login === 'bob' ? bob : null)),
    log: () => {},
  };
}

describe('loyalty command handler', () => {
  it('uses the Twitch ID from the @mention and the message id as idempotency key', async () => {
    const d = deps();
    await handleLoyaltyMessage(
      {
        messageId: 'm1',
        text: '!give @Bob 500',
        chatter: alice,
        mentions: [bob],
      },
      d,
    );
    expect(d.core.walletTransfer).toHaveBeenCalledWith({
      requestId: 'm1',
      from: alice,
      to: bob,
      amount: 500,
    });
    expect(d.lookupLogin).not.toHaveBeenCalled();
    expect(d.say).toHaveBeenCalledWith('transfer reply');
  });

  it('falls back to a Twitch lookup when the name was typed without a real mention', async () => {
    const d = deps();
    await handleLoyaltyMessage(
      { messageId: 'm2', text: '!trade 20 bob', chatter: alice, mentions: [] },
      d,
    );
    expect(d.lookupLogin).toHaveBeenCalledWith('bob');
    expect(d.core.walletTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ to: bob, amount: 20 }),
    );

    await handleLoyaltyMessage(
      {
        messageId: 'm3',
        text: '!give @ghost 20',
        chatter: alice,
        mentions: [],
      },
      d,
    );
    expect(d.say).toHaveBeenLastCalledWith(
      '@Alice — viewer « ghost » introuvable.',
    );
  });

  it('balance is forwarded as a read; admin keeps actor and reason; Core outage fails fast', async () => {
    const d = deps();
    await handleLoyaltyMessage(
      { messageId: 'm4', text: '!solde', chatter: alice, mentions: [] },
      d,
    );
    expect(d.core.walletBalance).toHaveBeenCalledWith({ viewer: alice });
    await handleLoyaltyMessage(
      {
        messageId: 'm5',
        text: '!wallet remove @Bob 300 triche',
        chatter: alice,
        mentions: [bob],
      },
      d,
    );
    expect(d.core.walletAdmin).toHaveBeenCalledWith({
      requestId: 'm5',
      actor: alice,
      target: bob,
      op: 'remove',
      amount: 300,
      reason: 'triche',
    });

    d.core.walletBalance.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await handleLoyaltyMessage(
      { messageId: 'm6', text: '!balance', chatter: alice, mentions: [] },
      d,
    );
    expect(d.say).toHaveBeenLastCalledWith(
      expect.stringMatching(/indisponible/),
    );
  });
});
