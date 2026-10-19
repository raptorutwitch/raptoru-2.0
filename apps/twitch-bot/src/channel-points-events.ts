import {
  hasTwitchScope,
  type CpRedemptionInput,
  type CpRedemptionUpdate,
  type CpRewardsSync,
} from '@raptoru/schemas';
import {
  memoryOutbox,
  type Outbox,
  type OutboxEntry,
} from './loyalty-outbox.js';

// Points de chaîne V1 (docs/CHANNEL_POINTS_V1.md) — Twitch custom reward redemptions → Core. READ ONLY: the
// subscription `channel.channel_points_custom_reward_redemption.add` v1 and Get Custom Reward need
// channel:read:redemptions on the BROADCASTER token (Twitch: the broadcaster authorizes this type); Raptoru never
// fulfils / cancels a redemption (only the app that created a reward may). The bot only forwards: Core decides
// (master switch OFF by default, rules, dedup by redemption id). Used on the broadcaster EventSub connection of the
// production bot (next to loyalty) and of the Lab chat adapter — never a second consumer of one token.
// Delivery to Core (19/10/2026, durable — a redemption may grant credits): written to the outbox BEFORE it is sent,
// removed only once Core answered (decided, duplicate or refused 4xx, kept bounded); retried with the SAME id (Core
// deduplicates) until then, resumed at start. Core alone decides what a late one still runs (only its credits). The
// status changes (`…redemption.update`: fulfilled / canceled from the reward queue) take the same path; a cancellation
// whose redemption is still waiting for Core waits for it. What cannot be guaranteed: an event Twitch sends while no
// WebSocket session is open is never received (Twitch does not replay a lost WebSocket session).

export const CP_READ_SCOPE = 'channel:read:redemptions';
export const canReadChannelPoints = (scopes: readonly string[]) =>
  hasTwitchScope(scopes, CP_READ_SCOPE);
export const CP_SUBSCRIPTION = {
  type: 'channel.channel_points_custom_reward_redemption.add',
  version: '1',
} as const;
/** Same scope as the redemptions: a redemption fulfilled or canceled (points given back) on Twitch. */
export const CP_UPDATE_SUBSCRIPTION = {
  type: 'channel.channel_points_custom_reward_redemption.update',
  version: '1',
} as const;
/** Backoff between two sends of a pending event (the last delay repeats: kept until Core answers). */
export const CP_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];

/** One redemption event waiting for Core, as stored in the outbox. */
export type CpOutboxEvent =
  | { eventId: string; kind: 'add'; body: CpRedemptionInput; label: string }
  | {
      eventId: string;
      kind: 'update';
      body: CpRedemptionUpdate;
      label: string;
    };

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const cut = (s: string, n: number) => [...s].slice(0, n).join('');
const ID = /^[A-Za-z0-9-]{1,128}$/;
const TWITCH_ID = /^\d{1,32}$/;

/** One EventSub redemption event → the Core contract, or null (another channel, unusable payload). */
export function normalizeRedemption(
  e: Obj,
  channelId: string,
  broadcasterId: string,
): CpRedemptionInput | null {
  if (str(e.broadcaster_user_id) !== broadcasterId) return null;
  const reward = (e.reward ?? {}) as Obj;
  const id = str(e.id);
  const rewardId = str(reward.id);
  const title = str(reward.title)?.trim();
  const userId = str(e.user_id);
  const login = str(e.user_login);
  const redeemedAt = str(e.redeemed_at);
  if (
    !id ||
    !ID.test(id) ||
    !rewardId ||
    !ID.test(rewardId) ||
    !title ||
    !userId ||
    !TWITCH_ID.test(userId) ||
    !login ||
    !redeemedAt ||
    Number.isNaN(Date.parse(redeemedAt))
  )
    return null;
  const cost = typeof reward.cost === 'number' ? reward.cost : 0;
  const status = str(e.status);
  const input = str(e.user_input);
  const prompt = str(reward.prompt);
  return {
    channel_id: channelId,
    source: 'twitch',
    redemption_id: id,
    reward: {
      id: rewardId,
      title: cut(title, 200),
      cost: Number.isInteger(cost) && cost >= 0 ? cost : 0,
      ...(prompt ? { prompt: cut(prompt, 500) } : {}),
    },
    user: {
      id: userId,
      login: cut(login, 64),
      display_name: cut(str(e.user_name) || login, 64),
    },
    ...(input ? { user_input: cut(input, 500) } : {}),
    ...(status &&
    ['unknown', 'unfulfilled', 'fulfilled', 'canceled'].includes(status)
      ? {
          twitch_status: status as NonNullable<
            CpRedemptionInput['twitch_status']
          >,
        }
      : {}),
    redeemed_at: new Date(redeemedAt).toISOString(),
  };
}

