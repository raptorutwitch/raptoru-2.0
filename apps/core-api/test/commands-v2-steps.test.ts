import { randomUUID } from 'node:crypto';
import type { CmdConfig, LabChatMessage } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandsAdmission } from '../src/commands/admission.js';
import { CommandsError } from '../src/commands/model.js';
import { raffleReservedWords } from '../src/commands/reserved.js';
import { CommandsService } from '../src/commands/service.js';
import { CommandSteps, type StepView } from '../src/commands/steps.js';
import type { Db } from '../src/db/db.js';
import { commandsRoutes } from '../src/http/commands-routes.js';
import { HttpError } from '../src/http/server.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { count, createTestDb, FakeClock } from './helpers.js';

const CH = '900100';
const STUDIO: Actor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const T0 = new Date('2026-10-04T18:00:00Z');
const SEC = 1000;

let db: Db;
let clock: FakeClock;
let svc: CommandsService;
let adm: CommandsAdmission;
let steps: CommandSteps;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  const reserved = raffleReservedWords(new RaffleLabService(db, clock));
  svc = new CommandsService(db, clock, { reserved });
  adm = new CommandsAdmission(db, clock, { reserved });
  steps = new CommandSteps(db, clock);
});

const chatAction = (text: string, over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  type: 'chat' as const,
  v: 1 as const,
  on_error: 'stop' as const,
  mode: 'normal' as const,
  text,
  to: 'none' as const,
  ...over,
});
const make = (over: Partial<CmdConfig> = {}) =>
  svc.create(CH, STUDIO, {
    name: 'hug',
    reply: { mode: 'normal', text: 'Câlin !', to: 'none' },
    cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
    ...over,
  });
let n = 0;
const msg = (
  text: string,
  id = `tw-${++n}`,
  source: 'twitch' | 'simulator' = 'twitch',
  viewer = '700',
): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: {
    id: viewer,
    login: `v${viewer}`,
    display_name: `V${viewer}`,
    role: 'viewer',
  },
  source,
});
const say = (
  text: string,
  id?: string,
  source?: 'twitch' | 'simulator',
  viewer?: string,
) => adm.chat(msg(text, id, source, viewer));
const on = () => steps.setOutput(CH, STUDIO, true);
const all = async () =>
  (await steps.list(CH, STUDIO, { limit: 200 })).steps.slice().reverse();
const claim = async (executor = 'bot-a') => {
  const r = await steps.claim(CH, executor);
  return r;
};
const ack = (
  s: Pick<StepView, 'step_id' | 'attempt_id'>,
  event: 'running' | 'succeeded' | 'failed' | 'unknown',
  extra: Record<string, unknown> = {},
  executor = 'bot-a',
) =>
  steps.ack(CH, s.step_id, {
    executor_id: executor,
    attempt_id: s.attempt_id!,
    event,
    ...extra,
  });
/** Claims, sends (fake) and acknowledges the next step. */
const deliver = async () => {
  const { step } = await claim();
  expect(step).not.toBeNull();
  await ack(step!, 'running');
  return (
    await ack(step!, 'succeeded', { twitch_message_id: `m-${step!.seq}` })
  ).step;
};
async function fails(p: Promise<unknown>, status: number, code: string) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(CommandsError);
  expect([(e as CommandsError).status, (e as CommandsError).code]).toEqual([
    status,
    code,
  ]);
}

