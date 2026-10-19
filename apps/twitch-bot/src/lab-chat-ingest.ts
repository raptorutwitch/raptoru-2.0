import type { LabAlertsIngest } from './lab-alerts-ingest.js';
import type { EventSubHandlers } from './twitch/eventsub.js';
import type { HelixStream } from './stream-watch.js';

// Lab chat ingestion — the ONE Twitch → Lab Core adapter of the Lab (not a Tombola feature), started
// by Studio only when its « Ingestion chat Twitch » switch is ON (OFF by default). It forwards, never
// decides: every chat message goes to POST /v1/lab/chat, where Core routes it to the Lab modules
// (commands to Tombola / Commands V2, the whole chat to the Jeu des mots), and the stream
// state (offline → live / live → offline) goes to POST /v1/lab/stream. A new module never adds a
// second EventSub connection, token or process. Nothing is written to the chat.

/** POST to the local Lab Core (secret-protected). */
export type LabCorePost = (path: string, body: unknown) => Promise<unknown>;

export interface LabChatIngestDeps {
  lab: LabCorePost;
  /** Lab channel (the Lab Core's channel id). */
  labChannelId: string;
  /** Twitch channel whose chat and stream state are read. */
  broadcasterId: string;
  /** Owner of the token (its own messages are ignored). */
  tokenUserId: string;
  subscribe(
    type: string,
    condition: Record<string, string>,
    sessionId: string,
    version?: string,
  ): Promise<void>;
  /** Twitch alerts on the same connection (lab-alerts-ingest.ts); absent / OFF: nothing more is subscribed. */
  alerts?: Pick<LabAlertsIngest, 'subscriptions' | 'handle' | 'close'>;
  getStream(): Promise<HelixStream | null>;
  log?: (...args: unknown[]) => void;
  /** Injectable clock (tests). */
  now?: () => number;
}

/**
 * Chat command whose forward to Core failed (ASTRA-P1-002, decided policy): retried in memory with the
 * SAME Twitch message_id after 1 / 2 / 4 / 8 s, never started more than 15 s after reception, then
 * dropped with a log line. Never persisted: an old game command is not worth replaying. Core stays
 * the authority: it deduplicates by message_id (one effect, whatever the retries) and decides at
 * reception (a join after the Tombola closed is refused normally).
 */
export const CHAT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
export const CHAT_RETRY_TTL_MS = 15_000;

/** Worth retrying: Core unreachable / timed out / 5xx / 408 / 429. A 4xx answer will not change. */
export function transient(error: unknown): boolean {
  const m = /^lab_core_(\d{3})$/.exec((error as Error)?.message ?? '');
  if (!m) return true;
  const status = Number(m[1]);
  return status >= 500 || status === 408 || status === 429;
}

/** Twitch badge set ids (subscriber, vip…), as Core accepts them (Commands V2 audience). */
export function badgeSets(badges: unknown): string[] {
  return (
    Array.isArray(badges)
      ? badges.map((b) => String((b as { set_id?: unknown }).set_id ?? ''))
      : []
  )
    .filter((s) => /^[a-z0-9_-]{1,32}$/.test(s))
    .slice(0, 20);
}

/** Twitch badges → the role Core will check (Core decides the effective role). */
export function chatRole(
  badges: unknown,
): 'broadcaster' | 'moderator' | 'viewer' {
  const sets = badgeSets(badges);
  if (sets.includes('broadcaster')) return 'broadcaster';
  if (sets.includes('moderator')) return 'moderator';
  return 'viewer';
}

