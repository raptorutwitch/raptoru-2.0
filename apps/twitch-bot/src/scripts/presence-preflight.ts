// Read-only check before a shadow presence run:
//   npm run presence:preflight -w @raptoru/twitch-bot [-- --refresh]
// Twitch calls: token validation (and a token refresh if the token is expiring, or with --refresh),
// then ONE Get Chatters page. Never subscribes to EventSub, never writes to chat, never calls Core.
import { loadTwitchAppConfig } from '../config.js';
import { fileTokenStore, TwitchAuth } from '../twitch/auth.js';
import { createHelix, HelixError } from '../twitch/helix.js';

const config = loadTwitchAppConfig();
const auth = new TwitchAuth({
  clientId: config.TWITCH_CLIENT_ID,
  clientSecret: config.TWITCH_CLIENT_SECRET,
  store: fileTokenStore(config.TWITCH_TOKEN_FILE),
  requiredScopes: ['moderator:read:chatters'],
  log: () => {},
});

const fail = (message: string): never => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

try {
  await auth.init();
  if (process.argv.includes('--refresh')) await auth.refresh();
} catch (error) {
  fail((error as Error).message);
}

const s = auth.status();
const hours = (Date.parse(s.expiresAt!) - Date.now()) / 3_600_000;
console.log(
  `token owner: ${s.login} (${s.userId})${s.userId === config.TWITCH_BROADCASTER_ID ? ' = broadcaster' : ' (must be a moderator of the channel)'}`,
);
console.log(`scopes: ${s.scopes.join(' ') || '(none)'}`);
console.log(
  `access token expires in: ${hours.toFixed(1)} h (refreshed automatically)`,
);
console.log(
  `refresh token: ${s.hasRefreshToken ? 'available' : 'MISSING'}${s.lastRefreshAt ? ` · refresh tested at ${s.lastRefreshAt}` : ''}`,
);
if (!s.hasRefreshToken) fail('no refresh token: run twitch:auth again');

const helix = createHelix({
  clientId: config.TWITCH_CLIENT_ID,
  getAccessToken: () => auth.getAccessToken(),
  handleUnauthorized: (rejected) => auth.handleUnauthorized(rejected),
});
try {
  const page = await helix.getChattersPage(
    config.TWITCH_BROADCASTER_ID,
    s.userId!,
    null,
    undefined,
    1,
  );
  console.log(
    `OK: Get Chatters works (total reported: ${page.total ?? 'unknown'})`,
  );
} catch (error) {
  if (error instanceof HelixError && error.status === 403) {
    fail(
      `Get Chatters refused (403): ${s.login} is not the broadcaster nor a moderator of the channel`,
    );
  }
  fail(`Get Chatters failed: ${(error as Error).message}`);
}
