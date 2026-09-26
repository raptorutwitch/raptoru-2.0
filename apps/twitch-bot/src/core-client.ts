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
}

class CoreHttpError extends Error {
  constructor(readonly status: number) {
    super(`core-api responded ${status}`);
  }
}

/**
 * Every call is idempotent on the Core side (claims keyed by Twitch message id, presence cycles by cycleId), so a
 * failed call is retried once: a lost response is replayed, never paid twice.
 */
export function createCoreClient(
  baseUrl: string,
  secret: string,
  fetchImpl: typeof fetch = fetch,
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
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new CoreHttpError(res.status);
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
  };
}
