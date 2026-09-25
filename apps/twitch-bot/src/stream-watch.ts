import type { CoreClient } from './core-client.js';

export interface HelixStream {
  id: string;
  started_at: string;
}

/**
 * Helix lags behind EventSub by up to a few minutes after going live/offline. For this long after
 * an EventSub stream event, a contradicting Helix snapshot is ignored.
 */
export const EVENTSUB_TRUST_MS = 5 * 60 * 1000;

/** Notified once Core has recorded the live state (e.g. to start/stop the presence worker). */
export interface StreamListener {
  live(streamId: string): void;
  offline(): void;
}

/**
 * Keeps Core's stream session in line with Twitch: EventSub online/offline in real time, plus a
 * Helix snapshot at startup and periodically to repair missed events. A Helix failure is never
 * interpreted as "offline".
 */
export function createStreamWatcher(deps: {
  core: CoreClient;
  getStream: () => Promise<HelixStream | null>;
  listener?: StreamListener;
  now?: () => number;
  log?: (...args: unknown[]) => void;
}) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console.warn;
  let lastEventAt = -Infinity;
  let lastLiveConfirmedAt: number | null = null;

  const confirmLive = (streamId: string) => {
    lastLiveConfirmedAt = now();
    deps.listener?.live(streamId);
  };
  const confirmOffline = () => {
    lastLiveConfirmedAt = null;
    deps.listener?.offline();
  };

  return {
    /** Seconds since Twitch last confirmed the live (EventSub or Helix), null when offline. */
    liveStateAgeSeconds(): number | null {
      return lastLiveConfirmedAt === null
        ? null
        : Math.round((now() - lastLiveConfirmedAt) / 1000);
    },

    async online(stream: HelixStream) {
      lastEventAt = now();
      await deps.core.streamOnline({
        streamId: stream.id,
        startedAt: stream.started_at,
      });
      confirmLive(stream.id);
    },

    async offline() {
      lastEventAt = now();
      confirmOffline();
      await deps.core.streamOffline({ endedAt: new Date(now()).toISOString() });
    },

    async sync() {
      if (now() - lastEventAt < EVENTSUB_TRUST_MS) return;
      let live: HelixStream | null;
      try {
        live = await deps.getStream();
      } catch (error) {
        log(
          '[twitch-bot] Helix stream check failed, keeping current state',
          error,
        );
        return;
      }
      if (!live) confirmOffline();
      await deps.core.streamSync({
        live: live ? { streamId: live.id, startedAt: live.started_at } : null,
      });
      if (live) confirmLive(live.id);
    },
  };
}
