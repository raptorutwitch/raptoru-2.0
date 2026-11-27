import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';
import { moduleSettingsRelay } from '../src/module-settings/relay.js';

// Studio › Chaos › Tarifs on the REAL Lab chain: Studio's relay (/api/chaos-prices) → Studio's real Lab Core client
// (its route allow-list) → the Lab Core's `chaos` module, which checks and stores the ranges. Fictional data.

const CH = '900100';
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const listen = async (server: Server) => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

async function chain() {
  const db = createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );
  await migrate(db, 'lab');
  cleanups.push(() => db.close());
  const secret = randomBytes(32).toString('hex');
  /** A Lab Core on this database (a new one = the Core restarted). */
  const startCore = async () => {
    const server = createLabCore({ db, clock: systemClock, secret }).server;
    const url = await listen(server);
    cleanups.push(() => server.close());
    return { server, url };
  };
  /** Studio's server with the relay (a new one = Studio restarted). */
  const startStudio = async (coreUrl: string) => {
    const relay = moduleSettingsRelay(localLabCoreClient(coreUrl, secret), CH);
    const server = createServer((req, res) => {
      void relay(req, res, new URL(req.url!, 'http://studio')).then((done) => {
        if (!done) res.writeHead(404).end();
      });
    });
    const url = await listen(server);
    cleanups.push(() => server.close());
    return async (
      body?: unknown,
      headers: Record<string, string> = { 'x-raptoru-studio': '1' },
      path = '/api/chaos-prices',
    ) => {
      const res = await fetch(`${url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
      return { status: res.status, body: (await res.json()) as any };
    };
  };
  return { startCore, startStudio };
}

const blur = (b: { effects: { id: string }[] }) =>
  b.effects.find((e) => e.id === 'blur');

describe('Studio › Chaos › Tarifs — real Lab chain (Studio relay + Lab Core client + Lab Core)', () => {
  it('reads the 13 ranges, sets Flou 10 000 – 75 000 (only the checked fields go), survives a Core and a Studio restart, back to the default', async () => {
    const { startCore, startStudio } = await chain();
    const core = await startCore();
    let studio = await startStudio(core.url);
    const read = await studio();
    expect(read.status).toBe(200);
    expect(read.body.effects).toHaveLength(13);
    expect(blur(read.body)).toMatchObject({
      min: 15_000,
      max: 100_000,
      custom: false,
    });
    const set = await studio({
      effect: 'blur',
      min: 10_000,
      max: 75_000,
      // Never forwarded: the relay sends only what the Core checks.
      key: 'chaos.enabled',
      value: 1,
    });
    expect(set.status).toBe(200);
    expect(blur(set.body)).toMatchObject({
      min: 10_000,
      max: 75_000,
      custom: true,
    });
    // Both restarted: the Core reads the range from its database.
    core.server.close();
    const again = await startCore();
    studio = await startStudio(again.url);
    expect(blur((await studio()).body)).toMatchObject({
      min: 10_000,
      max: 75_000,
    });
    const back = await studio({ effect: 'blur', reset: true });
    expect(blur(back.body)).toMatchObject({
      min: 15_000,
      max: 100_000,
      custom: false,
    });
  });

  it('the Core’s refusals reach Studio as they are; without the Studio header or with the Core down, nothing is claimed', async () => {
    const { startCore, startStudio } = await chain();
    const core = await startCore();
    const studio = await startStudio(core.url);
    const bad = await studio({ effect: 'blur', min: 80_000, max: 20_000 });
    expect([bad.status, bad.body.error]).toEqual([400, 'min_above_max']);
    expect(
      (await studio({ effect: 'blur', min: 10_025, max: 20_000 })).body.error,
    ).toBe('price_not_rounded');
    expect((await studio({ effect: 'blur', min: 'x', max: 1 })).status).toBe(
      400,
    );
    expect(
      (await studio({ effect: 'blur', min: 1_000, max: 2_000 }, {} as never))
        .status,
    ).toBe(403);
    expect(blur((await studio()).body)).toMatchObject({
      min: 15_000,
      custom: false,
    });
    core.server.close();
    const down = await studio({ effect: 'blur', min: 10_000, max: 75_000 });
    expect(down.status).toBeGreaterThanOrEqual(500);
    expect(down.body.effects).toBeUndefined();
  });

  it('« Autoriser les achats Chaos »: the header reads chaos.enabled and who may buy (Lab), turns it on and off through the module settings; the state is read only; Core down → no value claimed', async () => {
    const { startCore, startStudio } = await chain();
    const core = await startCore();
    const studio = await startStudio(core.url);
    const H = { 'x-raptoru-studio': '1' };
    const access = () => studio(undefined, H, '/api/chaos-access');
    expect((await access()).body).toEqual({
      setting: 0,
      open: false,
      audience: 'lab',
      testers: 0,
    });
    const on = await studio(
      { key: 'chaos.enabled', value: 1 },
      H,
      '/api/module-settings',
    );
    expect(on.status).toBe(200);
    expect((await access()).body).toMatchObject({ setting: 1, open: true });
    await studio({ key: 'chaos.enabled', value: 0 }, H, '/api/module-settings');
    expect((await access()).body).toMatchObject({ setting: 0, open: false });
    // The state is read only; the Studio header is required.
    expect((await studio({ setting: 1 }, H, '/api/chaos-access')).status).toBe(
      405,
    );
    expect((await studio(undefined, {}, '/api/chaos-access')).status).toBe(403);
    expect((await access()).body.setting).toBe(0);
    core.server.close();
    const down = await access();
    expect(down.status).toBeGreaterThanOrEqual(500);
    expect(down.body.setting).toBeUndefined();
  });
});