/** One EventSub status change (fulfilled / canceled) → the Core contract, or null. */
export function normalizeRedemptionUpdate(
  e: Obj,
  channelId: string,
  broadcasterId: string,
): CpRedemptionUpdate | null {
  if (str(e.broadcaster_user_id) !== broadcasterId) return null;
  const id = str(e.id);
  const rewardId = str((e.reward as Obj | undefined)?.id);
  const userId = str(e.user_id);
  const status = str(e.status);
  if (
    !id ||
    !ID.test(id) ||
    !rewardId ||
    !ID.test(rewardId) ||
    !userId ||
    !TWITCH_ID.test(userId) ||
    (status !== 'fulfilled' && status !== 'canceled')
  )
    return null;
  return {
    channel_id: channelId,
    source: 'twitch',
    redemption_id: id,
    reward_id: rewardId,
    user_id: userId,
    twitch_status: status,
  };
}

/** A Helix custom reward (Get Custom Reward), the fields Core keeps. */
export interface HelixReward {
  id: string;
  title: string;
  cost: number;
  prompt?: string;
  is_enabled: boolean;
  is_paused?: boolean;
  is_user_input_required?: boolean;
}

/** Worth retrying: no answer, 5xx, 408, 429 (a status on the error or « …_NNN » at the end of its message). */
function transient(error: unknown) {
  const e = error as { status?: number; message?: string };
  const status =
    e?.status ?? Number(/_(\d{3})$/.exec(e?.message ?? '')?.[1] ?? NaN);
  return Number.isNaN(status) || status >= 500 || [408, 429].includes(status);
}

export interface ChannelPointsEventsDeps {
  /** The Core channel id (the broadcaster's Twitch id in production; the Lab channel in the Lab). */
  channelId: string;
  broadcasterId: string;
  /** Sends a redemption / the reward list to Core (throws on failure). */
  postRedemption(body: CpRedemptionInput): Promise<unknown>;
  /** A status change (fulfilled / canceled); absent → the update subscription is not created. */
  postRedemptionUpdate?(body: CpRedemptionUpdate): Promise<unknown>;
  postRewards(body: CpRewardsSync): Promise<unknown>;
  /** Durable outbox (a JSON file in the bots); in memory by default (tests). */
  outbox?: Outbox<CpOutboxEvent>;
  subscribe(
    type: string,
    condition: Record<string, string>,
    sessionId: string,
    version: string,
  ): Promise<void>;
  getCustomRewards(): Promise<HelixReward[]>;
  log?: (...args: unknown[]) => void;
  now?: () => number;
}

