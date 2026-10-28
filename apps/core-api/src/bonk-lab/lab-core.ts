import { createServer, type Server } from 'node:http';
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
import { HttpError } from '../http/server.js';
import { commandsRoutes } from '../http/commands-routes.js';
import { miniGamesRoutes } from '../http/mini-games-routes.js';
import { alertsRoutes } from '../http/alerts-routes.js';
import { channelPointsRoutes } from '../http/channel-points-routes.js';
import { ChannelPointsService } from '../channel-points/service.js';
import { randomBanRoutes } from '../http/random-ban-routes.js';
import { dockRoutes } from '../http/dock-routes.js';
import { eventShopRoutes } from '../http/event-shop-routes.js';
import { EventShopService } from '../event-shop/service.js';
import { DockActivityService } from '../dock/service.js';
import { cautionRoutes } from '../http/caution-routes.js';
import { CautionService } from '../caution/service.js';
import { votekickRoutes } from '../http/votekick-routes.js';
import { VotekickService } from '../votekick/service.js';
import { CpTwitchActions } from '../channel-points/twitch-actions.js';
import { spotifyRoutes } from '../http/spotify-routes.js';
import { SpotifyService } from '../spotify/service.js';
import { RandomBanService } from '../random-ban/service.js';
import { subWheelRoutes } from '../http/sub-wheel-routes.js';
import { SubWheelService } from '../sub-wheel/service.js';
import { AlertsService } from '../alerts/service.js';
import { createChatGames } from '../lab-chat/games.js';
import type { WordGameService } from '../word-game/service.js';
import {
  serveWordGameEvents,
  wordGameRoutes,
} from '../http/word-game-routes.js';
import type { Clock } from '../clock.js';
import { dbReady, type Db } from '../db/db.js';
import { labEconomy, type EconomyPort } from '../economy/economy.js';

// The Lab Core: its services, routes and HTTP server on a given database. One assembly for the Lab
// Core process (local-server.ts: env, port, timers) and the end-to-end harness (apps/studio/server/e2e,
// in-memory database): what the E2E exercises is exactly what Studio runs.

/** Masks the Bearer secret and any credentials of a connection URL in a diagnostic text. */
export function redact(text: string, secret: string): string {
  return text
    .split(secret)
    .join('***')
    .replace(/(\/\/)[^/\s:@]+:[^@\s]+@/g, '$1***@');
}

export interface LabCoreOptions {
  db: Db;
  clock: Clock;
  /** Bearer secret of every route except /health and /ready (>= 32 chars). */
  secret: string;
  /** Twitch app (viewer catalog), only when the launcher passes it. */
  twitch?: { clientId: string; clientSecret: string } | null;
  /** The Lab channel's real Twitch broadcaster id (BONK_LAB_CHANNEL_TWITCH_ID), or ''. */
  channelTwitchId?: string;
  /**
   * Economy of every module of this runtime (Bonk, Soundboard, TTS, Tombola, Roue du Sub, moderation, Jeu des mots, mini-games). The Lab
   * test wallet unless a caller passes the result of economy/activation.ts selectEconomy (the launcher never does before
   * the cutover; the activation refuses a runtime whose modules are not all proven).
   */
  economy?: EconomyPort;
}

