import { musicExtRoutes } from '../http/music-ext-routes.js';
import { parseMusicAudience } from './music-audience.js';
import { cosmeticsRoutes } from '../http/cosmetics-routes.js';
import { modulesRoutes } from '../http/modules-routes.js';
import { moduleSettingsRoutes } from '../http/module-settings-routes.js';
import { eventShopRoutes } from '../http/event-shop-routes.js';
import type { Core } from '../app.js';
import { TwitchViewerCatalog } from '../bonk-lab/twitch-viewer.js';
import type { Clock } from '../clock.js';
import type { CoreConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { bonkLabRoutes } from '../http/bonk-lab-routes.js';
import { commandsRoutes } from '../http/commands-routes.js';
import { miniGamesRoutes } from '../http/mini-games-routes.js';
import { wordGameRoutes } from '../http/word-game-routes.js';
import { WalletAdminChat } from '../wallet/admin-chat.js';
import { chatRouter } from '../lab-chat/games.js';
import { labModerationRoutes } from '../http/lab-moderation-routes.js';
import type { AppDeps } from '../http/server.js';
import { soundLabRoutes } from '../http/sound-lab-routes.js';
import { subWheelRoutes } from '../http/sub-wheel-routes.js';
import { ttsLabRoutes } from '../http/tts-lab-routes.js';
import { LabModerationService } from '../lab-moderation/service.js';
import { AvatarCache, twitchAppUserLookup } from '../raffle-lab/avatars.js';
import type { TwitchUserLookup } from '../raffle-lab/avatars.js';
import { labTwitchViewers } from '../lab/fictional-twitch.js';
import { labCockpitRoutes } from '../lab/routes.js';
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
  if (config.CORE_ENVIRONMENT === 'lab')
    return labTwitchViewers(db, clock, config.PORT);
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
  /** `userLookup`: the viewers' names without Helix (the Lab's fictional directory). */
  o: { userLookup?: TwitchUserLookup } = {},
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
    // Music Hub: its Jetons purchases in the moderation history and the manual refund (post-live 11/11).
    core.spotify,
  );
  // The Lab environment (CORE_ENVIRONMENT=lab) carries the whole Lab table behind the same in-process call.
  const lab = config.CORE_ENVIRONMENT === 'lab';
  // Portefeuille in the chat (`!addpoints`…): the moderation's own `wallet_adjust`, same rules as the extension.
  const walletAdmin = new WalletAdminChat(
    db,
    clock,
    moderation,
    core.chat.loginLookup,
  );
  // The historical `!wallet add|remove|set` (bot): the same decision and the same adjustment (wallet/chat.ts).
  core.wallet.chat.moderation = {
    legacy: (req) => walletAdmin.legacy(channelId, req),
    isBroadcaster: (id) => walletAdmin.isBroadcaster(channelId, id),
  };
  const walletAdminModule = {
    name: 'wallet_admin',
    chat: (m: Parameters<WalletAdminChat['chat']>[0]) => walletAdmin.chat(m),
  };
  const call = internalLabCall([
    ...bonkLabRoutes(core.bonkLab, lab ? core.twitchViewers : null),
    ...soundLabRoutes(core.soundLab),
    ...ttsLabRoutes(core.ttsLab),
    // No Lab chat ingress here: the chat reaches this Core from the bot only (/v1/bot/chat, chatIngress below). The Lab
    // environment is the one exception: fictional Jetons, Studio's chat simulator through the cockpit.
    ...labModerationRoutes(
      moderation,
      core.ttsLab,
      core.raffleLab,
      lab
        ? [
            ...core.chat.chatModules,
            core.progression.chatModule,
            walletAdminModule,
          ]
        : [],
    ),
    ...(lab ? labCockpitRoutes(core, channelId) : []),
    // Chat games configuration for the Studio cockpit (lot 8): Commands V2, Jeu des mots, Roulette / Slot / Duel.
    ...commandsRoutes(core.chat.commands, core.chat.admission, core.chat.steps),
    ...wordGameRoutes(core.chat.wordGame),
    ...miniGamesRoutes(core.chat.miniGames),
    // Roue du Sub V2 (R8): the viewer frontier's own tours / team actions, in-process only (never on HTTP).
    ...subWheelRoutes(core.subWheel, core.alerts),
    // Music Hub (docs/music/MUSIC_HUB_STATE.md): the extension's song requests on Spotify V2, in-process only.
    ...musicExtRoutes(core.spotify),
    // Boutique d'événement (docs/HALLOWEEN.md): the viewer's state, purchase and conversion, in-process only.
    ...eventShopRoutes(core.eventShop),
    // Halloween « Titres » (docs/COSMETIC_SHOP.md § 8): the cosmetic shop's catalogue, a viewer's side and the purchase,
    // in-process only (the façade passes the JWT viewer; these routes are never on HTTP from here).
    ...cosmeticsRoutes(core.cosmetics, {
      channelId,
      production: false,
      site: true,
    }),
    // Refonte H10 / H12 / H14: Studio's module settings and Daily steps (through the cockpit), the façade's Bonk price.
    ...moduleSettingsRoutes(core.moduleSettings, db, {
      channelId,
      production: false,
    }),
    // The module host (architecture socle): catalog, status, admin, viewer, activity, refund — once for every module.
    ...modulesRoutes(core.modules),
  ]);
  const app =
    o.userLookup ??
    (config.TWITCH_APP_CLIENT_ID && config.TWITCH_APP_CLIENT_SECRET
      ? twitchAppUserLookup({
          clientId: config.TWITCH_APP_CLIENT_ID,
          clientSecret: config.TWITCH_APP_CLIENT_SECRET,
        })
      : null);
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
      lab,
      music: parseMusicAudience(config.MUSIC_HUB_EXTENSION),
    },
    core.twitchViewers,
  );
  return {
    deps: {
      cockpit: { core: call, channelId, lab },
      // The chat games' doors for the production bot: the Tombola first, then the chat games (same as the Lab).
      chatIngress: {
        router: chatRouter(core.raffleLab, [
          ...core.chat.chatModules,
          core.progression.chatModule,
          walletAdminModule,
        ]),
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
      core.votekick.attachAvatars(avatars);
      core.dock.attachAvatars(avatars);
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
          // Audit 09/11 (P2): a chat !rb owed after a restart or a failed settle is refunded within 15 s.
          await core.chat.randomBanChat
            ?.settleAll()
            .catch((e: Error) =>
              console.error('[core-api] !rb refund sweep failed', e.message),
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
      // Votekick V2: the vote's end, the leases and the broadcaster's mute (every 500 ms; never two at a time inside).
      const votekickTick = setInterval(() => {
        core.votekick
          .tick()
          .catch((e: Error) =>
            console.error('[core-api] votekick tick failed', e.message),
          );
      }, 500);
      // Spotify V2: Studio's leases and absence (song requests refunded when nobody takes them).
      const spotifyTick = setInterval(() => {
        core.spotify
          .tickAll()
          .catch((e: Error) =>
            console.error('[core-api] spotify tick failed', e.message),
          );
      }, 1000);
      // Refonte H6: the waiting song requests closed and refunded after the end of the live (every 30 s, idempotent).
      // The module host's periodic jobs (one loop for every module).
      const modulesTick = setInterval(() => {
        void core.modules.tick();
      }, 5000);
      const spotifyEndTick = setInterval(() => {
        core.spotify
          .closeAfterLive(channelId)
          .catch((e: Error) =>
            console.error('[core-api] spotify end of live failed', e.message),
          );
      }, 30_000);
      // Boutique d'événement: overdue plays (not taken, not started, never ended) settled even when nobody reads.
      const eventShopTick = setInterval(() => {
        core.eventShop
          .sweepAll()
          .catch((e: Error) =>
            console.error('[core-api] event shop sweep failed', e.message),
          );
      }, 5000);
      // Défis: the recount (only with CHALLENGES_ENGINE=true; nothing without the tables or a live challenge).
      core.challenges.engineEnabled = config.CHALLENGES_ENGINE === 'true';
      let counting = false;
      const challengesTick =
        config.CHALLENGES_ENGINE === 'true'
          ? setInterval(() => {
              if (counting) return;
              counting = true;
              core.challenges
                .tick(channelId)
                .catch((e: Error) =>
                  console.error('[core-api] challenges run failed', e.message),
                )
                .finally(() => (counting = false));
            }, 60_000)
          : null;
      return () => {
        if (challengesTick) clearInterval(challengesTick);
        clearInterval(eventShopTick);
        clearInterval(spotifyTick);
        clearInterval(spotifyEndTick);
        clearInterval(modulesTick);
        clearInterval(votekickTick);
        clearInterval(wordGameTick);
        clearInterval(raffleTick);
        clearInterval(avatarTick);
        clearInterval(expirySweep);
      };
    },
  };
}
