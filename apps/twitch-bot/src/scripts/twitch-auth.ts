// One-off local OAuth (authorization code flow) to obtain the first access + refresh token.
//   npm run twitch:auth -w @raptoru/twitch-bot
// Opens nothing by itself: prints the Twitch authorize URL, waits (5 min max) for the redirect on
// a loopback-only callback server, exchanges the code, validates it and writes the token file.
// Scopes are derived from the enabled features only. Tokens are never printed.
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  BROADCASTER_SCOPES,
  loadTwitchAppConfig,
  requiredScopes,
} from '../config.js';
import {
  fileTokenStore,
  requestToken,
  TWITCH_AUTHORIZE_URL,
  validateAccessToken,
} from '../twitch/auth.js';

const DEFAULT_REDIRECT_URI = 'http://localhost:3789/callback';
const TIMEOUT_MS = 5 * 60 * 1000;

const config = loadTwitchAppConfig();
// --broadcaster: separate token owned by the broadcaster, for subscriptions/cheers/follows.
const broadcasterMode = process.argv.includes('--broadcaster');
const scopes = broadcasterMode ? BROADCASTER_SCOPES : requiredScopes(config);
const tokenFile = broadcasterMode
  ? config.TWITCH_BROADCASTER_TOKEN_FILE
  : config.TWITCH_TOKEN_FILE;
if (scopes.length === 0) {
  throw new Error(
    'no feature enabled: set PRESENCE_SHADOW=true, LAB_CHAT_INGEST=true (or DAILY_CHAT_COMMANDS=true) first',
  );
}
const redirectUri = process.env.TWITCH_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
const redirect = new URL(redirectUri);
const state = randomUUID();

const authorizeUrl = new URL(TWITCH_AUTHORIZE_URL);
authorizeUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: config.TWITCH_CLIENT_ID,
  redirect_uri: redirectUri,
  scope: scopes.join(' '),
  state,
  force_verify: 'true', // always show the account picker: authorize with the right account
}).toString();

const code = await new Promise<string>((resolve, reject) => {
  const servers: Server[] = [];
  const done = (fn: () => void) => {
    clearTimeout(timer);
    for (const s of servers) s.close();
    fn();
  };
  const timer = setTimeout(
    () =>
      done(() =>
        reject(new Error('timed out waiting for the Twitch redirect')),
      ),
    TIMEOUT_MS,
  );

  const handler = (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => {
    const url = new URL(req.url ?? '/', redirectUri);
    if (url.pathname !== redirect.pathname) {
      res.writeHead(404).end();
      return;
    }
    const ok =
      url.searchParams.get('state') === state && url.searchParams.get('code');
    res.writeHead(ok ? 200 : 400, {
      'content-type': 'text/plain; charset=utf-8',
    });
    res.end(
      ok
        ? 'Raptoru : autorisation reçue, tu peux fermer cet onglet.'
        : 'Raptoru : autorisation refusée ou invalide.',
    );
    if (url.searchParams.get('state') !== state)
      return done(() => reject(new Error('OAuth state mismatch')));
    const error = url.searchParams.get('error');
    if (error)
      return done(() => reject(new Error(`authorization denied: ${error}`)));
    done(() => resolve(url.searchParams.get('code')!));
  };

  // Loopback only, IPv4 and IPv6 (browsers may resolve localhost to either).
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer(handler);
    server.on('error', () => {}); // e.g. no IPv6 loopback
    server.listen(Number(redirect.port || 80), host);
    servers.push(server);
  }
  console.log(`Scopes requested: ${scopes.join(' ')}`);
  console.log(
    'Open this URL in your browser and log in with the account that will own the token:',
  );
  console.log(authorizeUrl.toString());
});

const exchanged = await requestToken({
  client_id: config.TWITCH_CLIENT_ID,
  client_secret: config.TWITCH_CLIENT_SECRET,
  code,
  grant_type: 'authorization_code',
  redirect_uri: redirectUri,
});
if (!exchanged.ok)
  throw new Error(`code exchange failed: ${exchanged.message}`);

const info = await validateAccessToken(exchanged.token.access_token);
if (!info) throw new Error('Twitch rejected the new token');
const missing = scopes.filter((s) => !(info.scopes ?? []).includes(s));
if (missing.length)
  throw new Error(`granted token lacks scopes: ${missing.join(', ')}`);
if (broadcasterMode && info.user_id !== config.TWITCH_BROADCASTER_ID) {
  throw new Error(
    `this token belongs to ${info.login}, not to the broadcaster (${config.TWITCH_BROADCASTER_ID}): not saved. Log in as the broadcaster.`,
  );
}

await fileTokenStore(tokenFile).save({
  accessToken: exchanged.token.access_token,
  refreshToken: exchanged.token.refresh_token,
  scopes: info.scopes ?? [],
  expiresAt: Date.now() + info.expires_in * 1000,
  userId: info.user_id,
  login: info.login,
});

console.log(`Token saved to ${tokenFile} (git-ignored).`);
console.log(
  `Owner: ${info.login} (${info.user_id}) · scopes: ${(info.scopes ?? []).join(' ')}`,
);
console.log(
  info.user_id === config.TWITCH_BROADCASTER_ID
    ? 'Owner is the broadcaster: Get Chatters is allowed.'
    : 'Owner is NOT the broadcaster: it must be a moderator of the channel. Check with `npm run presence:preflight`.',
);
