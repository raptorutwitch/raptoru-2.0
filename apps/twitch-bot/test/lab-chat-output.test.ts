import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifySendError,
  createLabChatOutput,
  createRateLimiter,
  fileJournal,
  memoryJournal,
  type SendJournal,
} from '../src/lab-chat-output.js';
import { createHelix } from '../src/twitch/helix.js';

// Fake Lab Core: the same contract as apps/core-api/src/commands/steps.ts (FIFO, one attempt id per
// claim, ACK bound to it, 409 for another attempt, final states never regress).
function fakeCore(output = true) {
  let n = 0;
  const steps: {
    step_id: string;
    attempt_id: string | null;
    status: string;
    type: 'chat' | 'module';
    params: { mode: string; text: string; reply_to: string | null };
    acks: string[];
    twitch_message_id?: string;
    error?: unknown;
  }[] = [];
  const calls: string[] = [];
  let down = false;
  const core = async (path: string, body: unknown) => {
    if (down) throw new TypeError('fetch failed');
    const b = body as {
      attempt_id: string;
      event: string;
      twitch_message_id?: string;
      error?: { retryable: boolean };
    };
    if (path.endsWith('/claim')) {
      calls.push('claim');
      if (!output)
        return { status: 200, body: { step: null, reason: 'output_off' } };
      if (steps.some((s) => ['claimed', 'running'].includes(s.status)))
        return { status: 200, body: { step: null, reason: 'busy' } };
      const s = steps.find((x) => x.status === 'queued');
      if (!s) return { status: 200, body: { step: null, reason: 'empty' } };
      s.status = 'claimed';
      s.attempt_id = `att-${++n}`;
      return { status: 200, body: { step: { ...s } } };
    }
    const id = path.split('/').at(-2)!;
    const s = steps.find((x) => x.step_id === id)!;
    calls.push(`ack:${b.event}`);
    if (s.attempt_id !== b.attempt_id)
      return { status: 409, body: { error: 'stale_attempt' } };
    s.acks.push(b.event);
    if (b.event === 'running') s.status = 'running';
    else if (b.event === 'failed' && b.error?.retryable) {
      s.status = 'queued';
      s.attempt_id = null;
    } else {
      s.status = b.event;
      s.attempt_id = null;
      s.twitch_message_id = b.twitch_message_id;
    }
    s.error = b.error;
    return { status: 200, body: { step: { ...s } } };
  };
  const add = (
    mode: string,
    text: string,
    reply_to: string | null = null,
    type: 'chat' | 'module' = 'chat',
  ) =>
    steps.push({
      step_id: `00000000-0000-4000-8000-${String(steps.length + 1).padStart(12, '0')}`,
      attempt_id: null,
      status: 'queued',
      type,
      params: { mode, text, reply_to },
      acks: [],
    });
  return { core, steps, calls, add, setDown: (v: boolean) => (down = v) };
}

/** Real Helix client over a fake fetch: every Helix request is recorded. */
function fakeTwitch(
  answer: (url: string, body: unknown) => Response | Promise<Response>,
) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const helix = createHelix(
    {
      clientId: 'client',
      getAccessToken: async () => 'token',
      handleUnauthorized: async () => false,
    },
    (async (url: string, init: { body?: string }) => {
      const body = init.body
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
      requests.push({ url: String(url), body });
      return answer(String(url), body);
    }) as unknown as typeof fetch,
  );
  return { helix, requests };
}
const sent = (id = 'tw-msg-1') =>
  new Response(
    JSON.stringify({
      data: [{ message_id: id, is_sent: true, drop_reason: null }],
    }),
    { status: 200 },
  );

const SCOPES = [
  'user:read:chat',
  'user:write:chat',
  'moderator:manage:announcements',
];

function executor(
  core: ReturnType<typeof fakeCore>,
  twitch: ReturnType<typeof fakeTwitch>,
  o: {
    journal?: SendJournal;
    scopes?: string[];
    max?: number;
    now?: () => number;
  } = {},
) {
  return createLabChatOutput({
    core: core.core,
    channelId: '900100',
    executorId: 'lab-chat-1239040922',
    scopes: o.scopes ?? SCOPES,
    send: {
      chat: (text, replyTo) =>
        twitch.helix.sendChat('83603689', '1239040922', text, replyTo),
      announce: (text) =>
        twitch.helix.sendAnnouncement('83603689', '1239040922', text),
    },
    journal: o.journal ?? memoryJournal(),
    limiter: createRateLimiter({
      max: o.max ?? 20,
      windowMs: 30_000,
      now: o.now,
    }),
    now: o.now,
    log: () => {},
  });
}

