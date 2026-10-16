import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatRole, createLabChatIngest } from '../src/lab-chat-ingest.js';

// Lab chat ingestion: forwards, never decides (Core recognizes the commands and the roles).

function setup(live: { id: string; started_at: string } | null = null) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const subs: string[] = [];
  const ingest = createLabChatIngest({
    lab: async (path, body) => {
      calls.push({ path, body: body as Record<string, unknown> });
      return { ok: true };
    },
    labChannelId: '900100',
    broadcasterId: '83603689',
    tokenUserId: '111',
    subscribe: async (type) => {
      subs.push(type);
    },
    getStream: async () => live,
    log: () => {},
  });
  return { ingest, calls, subs };
}

const chat = (over: Record<string, unknown> = {}) => ({
  message_id: 'm-1',
  chatter_user_id: '222',
  chatter_user_login: 'viewer',
  chatter_user_name: 'Viewer',
  message: { text: '!join' },
  badges: [],
  ...over,
});

describe('Lab chat ingestion (Twitch → Lab Core, every module)', () => {
  it('subscribes to the chat and the stream state of the channel', async () => {
    const { ingest, subs } = setup();
    await ingest.handlers.subscribe('s-1');
    expect(subs).toEqual([
      'stream.online',
      'stream.offline',
      'channel.chat.message',
    ]);
  });

  it('Jeu des mots (Lot 5): every message is forwarded unchanged; Core decides', async () => {
    const { ingest, calls } = setup();
    const texts = ['!mots', 'bonjour', 'je pense que c’est angle', 'Requin'];
    for (const [i, text] of texts.entries())
      await ingest.handlers.notification(
        'channel.chat.message',
        chat({ message_id: `m-${i}`, message: { text } }),
        `e-${i}`,
        't',
      );
    expect(calls.map((c) => [c.path, c.body.message_id, c.body.text])).toEqual(
      texts.map((text, i) => ['/v1/lab/chat', `m-${i}`, text]),
    );
  });

  it('the bot account’s own messages (word announcements included) are never forwarded', async () => {
    const { ingest, calls } = setup();
    for (const text of ['🔸 lagne 🔸', 'Alice a trouvé angle !', '!mots'])
      await ingest.handlers.notification(
        'channel.chat.message',
        chat({ chatter_user_id: '111', message: { text } }),
        'e-1',
        't',
      );
    expect(calls).toEqual([]);
  });

  it('forwards chat commands with the badge role; forwards plain messages; ignores its own', async () => {
    const { ingest, calls } = setup();
    await ingest.handlers.notification(
      'channel.chat.message',
      chat(),
      'e-1',
      't',
    );
    await ingest.handlers.notification(
      'channel.chat.message',
      chat({
        message_id: 'm-2',
        message: { text: '!annuletombola' },
        badges: [{ set_id: 'moderator' }],
      }),
      'e-2',
      't',
    );
    await ingest.handlers.notification(
      'channel.chat.message',
      chat({ message_id: 'm-3', message: { text: 'salut' } }),
      'e-3',
      't',
    );
    await ingest.handlers.notification(
      'channel.chat.message',
      chat({ chatter_user_id: '111' }),
      'e-4',
      't',
    );
    expect(calls).toEqual([
      {
        path: '/v1/lab/chat',
        body: {
          channel_id: '900100',
          message_id: 'm-1',
          text: '!join',
          chatter: {
            id: '222',
            login: 'viewer',
            display_name: 'Viewer',
            role: 'viewer',
            badges: [],
          },
          source: 'twitch',
        },
      },
      expect.objectContaining({
        body: expect.objectContaining({
          chatter: expect.objectContaining({
            role: 'moderator',
            badges: ['moderator'],
          }),
        }),
      }),
      expect.objectContaining({
        body: expect.objectContaining({ message_id: 'm-3', text: 'salut' }),
      }),
    ]);
  });

  it('offline → live / live → offline open and end the Lab stream session; start-up syncs the real state', async () => {
    const { ingest, calls } = setup({
      id: '317823244002',
      started_at: '2026-10-01T18:00:00Z',
    });
    await ingest.handlers.notification(
      'stream.online',
      { id: '4242' },
      'e-1',
      't',
    );
    await ingest.handlers.notification('stream.offline', {}, 'e-2', 't');
    expect(await ingest.syncStream()).toBe(true);
    expect(calls.map((c) => c.body)).toEqual([
      { channel_id: '900100', event: 'online', twitch_stream_id: '4242' },
      { channel_id: '900100', event: 'offline' },
      {
        channel_id: '900100',
        event: 'online',
        twitch_stream_id: '317823244002',
      },
    ]);
  });

  it('ASTRA-P1-003: an offline lost during a Core outage is repaired from Helix; a steady state sends nothing', async () => {
    let coreUp = true;
    let live: { id: string; started_at: string } | null = {
      id: '4242',
      started_at: '2026-10-01T18:00:00Z',
    };
    const sent: unknown[] = [];
    const ingest = createLabChatIngest({
      lab: async (_path, body) => {
        if (!coreUp) throw new Error('ECONNREFUSED');
        sent.push(body);
        return { ok: true };
      },
      labChannelId: '900100',
      broadcasterId: '83603689',
      tokenUserId: '111',
      subscribe: async () => {},
      getStream: async () => {
        if (live === undefined) throw new Error('helix down');
        return live;
      },
      log: () => {},
    });
    await ingest.syncStream(); // connection: online delivered
    expect(await ingest.reconcileStream()).toBe(false); // steady: nothing sent
    coreUp = false;
    live = null;
    await ingest.handlers.notification('stream.offline', {}, 'e-1', 't'); // lost
    coreUp = true;
    expect(await ingest.reconcileStream()).toBe(true); // repaired
    expect(sent.at(-1)).toEqual({ channel_id: '900100', event: 'offline' });
    // Offline steadily (a simulated session in Studio would stay open): nothing more.
    expect(await ingest.reconcileStream()).toBe(false);
    expect(sent).toHaveLength(2);
    // Helix unreachable: no confirmation, nothing sent.
    live = undefined as never;
    await expect(ingest.reconcileStream()).rejects.toThrow('helix down');
    expect(sent).toHaveLength(2);
  });

  it('a Lab Core failure is logged, never thrown into the EventSub loop', async () => {
    const { ingest } = createFailing();
    await expect(
      ingest.handlers.notification('channel.chat.message', chat(), 'e-1', 't'),
    ).resolves.toBeUndefined();
    ingest.close(); // its background retry (ASTRA-P1-002) is not part of this test
  });

  it('badges → role', () => {
    expect(
      chatRole([{ set_id: 'broadcaster' }, { set_id: 'subscriber' }]),
    ).toBe('broadcaster');
    expect(chatRole([{ set_id: 'moderator' }])).toBe('moderator');
    expect(chatRole([{ set_id: 'vip' }])).toBe('viewer');
    expect(chatRole(undefined)).toBe('viewer');
  });
});

