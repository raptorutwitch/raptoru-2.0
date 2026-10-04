import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabCore } from '../src/bonk-lab/lab-core.js';
import type { Db } from '../src/db/db.js';
import { FakeClock } from './helpers.js';

// ASTRA-P2-013: an unexpected Lab Core error keeps its sober answer and leaves a redacted cause.
const SECRET = 's'.repeat(40);
afterEach(() => vi.restoreAllMocks());

async function serve(db: Db) {
  const { server } = createLabCore({
    db,
    clock: new FakeClock(new Date('2026-10-04T18:00:00Z')),
    secret: SECRET,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => server.close() };
}

describe('Lab Core unexpected errors', () => {
  it('500 bonk_core_error for the client; the log names the route and the cause, never the secret or credentials', async () => {
    const boom = () =>
      Promise.reject(
        new Error(
          `connect failed postgres://raptoru:hunter2@127.0.0.1:5432/x (${SECRET})`,
        ),
      );
    const s = await serve({
      query: boom,
      tx: boom,
      close: async () => {},
    } as unknown as Db);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await fetch(
      `${s.base}/v1/lab/commands/900100/public?viewer=x`,
      {
        headers: { authorization: `Bearer ${SECRET}` },
      },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'bonk_core_error' });
    const line = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).toContain('GET /v1/lab/commands/900100/public failed');
    expect(line).toContain('connect failed');
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('viewer=x');
    s.close();
  });

  it('expected errors keep their contract and are not logged as failures', async () => {
    const s = await serve({} as Db);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await fetch(`${s.base}/v1/lab/commands/900100`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
    expect(log).not.toHaveBeenCalled();
    s.close();
  });
});
