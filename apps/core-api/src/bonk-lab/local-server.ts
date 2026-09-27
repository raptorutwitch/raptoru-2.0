import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { BonkLabService } from './bonk-lab-service.js';
import { TwitchViewerCatalog } from './twitch-viewer.js';
import { ThirdPartyEmotes } from './third-party-emotes.js';
import { bonkLabRoutes } from '../http/bonk-lab-routes.js';
import { HttpError } from '../http/server.js';
import { systemClock } from '../clock.js';
import { createPgDb } from '../db/db.js';

// Separate Lab entrypoint: no Wallet/Loyalty process, timers, bot, or public routes.
const url = new URL(process.env.BONK_LAB_DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/raptoru_bonk_lab'
)
  throw new Error('dedicated_local_bonk_database_required');
const secret = process.env.BONK_LAB_SECRET ?? '';
if (secret.length < 32) throw new Error('bonk_secret_required');
const db = createPgDb(url.href);
// Twitch viewer catalog (read-only user:read:emotes), only when the launcher passes the app.
const clientId = process.env.BONK_LAB_TWITCH_CLIENT_ID ?? '';
const clientSecret = process.env.BONK_LAB_TWITCH_CLIENT_SECRET ?? '';
const viewers =
  clientId && clientSecret
    ? new TwitchViewerCatalog(db, systemClock, { clientId, clientSecret })
    : null;
// 7TV/BTTV/FFZ public catalogs of the channel (no token), only when the launcher passes its id.
const channelTwitchId = process.env.BONK_LAB_CHANNEL_TWITCH_ID ?? '';
const thirdParty = /^\d+$/.test(channelTwitchId)
  ? new ThirdPartyEmotes(channelTwitchId, systemClock)
  : null;
const routes = bonkLabRoutes(
  new BonkLabService(db, systemClock, viewers, thirdParty),
  viewers,
);
const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' && requestUrl.pathname === '/health')
    return send(200, { service: 'bonk-lab-core', test_mode: true });
  const actual = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return send(401, { error: 'unauthorized' });
  try {
    const route = routes.find(
      (r) => r.method === req.method && r.pattern.test(requestUrl.pathname),
    );
    if (!route) return send(404, { error: 'not_found' });
    let text = '';
    for await (const chunk of req) {
      text += String(chunk);
      if (text.length > 8192) return send(413, { error: 'too_large' });
    }
    const params = route.pattern.exec(requestUrl.pathname)!.slice(1);
    send(
      200,
      await route.handle({
        params,
        url: requestUrl,
        body: text ? JSON.parse(text) : undefined,
      }),
    );
  } catch (e) {
    if (e instanceof HttpError) send(e.status, e.body);
    else send(500, { error: 'bonk_core_error' });
  }
});
server.listen(4301, '127.0.0.1', () =>
  console.log('[bonk-lab-core] local port 4301, isolated database'),
);
const stop = () =>
  server.close(() => void db.close().then(() => process.exit(0)));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