export function createLabChatIngest(d: LabChatIngestDeps) {
  const log = d.log ?? console.log;
  const now = d.now ?? Date.now;
  /** Chat retries waiting for their next attempt (in memory only). */
  const retries = new Set<ReturnType<typeof setTimeout>>();

  /** One chat command to Core; on a transient failure, background retries (never blocks EventSub). */
  const forwardChat = async (body: {
    message_id: string;
    [k: string]: unknown;
  }) => {
    const receivedAt = now();
    let attempt = 0;
    const send = async (): Promise<void> => {
      try {
        await d.lab('/v1/lab/chat', body);
        if (attempt > 0)
          log(
            `[lab-chat] chat ${body.message_id} delivered after ${attempt} retr${attempt > 1 ? 'ies' : 'y'}`,
          );
      } catch (error) {
        const reason = (error as Error).message;
        if (!transient(error)) {
          log(`[lab-chat] chat ${body.message_id} refused by Core`, reason);
          return;
        }
        const delay = CHAT_RETRY_DELAYS_MS[attempt];
        if (
          delay === undefined ||
          now() + delay - receivedAt > CHAT_RETRY_TTL_MS
        ) {
          log(
            `[lab-chat] chat ${body.message_id} dropped: Core unreachable for ${CHAT_RETRY_TTL_MS / 1000} s`,
            reason,
          );
          return;
        }
        attempt += 1;
        log(
          `[lab-chat] chat ${body.message_id} forwarding failed, retry ${attempt} in ${delay / 1000} s`,
          reason,
        );
        const timer = setTimeout(() => {
          retries.delete(timer);
          void send();
        }, delay);
        retries.add(timer);
      }
    };
    await send();
  };
  /** Last stream state Core actually received (a failed forward leaves it unchanged). */
  let delivered: 'online' | 'offline' | null = null;
  const stream = async (event: 'online' | 'offline', id?: string) => {
    await d.lab('/v1/lab/stream', {
      channel_id: d.labChannelId,
      event,
      ...(id && /^\d{1,32}$/.test(id) ? { twitch_stream_id: id } : {}),
    });
    delivered = event;
  };

  const handlers: EventSubHandlers = {
    async subscribe(sessionId) {
      const condition = { broadcaster_user_id: d.broadcasterId };
      await d.subscribe('stream.online', condition, sessionId);
      await d.subscribe('stream.offline', condition, sessionId);
      await d.subscribe(
        'channel.chat.message',
        { ...condition, user_id: d.tokenUserId },
        sessionId,
      );
      log('[lab-chat] EventSub subscriptions created (chat, stream state)');
      // An alert source refused (missing scope, not moderator) never takes the chat ingestion down with it.
      for (const s of d.alerts?.subscriptions() ?? [])
        try {
          await d.subscribe(s.type, s.condition, sessionId, s.version);
          log(`[lab-alerts] abonnement ${s.type} créé`);
        } catch (error) {
          log(
            `[lab-alerts] abonnement ${s.type} refusé`,
            (error as Error).message,
          );
        }
    },
    async notification(type, event, messageId, timestamp) {
      try {
        if (type === 'stream.online')
          await stream('online', String(event.id ?? ''));
        else if (type === 'stream.offline') await stream('offline');
        else if (
          type === 'channel.chat.notification' ||
          type === 'channel.follow'
        )
          await d.alerts?.handle(type, event, messageId, timestamp);
        else if (type === 'channel.chat.message') {
          if (event.cheer)
            await d.alerts?.handle(type, event, messageId, timestamp);
          if (String(event.chatter_user_id) === d.tokenUserId) return;
          const text = String(
            (event.message as { text?: unknown } | undefined)?.text ?? '',
          );
          // Every message goes to Core (the Jeu des mots reads the whole chat); Core decides which module sees it.
          await forwardChat({
            channel_id: d.labChannelId,
            message_id: String(event.message_id ?? messageId),
            text: text.slice(0, 500),
            chatter: {
              id: String(event.chatter_user_id),
              login: String(event.chatter_user_login),
              display_name: String(
                event.chatter_user_name || event.chatter_user_login,
              ),
              role: chatRole(event.badges),
              badges: badgeSets(event.badges),
            },
            source: 'twitch',
          });
        }
      } catch (error) {
        log(`[lab-chat] ${type} forwarding failed`, (error as Error).message);
      }
    },
    log,
  };

  return {
    handlers,
    /** On start (and after a reconnection): the current Twitch state is the truth for the session. */
    async syncStream() {
      const live = await d.getStream();
      await stream(live ? 'online' : 'offline', live?.id);
      return Boolean(live);
    },
    /**
     * Periodic repair (ASTRA-P1-003): a transition Core did not receive (forward failed during a Core
     * outage) is sent again once Twitch still says so. Only a difference with what Core last received
     * is forwarded: a session the streamer simulates in Studio is never closed by a steady state.
     * Helix unreachable: throws, nothing is confirmed.
     */
    /** Chat retries still waiting (in memory). */
    pendingChatRetries: () => retries.size,
    /** Adapter stopping: pending chat retries are dropped (never persisted), with a log line. */
    close() {
      if (retries.size)
        log(
          `[lab-chat] ${retries.size} chat retr(ies) dropped: adapter stopping`,
        );
      for (const t of retries) clearTimeout(t);
      retries.clear();
      d.alerts?.close();
    },
    async reconcileStream() {
      const live = await d.getStream();
      const want = live ? 'online' : 'offline';
      if (want === delivered) return false;
      await stream(want, live?.id);
      return true;
    },
  };
}
