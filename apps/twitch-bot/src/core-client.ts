import {
  DailyClaimResponse,
  DailyStreakResponse,
  PresenceLeaseResponse,
  PresenceObservationResponse,
  WalletChatResponse,
  LoyaltyEventResponse,
  StreamStateResponse,
  type DailyClaimRequest,
  type DailyStreakRequest,
  type PresenceLeaseRequest,
  type PresenceObservationRequest,
  type WalletBalanceRequest,
  type LoyaltyEvent,
  type SubscriptionSnapshot,
  type WalletChatAdminRequest,
  type WalletTransferRequest,
  type StreamOfflineRequest,
  type StreamOnlineRequest,
  type StreamSyncRequest,
  type CpRedemptionInput,
  type CpRedemptionUpdate,
  type CpRewardsSync,
} from '@raptoru/schemas';
import { z } from 'zod';

export interface CoreClient {
  streamOnline(body: StreamOnlineRequest): Promise<StreamStateResponse>;
  streamOffline(body: StreamOfflineRequest): Promise<StreamStateResponse>;
  streamSync(body: StreamSyncRequest): Promise<StreamStateResponse>;
  dailyClaim(body: DailyClaimRequest): Promise<DailyClaimResponse>;
  dailyStreak(body: DailyStreakRequest): Promise<DailyStreakResponse>;
  presenceLease(body: PresenceLeaseRequest): Promise<PresenceLeaseResponse>;
  presenceObservation(
    body: PresenceObservationRequest,
  ): Promise<PresenceObservationResponse>;
  walletBalance(body: WalletBalanceRequest): Promise<WalletChatResponse>;
  walletTransfer(body: WalletTransferRequest): Promise<WalletChatResponse>;
  walletAdmin(body: WalletChatAdminRequest): Promise<WalletChatResponse>;
  loyaltyEvent(body: LoyaltyEvent): Promise<LoyaltyEventResponse>;
  subscriptionSnapshot(
    body: SubscriptionSnapshot,
  ): Promise<{ subscribers: number }>;
  /** Points de chaîne V1: a redemption (read from Twitch) and the reward list; Core decides everything. */
  channelPointsRedemption(
    body: CpRedemptionInput,
  ): Promise<{ outcome: string }>;
  channelPointsRedemptionUpdate(
    body: CpRedemptionUpdate,
  ): Promise<{ outcome: string }>;
  channelPointsRewards(body: CpRewardsSync): Promise<{ synced: number }>;
}

export class CoreHttpError extends Error {
  constructor(
    readonly status: number,
    /** The Core's error code when it gave one (e.g. `not_lease_holder`). */
    readonly code?: string,
  ) {
    super(`core-api responded ${status}`);
  }
}

/**
 * `409 not_lease_holder`: this instance does not hold the bot lease at this moment (a deploy handing over, a lease being
 * renewed, this instance about to stop). Never a definitive refusal: what it carried is kept and sent again — by this
 * instance once it holds the lease, or by the next holder from the same outbox. Core deduplicates by event id.
 */
export const notLeaseHolder = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'not_lease_holder';

/**
 * Every call is idempotent on the Core side (claims keyed by Twitch message id, presence cycles by cycleId), so a
 * failed call is retried once: a lost response is replayed, never paid twice.
 */
export function createCoreClient(
  baseUrl: string,
  secret: string,
  fetchImpl: typeof fetch = fetch,
  /** Sent on every call (the bot instance header of the single-instance lease). */
  extraHeaders: Record<string, string> = {},
): CoreClient {
  async function call<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const once = async () => {
      const res = await fetchImpl(new URL(path, baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const out = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new CoreHttpError(
          res.status,
          typeof out?.error === 'string' ? out.error : undefined,
        );
      }
      return schema.parse(await res.json());
    };
    try {
      return await once();
    } catch (error) {
      if (error instanceof CoreHttpError && error.status < 500) throw error;
      return once();
    }
  }

  return {
    streamOnline: (body) =>
      call('/v1/bot/stream/online', body, StreamStateResponse),
    streamOffline: (body) =>
      call('/v1/bot/stream/offline', body, StreamStateResponse),
    streamSync: (body) =>
      call('/v1/bot/stream/sync', body, StreamStateResponse),
    dailyClaim: (body) => call('/v1/bot/daily/claim', body, DailyClaimResponse),
    dailyStreak: (body) =>
      call('/v1/bot/daily/streak', body, DailyStreakResponse),
    presenceLease: (body) =>
      call('/v1/bot/presence/lease', body, PresenceLeaseResponse),
    presenceObservation: (body) =>
      call('/v1/bot/presence/observations', body, PresenceObservationResponse),
    walletBalance: (body) =>
      call('/v1/bot/wallet/balance', body, WalletChatResponse),
    walletTransfer: (body) =>
      call('/v1/bot/wallet/transfer', body, WalletChatResponse),
    walletAdmin: (body) =>
      call('/v1/bot/wallet/admin', body, WalletChatResponse),
    loyaltyEvent: (body) =>
      call('/v1/bot/loyalty/events', body, LoyaltyEventResponse),
    subscriptionSnapshot: (body) =>
      call(
        '/v1/bot/loyalty/subscriptions/snapshot',
        body,
        z.object({ subscribers: z.number() }),
      ),
    channelPointsRedemption: (body) =>
      call(
        '/v1/bot/channel-points/redemptions',
        body,
        z.object({ outcome: z.string() }).loose(),
      ),
    channelPointsRedemptionUpdate: (body) =>
      call(
        '/v1/bot/channel-points/redemptions/status',
        body,
        z.object({ outcome: z.string() }).loose(),
      ),
    channelPointsRewards: (body) =>
      call(
        '/v1/bot/channel-points/rewards',
        body,
        z.object({ synced: z.number() }),
      ),
  };
}
