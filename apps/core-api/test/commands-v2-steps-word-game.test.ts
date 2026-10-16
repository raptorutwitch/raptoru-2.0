import { randomUUID } from 'node:crypto';
import type { CmdConfig, LabChatMessage } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandsAdmission } from '../src/commands/admission.js';
import { raffleReservedWords } from '../src/commands/reserved.js';
import { CommandsService } from '../src/commands/service.js';
import {
  CommandSteps,
  insertWordGameSteps,
  type StepView,
  type WordGameStepDraft,
} from '../src/commands/steps.js';
import type { Db } from '../src/db/db.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Jeu des mots V1, Lot 2 (docs/WORD_GAME_PARITY.md § 19): the Commands durable chat queue (cmd_steps)
// also carries Jeu des mots messages — origin 'word_game', no invocation — with the same order, claim,
// lease and ACK, and without any Commands cascade on them.

const CH = '900200';
const STUDIO: Actor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const T0 = new Date('2026-10-16T20:00:00Z');
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

const queue = (drafts: WordGameStepDraft[]) =>
  db.tx((q) =>
    insertWordGameSteps(q, { channelId: CH, now: clock.now(), drafts }),
  );
const on = () => steps.setOutput(CH, STUDIO, true);
const all = async () =>
  (await steps.list(CH, STUDIO, { limit: 200 })).steps.slice().reverse();
const claim = () => steps.claim(CH, 'bot-a');
const ack = (
  s: Pick<StepView, 'step_id' | 'attempt_id'>,
  event: 'running' | 'succeeded' | 'failed' | 'unknown',
  extra: Record<string, unknown> = {},
) =>
  steps.ack(CH, s.step_id, {
    executor_id: 'bot-a',
    attempt_id: s.attempt_id!,
    event,
    ...extra,
  });
const deliver = async () => {
  const { step } = await claim();
  expect(step).not.toBeNull();
  await ack(step!, 'running');
  return (await ack(step!, 'succeeded', { twitch_message_id: 'm' })).step;
};
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
const say = (text: string) =>
  adm.chat({
    channel_id: CH,
    message_id: `tw-${++n}`,
    text,
    chatter: { id: '700', login: 'v700', display_name: 'V700', role: 'viewer' },
    source: 'twitch',
  } satisfies LabChatMessage);
const publish = (key = 'jdm:word:occ-1:publish'): WordGameStepDraft => ({
  idempotencyKey: key,
  mode: 'normal',
  text: '-> elgan <-',
});

