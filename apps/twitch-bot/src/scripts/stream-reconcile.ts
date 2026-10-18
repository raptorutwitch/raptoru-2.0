// One-shot live-state reconciliation, same path as the bot's periodic Helix check:
//   npm run stream:reconcile -w @raptoru/twitch-bot
// Twitch: token validation and one Get Streams read. Core: POST /v1/bot/stream/sync.
// A Helix failure changes nothing (never interpreted as offline). No chat, no EventSub.
// Operational command: initialization / refresh may replace tokens and the Core session is updated.
// Do not run this during a read-only audit.
import { TWITCH_OAUTH_PROFILES } from '@raptoru/schemas';
import { loadConfig } from '../config.js';
import { createCoreClient } from '../core-client.js';
import { fileTokenStore, TwitchAuth } from '../twitch/auth.js';
import { createHelix } from '../twitch/helix.js';

const config = loadConfig();
const auth = new TwitchAuth({
  clientId: config.TWITCH_CLIENT_ID,
  clientSecret: config.TWITCH_CLIENT_SECRET,
  store: fileTokenStore(config.TWITCH_TOKEN_FILE),
  requiredScopes: [],
  expectedUserId: TWITCH_OAUTH_PROFILES.bot.expectedUserId,
  log: () => {},
});

try {
  await auth.init();
  const helix = createHelix({
    clientId: config.TWITCH_CLIENT_ID,
    getAccessToken: () => auth.getAccessToken(),
    handleUnauthorized: (rejected) => auth.handleUnauthorized(rejected),
  });
  const live = await helix.getStream(config.TWITCH_BROADCASTER_ID);
  const state = await createCoreClient(
    config.CORE_API_URL,
    config.BOT_SECRET,
  ).streamSync({
    live: live ? { streamId: live.id, startedAt: live.started_at } : null,
  });
  console.log(
    live
      ? `still live on Twitch (${live.id}): session kept open`
      : `offline on Twitch: session closed (live=${state.live})`,
  );
} catch (error) {
  console.error(
    `reconciliation skipped, state unchanged: ${(error as Error).message}`,
  );
  process.exit(1);
}