describe('Lab chat output — sends', () => {
  it('« Sortie chat réelle » OFF: Core hands out nothing → zero Helix call', async () => {
    const core = fakeCore(false);
    core.add('normal', 'Câlin !');
    const twitch = fakeTwitch(() => sent());
    const out = executor(core, twitch);
    for (let i = 0; i < 3; i++)
      expect(await out.tick()).toEqual({
        kind: 'idle',
        reason: 'output_off',
        retry_in_ms: undefined,
      });
    expect(twitch.requests).toHaveLength(0);
  });

  it('normal message: running confirmed and journaled before Helix, then succeeded with the proof', async () => {
    const core = fakeCore();
    core.add('normal', 'Câlin !');
    const journal = memoryJournal();
    const seen: unknown[] = [];
    const twitch = fakeTwitch(() => {
      seen.push([core.steps[0]!.status, journal.entries().map((e) => e.state)]);
      return sent('tw-42');
    });
    expect(await executor(core, twitch, { journal }).tick()).toMatchObject({
      kind: 'sent',
    });
    expect(seen).toEqual([['running', ['about_to_send']]]);
    expect(twitch.requests).toEqual([
      {
        url: 'https://api.twitch.tv/helix/chat/messages',
        body: {
          broadcaster_id: '83603689',
          sender_id: '1239040922',
          message: 'Câlin !',
        },
      },
    ]);
    expect(core.steps[0]).toMatchObject({
      status: 'succeeded',
      twitch_message_id: 'tw-42',
    });
    expect(journal.entries()).toEqual([]);
  });

  it('reply: Twitch reply to the original message; announce: the announcement endpoint', async () => {
    const core = fakeCore();
    core.add('reply', 'Oui', 'tw-parent');
    core.add('announce', 'Grosse annonce');
    const twitch = fakeTwitch((url) =>
      url.includes('announcements')
        ? new Response(null, { status: 204 })
        : sent(),
    );
    const out = executor(core, twitch);
    await out.tick();
    await out.tick();
    expect(twitch.requests[0]!.body).toMatchObject({
      message: 'Oui',
      reply_parent_message_id: 'tw-parent',
    });
    expect(twitch.requests[1]).toEqual({
      url: 'https://api.twitch.tv/helix/chat/announcements?broadcaster_id=83603689&moderator_id=1239040922',
      body: { message: 'Grosse annonce' },
    });
    expect(core.steps.map((s) => s.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('unsendable step (/me, module) or missing scope: failed, never sent', async () => {
    const core = fakeCore();
    core.add('me', 'danse');
    core.add('normal', 'x', null, 'module');
    core.add('announce', 'annonce');
    const twitch = fakeTwitch(() => sent());
    const out = executor(core, twitch, { scopes: ['user:write:chat'] });
    for (let i = 0; i < 3; i++)
      expect(await out.tick()).toMatchObject({ kind: 'failed' });
    expect(twitch.requests).toHaveLength(0);
    expect(core.steps.map((s) => (s.error as { code: string }).code)).toEqual([
      'unsupported_step',
      'unsupported_step',
      'missing_scope',
    ]);
  });

  it('messages of the channel keep their order', async () => {
    const core = fakeCore();
    for (const t of ['1', '2', '3']) core.add('normal', t);
    const twitch = fakeTwitch(() => sent());
    const out = executor(core, twitch);
    for (let i = 0; i < 3; i++) await out.tick();
    expect(twitch.requests.map((r) => r.body.message)).toEqual(['1', '2', '3']);
  });
});

describe('Lab chat output — retry policy (a duplicate is worse than a lost message)', () => {
  it('connection refused before the request: failed, retryable (certainly not sent)', async () => {
    const core = fakeCore();
    core.add('normal', 'x');
    const twitch = fakeTwitch(() => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      });
    });
    expect(await executor(core, twitch).tick()).toMatchObject({
      kind: 'failed',
    });
    expect(core.steps[0]).toMatchObject({
      status: 'queued',
      error: { code: 'connection_failed', retryable: true },
    });
  });

  it('429: failed retryable with Twitch reset delay; every send paused until then', async () => {
    let t = 1_000_000;
    const core = fakeCore();
    core.add('normal', 'x');
    const twitch = fakeTwitch(
      () =>
        new Response('{"message":"too many"}', {
          status: 429,
          headers: { 'ratelimit-reset': String(Math.floor((t + 5000) / 1000)) },
        }),
    );
    const out = executor(core, twitch, { now: () => t });
    await out.tick();
    expect(core.steps[0]).toMatchObject({
      status: 'queued',
      error: { code: 'rate_limited', retryable: true },
    });
    const after = (core.steps[0]!.error as { retry_after_ms: number })
      .retry_after_ms;
    expect(after).toBeGreaterThan(3000);
    expect(await out.tick()).toMatchObject({
      kind: 'idle',
      reason: 'rate_limit',
    });
    expect(twitch.requests).toHaveLength(1);
    t += after + 1;
    await out.tick();
    expect(twitch.requests).toHaveLength(2);
  });

  it('timeout (answer lost, maybe sent): unknown, never retried', async () => {
    const core = fakeCore();
    core.add('normal', 'x');
    const twitch = fakeTwitch(() => {
      throw new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      );
    });
    const out = executor(core, twitch);
    expect(await out.tick()).toMatchObject({ kind: 'unknown' });
    for (let i = 0; i < 3; i++) await out.tick();
    expect(twitch.requests).toHaveLength(1);
    expect(core.steps[0]).toMatchObject({
      status: 'unknown',
      error: { code: 'timeout', retryable: false },
    });
  });

  it('5xx → unknown; 4xx → failed, not retried; explicit « not sent » → retryable', async () => {
    expect(
      classifySendError(
        Object.assign(new TypeError('x'), { cause: { code: 'ECONNRESET' } }),
        0,
      ),
    ).toMatchObject({ event: 'unknown' });
    const core = fakeCore();
    core.add('normal', 'a');
    core.add('normal', 'b');
    core.add('normal', 'c');
    const answers = [
      new Response('oops', { status: 503 }),
      new Response('{"message":"bad"}', { status: 400 }),
      new Response(
        JSON.stringify({
          data: [
            {
              message_id: '',
              is_sent: false,
              drop_reason: { code: 'msg_duplicate', message: 'dup' },
            },
          ],
        }),
        { status: 200 },
      ),
    ];
    const twitch = fakeTwitch(() => answers.shift()!);
    const out = executor(core, twitch);
    for (let i = 0; i < 3; i++) await out.tick();
    expect(
      core.steps.map((s) => [s.status, (s.error as { code: string }).code]),
    ).toEqual([
      ['unknown', 'twitch_server_error'],
      ['failed', 'twitch_400'],
      ['queued', 'dropped_msg_duplicate'],
    ]);
  });
});

