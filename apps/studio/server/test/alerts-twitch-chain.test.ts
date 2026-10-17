import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import { createLabAlertsIngest } from '../../../twitch-bot/src/lab-alerts-ingest.js';
import { createLabChatIngest } from '../../../twitch-bot/src/lab-chat-ingest.js';
import { createEventSubRouter } from '../../../twitch-bot/src/twitch/eventsub.js';
import {
  BROADCASTER,
  cheer,
  EVENTS,
  frame,
  READER,
} from '../../../twitch-bot/test/fixtures/eventsub-alerts.js';
import { AlertMediaStore } from '../src/alerts/media-store.js';
import { AlertsRuntime } from '../src/alerts/runtime.js';

// Twitch alerts, real events (17/10/2026) — the whole input chain with the REAL Lab Core (in-memory PGlite): EventSub
// frames shaped like the Twitch reference → the bot's router → Lab chat adapter → alerts adapter (ACTIVE) → POST
// /v1/lab/alerts/events → deduplication, variant, family queues. And Studio's mode switch (OFF / TEST / ACTIVE).

const CH = '900100';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function labCore() {
  const db = createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );
  await migrate(db, 'lab');
  const secret = randomBytes(32).toString('hex');
  const server: Server = createLabCore({
    db,
    clock: systemClock,
    secret,
  }).server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    server.close();
    await db.close();
  });
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`lab_core_${res.status}`);
    return out;
  };
  return { call, db };
}

/** One adapter run (a bot / adapter start): fresh router memory, mode ACTIVE, the Lab chat adapter wiring. */
function adapter(lab: (path: string, body: unknown) => Promise<unknown>) {
  const outcomes: string[] = [];
  const alerts = createLabAlertsIngest({
    mode: 'active',
    channelId: CH,
    broadcasterId: BROADCASTER,
    tokenUserId: READER,
    scopes: ['user:read:chat', 'moderator:read:followers'],
    lab,
    log: (...a: unknown[]) => outcomes.push(a.join(' ')),
  });
  const ingest = createLabChatIngest({
    lab,
    labChannelId: CH,
    broadcasterId: BROADCASTER,
    tokenUserId: READER,
    subscribe: async () => {},
    getStream: async () => null,
    alerts,
    log: () => {},
  });
  const route = createEventSubRouter(ingest.handlers);
  return {
    outcomes,
    deliver: (type: string, event: object, id: string, version = '1') =>
      route(frame(type, version, event as Record<string, unknown>, id), true),
  };
}

/** Every alert source once (the EventSub message ids are those of this session). */
async function burst(a: ReturnType<typeof adapter>, session: string) {
  await a.deliver('channel.follow', EVENTS.follow, 'follow-msg', '2');
  await a.deliver('channel.chat.notification', EVENTS.sub, `${session}-1`);
  await a.deliver('channel.chat.notification', EVENTS.resub, `${session}-2`);
  await a.deliver(
    'channel.chat.notification',
    EVENTS.giftTargeted,
    `${session}-3`,
  );
  for (const [i, e] of EVENTS.community.entries())
    await a.deliver('channel.chat.notification', e, `${session}-4-${i}`);
  await a.deliver(
    'channel.chat.message',
    cheer(100, { messageId: 'cheer-1' }),
    `${session}-5`,
  );
  await a.deliver(
    'channel.chat.message',
    cheer(5, { messageId: 'cheer-small' }),
    `${session}-6`,
  );
  await a.deliver('channel.chat.notification', EVENTS.raid, `${session}-7`);
}

type State = {
  queued: {
    type: string;
    family: string;
    variant_id: string;
    data: Record<string, unknown>;
  }[];
  in_flight: unknown[];
};