describe('Commands V2 steps — creation at admission', () => {
  it('an accepted invocation creates its steps, in order, with a stable idempotency key', async () => {
    await make({ actions: [chatAction('Action 1'), chatAction('Action 2')] });
    const out = await say('!hug', 'tw-a');
    expect(out).toMatchObject({ outcome: 'accepted', steps: 3 });
    const s = await all();
    expect(s.map((x) => [x.seq, x.kind, x.params.text, x.status])).toEqual([
      [1, 'action', 'Action 1', 'queued'],
      [2, 'action', 'Action 2', 'queued'],
      [3, 'reply', 'Câlin !', 'queued'],
    ]);
    expect(s[0]!.idempotency_key).toBe(`${out.invocation_id}:1`);
    expect(s[0]!.expires_at).toBe(
      new Date(T0.getTime() + 60 * SEC).toISOString(),
    );
    const inv = await db.query<{ status: string }>(
      'select status from cmd_invocations',
    );
    expect(inv[0]!.status).toBe('dispatched');
  });

  it('reply first; silent creates nothing; reply / announce / me modes frozen', async () => {
    await make({
      reply_first: true,
      actions: [chatAction('Annonce', { mode: 'announce' })],
    });
    await make({
      name: 'quiet',
      reply: { mode: 'silent', text: '', to: 'none' },
    });
    await make({
      name: 'rep',
      reply: { mode: 'reply', text: 'Oui', to: 'none' },
    });
    await make({
      name: 'moi',
      reply: { mode: 'me', text: 'danse', to: 'none' },
    });
    await say('!hug');
    expect(await say('!quiet')).toMatchObject({
      outcome: 'accepted',
      steps: 0,
    });
    await say('!rep', 'tw-parent');
    await say('!rep', 'sim-1', 'simulator');
    await say('!moi');
    expect(
      (await all()).map((x) => [
        x.kind,
        x.params.mode,
        x.params.reply_to ?? null,
        x.status,
      ]),
    ).toEqual([
      ['reply', 'normal', null, 'queued'],
      ['action', 'announce', null, 'queued'],
      ['reply', 'reply', 'tw-parent', 'queued'],
      // The simulator has no Twitch message to reply to.
      ['reply', 'reply', null, 'queued'],
      // /me: not supported by Send Chat Message — recorded, never sent.
      ['reply', 'me', null, 'skipped'],
    ]);
    expect((await all())[4]!.error).toMatchObject({ code: 'me_unsupported' });
  });

  it('the same Twitch message (redelivery, double EventSub) creates its steps once', async () => {
    await make();
    await say('!hug', 'tw-dup');
    expect(await say('!hug', 'tw-dup')).toMatchObject({
      reason: 'duplicate_message',
    });
    expect(await count(db, 'cmd_steps')).toBe(1);
  });

  it('a refusal answers through the same queue (refuse = explain / custom), once a minute per viewer', async () => {
    await make({
      cooldown: { enabled: true, seconds: 30, unit: 's', scope: 'viewer' },
      refuse: { mode: 'explain', text: '' },
    });
    await say('!hug');
    await say('!hug');
    await say('!hug');
    const s = await all();
    expect(s.map((x) => [x.kind, x.params.text])).toEqual([
      ['reply', 'Câlin !'],
      ['refusal', '@V700 Trop tôt : encore 30 s à attendre.'],
    ]);
    // Silent refusal / unknown command: nothing.
    await make({
      name: 'other',
      when: 'live',
      refuse: { mode: 'custom', text: 'Pas maintenant !' },
    });
    await say('!other');
    expect((await all()).at(-1)!.params.text).toBe('@V700 Pas maintenant !');
    await say('!nope');
    expect(await count(db, 'cmd_steps')).toBe(3);
  });
});

describe('Commands V2 steps — « Sortie chat réelle »', () => {
  it('OFF by default: nothing is handed out, steps wait then expire; only the streamer switches it', async () => {
    await make();
    await say('!hug');
    expect(await steps.output(CH)).toMatchObject({ enabled: false });
    expect(await claim()).toEqual({ step: null, reason: 'output_off' });
    expect((await all())[0]!.status).toBe('queued');
    clock.advance(61 * SEC);
    await claim();
    expect((await all())[0]).toMatchObject({
      status: 'expired',
      attempt_count: 0,
    });
    await expect(
      steps.setOutput(
        CH,
        { id: '501', role: 'moderator', via: 'extension' },
        true,
      ),
    ).rejects.toMatchObject({ code: 'streamer_only' });
    expect(await on()).toMatchObject({
      enabled: true,
      updated_by: 'studio:antoni',
    });
  });
});