export function createChannelPointsEvents(d: ChannelPointsEventsDeps) {
  const log = d.log ?? console.log;
  const now = d.now ?? Date.now;
  const outbox = d.outbox ?? memoryOutbox<CpOutboxEvent>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  const sending = new Set<string>();
  let subscribed = false;

  /** One send of a stored event; a transient failure schedules the next one (never blocks EventSub). */
  const attempt = async (
    entry: OutboxEntry<CpOutboxEvent>,
    n: number,
  ): Promise<void> => {
    const ev = entry.event;
    let retry: string;
    try {
      const out = (
        ev.kind === 'add'
          ? await d.postRedemption(ev.body)
          : await d.postRedemptionUpdate!(ev.body)
      ) as { outcome?: string };
      // A status change whose redemption is still waiting for Core: sent again after it.
      if (
        out.outcome === 'unknown_redemption' &&
        outbox
          .pending()
          .some((p) => p.event.eventId === `add:${ev.body.redemption_id}`)
      )
        retry = 'redemption pas encore reçue par Core';
      else {
        outbox.remove(ev.eventId);
        sending.delete(ev.eventId);
        log(`[channel-points] ${ev.label} → ${out.outcome ?? '?'}`);
        return;
      }
    } catch (error) {
      const reason = (error as Error).message;
      if (!transient(error)) {
        outbox.reject(entry, reason, new Date(now()));
        sending.delete(ev.eventId);
        log(
          `[channel-points] ${ev.label} refusée par Core (${reason}), gardée dans le journal des refus`,
        );
        return;
      }
      retry = `Core indisponible (${reason})`;
    }
    const delay =
      CP_RETRY_DELAYS_MS[Math.min(n, CP_RETRY_DELAYS_MS.length - 1)]!;
    log(
      `[channel-points] ${ev.label} : ${retry}, gardée, nouvel essai dans ${delay / 1000} s`,
    );
    const timer = setTimeout(() => {
      retries.delete(ev.eventId);
      void attempt(entry, n + 1);
    }, delay);
    retries.set(ev.eventId, timer);
  };
  const send = async (entry: OutboxEntry<CpOutboxEvent>) => {
    if (sending.has(entry.event.eventId)) return;
    sending.add(entry.event.eventId);
    await attempt(entry, 0);
  };
  /** Durable BEFORE it is sent (an unwritable outbox throws: the event is not taken in silently). */
  const take = async (event: CpOutboxEvent) => {
    const entry: OutboxEntry<CpOutboxEvent> = {
      event,
      receivedAt: new Date(now()).toISOString(),
      session: 'eventsub',
    };
    outbox.add(entry);
    await send(entry);
  };

  return {
    /** Subscribes this broadcaster session; a refusal is logged, never thrown (the other events go on). */
    async subscribe(sessionId: string) {
      subscribed = false;
      try {
        await d.subscribe(
          CP_SUBSCRIPTION.type,
          { broadcaster_user_id: d.broadcasterId },
          sessionId,
          CP_SUBSCRIPTION.version,
        );
        subscribed = true;
        log('[channel-points] abonnement aux récompenses créé');
      } catch (error) {
        log(
          '[channel-points] abonnement aux récompenses refusé',
          (error as Error).message,
        );
      }
      if (!d.postRedemptionUpdate) return;
      try {
        await d.subscribe(
          CP_UPDATE_SUBSCRIPTION.type,
          { broadcaster_user_id: d.broadcasterId },
          sessionId,
          CP_UPDATE_SUBSCRIPTION.version,
        );
        log('[channel-points] abonnement aux annulations créé');
      } catch (error) {
        log(
          '[channel-points] abonnement aux annulations refusé (crédits non repris si une redemption est annulée)',
          (error as Error).message,
        );
      }
    },
    subscriptionStatus: () => (subscribed ? 'subscribed' : 'inactive'),
    /** Handles a redemption / status notification; false for any other type. Throws only if the outbox is unwritable. */
    async handle(type: string, event: Obj) {
      if (type === CP_UPDATE_SUBSCRIPTION.type && d.postRedemptionUpdate) {
        const body = normalizeRedemptionUpdate(
          event,
          d.channelId,
          d.broadcasterId,
        );
        if (!body) return true; // another status, another channel: nothing to do
        await take({
          eventId: `update:${body.redemption_id}:${body.twitch_status}`,
          kind: 'update',
          body,
          label: `redemption ${body.redemption_id} ${body.twitch_status === 'canceled' ? 'annulée' : 'traitée'} sur Twitch`,
        });
        return true;
      }
      if (type !== CP_SUBSCRIPTION.type) return false;
      let body: CpRedemptionInput | null;
      try {
        body = normalizeRedemption(event, d.channelId, d.broadcasterId);
      } catch (error) {
        log('[channel-points] redemption ignorée', (error as Error).message);
        return true;
      }
      if (!body) {
        log('[channel-points] redemption ignorée (données inutilisables)');
        return true;
      }
      await take({
        eventId: `add:${body.redemption_id}`,
        kind: 'add',
        body,
        label: `« ${body.reward.title} » par ${body.user.display_name} (${body.redemption_id})`,
      });
      return true;
    },
    /** At start: sends what a previous run left unanswered, in order (same ids: Core deduplicates). */
    async resumePending() {
      const left = outbox.pending();
      if (left.length)
        log(
          `[channel-points] reprise de ${left.length} redemption(s) en attente`,
        );
      for (const entry of left) await send(entry);
    },
    pending: () => outbox.pending().length,
    /** The reward list (read only) → Core, at start and after each (re)connection. Failures are logged. */
    async syncRewards() {
      try {
        const rewards = await d.getCustomRewards();
        await d.postRewards({
          channel_id: d.channelId,
          rewards: rewards.slice(0, 50).map((r) => ({
            id: r.id,
            title: cut(r.title, 200),
            cost: r.cost,
            ...(r.prompt ? { prompt: cut(r.prompt, 500) } : {}),
            is_enabled: r.is_enabled,
            ...(r.is_paused !== undefined ? { is_paused: r.is_paused } : {}),
            ...(r.is_user_input_required !== undefined
              ? { user_input_required: r.is_user_input_required }
              : {}),
          })),
        });
        log(
          `[channel-points] ${rewards.length} récompense(s) lue(s) sur Twitch`,
        );
      } catch (error) {
        log(
          '[channel-points] liste des récompenses non lue',
          (error as Error).message,
        );
      }
    },
    pendingRetries: () => retries.size,
    close() {
      subscribed = false;
      const kept = outbox.pending().length;
      if (kept)
        log(
          `[channel-points] ${kept} redemption(s) en attente gardée(s) pour la reprise`,
        );
      for (const t of retries.values()) clearTimeout(t);
      retries.clear();
      sending.clear();
    },
  };
}

export type ChannelPointsEvents = ReturnType<typeof createChannelPointsEvents>;
