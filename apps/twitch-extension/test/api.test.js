/* global Response, ReadableStream */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../extension/shared/api.js';

// Extension HTTP client: the 8 s budget covers the whole response, body included (ASTRA-P2-010); a
// success must carry its JSON (ASTRA-P2-003); retries / Idempotency-Key unchanged (ASTRA-P1-009).
afterEach(() => vi.useRealTimers());

const json = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
/** Headers sent, body never finished. */
const stuck = () =>
  new Response(new ReadableStream({ start() {} }), { status: 200 });

function client(...replies) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, key: init.headers['Idempotency-Key'] ?? null });
    const next = replies.shift();
    return typeof next === 'function' ? next() : next;
  });
  return {
    api: createClient({
      getToken: () => 'tok',
      apiBase: 'http://ebs',
      demoMode: false,
      fetchImpl,
    }),
    calls,
  };
}

describe('Extension API client — response budget and contract', () => {
  it('a normal response is returned as is', async () => {
    const { api, calls } = client(json({ ok: true, items: [1] }));
    await expect(api.cmdV2('list')).resolves.toEqual({ ok: true, items: [1] });
    expect(calls).toHaveLength(1);
  });

  it('headers received then a body that never ends: explicit network_error at the budget, not a hang', async () => {
    vi.useFakeTimers();
    const { api } = client(stuck);
    const out = api.cmdV2('list').catch((e) => e);
    await vi.advanceTimersByTimeAsync(8_000);
    const error = await out;
    expect(error).toMatchObject({ code: 'network_error' });
    expect(error.cause?.message).toBe('response_timeout');
  });

  it('a success with invalid or missing JSON is an explicit invalid_response, never a silent {}', async () => {
    for (const bad of ['{"ok": tru', '', '"text"']) {
      const { api, calls } = client(json(bad));
      await expect(api.cmdV2('list')).rejects.toMatchObject({
        code: 'invalid_response',
        status: 200,
      });
      expect(calls).toHaveLength(1); // no retry of a delivered answer
    }
    // 204 = no content by design: an empty success.
    const { api } = client(new Response(null, { status: 204 }));
    await expect(api.cmdV2('list')).resolves.toEqual({});
  });

  it('an HTTP refusal keeps its contract (error code + details), even with a non-JSON body', async () => {
    const refused = client(json({ ok: false, error: 'forbidden' }, 403));
    await expect(refused.api.cmdV2('list')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
    const garbage = client(json('<html>bad gateway</html>', 400));
    await expect(garbage.api.cmdV2('list')).rejects.toMatchObject({
      message: 'http_error',
      status: 400,
    });
  });

  it('retries unchanged: a transient 503 is retried once with the same Idempotency-Key', async () => {
    vi.useFakeTimers();
    const { api, calls } = client(
      json({ ok: false, error: 'busy' }, 503),
      json({ ok: true, done: 1 }),
    );
    const out = api.modV2Act({ action: 'add_note', viewer_id: '1', note: 'x' });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(out).resolves.toEqual({ ok: true, done: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[0].key).toBeTruthy();
    expect(calls[1].key).toBe(calls[0].key);
  });
});
