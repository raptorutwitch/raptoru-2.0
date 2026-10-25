import type {
  LoyaltyEvent,
  SubscriptionSnapshot,
  SubTier,
  Viewer,
} from '@raptoru/schemas';
import {
  CoreHttpError,
  type CoreClient,
  notLeaseHolder,
} from './core-client.js';
import type { LoyaltyOutbox, OutboxEntry } from './loyalty-outbox.js';
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
    case 'channel.subscription.message': {
      // Twitch's cumulative months: the Roue du Sub's certain month (never invented when absent).
      const months = Number(e.cumulative_months);
      return viewer && tier
        ? {
            type: 'resub',
            eventId,
            viewer,
            tier,
            ...(Number.isInteger(months) && months >= 1 && months <= 1000
              ? { cumulativeMonths: months }
              : {}),
          }
        : null;
    }
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

/** Waits between forwarding attempts while Core is unreachable; the last one repeats forever. */
export const FORWARD_RETRY_DELAYS_MS = [
  5_000, 15_000, 30_000, 60_000, 120_000, 300_000,
];

export interface EventSubSubscription {
  type: string;
  sessionId: string | null;
  createdAt: string;
}

export function createBroadcasterEvents(deps: {
  core: Pick<CoreClient, 'loyaltyEvent' | 'subscriptionSnapshot'>;
  subscribe: (
    type: string,
    condition: Record<string, string>,
    sessionId: string,
    version: string,
  ) => Promise<void>;
  /** Enabled EventSub subscriptions of the broadcaster token (any session). */
  listEnabledSubscriptions: () => Promise<EventSubSubscription[]>;
  getSubscriptionsPage: SubscriptionsPage;
  broadcasterId: string;
  /** Durable store of the events not yet answered by Core (see loyalty-outbox.ts). */
  outbox: LoyaltyOutbox;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
  retryDelaysMs?: number[];
  schedule?: (run: () => void, ms: number) => void;
}) {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());
  const retryDelays = deps.retryDelaysMs ?? FORWARD_RETRY_DELAYS_MS;
  const schedule =
    deps.schedule ?? ((run, ms) => void setTimeout(run, ms).unref());
  const types = new Set<string>(
    BROADCASTER_EVENT_SUBSCRIPTIONS.map((s) => s.type),
  );
  /** Current EventSub session, and whether it is verified as the only consumer. */
  let session: string | null = null;
  let verified = false;
  /** Event ids being sent or waiting for a retry: never two concurrent sends of one event. */
  const sending = new Set<string>();

  // Core is idempotent per event id, so resending is always safe. A transient failure (Core down
  // or restarting, 5xx, or 409 not_lease_holder: the bot lease is changing hands) is retried until Core answers, across
  // bot restarts (outbox). Any other 4xx is a definitive refusal (e.g. 409: same event id with another payload), kept
  // in the outbox journal.
  function send(entry: OutboxEntry): void {
    if (sending.has(entry.event.eventId)) return;
    sending.add(entry.event.eventId);
    void attempt(entry, 0);
  }

  async function attempt(entry: OutboxEntry, n: number): Promise<void> {
    const { event } = entry;
    const ref = `${event.type} ${event.eventId}`;
    try {
      // The Twitch time travels with the event: Core decides on which side of the economic cutover it falls.
      const res = await deps.core.loyaltyEvent({
        ...event,
        occurredAt: entry.receivedAt,
      });
      deps.outbox.remove(event.eventId);
      sending.delete(event.eventId);
      log(
        `[loyalty] ${event.type} → ${res.status}${res.amount !== null ? ` ${res.amount}` : ''}${res.reason ? ` (${res.reason})` : ''}${res.replayed ? ' (replay)' : ''}`,
      );
    } catch (error) {
      const message = (error as Error).message;
      if (
        error instanceof CoreHttpError &&
        error.status < 500 &&
        !notLeaseHolder(error)
      ) {
        deps.outbox.reject(entry, message, now());
        sending.delete(event.eventId);
        log(`[loyalty] REJECTED by Core: ${ref} (${message})`);
        return;
      }
      const delay = retryDelays[Math.min(n, retryDelays.length - 1)]!;
      log(
        `[loyalty] forwarding failed: ${ref} (${message}), kept in the outbox, retry in ${delay / 1000}s`,
      );
      schedule(() => void attempt(entry, n + 1), delay);
    }
  }

  /** Sends every outbox entry, except those of a session still being verified. */
  function sendPending(): void {
    for (const entry of deps.outbox.pending())
      if (verified || entry.session !== session) send(entry);
  }

  /** Earliest creation time of the loyalty subscriptions of each session (Twitch clock). */
  async function consumers(): Promise<Map<string, string>> {
    const first = new Map<string, string>();
    for (const s of await deps.listEnabledSubscriptions()) {
      if (!types.has(s.type) || !s.sessionId) continue;
      const known = first.get(s.sessionId);
      if (!known || s.createdAt < known) first.set(s.sessionId, s.createdAt);
    }
    return first;
  }

  /**
   * This session is not the loyalty consumer: an older session receives the same events. An event
   * is dropped here only if another session than the one that received it was already subscribed
   * (that session has it too). Anything else (e.g. leftovers of this bot's previous run, whose
   * dead session may still be listed for a few seconds) is still sent.
   */
  function yieldTo(others: Map<string, string>, reason: string): never {
    let dropped = 0;
    for (const entry of deps.outbox.pending())
      if (
        [...others].some(
          ([id, at]) => id !== entry.session && at <= entry.receivedAt,
        )
      ) {
        deps.outbox.remove(entry.event.eventId);
        dropped++;
      }
    session = null;
    sendPending();
    throw new Error(
      `${reason}: loyalty events not consumed here (a second consumer would count every event twice)${dropped ? `, ${dropped} event(s) left to it` : ''}`,
    );
  }

  const eventSub: EventSubHandlers = {
    async subscribe(sessionId) {
      session = sessionId;
      verified = false;
      // Two consumers (e.g. a second bot) would each receive every event under a different message
      // id, and Core could not tell them apart from two real actions: only one may consume.
      const before = await consumers();
      before.delete(sessionId);
      if (before.size)
        yieldTo(before, 'another EventSub session already receives them');
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
      // Two bots starting together both pass the first check. After subscribing, the session
      // whose subscriptions are the oldest wins (both see the same answer); the other one yields.
      const after = await consumers();
      const mine = after.get(sessionId);
      after.delete(sessionId);
      const older = new Map(
        [...after].filter(
          ([id, at]) => !mine || at < mine || (at === mine && id < sessionId),
        ),
      );
      if (older.size)
        yieldTo(older, 'another EventSub session subscribed first');
      verified = true;
      log(
        '[loyalty] broadcaster EventSub subscriptions created (subs, gifts, cheers, follows)',
      );
      sendPending(); // this session's events + leftovers of a previous run
    },
    async notification(type, event, messageId, timestamp) {
      const normalized = normalizeLoyaltyEvent(type, event, messageId);
      if (!normalized) {
        log(
          `[loyalty] ignored ${type} ${messageId} (unusable payload) ${JSON.stringify(event)}`,
        );
        return;
      }
      if (session === null) {
        // Late message on the socket of a session that yielded: the consumer session has it.
        log(`[loyalty] ${type} ${messageId} left to the consumer session`);
        return;
      }
      const entry: OutboxEntry = {
        event: normalized,
        receivedAt: timestamp,
        session,
      };
      deps.outbox.add(entry); // durable before anything else
      if (verified && entry.session === session) send(entry);
    },
  };

  return {
    eventSub,
    /** At startup, before any EventSub session: sends what a previous run left unanswered. */
    resumePending: sendPending,
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