export function createLabCore({
  db,
  clock: systemClock,
  secret,
  twitch,
  channelTwitchId = '',
  economy = labEconomy,
}: LabCoreOptions): {
  server: Server;
  raffle: RaffleLabService;
  wordGame: WordGameService;
  votekick: VotekickService;
  spotify: SpotifyService;
} {
  if (secret.length < 32) throw new Error('bonk_secret_required');
  // Twitch viewer catalog (read-only user:read:emotes), only when the launcher passes the app.
  const viewers = twitch
    ? new TwitchViewerCatalog(db, systemClock, twitch)
    : null;
  // 7TV/BTTV/FFZ public catalogs of the channel (no token), only when the launcher passes its id.
  const thirdParty = /^\d+$/.test(channelTwitchId)
    ? new ThirdPartyEmotes(channelTwitchId, systemClock)
    : null;
  const bonk = new BonkLabService(
    db,
    systemClock,
    viewers,
    thirdParty,
    economy,
  );
  const sound = new SoundLabService(db, systemClock, undefined, economy);
  const tts = new TtsLabService(db, systemClock, undefined, undefined, economy);
  // The Lab channel's real Twitch broadcaster (the launcher's channel): the streamer of every Lab chat
  // module (Commands V2, Tombola) — lab-chat/broadcaster.ts.
  const broadcasterOf = () =>
    /^\d+$/.test(channelTwitchId) ? channelTwitchId : null;
  const raffle = new RaffleLabService(
    db,
    systemClock,
    Math.random,
    broadcasterOf,
    economy,
  );
  // Commands V2, Jeu des mots, Roulette / Slot / Duel: the ONE assembly of the chat games (lab-chat/games.ts).
  // Commands V2 answers become durable steps, handed to the Lab Twitch adapter only while « Sortie chat réelle » is
  // ON (OFF by default); Duel finds its target by login with the Lab app credentials of the Tombola avatars.
  const votekick = new VotekickService(db, systemClock, broadcasterOf);
  // Random Ban V3: the streamer as an exceptional target (his mic muted in OBS by Studio).
  const randomBan = new RandomBanService(db, systemClock, undefined, {
    streamer: () => {
      const id = broadcasterOf();
      return id
        ? { id, login: process.env.TWITCH_CHANNEL_LOGIN || 'raptoru_' }
        : null;
    },
    otherMutes: votekick,
  });
  // The broadcaster's caution ends ONE of his OBS mutes: Votekick's or the Random Ban's.
  const caution = new CautionService(db, systemClock, economy, broadcasterOf, [
    { kind: 'votekick', label: 'Votekick', source: votekick },
    { kind: 'random_ban', label: 'Random Ban', source: randomBan.mutes },
  ]);
  const cpTwitch = new CpTwitchActions(db, systemClock);
  const spotify = new SpotifyService(db, systemClock, cpTwitch);
  const channelPoints = new ChannelPointsService(
    db,
    systemClock,
    sound,
    randomBan,
    economy,
    spotify,
  );
  // Roue du Sub: the gains pay the runtime's economy — the canonical Wallet, or here the Lab test wallet (test data,
  // its own ledger kind, one row per spin). The Lab simulators (presence, events) only exist in the Lab database.
  const subWheel = new SubWheelService(db, systemClock, undefined, economy, {
    labCredits: true,
  });
  // Boutique d'événement (docs/HALLOWEEN.md): the Lab's simulated subs / gifts earn Bonbons too.
  const eventShop = new EventShopService(db, systemClock, economy, {
    rewardSimulations: true,
  });
  const { commands, admission, steps, wordGame, miniGames, chatModules } =
    createChatGames({
      db,
      clock: systemClock,
      economy,
      raffle,
      broadcasterOf,
      twitch,
      tts,
      randomBan,
      channelPoints,
      caution,
      votekick,
      spotify,
      subWheel,
      eventShop,
    });
  const alertsService = new AlertsService(db, systemClock);
  alertsService.attachListener('event_shop', (q, e) => eventShop.onAlert(q, e));
  const routes = [
    ...bonkLabRoutes(bonk, viewers),
    // Soundboard V2 Lab: same isolated Lab Core process and database.
    ...soundLabRoutes(sound),
    // TTS V2 Lab: same isolated Lab Core process and database.
    ...ttsLabRoutes(tts),
    // Moderation V2 + Lab test wallet + TTS configuration: Lab Core only (never the production Core).
    // Tombola V2 (minimal, needed by the D4 console) lives in the same Lab Core.
    ...labModerationRoutes(
      new LabModerationService(
        db,
        systemClock,
        tts,
        sound,
        bonk,
        raffle,
        economy,
      ),
      tts,
      raffle,
      // Whole chat for the Jeu des mots and the mini-games (the simulator identities are the Duel targets).
      chatModules,
    ),
    ...wordGameRoutes(wordGame),
    ...miniGamesRoutes(miniGames),
    // Twitch alerts V1 (A1): normalized events, durable queue, claim / ACK (no economy).
    ...alertsRoutes(alertsService, undefined, subWheel),
    // Roue du Sub: fed by the alerts reception above; state, switch (OFF), tests, animations, reconciliation.
    ...subWheelRoutes(subWheel, alertsService),
    // Points de chaîne V1: redemptions (Lab chat adapter), rules, OBS jobs (Studio); sounds through this Soundboard.
    ...channelPointsRoutes(channelPoints),
    // Random Ban V2: Studio (state, tests, animations) and the Lab chat adapter (Twitch executor).
    ...randomBanRoutes(randomBan),
    // Dock OBS V1: the activity feed and visual replays (read-only projection, docs/OBS_DOCK.md).
    ...dockRoutes(new DockActivityService(db, systemClock)),
    // Boutique d'événement: Studio's panel and overlay, and the viewer side for the Extension Lab.
    ...eventShopRoutes(eventShop),
    // Caution: Studio (state) and the Lab chat adapter (Twitch executor); `!caution` in the Lab chat.
    ...cautionRoutes(caution),
    // Votekick V2: Studio (state, overlay, mute) and the Lab chat adapter (Twitch executor); `!votekick` in the Lab chat.
    ...votekickRoutes(votekick),
    // Spotify V2: Studio (panel, sync, jobs) and the Lab chat adapter (Twitch-side actions); the commands in the Lab chat.
    ...spotifyRoutes(spotify, cpTwitch),
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
    // Jeu des mots: committed wins pushed to Studio (OBS sound), an open server-sent events stream.
    if (serveWordGameEvents(wordGame, req, res, requestUrl)) return;
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
      if (e instanceof HttpError) return send(e.status, e.body);
      // Unexpected (ASTRA-P2-013): the client still gets a sober answer, the cause goes to the log —
      // route only (no query, no body), the Bearer secret and database credentials masked.
      const cause =
        e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e);
      console.error(
        `[bonk-lab-core] ${req.method} ${requestUrl.pathname} failed: ${redact(cause, secret)}`,
      );
      send(500, { error: 'bonk_core_error' });
    }
  });
  return { server, raffle, wordGame, votekick, spotify };
}