function createFailing() {
  return {
    ingest: createLabChatIngest({
      lab: async () => {
        throw new Error('lab_core_503');
      },
      labChannelId: '900100',
      broadcasterId: '83603689',
      tokenUserId: '111',
      subscribe: async () => {},
      getStream: async () => null,
      log: () => {},
    }),
  };
}

// ASTRA-P1-002 (decided): chat commands whose forward failed are retried in memory, same message_id,
// 1 / 2 / 4 / 8 s, never started later than 15 s after reception; Core deduplicates and decides.
describe('chat retry when Core is briefly unreachable', () => {
  afterEach(() => vi.useRealTimers());

  /** Fake Lab Core: dedupes by message_id like the real one; `down` until `upAt` (ms). */
  function retrySetup(
    opts: { upAt?: number; status?: number; lostAnswer?: boolean } = {},
  ) {
    vi.useFakeTimers();
    const t0 = Date.now();
    const seen = new Set<string>();
    const attempts: number[] = [];
    let effects = 0;
    const logs: string[] = [];
    const ingest = createLabChatIngest({
      lab: async (_path, body) => {
        attempts.push(Date.now() - t0);
        if (opts.status) throw new Error(`lab_core_${opts.status}`);
        if (Date.now() - t0 < (opts.upAt ?? 0)) throw new Error('fetch failed');
        const id = (body as { message_id: string }).message_id;
        if (!seen.has(id)) {
          seen.add(id);
          effects += 1;
          // First answer lost after Core committed (timeout on the bot side).
          if (opts.lostAnswer && effects === 1) throw new Error('TimeoutError');
          return { outcome: 'joined' };
        }
        return { outcome: 'already_joined', replayed: true };
      },
      labChannelId: '900100',
      broadcasterId: '83603689',
      tokenUserId: '111',
      subscribe: async () => {},
      getStream: async () => null,
      log: (...a: unknown[]) => void logs.push(a.join(' ')),
    });
    const send = (text = '!join') =>
      ingest.handlers.notification(
        'channel.chat.message',
        chat({ message: { text } }),
        'e-1',
        't',
      );
    return { ingest, attempts, logs, send, effects: () => effects };
  }

  it('Core down at the first send, back within 15 s: one admission, no retry after success', async () => {
    const f = retrySetup({ upAt: 2_500 });
    await f.send(); // never blocks the EventSub loop
    expect(f.attempts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.attempts).toEqual([0, 1000, 3000]); // 3 s: Core answers, nothing after
    expect(f.effects()).toBe(1);
    expect(f.ingest.pendingChatRetries()).toBe(0);
    expect(f.logs.at(-1)).toMatch(/delivered after 2 retries/);
  });

  it('first answer lost after Core committed: the retry is deduplicated, one effect', async () => {
    const f = retrySetup({ lostAnswer: true });
    await f.send();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.attempts).toEqual([0, 1000]);
    expect(f.effects()).toBe(1);
  });

  it('the same message received several times: one effect', async () => {
    const f = retrySetup();
    await f.send();
    await f.send();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.effects()).toBe(1);
  });

  it('Core down for more than 15 s: last attempt at 15 s, then an explicit drop, nothing later', async () => {
    const f = retrySetup({ upAt: 60_000 });
    await f.send();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.attempts).toEqual([0, 1000, 3000, 7000, 15000]);
    expect(f.effects()).toBe(0);
    expect(f.logs.at(-1)).toMatch(/dropped: Core unreachable for 15 s/);
  });

  it('a Core refusal (4xx) is final: no retry', async () => {
    const f = retrySetup({ status: 400 });
    await f.send();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.attempts).toEqual([0]);
    expect(f.logs.at(-1)).toMatch(/refused by Core/);
  });

  it('a plain message (Jeu des mots answer) follows the same policy: 5xx retried, dedup, 4xx final', async () => {
    const down = retrySetup({ upAt: 2_500 });
    await down.send('angle');
    await down.send('angle'); // same message_id received twice
    await vi.advanceTimersByTimeAsync(60_000);
    expect(down.effects()).toBe(1);
    expect(down.attempts.slice(0, 2)).toEqual([0, 0]);
    expect(down.attempts).toContain(1000);
    vi.useRealTimers();
    const refused = retrySetup({ status: 400 });
    await refused.send('angle');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refused.attempts).toEqual([0]);
    expect(refused.logs.at(-1)).toMatch(/refused by Core/);
  });

  it('adapter stopping during the retries: pending ones are dropped, nothing is sent later', async () => {
    const f = retrySetup({ upAt: 2_500 });
    await f.send();
    expect(f.ingest.pendingChatRetries()).toBe(1);
    f.ingest.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.attempts).toEqual([0]);
    expect(f.effects()).toBe(0);
    expect(f.logs.at(-1)).toMatch(/dropped: adapter stopping/);
  });
});
