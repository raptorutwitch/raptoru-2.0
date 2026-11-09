/* global Response */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../extension/shared/api.js';
import { createRetryKeys, withRetryKey } from '../extension/shared/purchase.js';

// Audit 09/11 (P1): Soundboard, a single Bonk and the event shop used a NEW Idempotency-Key at every click. Core committed
// the purchase, the answer was lost, the viewer clicked again → a second debit and a second effect. Now the click that
// follows an unanswered failure re-sends the same key (Core replays the first purchase); every other click is its own.

const lost = Object.assign(new Error('network_error'), {
  code: 'network_error',
});
const refused = Object.assign(new Error('insufficient_tokens'), {
  code: 'insufficient_tokens',
  status: 409,
});

describe('retry keys: one purchase per intent, repeated clicks stay separate', () => {
  it('after a lost answer the next click on the same thing re-sends its key; then a new one', async () => {
    const keys = createRetryKeys();
    const sent = [];
    const task = (fail) => (key) => {
      sent.push(key);
      return fail ? Promise.reject(fail) : Promise.resolve({ ok: true });
    };
    await expect(withRetryKey(keys, 'sound:1', task(lost))).rejects.toBe(lost);
    await withRetryKey(keys, 'sound:1', task(null));
    await withRetryKey(keys, 'sound:1', task(null));
    expect(sent[1]).toBe(sent[0]);
    expect(sent[2]).not.toBe(sent[1]);
  });

  it('a decided refusal leaves nothing behind; another thing never takes the key', async () => {
    const keys = createRetryKeys();
    const sent = [];
    const task = (fail) => (key) => {
      sent.push(key);
      return fail ? Promise.reject(fail) : Promise.resolve({});
    };
    await expect(withRetryKey(keys, 'a', task(refused))).rejects.toBe(refused);
    await withRetryKey(keys, 'a', task(null));
    await expect(withRetryKey(keys, 'b', task(lost))).rejects.toBe(lost);
    await withRetryKey(keys, 'c', task(null));
    expect(new Set(sent).size).toBe(4);
  });

  it('two clicks in flight (two Bonks on purpose) keep two keys', () => {
    const keys = createRetryKeys();
    expect(keys.take('bonk:1')).not.toBe(keys.take('bonk:1'));
  });

  it('the client sends the key it is given (Soundboard, Bonk, event shop)', async () => {
    const seen = [];
    const api = createClient({
      getToken: () => 'tok',
      apiBase: 'http://ebs',
      demoMode: false,
      fetchImpl: vi.fn(async (url, init) => {
        seen.push(init.headers['Idempotency-Key']);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });
    await api.spendTokens('soundboard', { sound_id: 's' }, 'key-spend-0001');
    await api.useRedemption(
      'credit-soundboard',
      'soundboard',
      {},
      'key-redeem-0001',
    );
    await api.eventsBuy('item', 'key-event-0001');
    await api.eventsBuyTitle('offer', 'key-title-0001');
    expect(seen).toEqual([
      'key-spend-0001',
      'key-redeem-0001',
      'key-event-0001',
      'key-title-0001',
    ]);
  });
});