describe('Commands V2 steps — claim, lease, ACK', () => {
  beforeEach(async () => {
    await on();
  });

  it('one step in flight per channel, FIFO: N+1 only after N is final', async () => {
    await make({ actions: [chatAction('A')] });
    await say('!hug');
    await say('!hug');
    const first = (await claim()).step!;
    expect(first.params.text).toBe('A');
    expect(await claim('bot-b')).toEqual({ step: null, reason: 'busy' });
    await ack(first, 'running');
    expect(await claim('bot-b')).toEqual({ step: null, reason: 'busy' });
    await ack(first, 'succeeded', { twitch_message_id: 'm-1' });
    const texts = [first.params.text];
    for (let i = 0; i < 3; i++) texts.push((await deliver()).params.text);
    expect(texts).toEqual(['A', 'Câlin !', 'A', 'Câlin !']);
    expect(await claim()).toEqual({ step: null, reason: 'empty' });
    expect((await all())[0]).toMatchObject({
      status: 'succeeded',
      twitch_message_id: 'm-1',
    });
  });

  it('two concurrent workers: the step is handed out once', async () => {
    await make();
    await say('!hug');
    const out = await Promise.all(['a', 'b', 'c', 'd'].map((e) => claim(e)));
    expect(out.filter((o) => o.step)).toHaveLength(1);
  });

  it('a skipped step is never handed out; the next one is', async () => {
    await make({ actions: [chatAction('moi', { mode: 'me' })] });
    await say('!hug');
    expect((await claim()).step!.params.text).toBe('Câlin !');
  });

  it('claimed but never started, lease over: certainly not sent → queued again, new attempt', async () => {
    await make();
    await say('!hug');
    const a1 = (await claim()).step!;
    clock.advance(16 * SEC);
    const a2 = (await claim('bot-b')).step!;
    expect(a2.step_id).toBe(a1.step_id);
    expect(a2.attempt_id).not.toBe(a1.attempt_id);
    expect(a2.attempt_count).toBe(2);
    // The old attempt can never act again.
    await fails(ack(a1, 'running'), 409, 'stale_attempt');
    await ack(a2, 'running', {}, 'bot-b');
    const done = await ack(
      a2,
      'succeeded',
      { twitch_message_id: 'x' },
      'bot-b',
    );
    expect(done.step.status).toBe('succeeded');
  });

  it('running, lease over, no outcome: unknown, never handed out again; stop cancels the rest', async () => {
    await make({ actions: [chatAction('A', { on_error: 'stop' })] });
    await say('!hug');
    const s = (await claim()).step!;
    await ack(s, 'running');
    clock.advance(21 * SEC);
    expect(await claim()).toEqual({ step: null, reason: 'empty' });
    expect((await all()).map((x) => x.status)).toEqual([
      'unknown',
      'cancelled',
    ]);
    // The late proof of the send is recorded (no resend either way).
    expect(
      (await ack(s, 'succeeded', { twitch_message_id: 'late' })).step,
    ).toMatchObject({
      status: 'succeeded',
      twitch_message_id: 'late',
    });
  });

  it('on_error = continue: the next step still runs after an unknown one', async () => {
    await make({ actions: [chatAction('A', { on_error: 'continue' })] });
    await say('!hug');
    const s = (await claim()).step!;
    await ack(s, 'running');
    await ack(s, 'unknown', {
      error: { code: 'timeout', message: 'no answer', retryable: false },
    });
    expect((await claim()).step!.params.text).toBe('Câlin !');
  });

  it('ACK: bound to the attempt, idempotent replay, an obsolete ACK never overwrites a final state', async () => {
    await make();
    await say('!hug');
    const s = (await claim()).step!;
    await fails(
      ack({ ...s, attempt_id: randomUUID() }, 'running'),
      409,
      'stale_attempt',
    );
    await fails(ack(s, 'running', {}, 'bot-b'), 409, 'stale_attempt');
    await fails(ack(s, 'succeeded'), 409, 'invalid_transition');
    await ack(s, 'running');
    expect(await ack(s, 'running')).toMatchObject({ replayed: true });
    await ack(s, 'succeeded', { twitch_message_id: 'm' });
    expect(await ack(s, 'succeeded', { twitch_message_id: 'm' })).toMatchObject(
      { replayed: true },
    );
    await fails(
      ack(s, 'failed', { error: { code: 'x', message: 'x', retryable: true } }),
      409,
      'stale_attempt',
    );
    await fails(ack(s, 'unknown'), 409, 'stale_attempt');
    expect((await all())[0]).toMatchObject({
      status: 'succeeded',
      twitch_message_id: 'm',
    });
  });

  it('certain error before the send: retried with exponential backoff, at most 3 attempts', async () => {
    await make();
    await say('!hug');
    const err = {
      code: 'connection_refused',
      message: 'not sent',
      retryable: true,
    };
    const s1 = (await claim()).step!;
    await ack(s1, 'running');
    expect((await ack(s1, 'failed', { error: err })).step).toMatchObject({
      status: 'queued',
      available_at: new Date(T0.getTime() + 2 * SEC).toISOString(),
    });
    expect(await claim()).toMatchObject({
      step: null,
      reason: 'backoff',
      retry_in_ms: 2 * SEC,
    });
    clock.advance(2 * SEC);
    const s2 = (await claim()).step!;
    await ack(s2, 'failed', { error: err });
    expect((await all())[0]!.available_at).toBe(
      new Date(T0.getTime() + 6 * SEC).toISOString(),
    );
    clock.advance(4 * SEC);
    const s3 = (await claim()).step!;
    expect(s3.attempt_count).toBe(3);
    expect((await ack(s3, 'failed', { error: err })).step.status).toBe(
      'failed',
    );
  });

  it('a backed-off message keeps its place: a later message never overtakes it', async () => {
    await make();
    await say('!hug', 'first');
    await say('!hug', 'second');
    const s1 = (await claim()).step!;
    await ack(s1, 'failed', {
      error: { code: 'x', message: 'x', retryable: true },
    });
    expect(await claim()).toMatchObject({ reason: 'backoff' });
    clock.advance(2 * SEC);
    expect((await claim()).step!.step_id).toBe(s1.step_id);
  });

  it('429: retried after the delay Twitch gave', async () => {
    await make();
    await say('!hug');
    const s = (await claim()).step!;
    await ack(s, 'running');
    const r = await ack(s, 'failed', {
      error: {
        code: 'rate_limited',
        message: '429',
        retryable: true,
        retry_after_ms: 7000,
      },
    });
    expect(r.step.available_at).toBe(
      new Date(T0.getTime() + 7 * SEC).toISOString(),
    );
  });

  it('a non-retryable failure and an unknown outcome are final: never handed out again', async () => {
    await make();
    await say('!hug');
    await say('!hug');
    const s1 = (await claim()).step!;
    await ack(s1, 'running');
    await ack(s1, 'unknown', {
      error: { code: 'timeout', message: 'may be sent', retryable: false },
    });
    const s2 = (await claim()).step!;
    expect(s2.step_id).not.toBe(s1.step_id);
    await ack(s2, 'failed', {
      error: { code: 'bad_request', message: '400', retryable: false },
    });
    expect(await claim()).toEqual({ step: null, reason: 'empty' });
    expect((await all()).map((x) => x.status)).toEqual(['unknown', 'failed']);
  });

  it('expiry: no retry past it; a step claimed too late is answered expired (never sent)', async () => {
    await make();
    await say('!hug');
    await say('!hug');
    clock.advance(59 * SEC);
    const s1 = (await claim()).step!;
    expect(
      (
        await ack(s1, 'failed', {
          error: { code: 'x', message: 'x', retryable: true },
        })
      ).step.status,
    ).toBe('failed');
    const s2 = (await claim()).step!;
    clock.advance(6 * SEC);
    expect((await ack(s2, 'running')).step.status).toBe('expired');
  });

  it('Core restart: another Core instance continues with the same attempts', async () => {
    await make();
    await say('!hug');
    const s = (await claim()).step!;
    await ack(s, 'running');
    const restarted = new CommandSteps(db, clock);
    const r = await restarted.ack(CH, s.step_id, {
      executor_id: 'bot-a',
      attempt_id: s.attempt_id!,
      event: 'succeeded',
      twitch_message_id: 'm',
    });
    expect(r.step.status).toBe('succeeded');
  });

  it('debug list: counts by status, filters, team only', async () => {
    await make();
    await say('!hug');
    await say('!hug');
    await deliver();
    const l = await steps.list(CH, STUDIO, { status: 'queued', limit: 10 });
    expect(l).toMatchObject({
      output: true,
      counts: { queued: 1, succeeded: 1 },
    });
    expect(l.steps).toHaveLength(1);
    await expect(
      steps.list(
        CH,
        { id: '503', role: 'viewer', via: 'extension' },
        { limit: 10 },
      ),
    ).rejects.toMatchObject({ code: 'team_only' });
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
type Body = Record<string, any>;

describe('Commands V2 steps — HTTP routes', () => {
  it('output, claim, ack and the debug list through the Lab Core routes', async () => {
    const routes = commandsRoutes(svc, adm, steps);
    const call = async (
      method: 'GET' | 'POST',
      path: string,
      body?: unknown,
    ) => {
      const url = new URL(path, 'http://lab');
      const route = routes.find(
        (r) => r.method === method && r.pattern.test(url.pathname),
      )!;
      try {
        return {
          status: 200,
          body: (await route.handle({
            params: route.pattern.exec(url.pathname)!.slice(1),
            url,
            body,
          })) as Body,
        };
      } catch (e) {
        if (e instanceof HttpError)
          return { status: e.status, body: e.body as Body };
        throw e;
      }
    };
    await make();
    await say('!hug');
    expect(
      (await call('GET', `/v1/lab/commands/${CH}/output`)).body,
    ).toMatchObject({ enabled: false });
    expect(
      (
        await call('POST', `/v1/lab/commands/${CH}/steps/claim`, {
          executor_id: 'bot',
        })
      ).body,
    ).toEqual({
      step: null,
      reason: 'output_off',
    });
    await call('POST', `/v1/lab/commands/${CH}/output`, {
      actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
      enabled: true,
    });
    const { step } = (
      await call('POST', `/v1/lab/commands/${CH}/steps/claim`, {
        executor_id: 'bot',
      })
    ).body;
    const ackUrl = `/v1/lab/commands/${CH}/steps/${step.step_id}/ack`;
    expect(
      await call('POST', ackUrl, {
        executor_id: 'bot',
        attempt_id: randomUUID(),
        event: 'running',
      }),
    ).toMatchObject({
      status: 409,
      body: { error: 'stale_attempt' },
    });
    await call('POST', ackUrl, {
      executor_id: 'bot',
      attempt_id: step.attempt_id,
      event: 'running',
    });
    expect(
      (
        await call('POST', ackUrl, {
          executor_id: 'bot',
          attempt_id: step.attempt_id,
          event: 'succeeded',
          twitch_message_id: 'tw',
        })
      ).body.step,
    ).toMatchObject({ status: 'succeeded', twitch_message_id: 'tw' });
    expect(
      (await call('GET', `/v1/lab/commands/${CH}/steps?status=succeeded`)).body
        .steps,
    ).toHaveLength(1);
    expect(
      (await call('GET', `/v1/lab/commands/${CH}/steps?status=bogus`)).status,
    ).toBe(400);
  });
});
