import { RANDOM_BAN, type LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { RandomBanChat } from '../src/chat-interactions/random-ban-chat.js';
import { chatRouter } from '../src/lab-chat/games.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup } from './helpers.js';

// `!rb` in the chat (docs/CHAT_COMMANDS.md): the channel points Random Ban, paid 25 000 Jetons by the chat author;
// request + debit atomic, once per Twitch message, refunded once when nothing was done, never a success before the
// executor's result.

const CH = '83603689';
const alice = {
  id: '9001',
  login: 'alice',
  display_name: 'Alice',
  role: 'viewer' as const,
};
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const TARGET = { id: '9002', login: 'target', name: 'Target' };
const STATS = { chatters: 12, candidates: 7, follow_checks: 2 };
let n = 0;
const msg = (
  text: string,
  id = `tw-${++n}`,
  source: 'twitch' | 'simulator' = 'twitch',
): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: alice,
  source,
});

async function lab(tokens = 100_000) {
  const core = await setup();
  core.clock.set(new Date('2026-10-22T20:00:00Z'));
  await editWallet(
    core.db,
    core.clock.now(),
    CH,
    alice.id,
    'set',
    { tokens },
    'test',
  );
  const router = chatRouter(core.raffleLab, core.chat.chatModules);
  const rb = core.randomBan;
  /** The Twitch executor polls (tells Core it is there); returns what it claimed. */
  const poll = async (exec = EXEC) => (await rb.claim(CH, exec)).request;
  const tokensOf = async () =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, alice.id],
        )
      )[0]?.tokens,
    );
  const requests = () =>
    core.db.query<{
      request_id: string;
      source: string;
      status: string;
      refund: string;
      mode: string;
    }>(
      'select request_id, source, status, refund, mode from rb_requests order by seq',
    );
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'rb:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  return { core, router, rb, poll, tokensOf, requests, replies };
}

