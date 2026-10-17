import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlertEventInput } from '@raptoru/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exactAmount,
  jwtChannel,
  readTip,
  SE_RECONNECT_MS,
  type SeSocket,
  SeTipsLink,
} from '../src/alerts/se-tips.js';
import {
  FAKE_JWT,
  SE_MODERATION,
  SE_TIP_EXAMPLE,
  tip,
} from './fixtures/se-tips.js';

// Real StreamElements donations (17/10/2026): Astro tip messages (official examples) → journal / donation event, and
// the link itself (modes, token, reconnection) with a fake WebSocket and a fake Core. No real connection, no payment.

const AT = new Date('2026-10-17T20:00:00Z');
const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('readTip (StreamElements channel.tips → donation event)', () => {
  it('the official example: exact name, exact amount, currency, date, id; never the email / geo', () => {
    const { entry, event } = readTip('channel.tips', SE_TIP_EXAMPLE.data, AT);
    expect(event).toEqual({
      source: 'external',
      source_event_id: 'streamelements-tip-67b5f39d07ecd4c594e60f73',
      type: 'donation',
      actor: { display_name: 'Styler' },
      amount: { value: 42, decimal_place: 1, currency: 'USD' },
      provider: 'streamelements',
      occurred_at: '2025-02-19T15:07:09.302Z',
    });
    // Valid for Core's contract.
    expect(
      AlertEventInput.safeParse({ channel_id: '900100', ...event }).success,
    ).toBe(true);
    expect(entry).toMatchObject({
      tip_id: '67b5f39d07ecd4c594e60f73',
      name: 'Styler',
      amount: '4.2',
      currency: 'USD',
      message: null,
      status: 'success',
      approved: 'allowed',
    });
    expect(JSON.stringify({ entry, event })).not.toMatch(/styler@|"ZZ"|geo/);
  });

  it('the public name exactly as typed: case, spaces, accents, emoji, absurd names, HTML kept as text', () => {
    for (const name of [
      'Le Grand Gâteau 🎂',
      'xXx_DaRk_KeVin_xXx',
      'Un pigeon qui a un compte PayPal',
      '<img src=x onerror=alert(1)>',
      'Été  à   Noël',
    ]) {
      const { event } = readTip(
        'channel.tips',
        tip({ username: name }).data,
        AT,
      );
      expect(event!.actor).toEqual({ display_name: name });
    }
    // Only the outer spaces go (Core trims names); a name over 64 characters keeps its first 64 (emoji kept whole).
    expect(
      readTip('channel.tips', tip({ username: '  Bob  ' }).data, AT).event!
        .actor,
    ).toEqual({ display_name: 'Bob' });
    const long = '🦖'.repeat(70);
    const cutName = readTip('channel.tips', tip({ username: long }).data, AT)
      .event!.actor!.display_name;
    expect([...cutName]).toHaveLength(64);
    expect(cutName).toBe('🦖'.repeat(64));
    // Fallback only when the name is really absent.
    for (const username of [undefined, '', '   ', 42]) {
      const { event } = readTip('channel.tips', tip({ username }).data, AT);
      expect(event!.actor).toBeUndefined();
      expect(event!.anonymous).toBe(true);
    }
  });

  it('message: kept as untrusted text (max 500), absent or empty → no message', () => {
    const msg = '<script>alert("x")</script> Merci ! 🎉';
    expect(
      readTip('channel.tips', tip({ message: msg }).data, AT).event!.message,
    ).toBe(msg);
    expect([
      ...readTip('channel.tips', tip({ message: 'é'.repeat(600) }).data, AT)
        .event!.message!,
    ]).toHaveLength(500);
    for (const message of [undefined, '', '   ', null])
      expect(
        readTip('channel.tips', tip({ message }).data, AT).event!.message,
      ).toBeUndefined();
  });

  it('amounts exactly as sent (no float rounding), currency normalized; invalid ones refused', () => {
    expect(exactAmount(5)).toEqual({ value: 5, decimal_place: 0 });
    expect(exactAmount(4.2)).toEqual({ value: 42, decimal_place: 1 });
    expect(exactAmount(0.1)).toEqual({ value: 1, decimal_place: 1 });
    expect(exactAmount(19.99)).toEqual({ value: 1999, decimal_place: 2 });
    expect(exactAmount(1000000)).toEqual({ value: 1000000, decimal_place: 0 });
    expect(exactAmount('12.34')).toEqual({ value: 1234, decimal_place: 2 });
    for (const bad of [-1, Number.NaN, Infinity, '1,5', 'abc', null, {}, 1e21])
      expect(exactAmount(bad)).toBeNull();
    expect(
      readTip('channel.tips', tip({ amount: 19.99, currency: 'eur' }).data, AT)
        .event!.amount,
    ).toEqual({ value: 1999, decimal_place: 2, currency: 'EUR' });
    for (const [over, why] of [
      [{ amount: 'x' }, 'montant'],
      [{ amount: undefined }, 'montant'],
      [{ currency: 'EURO' }, 'devise'],
      [{ currency: undefined }, 'devise'],
    ] as const) {
      const r = readTip('channel.tips', tip(over).data, AT);
      expect(r.event).toBeNull();
      expect(r.entry.detail).toContain(why);
    }
  });

  it('only a completed, allowed tip makes an alert: other status, pending / rejected moderation refused', () => {
    for (const [over, why] of [
      [{ status: 'failed' }, 'transaction non confirmée'],
      [{ status: 'refunded' }, 'transaction non confirmée'],
      [{ approved: 'pending' }, 'en attente de modération'],
      [{ approved: 'rejected' }, 'refusé par la modération'],
      [{ _id: undefined }, 'identifiant'],
    ] as const) {
      const r = readTip('channel.tips', tip(over).data, AT);
      expect(r.event).toBeNull();
      expect(r.entry.decision).toBe('ignored');
      expect(r.entry.detail).toContain(why);
    }
    // Fields SE did not send are not guessed: no status / approved → accepted.
    expect(
      readTip(
        'channel.tips',
        tip({ status: undefined, approved: undefined }).data,
        AT,
      ).event,
    ).not.toBeNull();
    expect(
      readTip('channel.tips.moderation', SE_MODERATION('allowed').data, AT)
        .event,
    ).not.toBeNull();
    expect(
      readTip('channel.tips.moderation', SE_MODERATION('pending').data, AT)
        .event,
    ).toBeNull();
  });

  it('malformed messages never throw', () => {
    for (const data of [
      null,
      undefined,
      'x',
      42,
      [],
      { donation: 'x' },
      { donation: { user: null } },
    ])
      expect(() => readTip('channel.tips', data, AT)).not.toThrow();
  });

  it('the SE channel id of a JWT is read locally (room); garbage gives none', () => {
    expect(jwtChannel(FAKE_JWT)).toBe('5ad23dcc18fff500d78c5348');
    expect(jwtChannel('not-a-jwt')).toBeNull();
  });
});

