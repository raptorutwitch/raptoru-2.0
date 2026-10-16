import { describe, expect, it } from 'vitest';
import {
  ALERT_EVENTSUB_SOURCES,
  normalizeAlertEvent,
} from '../src/alert-events.js';

// Twitch alerts V1 (A1) — EventSub payloads (shapes of the Twitch EventSub reference) → normalized alert events.
// Not wired: no subscription is created by A1.

const chatter = {
  broadcaster_user_id: '83603689',
  chatter_user_id: '111',
  chatter_user_login: 'alice',
  chatter_user_name: 'Alice',
  chatter_is_anonymous: false,
  message_id: 'msg-1',
  message: { text: '', fragments: [] },
};
const notif = (notice: string, obj: Record<string, unknown>, over = {}) =>
  normalizeAlertEvent(
    'channel.chat.notification',
    { ...chatter, notice_type: notice, [notice]: obj, ...over },
    'evs-1',
  );

describe('channel.chat.notification', () => {
  it('sub and resub: two distinct types, tier / Prime and months', () => {
    expect(
      notif('sub', { sub_tier: '1000', is_prime: false, duration_months: 1 }),
    ).toEqual({
      source: 'twitch',
      source_event_id: 'msg-1',
      type: 'sub',
      actor: { id: '111', login: 'alice', display_name: 'Alice' },
      tier: '1000',
      months: 1,
    });
    expect(
      notif('resub', {
        cumulative_months: 14,
        duration_months: 1,
        streak_months: 3,
        sub_tier: '2000',
        is_prime: true,
        is_gift: false,
      }),
    ).toMatchObject({ type: 'resub', tier: 'prime', months: 14 });
  });

  it('sub_gift without community id: targeted gift (gifter, recipient)', () => {
    expect(
      notif('sub_gift', {
        duration_months: 1,
        recipient_user_id: '222',
        recipient_user_login: 'bob',
        recipient_user_name: 'Bob',
        sub_tier: '1000',
        community_gift_id: null,
      }),
    ).toMatchObject({
      type: 'gift_targeted',
      actor: { display_name: 'Alice' },
      recipient: { id: '222', display_name: 'Bob' },
    });
  });

  it('sub_gift with a community id: a recipient, absorbed by the batch (exact correlation)', () => {
    expect(
      notif('sub_gift', {
        recipient_user_id: '222',
        recipient_user_login: 'bob',
        recipient_user_name: 'Bob',
        sub_tier: '1000',
        community_gift_id: 'cg-9',
      }),
    ).toMatchObject({ type: 'gift_recipient', community_gift_id: 'cg-9' });
  });

  it('community_sub_gift: one batch with its total and id; anonymous gifter kept anonymous', () => {
    expect(
      notif('community_sub_gift', { id: 'cg-9', total: 10, sub_tier: '1000' }),
    ).toMatchObject({
      type: 'gift_community',
      count: 10,
      community_gift_id: 'cg-9',
      actor: { display_name: 'Alice' },
    });
    const anon = notif(
      'community_sub_gift',
      { id: 'cg-10', total: 5, sub_tier: '1000' },
      { chatter_is_anonymous: true, chatter_user_name: 'AnAnonymousGifter' },
    );
    expect(anon).toMatchObject({ type: 'gift_community', anonymous: true });
    expect(anon).not.toHaveProperty('actor');
  });

  it('raid (raider, viewer_count) and Twitch Charity donation (minor units)', () => {
    expect(
      notif('raid', {
        user_id: '333',
        user_login: 'raider',
        user_name: 'Raider',
        viewer_count: 42,
        profile_image_url: 'https://x',
      }),
    ).toMatchObject({ type: 'raid', actor: { id: '333' }, viewers: 42 });
    expect(
      notif('charity_donation', {
        charity_name: 'X',
        amount: { value: 1250, decimal_place: 2, currency: 'EUR' },
      }),
    ).toMatchObject({
      type: 'donation',
      amount: { value: 1250, decimal_place: 2, currency: 'EUR' },
      provider: 'twitch_charity',
    });
  });

  it('shared chat notices of another channel, announcements, upgrades: not alerts', () => {
    for (const t of [
      'shared_chat_sub',
      'announcement',
      'gift_paid_upgrade',
      'unknown',
    ])
      expect(notif(t, {})).toBeNull();
  });
});

describe('follow, raid, cheer', () => {
  it('channel.follow v2 → follow (EventSub message id as the event id)', () => {
    expect(
      normalizeAlertEvent(
        'channel.follow',
        {
          user_id: '444',
          user_login: 'newbie',
          user_name: 'Newbie',
          broadcaster_user_id: '83603689',
          followed_at: '2026-10-16T20:00:00.000Z',
        },
        'evs-follow',
      ),
    ).toEqual({
      source: 'twitch',
      source_event_id: 'evs-follow',
      type: 'follow',
      actor: { id: '444', login: 'newbie', display_name: 'Newbie' },
      occurred_at: '2026-10-16T20:00:00.000Z',
    });
  });

  it('channel.raid → raid (`viewers`)', () => {
    expect(
      normalizeAlertEvent(
        'channel.raid',
        {
          from_broadcaster_user_id: '555',
          from_broadcaster_user_login: 'big',
          from_broadcaster_user_name: 'Big',
          to_broadcaster_user_id: '83603689',
          viewers: 120,
        },
        'evs-raid',
      ),
    ).toMatchObject({
      type: 'raid',
      viewers: 120,
      source_event_id: 'evs-raid',
    });
  });

  it('channel.chat.message with cheer → bits (message kept); a plain message → null', () => {
    expect(
      normalizeAlertEvent(
        'channel.chat.message',
        { ...chatter, message: { text: 'Cheer100 gg' }, cheer: { bits: 100 } },
        'evs-2',
      ),
    ).toMatchObject({ type: 'bits', bits: 100, message: 'Cheer100 gg' });
    expect(
      normalizeAlertEvent(
        'channel.chat.message',
        { ...chatter, cheer: null },
        'evs-3',
      ),
    ).toBeNull();
  });

  it('documents the sources and their authorization (nothing wired in A1)', () => {
    expect(ALERT_EVENTSUB_SOURCES.map((s) => s.type)).toEqual([
      'channel.chat.notification',
      'channel.chat.message',
      'channel.follow',
      'channel.raid',
    ]);
  });
});
