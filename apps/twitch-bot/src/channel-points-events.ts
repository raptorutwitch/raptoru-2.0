import type { CpRedemptionInput, CpRewardsSync } from '@raptoru/schemas';

// Points de chaîne V1 (docs/CHANNEL_POINTS_V1.md) — Twitch custom reward redemptions → Core. READ ONLY: the
// subscription `channel.channel_points_custom_reward_redemption.add` v1 and Get Custom Reward need
// channel:read:redemptions on the BROADCASTER token (Twitch: the broadcaster authorizes this type); Raptoru never
// fulfils / cancels a redemption (only the app that created a reward may). The bot only forwards: Core decides
// (master switch OFF by default, rules, dedup by redemption id). Used on the broadcaster EventSub connection of the
// production bot (next to loyalty) and of the Lab chat adapter — never a second consumer of one token.
// Delivery to Core: retried in memory with the SAME id (Core deduplicates), dropped after 90 s or when stopping.
// Twitch does not replay the events of a lost WebSocket session either: no « zero loss » guarantee.

export const CP_READ_SCOPE = 'channel:read:redemptions';
export const CP_SUBSCRIPTION = {
  type: 'channel.channel_points_custom_reward_redemption.add',
  version: '1',
} as const;
export const CP_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];
export const CP_RETRY_TTL_MS = 90_000;

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
  postRewards(body: CpRewardsSync): Promise<unknown>;
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
  const retries = new Set<ReturnType<typeof setTimeout>>();

  const forward = async (body: CpRedemptionInput) => {
    const receivedAt = now();
    const label = `« ${body.reward.title} » par ${body.user.display_name} (${body.redemption_id})`;
    let attempt = 0;
    const send = async (): Promise<void> => {
      try {
        const out = (await d.postRedemption(body)) as { outcome?: string };
        log(`[channel-points] ${label} → ${out.outcome ?? '?'}`);
      } catch (error) {
        const delay = CP_RETRY_DELAYS_MS[attempt];
        if (
          !transient(error) ||
          delay === undefined ||
          now() + delay - receivedAt > CP_RETRY_TTL_MS
        ) {
          log(
            `[channel-points] ${label} perdu (Core : ${(error as Error).message})`,
          );
          return;
        }
        attempt += 1;
        const timer = setTimeout(() => {
          retries.delete(timer);
          void send();
        }, delay);
        retries.add(timer);
      }
    };
    await send();
  };

  return {
    /** Subscribes this broadcaster session; a refusal is logged, never thrown (the other events go on). */
    async subscribe(sessionId: string) {
      try {
        await d.subscribe(
          CP_SUBSCRIPTION.type,
          { broadcaster_user_id: d.broadcasterId },
          sessionId,
          CP_SUBSCRIPTION.version,
        );
        log('[channel-points] abonnement aux récompenses créé');
      } catch (error) {
        log(
          '[channel-points] abonnement aux récompenses refusé',
          (error as Error).message,
        );
      }
    },
    /** Handles a notification of the redemption type; returns false for any other type. Never throws. */
    async handle(type: string, event: Obj) {
      if (type !== CP_SUBSCRIPTION.type) return false;
      try {
        const body = normalizeRedemption(event, d.channelId, d.broadcasterId);
        if (body) await forward(body);
        else log('[channel-points] redemption ignorée (données inutilisables)');
      } catch (error) {
        log('[channel-points] redemption ignorée', (error as Error).message);
      }
      return true;
    },
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
      for (const t of retries) clearTimeout(t);
      retries.clear();
    },
  };
}

export type ChannelPointsEvents = ReturnType<typeof createChannelPointsEvents>;