describe('real Twitch events → Lab Core alert queues', () => {
  it('one alert per real event, community gift once (recipients absorbed), small cheer below threshold, families apart', async () => {
    const core = await labCore();
    const a = adapter(core.call);
    await burst(a, 'sess1');
    expect(a.outcomes.filter((l) => l.includes('→'))).toEqual([
      '[lab-alerts] follow Cool_User (follow-msg) → queued',
      '[lab-alerts] sub Alice (n-sub-1) → queued',
      '[lab-alerts] resub viewer23 (d62235c8-47ff-a4f4--84e8-5a29a65a9c03) → queued',
      '[lab-alerts] gift_targeted Alice (n-gift-t-1) → queued',
      '[lab-alerts] gift_community Bob (n-cg-777) → queued',
      '[lab-alerts] gift_recipient Bob (n-cg-777-401) → absorbed',
      '[lab-alerts] gift_recipient Bob (n-cg-777-402) → absorbed',
      '[lab-alerts] gift_recipient Bob (n-cg-777-403) → absorbed',
      '[lab-alerts] bits viewer32 (cheer-1) → queued',
      '[lab-alerts] bits viewer32 (cheer-small) → below_threshold',
      '[lab-alerts] raid GrosRaideur (n-raid-1) → queued',
    ]);
    const state = (await core.call(
      `/v1/lab/alerts/${CH}/state`,
    )) as unknown as State;
    expect(state.queued.map((q) => [q.type, q.family])).toEqual([
      ['follow', 'follow'],
      ['sub', 'subscription'],
      ['resub', 'subscription'],
      ['gift_targeted', 'subscription'],
      ['gift_community', 'subscription'],
      ['bits', 'bits'],
      ['raid', 'raid'],
    ]);
    const byType = Object.fromEntries(state.queued.map((q) => [q.type, q]));
    expect(byType.gift_targeted!.data).toMatchObject({ recipient: 'Chanceux' });
    expect(byType.gift_community!.data).toMatchObject({
      count: 3,
      pseudo: 'Bob',
    });
    expect(byType.gift_community!.variant_id).toMatch(/subgift/);
    expect(byType.bits!.data).toMatchObject({
      amount: '100',
      pseudo: 'viewer32',
    });
    expect(byType.raid!.data).toMatchObject({
      viewers: 42,
      pseudo: 'GrosRaideur',
    });
    // Families stay independent: one source gets the follow, the sub, the bits and the raid at once (not the resub).
    const claimed: string[] = [];
    for (;;) {
      const { alert } = (await core.call(`/v1/lab/alerts/${CH}/claim`, {
        consumer_id: 'obs-test',
      })) as { alert: { type: string } | null };
      if (!alert) break;
      claimed.push(alert.type);
    }
    expect(claimed.sort()).toEqual(['bits', 'follow', 'raid', 'sub']);
  });

  it('bot restart / EventSub reconnection replaying the same events: nothing new queued (Core dedup by Twitch id)', async () => {
    const core = await labCore();
    await burst(adapter(core.call), 'sess1');
    const before = (await core.call(
      `/v1/lab/alerts/${CH}/state`,
    )) as unknown as State;
    // A new adapter process, a new EventSub session: other message ids, the same Twitch events.
    const again = adapter(core.call);
    await burst(again, 'sess2');
    expect(
      again.outcomes
        .filter((l) => l.includes('→'))
        .every((l) => l.endsWith('→ duplicate')),
    ).toBe(true);
    const after = (await core.call(
      `/v1/lab/alerts/${CH}/state`,
    )) as unknown as State;
    expect(after.queued).toHaveLength(before.queued.length);
    expect(after.queued.map((q) => q.variant_id)).toEqual(
      before.queued.map((q) => q.variant_id),
    );
  });
});

describe('Studio « Événements Twitch réels » mode', () => {
  it('OFF by default and after an unreadable file; saved; a change restarts the adapter; invalid refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alerts-mode-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    let restarts = 0;
    let rt: AlertsRuntime | null = null;
    const server = createServer((req, res) => {
      void rt!.handle(req, res, new URL(req.url!, origin));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    cleanups.push(async () => server.close());
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const deps = {
      channelId: CH,
      core: (async () => ({})) as never,
      origin,
      dir,
      playerDir: join(import.meta.dirname, '..', 'alerts-player'),
      media: await AlertMediaStore.open(join(dir, 'media')),
      twitch: {
        status: () => ({
          ingestion_enabled: true,
          ingestion_running: true,
          token_login: 'lecroupier_',
          follow_scope: false,
        }),
        restart: async () => {
          restarts++;
        },
      },
    };
    rt = await AlertsRuntime.create(deps);
    expect(rt.twitchMode).toBe('off');
    const call = (method: string, body?: unknown) =>
      fetch(`${origin}/api/alerts/twitch`, {
        method,
        headers: {
          'x-raptoru-studio': '1',
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    expect(await (await call('GET')).json()).toEqual({
      mode: 'off',
      ingestion_enabled: true,
      ingestion_running: true,
      token_login: 'lecroupier_',
      follow_scope: false,
    });
    expect((await call('POST', { mode: 'test' })).status).toBe(200);
    expect(restarts).toBe(1);
    expect(rt.twitchMode).toBe('test');
    expect(
      JSON.parse(await readFile(join(dir, 'twitch-mode.json'), 'utf8')),
    ).toEqual({ mode: 'test' });
    // Same mode again: nothing restarted.
    await call('POST', { mode: 'test' });
    expect(restarts).toBe(1);
    expect((await call('POST', { mode: 'on' })).status).toBe(400);
    expect(rt.twitchMode).toBe('test');
    // Without the Studio header: refused.
    expect(
      (
        await fetch(`${origin}/api/alerts/twitch`, {
          method: 'POST',
          body: '{"mode":"active"}',
        })
      ).status,
    ).toBe(403);
    // Kept across a Studio restart; an unreadable file means OFF.
    expect((await AlertsRuntime.create(deps)).twitchMode).toBe('test');
    await writeFile(join(dir, 'twitch-mode.json'), '{oops');
    expect((await AlertsRuntime.create(deps)).twitchMode).toBe('off');
  });
});