describe('!rb in the chat', () => {
  it('`!rb`: one Random Ban request (source chat) and 25 000 Jetons debited together; « en file », never « réussi »', async () => {
    const l = await lab();
    await l.poll();
    const out = await l.router.message(msg('!rb'));
    expect(out.handled).toEqual([
      { module: 'random_ban', outcome: 'rb_queued', replayed: false },
    ]);
    expect(await l.requests()).toMatchObject([
      { source: 'chat', status: 'queued', refund: 'none', mode: 'real' },
    ]);
    expect(await l.tokensOf()).toBe(100_000 - 25_000);
    expect(await l.replies()).toEqual([
      '@Alice — 🎲 Random Ban en file (25 000 Jetons). Résultat dans un instant.',
    ]);
  });

  it('strict syntax: arguments, a sentence, a longer word are not commands (nothing paid, no answer)', async () => {
    const l = await lab();
    await l.poll();
    for (const text of [
      '!rb salut',
      'Salut !rb',
      '!rbx',
      '!r b',
      'rb',
      '!rb @Bob',
    ])
      expect((await l.router.message(msg(text))).handled).toEqual([]);
    expect(await l.requests()).toEqual([]);
    expect(await l.tokensOf()).toBe(100_000);
    expect(await l.replies()).toEqual([]);
    // Case and outer spaces ignored.
    expect((await l.router.message(msg('  !RB  '))).handled[0]).toMatchObject({
      outcome: 'rb_queued',
    });
  });

  it('the same Twitch message twice: one request, one debit, one answer', async () => {
    const l = await lab();
    await l.poll();
    const m = msg('!rb');
    await l.router.message(m);
    expect((await l.router.message(m)).handled).toEqual([
      { module: 'random_ban', outcome: 'rb_replayed', replayed: true },
    ]);
    expect(await l.requests()).toHaveLength(1);
    expect(await l.tokensOf()).toBe(75_000);
    expect(await l.replies()).toHaveLength(1);
  });

  it('not enough Jetons: price, balance and gap; no request, nothing debited', async () => {
    const l = await lab(12_000);
    await l.poll();
    await l.router.message(msg('!rb'));
    expect(await l.replies()).toEqual([
      '@Alice — Il te faut 25 000 Jetons pour utiliser Random Ban. Solde : 12 000 Jetons (il te manque 13 000).',
    ]);
    expect(await l.requests()).toEqual([]);
    expect(await l.tokensOf()).toBe(12_000);
  });

  it('executor absent (bot not polling) or Raptoru paused: refused before any debit', async () => {
    const l = await lab();
    await l.router.message(msg('!rb'));
    await l.poll();
    await l.core.db.query(
      `insert into lab_global_state (channel_id, paused, paused_at, paused_by, updated_at) values ($1, true, now(), 'mod', now())`,
      [CH],
    );
    await l.router.message(msg('!rb'));
    expect(await l.replies()).toEqual([
      '@Alice — Random Ban indisponible pour le moment · rien n’a été débité.',
      '@Alice — Raptoru en pause · rien n’a été débité.',
    ]);
    expect(await l.requests()).toEqual([]);
    expect(await l.tokensOf()).toBe(100_000);
  });

  it('confirmed by the executor: paid, no refund', async () => {
    const l = await lab();
    await l.poll();
    await l.router.message(msg('!rb'));
    const c = (await l.poll())!;
    await l.rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: TARGET,
      is_sub: false,
      stats: STATS,
    });
    await l.rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'confirmed',
    });
    expect(await l.requests()).toMatchObject([
      { status: 'confirmed', refund: 'none' },
    ]);
    expect(await l.tokensOf()).toBe(75_000);
    expect(await l.replies()).toHaveLength(1);
  });

  it('refused by Twitch after the target (nothing done): refunded once, told once', async () => {
    const l = await lab();
    await l.poll();
    await l.router.message(msg('!rb'));
    const c = (await l.poll())!;
    await l.rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: TARGET,
      is_sub: false,
      stats: STATS,
    });
    await l.rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'refused',
      error: 'user_is_mod',
    });
    expect(await l.tokensOf()).toBe(100_000);
    expect(await l.requests()).toMatchObject([
      { status: 'failed', refund: 'none' },
    ]);
    await l.core.chat.randomBanChat!.settle(CH); // a second settle: nothing more
    expect(await l.tokensOf()).toBe(100_000);
    expect((await l.replies()).slice(1)).toEqual([
      '@Alice — Random Ban impossible pour le moment · 25 000 Jetons remboursés.',
    ]);
  });

  it('executor gone before picking it up (sweep): refunded once', async () => {
    const l = await lab();
    await l.poll();
    await l.router.message(msg('!rb'));
    l.core.clock.advance(RANDOM_BAN.pickupMs + 1000);
    // The next poll (or Studio's read) sweeps: executor_absent → refund told to the chat module.
    await l.rb.state(CH);
    expect(await l.requests()).toMatchObject([
      { status: 'failed', refund: 'none' },
    ]);
    expect(await l.tokensOf()).toBe(100_000);
  });

  it('timeout sent but no answer (uncertain): never refunded automatically (à vérifier)', async () => {
    const l = await lab();
    await l.poll();
    await l.router.message(msg('!rb'));
    const c = (await l.poll())!;
    await l.rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: TARGET,
      is_sub: false,
      stats: STATS,
    });
    await l.rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'uncertain',
      error: 'no_answer',
    });
    expect(await l.requests()).toMatchObject([
      { status: 'uncertain', refund: 'to_verify' },
    ]);
    expect(await l.tokensOf()).toBe(75_000);
  });

  it('chat and channel points together: two requests in turn, only the chat one paid in Jetons', async () => {
    const l = await lab();
    await l.poll();
    await Promise.all([
      l.router.message(msg('!rb')),
      l.rb.request({
        channel_id: CH,
        source: 'channel_points',
        source_ref: 'twitch:r1:0',
        mode: 'real',
        buyer: { id: '9100', login: 'cp', name: 'CP' },
      }),
    ]);
    const rows = await l.requests();
    expect(rows.map((r) => r.source).sort()).toEqual([
      'channel_points',
      'chat',
    ]);
    expect(await l.tokensOf()).toBe(75_000);
    // One Random Ban at a time: the second waits for the first.
    const first = (await l.poll())!;
    expect(await l.poll()).toBeNull();
    expect(first.request_id).toBe(rows[0]!.request_id);
  });

  it('the Studio simulator never times anyone out (dry run), like a channel points test', async () => {
    const l = await lab();
    await l.poll();
    await l.router.message(msg('!rb', 'sim-1', 'simulator'));
    expect(await l.requests()).toMatchObject([{ mode: 'dry_run' }]);
  });

  it('prices come from Core’s price reader (Studio later): another price is debited and shown', async () => {
    const core = await setup();
    core.clock.set(new Date('2026-10-22T20:00:00Z'));
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      alice.id,
      'set',
      { tokens: 100_000 },
      'test',
    );
    const chat = new RandomBanChat(
      core.db,
      core.clock,
      core.randomBan,
      core.economy,
      {
        price: async (_c, i) => (i === 'random_ban' ? 30_000 : 0),
      },
    );
    await core.randomBan.claim(CH, EXEC);
    await chat.chat(msg('!rb'));
    const tokens = await core.db.query<{ tokens: number }>(
      'select tokens from lab_wallets where viewer_id = $1',
      [alice.id],
    );
    expect(Number(tokens[0]!.tokens)).toBe(70_000);
  });
});
