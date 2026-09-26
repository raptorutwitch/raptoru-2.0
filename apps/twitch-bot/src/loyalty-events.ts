import type {
  LoyaltyEvent,
  SubscriptionSnapshot,
  SubTier,
  Viewer,
} from '@raptoru/schemas';
import type { CoreClient } from './core-client.js';
import type { EventSubHandlers } from './twitch/eventsub.js';

// Broadcaster-side Twitch events for the Loyalty Engine: the bot only normalizes and forwards.
// Amounts, modes (shadow/preview/credit) and idempotency are decided by Core.

export const BROADCASTER_EVENT_SUBSCRIPTIONS = [
  { type: 'channel.subscribe', version: '1' },
  { type: 'channel.subscription.message', version: '1' },
  { type: 'channel.subscription.gift', version: '1' },
  { type: 'channel.subscription.end', version: '1' },
  { type: 'channel.cheer', version: '1' },
  { type: 'channel.follow', version: '2' },
] as const;

const TIERS: Record<string, SubTier> = {
  '1000': 't1',
  '2000': 't2',
  '3000': 't3',
};

type Payload = Record<string, unknown>;

function viewerOf(e: Payload): Viewer | null {
  const id = e.user_id;
  if (
    typeof id !== 'string' ||
    !/^\d+$/.test(id) ||
    typeof e.user_login !== 'string'
  )
    return null;
  return {
    twitchUserId: id,
    login: e.user_login,
    displayName: String(e.user_name || e.user_login),
  };
}

/** EventSub notification → Core event. Returns null for unusable payloads (never invents a tier). */
export function normalizeLoyaltyEvent(
  type: string,
  e: Payload,
  eventId: string,
): LoyaltyEvent | null {
  const viewer = viewerOf(e);
  const tier = TIERS[String(e.tier)];
  switch (type) {
    case 'channel.subscribe':
      return viewer && tier
        ? { type: 'sub', eventId, viewer, tier, isGift: e.is_gift === true }
        : null;
    case 'channel.subscription.message':
      return viewer && tier ? { type: 'resub', eventId, viewer, tier } : null;
    case 'channel.subscription.gift': {
      const count = Number(e.total);
      if (!tier || !Number.isInteger(count) || count < 1) return null;
      return {
        type: 'subgift',
        eventId,
        gifter: e.is_anonymous === true ? null : viewer,
        tier,
        count,
      };
    }
    case 'channel.subscription.end':
      return viewer ? { type: 'subscription_end', eventId, viewer } : null;
    case 'channel.cheer': {
      const bits = Number(e.bits);
      if (!Number.isInteger(bits) || bits < 1) return null;
      return {
        type: 'bits',
        eventId,
        viewer: e.is_anonymous === true ? null : viewer,
        bits,
      };
    }
    case 'channel.follow':
      return viewer ? { type: 'follow', eventId, viewer } : null;
    default:
      return null;
  }
}

export type SubscriptionsPage = (after: string | null) => Promise<{
  subscriptions: {
    user_id: string;
    user_login: string;
    user_name: string;
    tier: string;
    is_gift: boolean;
  }[];
  cursor: string | null;
}>;

/**
 * Complete subscriber list across all pages. Throws on any failure, repeated cursor or page limit:
 * a partial list is never sent (Core would take absent subscribers for non-subs).
 */
export async function fetchSubscriptionSnapshot(
  getPage: SubscriptionsPage,
  now: Date,
  maxPages = 1000,
): Promise<SubscriptionSnapshot> {
  const subscribers = new Map<
    string,
    SubscriptionSnapshot['subscribers'][number]
  >();
  const seen = new Set<string>();
  let after: string | null = null;
  for (let page = 1; ; page++) {
    if (page > maxPages)
      throw new Error(`subscriptions: more than ${maxPages} pages`);
    const { subscriptions, cursor } = await getPage(after);
    for (const s of subscriptions) {
      const tier = TIERS[s.tier];
      if (!tier) throw new Error(`subscriptions: unknown tier ${s.tier}`);
      subscribers.set(s.user_id, {
        viewer: {
          twitchUserId: s.user_id,
          login: s.user_login,
          displayName: s.user_name || s.user_login,
        },
        tier,
        isGift: s.is_gift,
      });
    }
    if (!cursor)
      return {
        fetchedAt: now.toISOString(),
        subscribers: [...subscribers.values()],
      };
    if (seen.has(cursor))
      throw new Error('subscriptions: repeated pagination cursor');
    seen.add(cursor);
    after = cursor;
  }
}

export function createBroadcasterEvents(deps: {
  core: Pick<CoreClient, 'loyaltyEvent' | 'subscriptionSnapshot'>;
  subscribe: (
    type: string,
    condition: Record<string, string>,
    sessionId: string,
    version: string,
  ) => Promise<void>;
  getSubscriptionsPage: SubscriptionsPage;
  broadcasterId: string;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}) {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());

  const eventSub: EventSubHandlers = {
    async subscribe(sessionId) {
      for (const s of BROADCASTER_EVENT_SUBSCRIPTIONS) {
        const condition: Record<string, string> =
          s.type === 'channel.follow'
            ? {
                broadcaster_user_id: deps.broadcasterId,
                moderator_user_id: deps.broadcasterId,
              }
            : { broadcaster_user_id: deps.broadcasterId };
        await deps.subscribe(s.type, condition, sessionId, s.version);
      }
      log(
        '[loyalty] broadcaster EventSub subscriptions created (subs, gifts, cheers, follows)',
      );
    },
    async notification(type, event, messageId) {
      const normalized = normalizeLoyaltyEvent(type, event, messageId);
      if (!normalized) {
        log(`[loyalty] ignored ${type} (unusable payload)`);
        return;
      }
      try {
        const res = await deps.core.loyaltyEvent(normalized);
        log(
          `[loyalty] ${normalized.type} → ${res.status}${res.amount !== null ? ` ${res.amount}` : ''}${res.reason ? ` (${res.reason})` : ''}`,
        );
      } catch (error) {
        log(
          `[loyalty] ${normalized.type} forwarding failed`,
          (error as Error).message,
        );
      }
    },
  };

  return {
    eventSub,
    /** Full subscriber snapshot → Core. On failure nothing is sent and tiers stay as they are. */
    async syncSubscriptions(): Promise<number | null> {
      try {
        const snapshot = await fetchSubscriptionSnapshot(
          deps.getSubscriptionsPage,
          now(),
        );
        await deps.core.subscriptionSnapshot(snapshot);
        log(
          `[loyalty] subscription snapshot: ${snapshot.subscribers.length} subscribers`,
        );
        return snapshot.subscribers.length;
      } catch (error) {
        log(
          '[loyalty] subscription snapshot failed, tiers unchanged',
          (error as Error).message,
        );
        return null;
      }
    },
  };
}
