import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, expect, it } from 'vitest';
import { createLabCore } from '../src/bonk-lab/lab-core.js';
import { systemClock } from '../src/clock.js';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDb } from './helpers.js';

// Progression native in the Lab, end to end: the REAL Lab Core over HTTP on the dedicated Lab database (lab_viewers,
// Lab session — no production table): the Lab chat ingress pays XP while the simulated live runs, Studio's routes
// create a reward, find the viewer by pseudo, grant it, and the public read shows level, XP and inventory.

const CH = '900100';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

it('Lab: chat XP during the simulated live, reward created, viewer found, granted, shown', async () => {
  const db = createPgliteDb(
    new PGlite({ parsers: { 20: (v: string) => Number(v) } }),
  );
  await migrate(db, 'lab');
  const secret = randomBytes(32).toString('hex');
  const server: Server = createLabCore({
    db,
    clock: systemClock,
    secret,
  }).server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(async () => {
    server.close();
    await db.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async <T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    auth = true,
  ) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(auth ? { authorization: `Bearer ${secret}` } : {}),
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json()) as T & { error?: string };
    if (!res.ok)
      throw Object.assign(new Error(out.error ?? 'http'), {
        status: res.status,
      });
    return out as T;
  };
  const say = (text: string) =>
    call('/v1/lab/chat', {
      channel_id: CH,
      message_id: randomUUID(),
      text,
      chatter: {
        id: '9801',
        login: 'ana',
        display_name: 'Ana',
        role: 'viewer',
      },
      source: 'simulator',
    });
  const studio = { id: 'antoni', role: 'broadcaster', via: 'studio' } as const;

  await call('/v1/lab/progression/settings', { enabled: true });
  await say('bonsoir le chat'); // off live: nothing
  expect((await call<{ xp: number }>('/v1/progression/viewers/9801')).xp).toBe(
    0,
  );
  await call(`/v1/lab/raffle/${CH}/actions`, {
    actor: studio,
    command: { action: 'stream_start', reason: 'test' },
  });
  const r = (await say('bonsoir tout le monde')) as {
    handled: { module: string }[];
  };
  expect(r.handled.map((h) => h.module)).not.toContain('progression'); // never takes a message
  const v = await call<{ xp: number; messages: number; level: number }>(
    '/v1/progression/viewers/9801',
  );
  expect([v.xp, v.messages]).toEqual([5, 1]);

  await call('/v1/lab/progression/rewards', {
    reward_id: 'citrouille-2026',
    kind: 'badge',
    label: 'Citrouille 2026',
    rarity: 'event',
  });
  const found = await call<{ twitch_user_id: string }[]>(
    '/v1/lab/progression/viewers?q=an',
  );
  expect(found.map((f) => f.twitch_user_id)).toEqual(['9801']);
  const g = await call<{ granted: string[] }>('/v1/lab/progression/grant', {
    reward_id: 'citrouille-2026',
    viewers: ['9801'],
    source: 'event',
    reference: 'halloween-2026',
  });
  expect(g.granted).toEqual(['9801']);
  const shown = await call<{ inventory: { id: string; reference: string }[] }>(
    '/v1/progression/viewers/9801',
  );
  expect(shown.inventory).toMatchObject([
    { id: 'citrouille-2026', reference: 'halloween-2026' },
  ]);
  // Every Lab Core route needs the Lab secret (the public reads are open on the main Core only).
  await expect(
    call('/v1/progression/leaderboard', undefined, false),
  ).rejects.toMatchObject({ status: 401 });
  expect(
    (await call<{ entries: unknown[] }>('/v1/progression/leaderboard')).entries,
  ).toHaveLength(1);
});
