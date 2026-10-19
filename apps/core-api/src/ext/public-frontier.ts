import type { Core } from '../app.js';
import { TwitchViewerCatalog } from '../bonk-lab/twitch-viewer.js';
import type { Clock } from '../clock.js';
import type { CoreConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { bonkLabRoutes } from '../http/bonk-lab-routes.js';
import { commandsRoutes } from '../http/commands-routes.js';
import { miniGamesRoutes } from '../http/mini-games-routes.js';
import { wordGameRoutes } from '../http/word-game-routes.js';
import { chatRouter } from '../lab-chat/games.js';
import { labModerationRoutes } from '../http/lab-moderation-routes.js';
import type { AppDeps } from '../http/server.js';
import { soundLabRoutes } from '../http/sound-lab-routes.js';
import { ttsLabRoutes } from '../http/tts-lab-routes.js';
import { LabModerationService } from '../lab-moderation/service.js';
import { AvatarCache, twitchAppUserLookup } from '../raffle-lab/avatars.js';
import { ExtFacade } from './ext-facade.js';
import { internalLabCall } from './lab-internal.js';
import { TwitchNames } from './twitch-names.js';

// Public Core assembly of the viewer frontier (/v1/ext/*) and the Studio cockpit (/v1/studio/cockpit/*):
// the Lab services and routes (Moderation V2, Tombola, test wallet, Bonk / Soundboard / TTS admission)
// behind an in-process call only — never mounted on the HTTP server. Off unless the Core is told its
// channel (TWITCH_CHANNEL_ID); the viewer frontier also needs the extension secret.

/**
 * Twitch viewers of the public Core (Bonk emotes): the Twitch app of TWITCH_APP_CLIENT_ID (the same
 * app as the local Lab Core's linking), the HTTPS redirect of EXT_TWITCH_REDIRECT_URI (absent = no
 * linking, the catalogs still check the Bonk), tokens encrypted with EXT_TOKEN_KEY.
 */
export function publicTwitchViewers(
  db: Db,
  clock: Clock,
  config: CoreConfig,
): TwitchViewerCatalog | null {
  if (!config.TWITCH_APP_CLIENT_ID || !config.TWITCH_APP_CLIENT_SECRET)
    return null;
  return new TwitchViewerCatalog(
    db,
    clock,
    {
      clientId: config.TWITCH_APP_CLIENT_ID,
      clientSecret: config.TWITCH_APP_CLIENT_SECRET,
    },
    fetch,
    {
      redirectUri: config.EXT_TWITCH_REDIRECT_URI ?? null,
      tokenKey: config.EXT_TOKEN_KEY
        ? Buffer.from(config.EXT_TOKEN_KEY, 'base64')
        : null,
    },
  );
}

export interface PublicFrontier {
  deps: Pick<AppDeps, 'ext' | 'cockpit' | 'chatIngress'>;
  /** Time-driven work (Tombola transitions, avatars): started by the process, stopped on exit. */
  start(): () => void;
}

export function createPublicFrontier(
  core: Core,
  db: Db,
  clock: Clock,
  config: CoreConfig,
): PublicFrontier | null {
  const channelId = config.TWITCH_CHANNEL_ID;
  if (!channelId) return null;
  const moderation = new LabModerationService(
    db,
    clock,
    core.ttsLab,
    core.soundLab,
    core.bonkLab,
    core.raffleLab,
    // The same economy as every module of this Core (balances, activity, adjustments).
    core.economy,
  );
  const call = internalLabCall([
    ...bonkLabRoutes(core.bonkLab),
    ...soundLabRoutes(core.soundLab),
    ...ttsLabRoutes(core.ttsLab),
    // No Lab chat ingress here: the chat reaches this Core from the bot only (/v1/bot/chat, chatIngress below).
    ...labModerationRoutes(moderation, core.ttsLab, core.raffleLab, []),
    // Chat games configuration for the Studio cockpit (lot 8): Commands V2, Jeu des mots, Roulette / Slot / Duel.
    ...commandsRoutes(core.chat.commands, core.chat.admission, core.chat.steps),
    ...wordGameRoutes(core.chat.wordGame),
    ...miniGamesRoutes(core.chat.miniGames),
  ]);
  const app =
    config.TWITCH_APP_CLIENT_ID && config.TWITCH_APP_CLIENT_SECRET
      ? twitchAppUserLookup({
          clientId: config.TWITCH_APP_CLIENT_ID,
          clientSecret: config.TWITCH_APP_CLIENT_SECRET,
        })
      : null;
  const secret = config.TWITCH_EXTENSION_SECRET
    ? Buffer.from(config.TWITCH_EXTENSION_SECRET, 'base64')
    : null;
  const facade = new ExtFacade(
    call,
    new TwitchNames(app),
    {
      channelId,
      channelLogin: config.TWITCH_CHANNEL_LOGIN,
      environment: config.CORE_ENVIRONMENT,
      wallet: core.economy.mode === 'canonical',
    },
    core.twitchViewers,
  );
  return {
    deps: {
      cockpit: { core: call, channelId },
      // The chat games' doors for the production bot: the Tombola first, then the chat games (same as the Lab).
      chatIngress: {
        router: chatRouter(core.raffleLab, core.chat.chatModules),
        games: core.chat,
      },
      ext: secret
        ? {
            secret,
            channelId,
            facade,
            emotesCallback: (q: URLSearchParams) => facade.oauthCallback(q),
          }
        : undefined,
    },
    start() {
      // Tombola V2 takes its own time-driven transitions (announcement end, draw at closes_at,
      // reveal, result end) even when nobody reads — like the Lab Core process.
      let ticking = false;
      const raffleTick = setInterval(() => {
        if (ticking) return;
        ticking = true;
        core.raffleLab
          .tick()
          .catch((e: Error) =>
            console.error('[core-api] tombola tick failed', e.message),
          )
          .finally(() => (ticking = false));
      }, 250);
      const avatars = new AvatarCache(db, clock, app);
      const avatarTick = setInterval(() => {
        avatars
          .refresh()
          .catch((e: Error) =>
            console.error('[core-api] avatars failed', e.message),
          );
      }, 5000);
      // Work nobody claims (no Studio on this channel) still expires and is refunded, for the three
      // execution modules.
      let sweeping = false;
      const expirySweep = setInterval(() => {
        if (sweeping) return;
        sweeping = true;
        void (async () => {
          for (const [name, service] of [
            ['bonk', core.bonkLab],
            ['soundboard', core.soundLab],
            ['tts', core.ttsLab],
          ] as const)
            await service
              .sweepExpired()
              .catch((e: Error) =>
                console.error(`[core-api] ${name} expiry failed`, e.message),
              );
        })().finally(() => (sweeping = false));
      }, 15_000);
      // Jeu des mots: the 5–15 min cycle of a live channel (one word when due), like the Lab Core process.
      let wordTicking = false;
      const wordGameTick = setInterval(() => {
        if (wordTicking) return;
        wordTicking = true;
        core.chat.wordGame
          .tick()
          .catch((e: Error) =>
            console.error('[core-api] jeu des mots tick failed', e.message),
          )
          .finally(() => (wordTicking = false));
      }, 1000);
      return () => {
        clearInterval(wordGameTick);
        clearInterval(raffleTick);
        clearInterval(avatarTick);
        clearInterval(expirySweep);
      };
    },
  };
}
