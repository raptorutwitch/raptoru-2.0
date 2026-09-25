import { handleChatMessage } from './chat-commands.js';
import { loadConfig } from './config.js';
import { createCoreClient } from './core-client.js';
import { createStreamWatcher, type HelixStream } from './stream-watch.js';
import { runEventSub } from './twitch/eventsub.js';
import { createHelix, validateToken } from './twitch/helix.js';

// Safety switch: while SAMMI still runs the production Daily, the bot must never answer !daily on
// the real channel. It only connects to Twitch when explicitly enabled.
if (process.env.TWITCH_ENABLED !== 'true') {
  console.log(
    '[twitch-bot] Twitch disabled (TWITCH_ENABLED is not "true"): not connecting.',
  );
  process.exit(0);
}

const config = loadConfig();
const token = await validateToken(config.TWITCH_USER_ACCESS_TOKEN);
console.log(
  `[twitch-bot] token ok for ${token.login}, expires in ${token.expires_in}s`,
);

const helix = createHelix({
  clientId: config.TWITCH_CLIENT_ID,
  accessToken: config.TWITCH_USER_ACCESS_TOKEN,
});
const core = createCoreClient(config.CORE_API_URL, config.BOT_SECRET);
const broadcaster = config.TWITCH_BROADCASTER_ID;
const streams = createStreamWatcher({
  core,
  getStream: () => helix.getStream(broadcaster),
});
const say = (text: string) =>
  helix.sendChatMessage(broadcaster, config.TWITCH_BOT_USER_ID, text);

runEventSub({
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
    await helix.subscribe(
      'channel.chat.message',
      { broadcaster_user_id: broadcaster, user_id: config.TWITCH_BOT_USER_ID },
      sessionId,
    );
    console.log('[twitch-bot] EventSub subscriptions created');
  },
  async notification(type, event) {
    try {
      if (type === 'stream.online')
        await streams.online(event as unknown as HelixStream);
      else if (type === 'stream.offline') await streams.offline();
      else if (type === 'channel.chat.message') {
        if (event.chatter_user_id === config.TWITCH_BOT_USER_ID) return;
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
      console.error(`[twitch-bot] ${type} handling failed`, error);
    }
  },
});

await streams
  .sync()
  .catch((error) =>
    console.error('[twitch-bot] initial stream sync failed', error),
  );
setInterval(() => {
  streams
    .sync()
    .catch((error) => console.error('[twitch-bot] stream sync failed', error));
}, config.STREAM_SYNC_INTERVAL_MS);
