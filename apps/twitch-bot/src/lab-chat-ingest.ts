import type { EventSubHandlers } from './twitch/eventsub.js';
import type { HelixStream } from './stream-watch.js';

// Lab chat ingestion — the ONE Twitch → Lab Core adapter of the Lab (not a Tombola feature), started
// by Studio only when its « Ingestion chat Twitch » switch is ON (OFF by default). It forwards, never
// decides: every chat command goes to POST /v1/lab/chat, where Core routes it to the Lab modules
// (Tombola today; TTS !canceltts, global commands, moderation test commands later), and the stream
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
  ): Promise<void>;
  getStream(): Promise<HelixStream | null>;
  log?: (...args: unknown[]) => void;
}

/** Twitch badges → the role Core will check (Core decides the effective role). */
export function chatRole(
  badges: unknown,
): 'broadcaster' | 'moderator' | 'viewer' {
  const sets = Array.isArray(badges)
    ? badges.map((b) => String((b as { set_id?: unknown }).set_id ?? ''))
    : [];
  if (sets.includes('broadcaster')) return 'broadcaster';
  if (sets.includes('moderator')) return 'moderator';
  return 'viewer';
}

export function createLabChatIngest(d: LabChatIngestDeps) {
  const log = d.log ?? console.log;
  const stream = (event: 'online' | 'offline', id?: string) =>
    d.lab('/v1/lab/stream', {
      channel_id: d.labChannelId,
      event,
      ...(id && /^\d{1,32}$/.test(id) ? { twitch_stream_id: id } : {}),
    });

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
    },
    async notification(type, event, messageId) {
      try {
        if (type === 'stream.online')
          await stream('online', String(event.id ?? ''));
        else if (type === 'stream.offline') await stream('offline');
        else if (type === 'channel.chat.message') {
          if (String(event.chatter_user_id) === d.tokenUserId) return;
          const text = String(
            (event.message as { text?: unknown } | undefined)?.text ?? '',
          );
          // Only commands are worth a round trip; Core routes them to the Lab modules (Tombola, later TTS, global commands…).
          if (!text.trimStart().startsWith('!')) return;
          await d.lab('/v1/lab/chat', {
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
  };
}
