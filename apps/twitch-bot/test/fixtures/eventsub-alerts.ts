// EventSub WebSocket frames of the alert sources, shaped like the Twitch reference examples (dev.twitch.tv EventSub
// subscription types / reference, read 17/10/2026): `channel.chat.notification` v1 (every notice object present, null
// when unused; resub verbatim from the example, incl. its `sub_plan`), `channel.chat.message` v1 with a cheer,
// `channel.follow` v2. Ids are fictitious; raptoru_ = 83603689, LeCroupier_ = 1239040922.

export const BROADCASTER = '83603689';
export const READER = '1239040922';

const NOTICES = [
  'sub',
  'resub',
  'sub_gift',
  'community_sub_gift',
  'gift_paid_upgrade',
  'prime_paid_upgrade',
  'pay_it_forward',
  'raid',
  'unraid',
  'announcement',
  'bits_badge_tier',
  'charity_donation',
  'watch_streak',
  'modiversary',
  'gifted_drops_summary',
  'shared_chat_sub',
  'shared_chat_resub',
  'shared_chat_sub_gift',
  'shared_chat_community_sub_gift',
  'shared_chat_gift_paid_upgrade',
  'shared_chat_prime_paid_upgrade',
  'shared_chat_pay_it_forward',
  'shared_chat_raid',
  'shared_chat_announcement',
  'shared_chat_modiversary',
  'shared_chat_gifted_drops_summary',
];

const channel = {
  broadcaster_user_id: BROADCASTER,
  broadcaster_user_login: 'raptoru_',
  broadcaster_user_name: 'Raptoru_',
};
const noSource = {
  source_broadcaster_user_id: null,
  source_broadcaster_user_login: null,
  source_broadcaster_user_name: null,
  source_message_id: null,
  source_badges: null,
};

/** A whole WebSocket notification frame (what the EventSub client receives). */
export function frame(
  type: string,
  version: string,
  event: Record<string, unknown>,
  messageId: string,
) {
  return JSON.stringify({
    metadata: {
      message_id: messageId,
      message_type: 'notification',
      message_timestamp: '2026-10-17T20:00:00.000000000Z',
      subscription_type: type,
      subscription_version: version,
    },
    payload: {
      subscription: {
        id: 'dc1a3cfc-a930-4972-bf9e-0ffc4e7a8996',
        status: 'enabled',
        type,
        version,
        condition:
          type === 'channel.follow'
            ? { broadcaster_user_id: BROADCASTER, moderator_user_id: READER }
            : { broadcaster_user_id: BROADCASTER, user_id: READER },
        transport: {
          method: 'websocket',
          session_id: 'AgoQOtgGkFvXRlSkij343CndhIGY2VsbC1h',
        },
        created_at: '2026-10-17T19:00:00.000000000Z',
        cost: 0,
      },
      event,
    },
  });
}

type Who = { id: string; login: string; name: string } | 'anonymous';

/** One `channel.chat.notification` event: every notice object null except `notice`. */
export function notice(
  notice: string,
  body: Record<string, unknown>,
  o: { who: Who; messageId: string; source?: string },
) {
  const anon = o.who === 'anonymous';
  const who = anon
    ? { id: '274598607', login: 'ananonymousgifter', name: 'AnAnonymousGifter' }
    : (o.who as Exclude<Who, 'anonymous'>);
  return {
    ...channel,
    chatter_user_id: who.id,
    chatter_user_login: who.login,
    chatter_user_name: who.name,
    chatter_is_anonymous: anon,
    color: '',
    badges: [],
    system_message: '',
    message_id: o.messageId,
    message: { text: '', fragments: [] },
    notice_type: notice,
    ...Object.fromEntries(NOTICES.map((n) => [n, n === notice ? body : null])),
    ...noSource,
    ...(o.source
      ? {
          source_broadcaster_user_id: o.source,
          source_broadcaster_user_login: 'streamer33',
          source_broadcaster_user_name: 'streamer33',
          source_message_id: '2be7193d-0366-4453-b6ec-b288ce9f2c39',
          source_badges: [],
          is_source_only: true,
        }
      : { is_source_only: null }),
  };
}

