import type { AlertEventInput } from '@raptoru/schemas';

// Twitch alerts V1, lot A1 — EventSub notification → normalized alert event (docs/TWITCH_ALERTS_PARITY_2026-10.md).
// Pure functions, NOT WIRED yet: no subscription is created in A1 (changing the real EventSub subscriptions needs
// Antoni's go). The Bot stays the single EventSub consumer; loyalty / wallet and alerts are two distinct consumers of
// the same events (enabling alerts never enables any economy flag). Field names follow the Twitch EventSub reference
// (checked 16/10/2026), not yet seen on real traffic.

/** What each source needs once wired (documentation of the blocking points). */
export const ALERT_EVENTSUB_SOURCES = [
  {
    type: 'channel.chat.notification',
    version: '1',
    covers:
      'sub, resub, sub_gift (community_gift_id), community_sub_gift (id, total), raid, charity_donation',
    auth: 'user:read:chat of the reading account (LeCroupier_, already used by the Lab chat adapter)',
  },
  {
    type: 'channel.chat.message',
    version: '1',
    covers: 'bits (cheer.bits) — already subscribed by the Lab chat adapter',
    auth: 'user:read:chat',
  },
  {
    type: 'channel.follow',
    version: '2',
    covers: 'follow',
    auth: 'moderator:read:followers (moderator token, condition moderator_user_id)',
  },
  {
    type: 'channel.raid',
    version: '1',
    covers: 'raid (alternative to the chat notification)',
    auth: 'none (condition to_broadcaster_user_id)',
  },
] as const;

type Payload = Record<string, unknown>;
type Out = Omit<AlertEventInput, 'channel_id'>;

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function person(id: unknown, login: unknown, name: unknown) {
  const display = str(name) ?? str(login);
  if (!display) return undefined;
  return {
    ...(str(id) && /^\d{1,32}$/.test(String(id)) ? { id: String(id) } : {}),
    ...(str(login) ? { login: String(login) } : {}),
    display_name: display.slice(0, 64),
  };
}

const tierOf = (tier: unknown, prime: unknown) =>
  prime === true
    ? ('prime' as const)
    : (['1000', '2000', '3000'] as const).find((t) => t === tier);

/**
 * One EventSub notification → one normalized alert event, or null when it is not an alert (other notice types,
 * shared-chat notices of another channel, unusable payloads). `messageId` = the EventSub message id (stable across
 * redeliveries) used when the event has no id of its own.
 */
export function normalizeAlertEvent(
  type: string,
  e: Payload,
  messageId: string,
): Out | null {
  const base = (sourceEventId: unknown) => ({
    source: 'twitch' as const,
    source_event_id: String(str(sourceEventId) ?? messageId).slice(0, 128),
  });
  if (type === 'channel.follow') {
    const actor = person(e.user_id, e.user_login, e.user_name);
    return actor
      ? {
          ...base(messageId),
          type: 'follow',
          actor,
          ...(str(e.followed_at) ? { occurred_at: String(e.followed_at) } : {}),
        }
      : null;
  }
  if (type === 'channel.raid') {
    const actor = person(
      e.from_broadcaster_user_id,
      e.from_broadcaster_user_login,
      e.from_broadcaster_user_name,
    );
    return actor
      ? {
          ...base(messageId),
          type: 'raid',
          actor,
          ...(num(e.viewers) !== undefined ? { viewers: num(e.viewers) } : {}),
        }
      : null;
  }
  if (type === 'channel.chat.message') {
    const bits = num((e.cheer as Payload | null | undefined)?.bits);
    const actor = person(
      e.chatter_user_id,
      e.chatter_user_login,
      e.chatter_user_name,
    );
    if (!bits || !actor) return null;
    const text = str((e.message as Payload | undefined)?.text);
    return {
      ...base(e.message_id),
      type: 'bits',
      actor,
      bits,
      ...(text ? { message: text.slice(0, 500) } : {}),
    };
  }
  if (type !== 'channel.chat.notification') return null;
  const anonymous = e.chatter_is_anonymous === true;
  const actor = anonymous
    ? undefined
    : person(e.chatter_user_id, e.chatter_user_login, e.chatter_user_name);
  const who = {
    ...(actor ? { actor } : {}),
    ...(anonymous ? { anonymous } : {}),
  };
  const notice = String(e.notice_type ?? '');
  const sub = (e[notice] as Payload | null | undefined) ?? {};
  switch (notice) {
    case 'sub': {
      const tier = tierOf(sub.sub_tier, sub.is_prime);
      return actor
        ? {
            ...base(e.message_id),
            type: 'sub',
            actor,
            ...(tier ? { tier } : {}),
            ...(num(sub.duration_months) !== undefined
              ? { months: num(sub.duration_months) }
              : {}),
          }
        : null;
    }
    case 'resub': {
      const tier = tierOf(sub.sub_tier ?? sub.sub_plan, sub.is_prime);
      return actor
        ? {
            ...base(e.message_id),
            type: 'resub',
            actor,
            ...(tier ? { tier } : {}),
            ...(num(sub.cumulative_months) !== undefined
              ? { months: num(sub.cumulative_months) }
              : {}),
          }
        : null;
    }
    case 'sub_gift': {
      const recipient = person(
        sub.recipient_user_id,
        sub.recipient_user_login,
        sub.recipient_user_name,
      );
      const tier = tierOf(sub.sub_tier, false);
      const community = str(sub.community_gift_id);
      // Part of a community gift: absorbed by the batch alert (exact correlation id, never a name / time guess).
      return {
        ...base(e.message_id),
        type: community ? 'gift_recipient' : 'gift_targeted',
        ...who,
        ...(recipient ? { recipient } : {}),
        ...(community ? { community_gift_id: community } : {}),
        ...(tier ? { tier } : {}),
      };
    }
    case 'community_sub_gift': {
      const total = num(sub.total);
      const tier = tierOf(sub.sub_tier, false);
      return total
        ? {
            ...base(e.message_id),
            type: 'gift_community',
            ...who,
            count: total,
            ...(str(sub.id) ? { community_gift_id: String(sub.id) } : {}),
            ...(tier ? { tier } : {}),
          }
        : null;
    }
    case 'raid': {
      const raider = person(sub.user_id, sub.user_login, sub.user_name);
      return raider
        ? {
            ...base(e.message_id),
            type: 'raid',
            actor: raider,
            ...(num(sub.viewer_count) !== undefined
              ? { viewers: num(sub.viewer_count) }
              : {}),
          }
        : null;
    }
    case 'charity_donation': {
      const amount = sub.amount as Payload | undefined;
      const value = num(amount?.value);
      const places = num(amount?.decimal_place);
      const currency = str(amount?.currency);
      return value !== undefined && places !== undefined && currency
        ? {
            ...base(e.message_id),
            type: 'donation',
            ...who,
            amount: { value, decimal_place: places, currency },
            provider: 'twitch_charity',
          }
        : null;
    }
    default:
      // shared_chat_* (another channel's notice), announcements, upgrades…: not an alert of this channel.
      return null;
  }
}
