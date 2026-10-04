import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import { createApp } from '../src/http/server.js';
import { setup } from './helpers.js';

// ASTRA-P1-005: liveness (/health) and readiness (/ready: the database answers) are distinct.
async function serve(db?: Pick<Db, 'query'>) {
  const core = await setup();
  const server = createApp({
    daily: core.daily,
    streams: core.streams,
    presence: core.presence,
    wallet: core.wallet,
    loyalty: core.loyalty,
    botSecret: 'b'.repeat(32),
    studioSecret: 's'.repeat(32),
    db,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    const res = await fetch(base + path);
    return { status: res.status, body: (await res.json()) as unknown };
  };
  return { core, get, close: () => server.close() };
}

describe('Core readiness', () => {
  it('ready when the database answers', async () => {
    const s = await serve();
    const s2 = await serve(s.core.db);
    expect(await s2.get('/ready')).toEqual({
      status: 200,
      body: { service: 'core-api', status: 'ready' },
    });
    s.close();
    s2.close();
  });

  it('HTTP alive but database down or stuck: /health stays 200, /ready is 503 within its budget', async () => {
    for (const db of [
      { query: () => Promise.reject(new Error('ECONNREFUSED')) },
      { query: () => new Promise<never>(() => {}) }, // stuck
    ] as Pick<Db, 'query'>[]) {
      const s = await serve(db);
      expect((await s.get('/health')).status).toBe(200);
      const t0 = Date.now();
      expect(await s.get('/ready')).toEqual({
        status: 503,
        body: { service: 'core-api', status: 'db_unavailable' },
      });
      expect(Date.now() - t0).toBeLessThan(3_000);
      s.close();
    }
  });
});
