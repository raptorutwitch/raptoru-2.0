import { describe, expect, it, vi } from 'vitest';
import {
  handleLoyaltyMessage,
  parseLoyaltyCommand,
} from '../src/loyalty-commands.js';

const alice = { twitchUserId: '1001', login: 'alice', displayName: 'Alice' };
const bob = { twitchUserId: '1002', login: 'bob', displayName: 'Bob' };

describe('loyalty command parser', () => {
  it('balance aliases (no !points)', () => {
    for (const c of ['!solde', '!balance', '!COMPTE', '  !solde  '])
      expect(parseLoyaltyCommand(c)).toEqual({ kind: 'balance' });
    expect(parseLoyaltyCommand('!points')).toBeNull();
    expect(parseLoyaltyCommand('bonjour')).toBeNull();
  });

  it('!solde Pseudo and !solde @Pseudo: the same target, case ignored', () => {
    for (const c of [
      '!solde Bob',
      '!solde @Bob',
      '!SOLDE @bOB',
      '!solde bob  ',
      '!balance @Bob',
      '!compte bob',
    ])
      expect(parseLoyaltyCommand(c)).toEqual({
        kind: 'balance',
        target: 'bob',
      });
  });

  it('!solde: any other form is not a command (no action, no reply)', () => {
    for (const bad of [
      '!solde pour voir tes jetons',
      '!solde @Bob salut',
      'Salut !solde',
      'Salut !solde @Bob',
      '!solde @',
      '!solde @@Bob',
      '!solde @Bo',
      '!solde @Bob @Alice',
    ])
      expect(parseLoyaltyCommand(bad)).toBeNull();
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
      '@Alice - viewer « ghost » introuvable.',
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

describe('!solde of another viewer', () => {
  const carol = { twitchUserId: '1003', login: 'carol', displayName: 'Carol' };
  const run = (text: string, d = deps(), mentions: (typeof bob)[] = []) =>
    handleLoyaltyMessage(
      { messageId: 'mx', text, chatter: alice, mentions },
      d,
    ).then(() => d);

  it('own balance: the author only (no lookup)', async () => {
    const d = await run('!solde');
    expect(d.core.walletBalance).toHaveBeenCalledWith({ viewer: alice });
    expect(d.lookupLogin).not.toHaveBeenCalled();
  });

  it('with @ (real mention): the mentioned account, answered to the author', async () => {
    const d = await run('!solde @Bob', deps(), [bob]);
    expect(d.lookupLogin).not.toHaveBeenCalled();
    expect(d.core.walletBalance).toHaveBeenCalledWith({
      viewer: bob,
      requester: alice,
    });
    expect(d.say).toHaveBeenCalledWith('balance reply');
  });

  it('without @, any case: resolved through Twitch to the same account', async () => {
    for (const text of ['!solde bob', '!solde BOB', '!solde @bOb']) {
      const d = await run(text);
      expect(d.lookupLogin).toHaveBeenCalledWith('bob');
      expect(d.core.walletBalance).toHaveBeenCalledWith({
        viewer: bob,
        requester: alice,
      });
    }
  });

  it('two wallets never mixed: each target reads its own account', async () => {
    const d = deps();
    d.lookupLogin.mockImplementation(async (login: string) =>
      login === 'bob' ? bob : login === 'carol' ? carol : null,
    );
    await run('!solde carol', d);
    await run('!solde @Bob', d);
    expect(
      d.core.walletBalance.mock.calls.map(
        (c) =>
          (c as unknown as [{ viewer: typeof bob }])[0].viewer.twitchUserId,
      ),
    ).toEqual(['1003', '1002']);
  });

  it('unknown viewer (or a word that is not one): clear reply, no wallet read, never the author', async () => {
    // « pour » or « 500 » are valid pseudo shapes: only Twitch can tell; not found → never a balance.
    expect(parseLoyaltyCommand('!solde 500')).toEqual({
      kind: 'balance',
      target: '500',
    });
    const d = await run('!solde pour');
    expect(d.lookupLogin).toHaveBeenCalledWith('pour');
    expect(d.core.walletBalance).not.toHaveBeenCalled();
    expect(d.say).toHaveBeenCalledWith('@Alice - viewer « pour » introuvable.');
  });

  it('Twitch answers another login than the one asked: treated as not found', async () => {
    const d = deps();
    d.lookupLogin.mockResolvedValueOnce(carol);
    await run('!solde bob', d);
    expect(d.core.walletBalance).not.toHaveBeenCalled();
    expect(d.say).toHaveBeenCalledWith('@Alice - viewer « bob » introuvable.');
  });

  it('Twitch API error: « indisponible », never the author’s balance', async () => {
    const d = deps();
    d.lookupLogin.mockRejectedValueOnce(new Error('helix 503'));
    await run('!solde bob', d);
    expect(d.core.walletBalance).not.toHaveBeenCalled();
    expect(d.say).toHaveBeenCalledWith(expect.stringMatching(/indisponible/));
  });

  it('Core error on the target’s balance: « indisponible »', async () => {
    const d = deps();
    d.core.walletBalance.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await run('!solde @Bob', d, [bob]);
    expect(d.say).toHaveBeenCalledWith(expect.stringMatching(/indisponible/));
  });

  it('naming oneself: the own balance (same reply as !solde)', async () => {
    const d = await run('!solde @Alice', deps(), [alice]);
    expect(d.core.walletBalance).toHaveBeenCalledWith({ viewer: alice });
  });

  it('invalid forms do nothing at all', async () => {
    for (const text of [
      '!solde pour voir tes jetons',
      '!solde @Bob salut',
      'Salut !solde',
      '!solde @',
    ]) {
      const d = await run(text, deps(), [bob]);
      expect(d.say).not.toHaveBeenCalled();
      expect(d.core.walletBalance).not.toHaveBeenCalled();
    }
  });
});
