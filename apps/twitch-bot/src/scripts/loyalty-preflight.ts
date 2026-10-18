// Operational check of the broadcaster token (NOT a token-preserving audit):
//   npm run loyalty:preflight -w @raptoru/twitch-bot
// Twitch calls: token validation (refresh if expiring) and ONE Get Broadcaster Subscriptions page.
// Never subscribes to EventSub, never writes to chat, never calls Core.
// Initialization / refresh may replace the stored tokens. Do not run this during a read-only audit.
import { TWITCH_OAUTH_PROFILES } from '@raptoru/schemas';
import { BROADCASTER_SCOPES, loadTwitchAppConfig } from '../config.js';
import { fileTokenStore, TwitchAuth } from '../twitch/auth.js';
import { createHelix } from '../twitch/helix.js';

const config = loadTwitchAppConfig();
const auth = new TwitchAuth({
  clientId: config.TWITCH_CLIENT_ID,
  clientSecret: config.TWITCH_CLIENT_SECRET,
  store: fileTokenStore(config.TWITCH_BROADCASTER_TOKEN_FILE),
  requiredScopes: BROADCASTER_SCOPES,
  expectedUserId: TWITCH_OAUTH_PROFILES.broadcaster.expectedUserId,
  log: () => {},
});

const fail = (message: string): never => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

try {
  await auth.init();
} catch (error) {
  fail(
    `${(error as Error).message} (run: npm run twitch:auth -w @raptoru/twitch-bot -- --broadcaster, logged in as the broadcaster)`,
  );
}
const s = auth.status();
console.log(`broadcaster token owner: ${s.login} (${s.userId})`);
console.log(`scopes: ${s.scopes.join(' ')}`);
console.log(`refresh token: ${s.hasRefreshToken ? 'available' : 'MISSING'}`);
if (s.userId !== config.TWITCH_BROADCASTER_ID)
  fail('token does not belong to TWITCH_BROADCASTER_ID');

const helix = createHelix({
  clientId: config.TWITCH_CLIENT_ID,
  getAccessToken: () => auth.getAccessToken(),
  handleUnauthorized: (rejected) => auth.handleUnauthorized(rejected),
});
try {
  const page = await helix.getSubscriptionsPage(
    config.TWITCH_BROADCASTER_ID,
    null,
  );
  console.log(
    `OK: Get Broadcaster Subscriptions works (total reported: ${page.total ?? 'unknown'})`,
  );
} catch (error) {
  fail(`Get Broadcaster Subscriptions failed: ${(error as Error).message}`);
}
