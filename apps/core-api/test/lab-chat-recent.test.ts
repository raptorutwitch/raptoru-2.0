import type { LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { LAB_CHAT_RECENT_MAX, LabChatRouter } from '../src/lab-chat/router.js';

// Studio « Simulation » chat: Core remembers the last received Lab chat messages (memory only) with the
// modules' outcomes, one entry per message id, simulator and real chat told apart.

const msg = (
  id: string,
  text: string,
  over: Partial<LabChatMessage> = {},
): LabChatMessage => ({
  channel_id: '900100',
  message_id: id,
  text,
  chatter: { id: '1', login: 'alice', display_name: 'Alice', role: 'viewer' },
  source: 'simulator',
  ...over,
});

describe('received messages (memory)', () => {
  it('keeps each message with its source, chatter and the modules that handled it', async () => {
    const router = new LabChatRouter([
      {
        name: 'raffle',
        chat: async (m) => ({
          outcome: m.text === '!join' ? 'joined' : 'ignored',
        }),
      },
      {
        name: 'word_game',
        plainText: true,
        chat: async () => ({ outcome: 'ignored' }),
      },
    ]);
    await router.message(msg('m1', '!join'));
    await router.message(msg('m2', 'bonjour', { source: 'twitch' }));
    const { messages } = router.recent('900100');
    expect(
      messages.map((m) => [m.seq, m.message_id, m.source, m.text, m.handled]),
    ).toEqual([
      [
        1,
        'm1',
        'simulator',
        '!join',
        [{ module: 'raffle', outcome: 'joined' }],
      ],
      [2, 'm2', 'twitch', 'bonjour', []],
    ]);
    expect(messages[0]!.chatter).toEqual({
      id: '1',
      display_name: 'Alice',
      role: 'viewer',
    });
    expect(router.recent('999').messages).toEqual([]);
  });

  it('a resent message id updates its entry, never a duplicate', async () => {
    let n = 0;
    const router = new LabChatRouter([
      {
        name: 'mini_games',
        chat: async () =>
          ++n === 1
            ? { outcome: 'mini_game_played' }
            : { outcome: 'mini_game_played', replayed: true },
      },
    ]);
    await router.message(msg('m1', '!roulette 100'));
    await router.message(msg('m1', '!roulette 100'));
    const { messages } = router.recent('900100');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.handled).toEqual([
      { module: 'mini_games', outcome: 'mini_game_played', replayed: true },
    ]);
  });

  it('a refused message is kept with its error (and still thrown to the caller)', async () => {
    let fail = true;
    const router = new LabChatRouter([
      {
        name: 'word_game',
        plainText: true,
        chat: async () => {
          if (fail)
            throw Object.assign(new Error('credit'), { code: 'credit_failed' });
          return { outcome: 'word_game_win' };
        },
      },
    ]);
    await expect(router.message(msg('m1', 'angle'))).rejects.toThrow('credit');
    expect(router.recent('900100').messages[0]).toMatchObject({
      error: 'credit_failed',
      handled: [],
    });
    fail = false;
    await router.message(msg('m1', 'angle'));
    const entry = router.recent('900100').messages[0]!;
    expect(entry.error).toBeUndefined();
    expect(entry.handled).toEqual([
      { module: 'word_game', outcome: 'word_game_win' },
    ]);
  });

  it('the reception time is taken before the modules run (answers come after their message)', async () => {
    let during = '';
    const router = new LabChatRouter([
      {
        name: 'slow',
        chat: async () => {
          await new Promise((r) => setTimeout(r, 30));
          during = new Date().toISOString();
          return { outcome: 'done' };
        },
      },
    ]);
    await router.message(msg('m1', '!x'));
    expect(router.recent('900100').messages[0]!.received_at < during).toBe(
      true,
    );
  });

  it('only the last messages are kept', async () => {
    const router = new LabChatRouter([]);
    for (let i = 0; i < LAB_CHAT_RECENT_MAX + 5; i++)
      await router.message(msg(`m${i}`, 'salut'));
    const { messages } = router.recent('900100');
    expect(messages).toHaveLength(LAB_CHAT_RECENT_MAX);
    expect(messages[0]!.message_id).toBe('m5');
  });
});
