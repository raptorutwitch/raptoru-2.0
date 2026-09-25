import { handleChatMessage } from './chat-commands.js';
import type { BotConfig } from './config.js';
import type { CoreClient } from './core-client.js';
import { PresenceWorker } from './presence/presence-worker.js';
import { createStreamWatcher, type HelixStream } from './stream-watch.js';
import type { EventSubHandlers } from './twitch/eventsub.js';
import type { Helix } from './twitch/helix.js';

export interface BotRuntimeDeps {
  config: BotConfig;
  /** Owner of the user token: chat sender and Get Chatters moderator. */
  tokenUserId: string;
  helix: Pick<
    Helix,
    'getStream' | 'getChattersPage' | 'sendChatMessage' | 'subscribe'
  >;
  core: CoreClient;
  workerId: string;
  log?: (...args: unknown[]) => void;
}

/**
 * Wires Twitch events to Core. Features are opt-in: without DAILY_CHAT_COMMANDS the bot neither
 * subscribes to chat nor can send a chat message; without PRESENCE_SHADOW no presence worker exists.
 */
export function createBotRuntime({
  config,
  tokenUserId,
  helix,
  core,
  workerId,
  log = console.log,
}: BotRuntimeDeps) {
  const broadcaster = config.TWITCH_BROADCASTER_ID;
  const dailyChat = config.DAILY_CHAT_COMMANDS === 'true';

  let liveStateAgeSeconds: () => number | null = () => null;
  const presence =
    config.PRESENCE_SHADOW === 'true'
      ? new PresenceWorker({
          core,
          workerId,
          getPage: (after, signal) =>
            helix.getChattersPage(broadcaster, tokenUserId, after, signal),
          liveStateAgeSeconds: () => liveStateAgeSeconds(),
          log,
        })
      : null;

  const streams = createStreamWatcher({
    core,
    getStream: () => helix.getStream(broadcaster),
    listener: presence
      ? { live: (id) => presence.start(id), offline: () => presence.stop() }
      : undefined,
  });
  liveStateAgeSeconds = streams.liveStateAgeSeconds;

  const say = dailyChat
    ? (text: string) => helix.sendChatMessage(broadcaster, tokenUserId, text)
    : null;

  const eventSub: EventSubHandlers = {
    async subscribe(sessionId) {
      await helix.subscribe(
        'stream.online',
        { broadcaster_user_id: broadcaster },
        sessionId,
      );
      await helix.subscribe(
        'stream.offline',
        { broadcaster_user_id: broadcaster },
        sessionId,
      );
      if (dailyChat) {
        await helix.subscribe(
          'channel.chat.message',
          { broadcaster_user_id: broadcaster, user_id: tokenUserId },
          sessionId,
        );
      }
      log(
        `[twitch-bot] EventSub subscriptions created (chat commands: ${dailyChat ? 'on' : 'off'})`,
      );
    },
    async notification(type, event) {
      try {
        if (type === 'stream.online')
          await streams.online(event as unknown as HelixStream);
        else if (type === 'stream.offline') await streams.offline();
        else if (type === 'channel.chat.message' && say) {
          if (event.chatter_user_id === tokenUserId) return;
          await handleChatMessage(
            {
              messageId: String(event.message_id),
              text: String(
                (event.message as { text?: string } | undefined)?.text ?? '',
              ),
              chatter: {
                twitchUserId: String(event.chatter_user_id),
                login: String(event.chatter_user_login),
                displayName: String(event.chatter_user_name),
              },
            },
            { core, say },
          );
        }
      } catch (error) {
        log(`[twitch-bot] ${type} handling failed`, error);
      }
    },
  };

  return { eventSub, streams, presence };
}