describe('Lab chat output — journal, crash and restart', () => {
  it('crash after about_to_send, before the ACK: the restarted bot reports unknown, never resends', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-chat-'));
    const path = join(dir, 'journal.json');
    const core = fakeCore();
    core.add('normal', 'x');
    // First process: claims, confirms running, journals, calls Helix… and dies before any answer.
    const crashed = fakeTwitch(() => new Promise<Response>(() => {}));
    void executor(core, crashed, { journal: fileJournal(path) }).tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toMatchObject([
      { state: 'about_to_send' },
    ]);
    expect(core.steps[0]!.status).toBe('running');
    // Second process: same journal file.
    const twitch = fakeTwitch(() => sent());
    const out = executor(core, twitch, { journal: fileJournal(path) });
    await out.tick();
    await out.tick();
    expect(core.steps[0]).toMatchObject({
      status: 'unknown',
      error: { code: 'executor_restart' },
    });
    expect(twitch.requests).toHaveLength(0);
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toEqual([]);
  });

  it('Core unreachable for the running confirmation: nothing is sent', async () => {
    const core = fakeCore();
    core.add('normal', 'x');
    const twitch = fakeTwitch(() => sent());
    const orig = core.core;
    let calls = 0;
    const flaky = executor(
      {
        ...core,
        core: async (p, b) =>
          ++calls === 2
            ? Promise.reject(new TypeError('fetch failed'))
            : orig(p, b),
      },
      twitch,
    );
    expect(await flaky.tick()).toMatchObject({ kind: 'not_started' });
    expect(twitch.requests).toHaveLength(0);
  });

  it('Core unreachable for the final ACK: the outcome stays journaled and is reported later', async () => {
    const core = fakeCore();
    core.add('normal', 'x');
    const journal = memoryJournal();
    const twitch = fakeTwitch(() => {
      core.setDown(true);
      return sent('tw-9');
    });
    const out = executor(core, twitch, { journal });
    await out.tick();
    expect(journal.entries()).toMatchObject([
      {
        state: 'done',
        outcome: { event: 'succeeded', twitch_message_id: 'tw-9' },
      },
    ]);
    expect(await out.tick()).toMatchObject({
      kind: 'idle',
      reason: 'core_unavailable',
    });
    core.setDown(false);
    await out.tick();
    expect(core.steps[0]).toMatchObject({
      status: 'succeeded',
      twitch_message_id: 'tw-9',
    });
    expect(journal.entries()).toEqual([]);
    expect(twitch.requests).toHaveLength(1);
  });
});

describe('Lab chat output — rate limiter', () => {
  it('a burst waits for a free slot (claimed only then), in order, nothing dropped', async () => {
    let t = 0;
    const core = fakeCore();
    for (const x of ['1', '2', '3']) core.add('normal', x);
    const twitch = fakeTwitch(() => sent());
    const out = executor(core, twitch, { max: 2, now: () => t });
    await out.tick();
    await out.tick();
    expect(await out.tick()).toEqual({
      kind: 'idle',
      reason: 'rate_limit',
      retry_in_ms: 30_000,
    });
    expect(core.steps[2]!.status).toBe('queued');
    t = 30_000;
    await out.tick();
    expect(twitch.requests.map((r) => r.body.message)).toEqual(['1', '2', '3']);
  });
});
