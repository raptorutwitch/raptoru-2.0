import { describe, expect, it, vi } from 'vitest';
import {
  chatboxEvent,
  createChatboxForwarder,
  OwnAnswers,
} from '../src/chatbox-forward.js';

// Chatbox Raptoru — the bot's part (docs/CHATBOX.md § 5.1): EventSub notifications → the chatbox events (display
// fields, own messages, announcements, moderation), sent in batches, best effort (never blocking the chat games).

const base = {
  chatter_user_id: '42',
  chatter_user_login: 'Mimi',
  chatter_user_name: 'Mimi',
  message_id: 'm1',
  color: '#FF69B4',
  badges: [
    { set_id: 'subscriber', id: '12', info: '12' },
    { set_id: 'lead_moderator', id: '1', info: '' },
  ],
  message: {
    text: 'Coucou Kappa @Duc cheer100',
    fragments: [
      { type: 'text', text: 'Coucou ' },
      { type: 'emote', text: 'Kappa', emote: { id: '25', format: ['static'] } },
      { type: 'text', text: ' ' },
      { type: 'mention', text: '@Duc', mention: { user_id: '9' } },
      { type: 'text', text: ' ' },
      {
        type: 'cheermote',
        text: 'cheer100',
        cheermote: { prefix: 'cheer', bits: 100, tier: 100 },
      },
    ],
  },
  message_type: 'text',
};
const o = { tokenUserId: '999' };

describe('chatbox events from EventSub', () => {
  it('a chat message: colour, badges (lead_moderator kept), fragments, reply', () => {
    const e = chatboxEvent(
      'channel.chat.message',
      {
        ...base,
        reply: {
          parent_message_id: 'p',
          parent_user_name: 'Duc',
          parent_message_body: 'GG',
        },
      },
      o,
    );
    expect(e).toMatchObject({
      type: 'msg',
      message_id: 'm1',
      user: {
        id: '42',
        login: 'mimi',
        name: 'Mimi',
        color: '#FF69B4',
        badges: [
          { set: 'subscriber', version: '12' },
          { set: 'lead_moderator', version: '1' },
        ],
      },
      fragments: [
        { t: 'text', text: 'Coucou ' },
        { t: 'emote', id: '25', text: 'Kappa' },
        { t: 'text', text: ' ' },
        { t: 'mention', text: '@Duc' },
        { t: 'text', text: ' ' },
        { t: 'cheer', text: 'cheer100', bits: 100 },
      ],
      reply: { name: 'Duc', text: 'GG' },
    });
    expect(e).not.toHaveProperty('own');
  });

  it('channel-points highlight and first message; an announcement with its colour; other notices ignored', () => {
    expect(
      chatboxEvent(
        'channel.chat.message',
        { ...base, message_type: 'channel_points_highlighted' },
        o,
      ),
    ).toMatchObject({ kind: 'highlighted' });
    expect(
      chatboxEvent(
        'channel.chat.message',
        { ...base, message_type: 'user_intro' },
        o,
      ),
    ).toMatchObject({ kind: 'first' });
    expect(
      chatboxEvent(
        'channel.chat.notification',
        {
          ...base,
          notice_type: 'announcement',
          announcement: { color: 'BLUE' },
        },
        o,
      ),
    ).toMatchObject({ kind: 'announcement', accent: 'blue' });
    expect(
      chatboxEvent(
        'channel.chat.notification',
        { ...base, notice_type: 'sub' },
        o,
      ),
    ).toBeNull();
  });

  it("LeCroupier_'s own message is marked, with the command its direct answer belongs to", () => {
    const answers = new OwnAnswers();
    answers.note('m1', 'daily');
    const own = { ...base, chatter_user_id: '999' };
    expect(
      chatboxEvent('channel.chat.message', own, {
        ...o,
        answered: (id) => answers.get(id),
      }),
    ).toMatchObject({
      own: true,
      answered: 'daily',
    });
    expect(
      chatboxEvent(
        'channel.chat.message',
        { ...own, message_id: 'm2' },
        { ...o, answered: (id) => answers.get(id) },
      ),
    ).toMatchObject({ own: true });
    expect(
      chatboxEvent(
        'channel.chat.message',
        { ...own, message_id: 'm2' },
        { ...o, answered: (id) => answers.get(id) },
      ),
    ).not.toHaveProperty('answered');
  });

  it('moderation: deleted message, timeout / ban, clear', () => {
    expect(
      chatboxEvent('channel.chat.message_delete', { message_id: 'm1' }, o),
    ).toEqual({ type: 'delete', message_id: 'm1' });
    expect(
      chatboxEvent(
        'channel.chat.clear_user_messages',
        { target_user_id: '42' },
        o,
      ),
    ).toEqual({ type: 'clear_user', user_id: '42' });
    expect(chatboxEvent('channel.chat.clear', {}, o)).toEqual({
      type: 'clear',
    });
    expect(chatboxEvent('stream.online', {}, o)).toBeNull();
  });
});

describe('chatbox forwarder', () => {
  it('batches, posts to /v1/bot/chatbox, and swallows a refusal (the chat games never wait)', async () => {
    const posts: unknown[] = [];
    const post = vi.fn(async (_p: string, body: unknown) => {
      posts.push(body);
      return { status: posts.length === 1 ? 200 : 503 };
    });
    const log = vi.fn();
    const f = createChatboxForwarder({ channelId: '1', post, log, flushMs: 5 });
    f.send({ type: 'clear' });
    f.send({ type: 'delete', message_id: 'x' });
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(posts[0]).toEqual({
      channel_id: '1',
      events: [{ type: 'clear' }, { type: 'delete', message_id: 'x' }],
    });
    f.send({ type: 'clear' });
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        '[chatbox] events not delivered',
        'core_503',
      ),
    );
  });
});