describe('word_game steps on the durable chat queue', () => {
  it('a word_game step has no invocation; the diagnostic list shows it as such', async () => {
    expect(await queue([publish()])).toBe(1);
    const [s] = await all();
    expect(s).toMatchObject({
      origin: 'word_game',
      invocation_id: null,
      seq: 1,
      idempotency_key: 'jdm:word:occ-1:publish',
      executor: 'twitch_chat',
      kind: 'action',
      type: 'chat',
      params: { mode: 'normal', text: '-> elgan <-' },
      on_error: 'continue',
      status: 'queued',
      available_at: T0.toISOString(),
      expires_at: new Date(T0.getTime() + 60 * SEC).toISOString(),
    });
  });

  it('the database refuses a Commands step without invocation, and a word_game step with one', async () => {
    await queue([publish()]);
    const insert = (origin: string, invocation: string | null) =>
      db.query(
        `insert into cmd_steps (step_id, origin, invocation_id, channel_id, seq, idempotency_key, executor, kind,
           type, params, on_error, status, available_at, expires_at, created_at, updated_at)
         values ($1, $2, $3, $4, 1, $5, 'twitch_chat', 'action', 'chat', '{}', 'continue', 'queued', $6, $6, $6, $6)`,
        [randomUUID(), origin, invocation, CH, randomUUID(), T0],
      );
    await expect(insert('commands', null)).rejects.toThrow();
    await expect(insert('word_game', randomUUID())).rejects.toThrow();
    await expect(insert('other', null)).rejects.toThrow();
  });

  it('the idempotency key makes a rewrite a no-op', async () => {
    expect(await queue([publish()])).toBe(1);
    expect(await queue([publish()])).toBe(0);
    expect(
      await queue([
        publish(),
        { idempotencyKey: 'jdm:msg:tw-1:find', mode: 'announce', text: 'x' },
      ]),
    ).toBe(1);
    expect((await all()).map((s) => s.idempotency_key)).toEqual([
      'jdm:word:occ-1:publish',
      'jdm:msg:tw-1:find',
    ]);
  });

  it('channel order is kept between Commands and Jeu des mots; normal and announce are handed out as such', async () => {
    await on();
    await make();
    await say('!hug');
    await queue([
      {
        idempotencyKey: 'jdm:msg:tw-x:find',
        mode: 'announce',
        text: '@V a trouvé le mot "angle" ! +500 jetons',
      },
      publish(),
    ]);
    await say('!hug');
    const handed: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      const { step } = await claim();
      handed.push([step!.origin, step!.params]);
      await ack(step!, 'running');
      await ack(step!, 'succeeded', { twitch_message_id: `m${i}` });
    }
    expect(handed).toEqual([
      ['commands', { mode: 'normal', text: 'Câlin !', reply_to: null }],
      [
        'word_game',
        { mode: 'announce', text: '@V a trouvé le mot "angle" ! +500 jetons' },
      ],
      ['word_game', { mode: 'normal', text: '-> elgan <-' }],
      ['commands', { mode: 'normal', text: 'Câlin !', reply_to: null }],
    ]);
    expect(await claim()).toEqual({ step: null, reason: 'empty' });
  });

  it('a delay holds the message (and what follows) until its time, then it expires 60 s after it', async () => {
    await on();
    await queue([
      {
        idempotencyKey: 'jdm:msg:tw-1:streak',
        mode: 'announce',
        text: 'série',
        delayMs: 2000,
      },
    ]);
    await make();
    await say('!hug');
    expect(await claim()).toEqual({
      step: null,
      reason: 'backoff',
      retry_in_ms: 2000,
    });
    clock.advance(1999);
    expect((await claim()).reason).toBe('backoff');
    clock.advance(1);
    const first = (await claim()).step!;
    expect(first).toMatchObject({
      origin: 'word_game',
      params: { text: 'série' },
    });
    expect(first.expires_at).toBe(
      new Date(T0.getTime() + 62 * SEC).toISOString(),
    );
    await ack(first, 'running');
    await ack(first, 'succeeded');
    expect((await deliver()).origin).toBe('commands');
  });

  it('a failing Commands step cancels the rest of ITS invocation, never a word_game step', async () => {
    await on();
    await make({ actions: [chatAction('A', { on_error: 'stop' })] });
    await say('!hug');
    await queue([publish()]);
    const a = (await claim()).step!;
    expect(a.origin).toBe('commands');
    await ack(a, 'running');
    await ack(a, 'failed', {
      error: { code: 'boom', message: 'refused', retryable: false },
    });
    expect((await all()).map((s) => [s.origin, s.status])).toEqual([
      ['commands', 'failed'],
      ['commands', 'cancelled'],
      ['word_game', 'queued'],
    ]);
    expect((await deliver()).origin).toBe('word_game');
  });

  it('a Commands step whose send is unknown (lease over) never cancels a word_game step either', async () => {
    await on();
    await make({ actions: [chatAction('A', { on_error: 'stop' })] });
    await say('!hug');
    await queue([publish()]);
    const a = (await claim()).step!;
    await ack(a, 'running');
    clock.advance(21 * SEC);
    expect((await claim()).step?.origin).toBe('word_game');
    expect((await all()).map((s) => s.status)).toEqual([
      'unknown',
      'cancelled',
      'claimed',
    ]);
  });

  it('a failing word_game step cancels nothing', async () => {
    await on();
    await queue([
      publish(),
      {
        idempotencyKey: 'jdm:word:occ-2:publish',
        mode: 'normal',
        text: '-> quiner <-',
      },
    ]);
    await make({ actions: [chatAction('A', { on_error: 'stop' })] });
    await say('!hug');
    const w = (await claim()).step!;
    await ack(w, 'running');
    await ack(w, 'failed', {
      error: { code: 'boom', message: 'refused', retryable: false },
    });
    expect((await all()).map((s) => s.status)).toEqual([
      'failed',
      'queued',
      'queued',
      'queued',
    ]);
    expect((await deliver()).idempotency_key).toBe('jdm:word:occ-2:publish');
  });

  it('a retryable word_game failure is retried with backoff, like a Commands step', async () => {
    await on();
    await queue([publish()]);
    const w1 = (await claim()).step!;
    await ack(w1, 'running');
    const r = await ack(w1, 'failed', {
      error: {
        code: 'dropped_x',
        message: 'Twitch did not send it',
        retryable: true,
      },
    });
    expect(r.step).toMatchObject({ status: 'queued', attempt_count: 1 });
    clock.advance(2 * SEC);
    const w2 = (await claim()).step!;
    expect(w2).toMatchObject({ step_id: w1.step_id, attempt_count: 2 });
  });

  it('nothing is handed out while « Sortie chat réelle » is OFF; queueing never turns it on', async () => {
    await queue([publish()]);
    expect(await claim()).toEqual({ step: null, reason: 'output_off' });
    expect((await steps.output(CH)).enabled).toBe(false);
    await on();
    expect((await deliver()).origin).toBe('word_game');
  });

  it('an unsent word_game message expires 60 s after its send time', async () => {
    await queue([publish()]);
    clock.advance(61 * SEC);
    await on();
    expect(await claim()).toEqual({ step: null, reason: 'empty' });
    expect((await all())[0]).toMatchObject({
      status: 'expired',
      origin: 'word_game',
    });
  });
});