const ALICE = { id: '111', login: 'alice', name: 'Alice' };
const BOB = { id: '222', login: 'bob', name: 'Bob' };

export const EVENTS = {
  sub: notice(
    'sub',
    { sub_tier: '1000', is_prime: false, duration_months: 1 },
    { who: ALICE, messageId: 'n-sub-1' },
  ),
  prime: notice(
    'sub',
    { sub_tier: '1000', is_prime: true, duration_months: 1 },
    { who: BOB, messageId: 'n-prime-1' },
  ),
  // Verbatim shape of the reference example (sub_plan, streak null).
  resub: notice(
    'resub',
    {
      cumulative_months: 10,
      duration_months: 0,
      streak_months: null,
      sub_plan: '1000',
      is_gift: false,
      gifter_is_anonymous: null,
      gifter_user_id: null,
      gifter_user_name: null,
      gifter_user_login: null,
    },
    {
      who: { id: '49912639', login: 'viewer23', name: 'viewer23' },
      messageId: 'd62235c8-47ff-a4f4--84e8-5a29a65a9c03',
    },
  ),
  giftTargeted: notice(
    'sub_gift',
    {
      duration_months: 1,
      cumulative_total: 4,
      recipient_user_id: '333',
      recipient_user_name: 'Chanceux',
      recipient_user_login: 'chanceux',
      sub_tier: '1000',
      community_gift_id: null,
    },
    { who: ALICE, messageId: 'n-gift-t-1' },
  ),
  /** A community gift of 3: the batch notice, then one sub_gift per recipient carrying its id. */
  community: [
    notice(
      'community_sub_gift',
      { id: 'cg-777', total: 3, sub_tier: '1000', cumulative_total: 12 },
      { who: BOB, messageId: 'n-cg-777' },
    ),
    ...['401', '402', '403'].map((id) =>
      notice(
        'sub_gift',
        {
          duration_months: 1,
          cumulative_total: null,
          recipient_user_id: id,
          recipient_user_name: `R${id}`,
          recipient_user_login: `r${id}`,
          sub_tier: '1000',
          community_gift_id: 'cg-777',
        },
        { who: BOB, messageId: `n-cg-777-${id}` },
      ),
    ),
  ],
  communityAnonymous: notice(
    'community_sub_gift',
    { id: 'cg-888', total: 5, sub_tier: '1000', cumulative_total: null },
    { who: 'anonymous', messageId: 'n-cg-888' },
  ),
  raid: notice(
    'raid',
    {
      user_id: '555',
      user_name: 'GrosRaideur',
      user_login: 'grosraideur',
      viewer_count: 42,
      profile_image_url: 'https://example.invalid/p.png',
    },
    {
      who: { id: '555', login: 'grosraideur', name: 'GrosRaideur' },
      messageId: 'n-raid-1',
    },
  ),
  /** A resub in another channel of a shared chat session: not ours. */
  sharedResub: notice(
    'shared_chat_resub',
    {},
    { who: ALICE, messageId: 'n-shared-1', source: '112233' },
  ),
  follow: {
    user_id: '1234',
    user_login: 'cool_user',
    user_name: 'Cool_User',
    ...channel,
    followed_at: '2026-10-17T20:00:00.17106713Z',
  },
};

/** A chat message (reference example) carrying a cheer. */
export function cheer(
  bits: number,
  o: { messageId: string; login?: string; name?: string; source?: string },
) {
  return {
    ...channel,
    chatter_user_id: '4145994',
    chatter_user_login: o.login ?? 'viewer32',
    chatter_user_name: o.name ?? 'viewer32',
    message_id: o.messageId,
    message: {
      text: `Cheer${bits} bravo`,
      fragments: [
        {
          type: 'cheermote',
          text: `Cheer${bits}`,
          cheermote: { prefix: 'cheer', bits, tier: 1 },
          emote: null,
          mention: null,
        },
        {
          type: 'text',
          text: ' bravo',
          cheermote: null,
          emote: null,
          mention: null,
        },
      ],
    },
    color: '#00FF7F',
    badges: [],
    message_type: 'text',
    cheer: { bits },
    reply: null,
    channel_points_custom_reward_id: null,
    ...noSource,
    ...(o.source ? { source_broadcaster_user_id: o.source } : {}),
  };
}