// --- the link ---------------------------------------------------------------------------------------------------

class FakeSocket implements SeSocket {
  sent: { type: string; nonce: string; data: Record<string, string> }[] = [];
  closed = false;
  onmessage: SeSocket['onmessage'] = null;
  onclose: SeSocket['onclose'] = null;
  onerror: SeSocket['onerror'] = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  push(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  welcome() {
    this.push({ type: 'welcome', data: { client_id: 'c1' } });
  }
  ok() {
    for (const s of this.sent)
      if (s.type === 'subscribe')
        this.push({
          type: 'response',
          nonce: s.nonce,
          room: '5ad23dcc18fff500d78c5348',
          data: { message: 'successfully subscribed to topic' },
        });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

async function link(
  o: {
    core?: (path: string, body: unknown) => Promise<unknown>;
    main?: boolean;
    dir?: string;
  } = {},
) {
  const dir = o.dir ?? (await mkdtemp(join(tmpdir(), 'se-tips-')));
  if (!o.dir) dirs.push(dir);
  const sockets: FakeSocket[] = [];
  const posts: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const se = await SeTipsLink.open({
    dir,
    channelId: '900100',
    core: (async (path: string, body: unknown) => {
      posts.push(body as Record<string, unknown>);
      return o.core ? o.core(path, body) : { outcome: 'queued' };
    }) as never,
    fromMain: () => o.main ?? true,
    socket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    now: () => AT,
    log: (l) => lines.push(l),
  });
  const last = () => sockets.at(-1)!;
  const settle = () => new Promise((r) => setTimeout(r, 50)); // Core answers + journal file write
  return { se, sockets, posts, lines, last, dir, settle };
}

describe('SeTipsLink — modes OFF / TEST / ACTIVE', () => {
  it('OFF (default): no connection even with a token', async () => {
    const t = await link();
    expect(t.se.mode).toBe('off');
    t.se.setToken('jwt', FAKE_JWT, null);
    expect(t.sockets).toHaveLength(0);
    expect(t.se.status()).toMatchObject({
      state: 'off',
      token: { present: true, type: 'jwt' },
    });
  });

  it('TEST: connects, subscribes tips + moderation with the token and the JWT channel; tips journaled, NEVER sent to Core', async () => {
    const t = await link();
    t.se.setToken('jwt', FAKE_JWT, null);
    await t.se.setMode('test');
    expect(t.last().url).toBe('wss://astro.streamelements.com/');
    t.last().welcome();
    expect(
      t
        .last()
        .sent.map((s) => [
          s.type,
          s.data.topic,
          s.data.room,
          s.data.token_type,
        ]),
    ).toEqual([
      ['subscribe', 'channel.tips', '5ad23dcc18fff500d78c5348', 'jwt'],
      [
        'subscribe',
        'channel.tips.moderation',
        '5ad23dcc18fff500d78c5348',
        'jwt',
      ],
    ]);
    expect(t.last().sent[0]!.data.token).toBe(FAKE_JWT);
    t.last().ok();
    expect(t.se.status()).toMatchObject({
      state: 'connected',
      room: '5ad23dcc18fff500d78c5348',
      topics: [
        { topic: 'channel.tips', subscribed: true },
        { topic: 'channel.tips.moderation', subscribed: true },
      ],
    });
    t.last().push(SE_TIP_EXAMPLE);
    t.last().push(tip({ _id: 'bad1', status: 'failed' }));
    await t.settle();
    expect(t.posts).toEqual([]);
    expect(t.se.status().journal.map((e) => [e.tip_id, e.decision])).toEqual([
      ['bad1', 'ignored'],
      ['67b5f39d07ecd4c594e60f73', 'test'],
    ]);
    expect(t.se.status().last_event).toMatchObject({ tip_id: 'bad1' });
  });

  it('ACTIVE: allowed tips go to the Lab Core (donation event), duplicates said as such; TEST ↔ ACTIVE keeps the connection', async () => {
    let n = 0;
    const t = await link({
      core: async () => ({ outcome: n++ ? 'duplicate' : 'queued' }),
    });
    t.se.setToken('jwt', FAKE_JWT, null);
    await t.se.setMode('test');
    t.last().welcome();
    await t.se.setMode('active');
    expect(t.sockets).toHaveLength(1);
    t.last().push(SE_TIP_EXAMPLE);
    t.last().push(SE_MODERATION('allowed'));
    t.last().push(SE_MODERATION('pending'));
    await t.settle();
    expect(t.posts).toHaveLength(2);
    expect(t.posts[0]).toMatchObject({
      channel_id: '900100',
      source: 'external',
      source_event_id: 'streamelements-tip-67b5f39d07ecd4c594e60f73',
      type: 'donation',
      actor: { display_name: 'Styler' },
    });
    // Journal order = when each one was settled (Core answers come after the pending tip's refusal).
    expect(
      t.se
        .status()
        .journal.map((e) => e.decision)
        .sort(),
    ).toEqual(['duplicate', 'ignored', 'queued']);
    await t.se.setMode('off');
    expect(t.last().closed).toBe(true);
    expect(t.se.state).toBe('off');
  });
});

describe('SeTipsLink — token, reconnection, errors', () => {
  it('the token is never in a status, the journal file or a log line; only Electron main may hand it over', async () => {
    const t = await link({ main: false });
    const replies: [number, unknown][] = [];
    const reply = (s: number, b: unknown) => replies.push([s, b]);
    const req = (method: string) => ({ method }) as IncomingMessage;
    await t.se.api(
      req('POST'),
      '/connect',
      async () => ({ token_type: 'jwt', token: FAKE_JWT }),
      reply,
    );
    expect(replies.pop()![0]).toBe(403);
    const main = await link({ main: true });
    await main.se.api(
      req('POST'),
      '/connect',
      async () => ({ token_type: 'jwt', token: 'short' }),
      reply,
    );
    expect(replies.pop()).toEqual([400, { ok: false, error: 'invalid_token' }]);
    await main.se.api(
      req('POST'),
      '/connect',
      async () => ({ token_type: 'oauth2', token: FAKE_JWT }),
      reply,
    );
    expect(replies.pop()![0]).toBe(400);
    await main.se.api(
      req('POST'),
      '/connect',
      async () => ({ token_type: 'apikey', token: FAKE_JWT, room: 'nope' }),
      reply,
    );
    expect(replies.pop()).toEqual([400, { ok: false, error: 'invalid_room' }]);
    await main.se.api(
      req('POST'),
      '/connect',
      async () => ({ token_type: 'jwt', token: FAKE_JWT }),
      reply,
    );
    expect(replies.pop()![0]).toBe(200);
    await main.se.api(
      req('POST'),
      '/mode',
      async () => ({ mode: 'test' }),
      reply,
    );
    main.last().welcome();
    main.last().push(SE_TIP_EXAMPLE);
    await main.settle();
    await main.se.api(req('GET'), '', async () => ({}), reply);
    const secret = FAKE_JWT.split('.')[2]!;
    expect(JSON.stringify(replies)).not.toContain(secret);
    expect(main.lines.join('\n')).not.toContain(secret);
    expect(
      await readFile(join(main.dir, 'se-journal.json'), 'utf8'),
    ).not.toContain(secret);
    expect(await readFile(join(main.dir, 'se-mode.json'), 'utf8')).toBe(
      '{"mode":"test"}',
    );
    await main.se.api(req('POST'), '/forget', async () => ({}), reply);
    expect(main.se.status()).toMatchObject({
      state: 'no_token',
      token: { present: false },
    });
  });

  it('tips topic refused (bad token) → « auth_failed », no reconnection loop; moderation refused alone → noted only', async () => {
    vi.useFakeTimers();
    const t = await link();
    t.se.setToken('apikey', 'overlay-token-abcdefghijkl', null);
    await t.se.setMode('test');
    t.last().welcome();
    const [tips, moderation] = t.last().sent;
    t.last().push({
      type: 'response',
      nonce: moderation!.nonce,
      error: 'err_unauthorized',
      data: { message: 'missing scope' },
    });
    expect(t.se.state).toBe('connected');
    expect(t.se.status().topics[1]).toMatchObject({
      subscribed: false,
      error: 'err_unauthorized : missing scope',
    });
    t.last().push({
      type: 'response',
      nonce: tips!.nonce,
      error: 'err_unauthorized',
      data: { message: 'invalid token' },
    });
    expect(t.se.state).toBe('auth_failed');
    expect(t.se.status().error).toContain('reconnecte');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.sockets).toHaveLength(1);
    // A new token is the action it waited for.
    t.se.setToken('jwt', FAKE_JWT, null);
    expect(t.sockets).toHaveLength(2);
  });

  it('connection lost → reconnects (longer each time), subscribes again; a graceful « reconnect » resumes at once with its token, without re-subscribing', async () => {
    vi.useFakeTimers();
    const t = await link();
    t.se.setToken('jwt', FAKE_JWT, null);
    await t.se.setMode('test');
    t.last().welcome();
    t.last().drop();
    expect(t.se.state).toBe('reconnecting');
    expect(t.se.status().error).toContain('fermée (code 1006)');
    await vi.advanceTimersByTimeAsync(SE_RECONNECT_MS[0]! - 1);
    expect(t.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.sockets).toHaveLength(2);
    t.last().drop();
    await vi.advanceTimersByTimeAsync(SE_RECONNECT_MS[1]!);
    expect(t.sockets).toHaveLength(3);
    t.last().welcome();
    expect(t.last().sent.filter((s) => s.type === 'subscribe')).toHaveLength(2);
    expect(t.se.state).toBe('connected');
    // Graceful shutdown.
    t.last().push({
      type: 'reconnect',
      data: {
        message: 'The server is shutting down.',
        reconnect_token: 'rt/1+=',
      },
    });
    t.last().drop(1001);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last().url).toBe(
      'wss://astro.streamelements.com/?reconnect_token=rt%2F1%2B%3D',
    );
    t.last().welcome();
    expect(t.last().sent).toEqual([]);
    expect(t.se.status().topics.every((x) => x.subscribed)).toBe(true);
  });

  it('Core down in ACTIVE: retried with the same id, then queued; a Core refusal (4xx) is an « error » line', async () => {
    vi.useFakeTimers();
    let down = true;
    const t = await link({
      core: async () => {
        if (down)
          throw Object.assign(new Error('core_unavailable'), { status: 503 });
        return { outcome: 'queued' };
      },
    });
    t.se.setToken('jwt', FAKE_JWT, null);
    await t.se.setMode('active');
    t.last().welcome();
    t.last().push(SE_TIP_EXAMPLE);
    await vi.advanceTimersByTimeAsync(1000);
    down = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.posts.map((p) => p.source_event_id)).toEqual([
      'streamelements-tip-67b5f39d07ecd4c594e60f73',
      'streamelements-tip-67b5f39d07ecd4c594e60f73',
      'streamelements-tip-67b5f39d07ecd4c594e60f73',
    ]);
    expect(t.se.status().last_event).toMatchObject({ decision: 'queued' });
    const refused = await link({
      core: async () => {
        throw Object.assign(new Error('invalid_body'), { status: 400 });
      },
    });
    refused.se.setToken('jwt', FAKE_JWT, null);
    await refused.se.setMode('active');
    refused.last().welcome();
    refused.last().push(SE_TIP_EXAMPLE);
    await vi.advanceTimersByTimeAsync(0);
    expect(refused.se.status().last_event).toMatchObject({ decision: 'error' });
    expect(refused.posts).toHaveLength(1);
  });

  it('mode and journal survive a Studio restart; the token does not (Electron main hands it again)', async () => {
    const t = await link();
    t.se.setToken('jwt', FAKE_JWT, null);
    await t.se.setMode('test');
    t.last().welcome();
    t.last().push(SE_TIP_EXAMPLE);
    await t.settle();
    t.se.close();
    const again = await link({ dir: t.dir });
    expect(again.se.mode).toBe('test');
    expect(again.se.status()).toMatchObject({
      state: 'no_token',
      token: { present: false },
    });
    expect(again.se.status().journal).toHaveLength(1);
  });

  it('a saved ACTIVE is never resumed by a Studio start: TEST (observation), said so, until chosen again', async () => {
    const t = await link();
    await t.se.setMode('active');
    t.se.close();
    const again = await link({ dir: t.dir });
    expect(again.se.status()).toMatchObject({
      mode: 'test',
      resumed_from_active: true,
      environment: 'lab',
    });
    again.se.setToken('jwt', FAKE_JWT, null);
    again.last().welcome();
    again.last().push(SE_TIP_EXAMPLE);
    await again.settle();
    expect(again.posts).toEqual([]); // observation only
    await again.se.setMode('active');
    expect(again.se.status()).toMatchObject({
      mode: 'active',
      resumed_from_active: false,
    });
  });

  it('a fresh storage folder (new install, production profile) is created: the mode can be saved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'se-fresh-'));
    dirs.push(root);
    const t = await link({ dir: join(root, 'production', 'alerts') });
    await t.se.setMode('test');
    expect(
      await readFile(
        join(root, 'production', 'alerts', 'se-mode.json'),
        'utf8',
      ),
    ).toBe('{"mode":"test"}');
  });
});
