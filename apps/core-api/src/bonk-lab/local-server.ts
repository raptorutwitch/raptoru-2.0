import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { BonkLabService } from './bonk-lab-service.js';
import { TwitchViewerCatalog } from './twitch-viewer.js';
import { ThirdPartyEmotes } from './third-party-emotes.js';
import { bonkLabRoutes } from '../http/bonk-lab-routes.js';
import { soundLabRoutes } from '../http/sound-lab-routes.js';
import { SoundLabService } from '../sound-lab/sound-lab-service.js';
import { TtsLabService } from '../tts-lab/tts-lab-service.js';
import { ttsLabRoutes } from '../http/tts-lab-routes.js';
import { labModerationRoutes } from '../http/lab-moderation-routes.js';
import { LabModerationService } from '../lab-moderation/service.js';
import { RaffleLabService } from '../raffle-lab/raffle-lab-service.js';
import { AvatarCache, twitchAppUserLookup } from '../raffle-lab/avatars.js';
import { HttpError } from '../http/server.js';
import { commandsRoutes } from '../http/commands-routes.js';
import { CommandsService } from '../commands/service.js';
import { raffleReservedWords } from '../commands/reserved.js';
import { CommandsAdmission } from '../commands/admission.js';
import { CommandSteps } from '../commands/steps.js';
import { systemClock } from '../clock.js';
import { createPgDb, dbReady, SERVER_DB_LIMITS } from '../db/db.js';

// Separate Lab entrypoint: no Wallet/Loyalty process, timers, bot, or public routes.
const url = new URL(process.env.BONK_LAB_DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  // The Lab database, or a dedicated throw-away copy for end-to-end tests (raptoru_bonk_lab_<name>).
  !/^\/raptoru_bonk_lab(_[a-z0-9]{1,32})?$/.test(url.pathname)
)
  throw new Error('dedicated_local_bonk_database_required');
const secret = process.env.BONK_LAB_SECRET ?? '';
if (secret.length < 32) throw new Error('bonk_secret_required');
const db = createPgDb(url.href, SERVER_DB_LIMITS);
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
const bonk = new BonkLabService(db, systemClock, viewers, thirdParty);
const sound = new SoundLabService(db, systemClock);
const tts = new TtsLabService(db, systemClock);
// The Lab channel's real Twitch broadcaster (the launcher's channel): the streamer of every Lab chat
// module (Commands V2, Tombola) — lab-chat/broadcaster.ts.
const broadcasterOf = () =>
  /^\d+$/.test(channelTwitchId) ? channelTwitchId : null;
const raffle = new RaffleLabService(
  db,
  systemClock,
  Math.random,
  broadcasterOf,
);
// Commands V2 (Lab): Tombola's chat words stay Tombola's (reserved, read through its own configuration
// reader). Admission (phase B) records; accepted answers become durable steps (phase C), handed to the
// Lab Twitch adapter only while « Sortie chat réelle » is ON (OFF by default).
const reserved = raffleReservedWords(raffle);
const commands = new CommandsService(db, systemClock, { reserved });
const admission = new CommandsAdmission(db, systemClock, {
  reserved,
  broadcasterOf,
});
const steps = new CommandSteps(db, systemClock);
const routes = [
  ...bonkLabRoutes(bonk, viewers),
  // Soundboard V2 Lab: same isolated Lab Core process and database.
  ...soundLabRoutes(sound),
  // TTS V2 Lab: same isolated Lab Core process and database.
  ...ttsLabRoutes(tts),
  // Moderation V2 + Lab test wallet + TTS configuration: Lab Core only (never the production Core).
  // Tombola V2 (minimal, needed by the D4 console) lives in the same Lab Core.
  ...labModerationRoutes(
    new LabModerationService(db, systemClock, tts, sound, bonk, raffle),
    tts,
    raffle,
    [{ name: 'commands', chat: (m) => admission.chat(m) }],
  ),
  // Commands V2 (configuration phase A, admission phase B): same Lab Core and database.
  ...commandsRoutes(commands, admission, steps),
];
const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' && requestUrl.pathname === '/health')
    return send(200, { service: 'bonk-lab-core', test_mode: true });
  // Readiness, distinct from liveness above: 503 while the Lab database does not answer.
  if (req.method === 'GET' && requestUrl.pathname === '/ready')
    return (await dbReady(db))
      ? send(200, { service: 'bonk-lab-core', status: 'ready' })
      : send(503, { service: 'bonk-lab-core', status: 'db_unavailable' });
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
// 4301 by default (Studio runtime); another port only for isolated end-to-end tests.
const port = Number(process.env.BONK_LAB_CORE_PORT ?? 4301);
server.listen(port, '127.0.0.1', () =>
  console.log(`[bonk-lab-core] local port ${port}, isolated database`),
);
// Tombola V2: Core takes its own time-driven transitions (end of the announcement, draw at
// closes_at, reveal, end of the result) even when nobody reads, and refreshes the Twitch profile
// pictures of the participants in the background (initials fallback when absent).
const avatars = new AvatarCache(
  db,
  systemClock,
  clientId && clientSecret
    ? twitchAppUserLookup({ clientId, clientSecret })
    : null,
);
let ticking = false;
const raffleTick = setInterval(() => {
  if (ticking) return;
  ticking = true;
  raffle
    .tick()
    .catch((e) => console.error('[bonk-lab-core] tombola tick failed', e))
    .finally(() => (ticking = false));
}, 250);
const avatarTick = setInterval(() => {
  avatars
    .refresh()
    .catch((e) => console.error('[bonk-lab-core] avatars failed', e));
}, 5000);
const stop = () => {
  clearInterval(raffleTick);
  clearInterval(avatarTick);
  server.close(() => void db.close().then(() => process.exit(0)));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
