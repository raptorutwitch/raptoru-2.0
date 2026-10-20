import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { setup } from '../../../core-api/test/helpers.js';
import { AlertMediaStore } from '../src/alerts/media-store.js';
import { AlertsRuntime } from '../src/alerts/runtime.js';
import {
  type LabCoreCall,
  type LabCoreEvents,
  localLabCoreClient,
  localLabCoreEvents,
} from '../src/lab-moderation/proxy.js';
import {
  cockpitClient,
  cockpitEvents,
} from '../src/prod-transport/production.js';
import { WordGameRuntime } from '../src/word-game/runtime.js';
import { cert, CHANNEL, pairedStudio } from './prod-fixture.js';

// Lot 9: Studio drives the Jeu des mots and supervises the real Twitch alerts in BOTH profiles, with the same
// runtimes: the Lab Core (Lab profile), or the main Core over the real production transport (HTTPS, installation
// credential, cockpit and its wins stream). The OBS sound source is Studio's local page; the Core never reaches OBS.

const PLAYER_DIR = join(import.meta.dirname, '..', 'word-game-player');
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

type Handle = (req: never, res: never, url: URL) => Promise<boolean>;

/** Studio's local server around one runtime (given once created, with the server's origin). */
async function studioServer() {
  let handle: Handle = async () => false;
  const server: Server = createServer((req, res) => {
    void handle(req as never, res as never, new URL(req.url!, origin)).then(
      (done) => {
        if (!done) res.writeHead(404).end();
      },
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(() => r(undefined)));
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
  const api = async (path: string, body?: unknown): Promise<any> => {
    const res = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, ...(await res.json()) };
  };
  return {
    origin,
    api,
    serve: (h: { handle: Handle }) => void (handle = (...a) => h.handle(...a)),
  };
}

/** The Jeu des mots runtime of Studio + its OBS sound source connected (the message ids it would play). */
async function wordGameStudio(o: {
  core: LabCoreCall;
  events: LabCoreEvents;
  environment: 'lab' | 'production';
  channelId: string;
}) {
  const dir = await mkdtemp(join(tmpdir(), 'lot9-wg-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const s = await studioServer();
  const rt = await WordGameRuntime.create({
    ...o,
    origin: s.origin,
    dir,
    playerDir: PLAYER_DIR,
  });
  s.serve(rt as never);
  cleanups.push(async () => rt.stop());
  const sounds: string[] = [];
  const obs = new AbortController();
  cleanups.push(async () => obs.abort());
  const token = rt.playerUrl.split('#')[1];
  const source = await fetch(`${s.origin}/word-game/events?t=${token}`, {
    signal: obs.signal,
  });
  expect(source.status).toBe(200);
  void (async () => {
    const reader = source.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (/^event: win$/m.test(block) && data)
            sounds.push(JSON.parse(data).message_id);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { ...s, rt, sounds };
}

const listeners = (game: unknown) =>
  (game as { winListeners: Set<unknown> }).winListeners.size;

let seq = 0;
const chatMessage = (channel: string, text: string, source: string) => ({
  channel_id: channel,
  message_id: `lot9-${++seq}`,
  text,
  chatter: {
    id: String(5000 + seq),
    login: `viewer${seq}`,
    display_name: `Viewer${seq}`,
    role: 'viewer',
  },
  source,
});

describe('Jeu des mots, Studio Lab profile (Lab Core, test wallet)', () => {
  it('panel and OBS sound on the Lab Core: one gain on the Lab wallet, one sound, never the canonical Wallet', async () => {
    const core = await setup();
    core.clock.set(new Date());
    const secret = 's'.repeat(40);
    const lab = createLabCore({ db: core.db, clock: core.clock, secret });
    await new Promise<void>((r) => lab.server.listen(0, '127.0.0.1', r));
    cleanups.push(() => {
      lab.server.closeAllConnections();
      return new Promise((r) => lab.server.close(() => r(undefined)));
    });
    const base = `http://127.0.0.1:${(lab.server.address() as AddressInfo).port}`;
    const call = localLabCoreClient(base, secret);
    // The Lab chat simulator's and the Lab adapter's doors (Studio secret).
    const post = (path: string, body: unknown) =>
      fetch(base + path, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + secret,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }).then((r) => expect(r.status).toBe(200));
    const s = await wordGameStudio({
      core: call,
      events: localLabCoreEvents(base, secret),
      environment: 'lab',
      channelId: '900100',
    });
    const state = await s.api('/api/word-game/state');
    expect(state).toMatchObject({ status: 200, environment: 'lab' });
    await vi.waitFor(() => expect(listeners(lab.wordGame)).toBe(1));
    await post('/v1/lab/stream', { channel_id: '900100', event: 'online' });
    expect(
      (await s.api('/api/word-game/actions', { action: 'stop' })).stopped,
    ).toBe(true);
    expect(
      (await s.api('/api/word-game/actions', { action: 'start' })).stopped,
    ).toBe(false);
    const after = await s.api('/api/word-game/actions', {
      action: 'new_word',
      request_id: crypto.randomUUID(),
    });
    const word = after.active[0].word as string;
    // The Lab simulator's message (allowed on the Lab Core only), delivered twice.
    const m = chatMessage('900100', word, 'simulator');
    await post('/v1/lab/chat', m);
    await post('/v1/lab/chat', m);
    await vi.waitFor(() => expect(s.sounds).toEqual([m.message_id]));
    const count = async (sql: string) =>
      Number(
        (
          await core.db.query<{ n: string }>(`select count(*) as n from ${sql}`)
        )[0]!.n,
      );
    expect(await count("lab_wallet_ledger where kind = 'word_game'")).toBe(1);
    expect(await count('wallet_transactions')).toBe(0);
  });
});

describe('Jeu des mots, Studio Production profile (main Core over HTTPS)', () => {
  it('panel through the cockpit, OBS sound through the wins stream: one sound per win, reconnection after a cut', async () => {
    const f = await pairedStudio(cleanups);
    const client = f.client();
    const s = await wordGameStudio({
      core: cockpitClient(client),
      events: cockpitEvents(client),
      environment: 'production',
      channelId: CHANNEL,
    });
    // The bot's doors of the same Core (bot secret), over HTTPS.
    const bot = (path: string, body: unknown) =>
      new Promise<{ status: number; body: Record<string, unknown> }>(
        (resolve, reject) => {
          const req = request(
            new URL(path, f.net.url()),
            {
              method: 'POST',
              ca: cert,
              headers: {
                authorization: 'Bearer bot-test-secret',
                'content-type': 'application/json',
              },
            },
            (res) => {
              let text = '';
              res.on('data', (c) => (text += c));
              res.on('end', () =>
                resolve({ status: res.statusCode!, body: JSON.parse(text) }),
              );
            },
          );
          req.on('error', reject);
          req.end(JSON.stringify(body));
        },
      );
    expect(await s.api('/api/word-game/state')).toMatchObject({
      status: 200,
      environment: 'production',
      channel_id: CHANNEL,
      live: false,
    });
    await vi.waitFor(() => expect(listeners(f.core.chat.wordGame)).toBe(1));
    expect(
      (
        await bot('/v1/bot/stream', {
          channel_id: CHANNEL,
          event: 'online',
          twitch_stream_id: '1',
        })
      ).status,
    ).toBe(200);
    expect(
      (await s.api('/api/word-game/actions', { action: 'stop' })).stopped,
    ).toBe(true);
    expect(
      (await s.api('/api/word-game/actions', { action: 'start' })).stopped,
    ).toBe(false);
    const newWord = async () =>
      (
        await s.api('/api/word-game/actions', {
          action: 'new_word',
          request_id: crypto.randomUUID(),
        })
      ).active.at(-1).word as string;
    // A simulated message never reaches the main Core's games.
    expect(
      (
        await bot(
          '/v1/bot/chat',
          chatMessage(CHANNEL, await newWord(), 'simulator'),
        )
      ).body.error,
    ).toBe('twitch_source_required');
    const word = (await s.api('/api/word-game/state')).active[0].word;
    const m = chatMessage(CHANNEL, word, 'twitch');
    await Promise.all([bot('/v1/bot/chat', m), bot('/v1/bot/chat', m)]);
    await vi.waitFor(() => expect(s.sounds).toEqual([m.message_id]));
    // The Core goes away and comes back (network cut, restart): Studio reconnects alone; nothing is replayed.
    await f.net.down();
    await vi.waitFor(() => expect(listeners(f.core.chat.wordGame)).toBe(0));
    await f.net.up();
    await vi.waitFor(() => expect(listeners(f.core.chat.wordGame)).toBe(1), {
      timeout: 10_000,
    });
    const m2 = chatMessage(CHANNEL, await newWord(), 'twitch');
    await bot('/v1/bot/chat', m2);
    await vi.waitFor(() =>
      expect(s.sounds).toEqual([m.message_id, m2.message_id]),
    );
    await bot('/v1/bot/chat', m); // redelivered after the reconnection
    await new Promise((r) => setTimeout(r, 300));
    expect(s.sounds).toHaveLength(2);
  }, 30_000);
});

describe('real Twitch alerts, Studio Production profile (main Core over HTTPS)', () => {
  it('reception reported by the production bot, read only; a real sub shown once by the OBS source', async () => {
    const f = await pairedStudio(cleanups);
    const client = f.client();
    const dir = await mkdtemp(join(tmpdir(), 'lot9-alerts-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    // The sub variant's media, as imported by alerts/import-cli.ts (dummy bytes).
    const media = await AlertMediaStore.open(join(dir, 'media'));
    const fake = join(dir, 'fake.bin');
    await writeFile(fake, 'x');
    await media.import([
      { name: 'Eren Sub Glitch.webm', from: fake },
      { name: 'Eren Voiceline Sub.mp3', from: fake },
    ]);
    const s = await studioServer();
    const rt = await AlertsRuntime.create({
      channelId: CHANNEL,
      core: client,
      environment: 'production',
      origin: s.origin,
      dir: join(dir, 'alerts'),
      playerDir: join(import.meta.dirname, '..', 'alerts-player'),
      media,
    });
    s.serve(rt as never);
    const bot = (path: string, body: unknown) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          new URL(path, f.net.url()),
          {
            method: 'POST',
            ca: cert,
            headers: {
              authorization: 'Bearer bot-test-secret',
              'content-type': 'application/json',
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode!));
          },
        );
        req.on('error', reject);
        req.end(JSON.stringify(body));
      });

    // No report yet: unavailable, said so; Studio never changes the bot's mode.
    expect(await s.api('/api/alerts/twitch')).toMatchObject({
      status: 200,
      environment: 'production',
      managed_by: 'production_bot',
      bot: null,
      max_age_ms: null,
    });
    expect(await s.api('/api/alerts/twitch', { mode: 'active' })).toMatchObject(
      { status: 409, error: 'set_on_production_bot' },
    );
    const report = {
      channel_id: CHANNEL,
      mode: 'active',
      subscriptions: ['channel.chat.notification'],
      refused: ['channel.follow'],
      pending: 0,
    };
    expect(await bot('/v1/bot/alerts/status', report)).toBe(200);
    expect(await s.api('/api/alerts/twitch')).toMatchObject({
      mode: 'active',
      ingestion_running: true,
      follow_scope: false,
      bot: { mode: 'active', refused: ['channel.follow'], pending: 0 },
    });
    // The bot's doors refuse another channel and a missing secret.
    expect(
      await bot('/v1/bot/alerts/status', { ...report, channel_id: '1' }),
    ).toBe(409);

    // A real sub received three times (EventSub redelivery, outbox resume): one alert, shown once.
    const sub = {
      channel_id: CHANNEL,
      source: 'twitch',
      source_event_id: 'twitch-msg-1',
      type: 'sub',
      actor: { id: '4242', login: 'subber', display_name: 'Subber' },
      tier: '1000',
      occurred_at: new Date().toISOString(),
    };
    for (let i = 0; i < 3; i++)
      expect(await bot('/v1/bot/alerts/events', sub)).toBe(200);
    const state = await s.api('/api/alerts/state');
    expect(state.queued).toHaveLength(1);
    expect(state.queued[0].data.pseudo).toBe('Subber');
    expect(
      (await s.api('/api/alerts/twitch')).last_twitch_event_at,
    ).not.toBeNull();
    // A Studio cannot pose as Twitch.
    expect(
      await client('/v1/studio/alerts/events', {
        ...sub,
        source_event_id: 'forged',
      }).catch((e: { status: number }) => e.status),
    ).toBe(403);
    const token = new URL(rt.playerUrl).hash.slice(1);
    const next = () =>
      fetch(`${s.origin}/alerts/next`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, consumer_id: 'obs-1' }),
      }).then((r) => r.json());
    const shown = await next();
    expect(shown.alert).toMatchObject({
      variant: { id: 'eren_sub' },
      data: { pseudo: 'Subber' },
    });
    expect((await next()).alert).toBeNull();
  }, 30_000);
});
