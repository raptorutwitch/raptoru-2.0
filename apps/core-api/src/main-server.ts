import type { Server } from 'node:http';
import { parseMusicAudience } from './ext/music-audience.js';
import { createCore, type Core } from './app.js';
import { ThirdPartyEmotes } from './bonk-lab/third-party-emotes.js';
import type { CreditProvider } from './daily/credits.js';
import type { EconomyPort } from './economy/economy.js';
import type { Clock } from './clock.js';
import type { CoreConfig } from './config.js';
import type { Db } from './db/db.js';
import {
  createPublicFrontier,
  publicTwitchViewers,
  type PublicFrontier,
} from './ext/public-frontier.js';
import { createApp } from './http/server.js';
import { LAB_CHANNEL, labUserLookup } from './lab/environment.js';
import {
  labEmoteImage,
  labEmoteProvidersFetch,
  labTwitchConsentRoutes,
} from './lab/fictional-twitch.js';
import { helixLive, opsStatus } from './ops/status.js';

/** The main Core's services, assembled from its configuration (the same call for Production and the Lab). */
export function createMainCore(
  db: Db,
  clock: Clock,
  config: CoreConfig,
  economy: EconomyPort,
  dailyProvider: CreditProvider,
): Core {
  const lab = config.CORE_ENVIRONMENT === 'lab';
  return createCore(
    db,
    clock,
    dailyProvider,
    {
      preview: config.LOYALTY_PREVIEW === 'true',
      passiveCredits: config.LOYALTY_PASSIVE_CREDITS === 'true',
      eventCredits: config.LOYALTY_EVENT_CREDITS === 'true',
    },
    publicTwitchViewers(db, clock, config),
    economy,
    {
      // The streamer of the chat modules (Tombola, Commands V2, games) and the Twitch app (Duel targets by login).
      broadcasterId: config.TWITCH_CHANNEL_ID ?? null,
      broadcasterLogin: config.TWITCH_CHANNEL_LOGIN,
      lab,
      emoteCatalog: config.EMOTE_CATALOG_CHANNEL_ID
        ? new ThirdPartyEmotes(config.EMOTE_CATALOG_CHANNEL_ID, clock)
        : lab
          ? new ThirdPartyEmotes(
              LAB_CHANNEL.id,
              clock,
              labEmoteProvidersFetch,
              undefined,
              (e) => labEmoteImage(e.provider, e.id),
            )
          : null,
      twitchApp:
        config.TWITCH_APP_CLIENT_ID && config.TWITCH_APP_CLIENT_SECRET
          ? {
              clientId: config.TWITCH_APP_CLIENT_ID,
              clientSecret: config.TWITCH_APP_CLIENT_SECRET,
            }
          : null,
      cautionChat: config.CAUTION_CHAT === 'true',
      votekickChat: config.VOTEKICK_CHAT === 'true',
      spotifyChat: config.SPOTIFY_CHAT === 'true',
      musicHub: parseMusicAudience(config.MUSIC_HUB_EXTENSION).mode !== 'off',
      alertsMaxAgeMs: config.ALERTS_MAX_AGE_SECONDS
        ? config.ALERTS_MAX_AGE_SECONDS * 1000
        : null,
    },
  );
}

// The main Core's HTTP assembly (doors: bot, paired Studio, viewer frontier, site, ops), ONE function for every place
// that runs the main Core: Production's and the Lab's entry point (src/index.ts) and the Lab test stack — the Lab can
// never serve a different set of routes than Production. The caller starts the frontier's timers and listens.
export function createMainServer(
  core: Core,
  db: Db,
  clock: Clock,
  config: CoreConfig,
): { server: Server; frontier: PublicFrontier | null } {
  const lab = config.CORE_ENVIRONMENT === 'lab';
  const startedAt = new Date();
  // One Helix client (its app token cached) for every /v1/ops/status call.
  const liveOnTwitch =
    config.TWITCH_APP_CLIENT_ID &&
    config.TWITCH_APP_CLIENT_SECRET &&
    config.TWITCH_CHANNEL_ID
      ? helixLive(
          {
            clientId: config.TWITCH_APP_CLIENT_ID,
            clientSecret: config.TWITCH_APP_CLIENT_SECRET,
          },
          config.TWITCH_CHANNEL_ID,
        )
      : null;

  // Viewer frontier (/v1/ext/*, Twitch JWT) and Studio cockpit: only when the channel is configured.
  // Payment: the economy chosen above (Lab test wallet by default: nothing here moves real Jetons or Channel Points).
  const frontier = createPublicFrontier(
    core,
    db,
    clock,
    config,
    lab ? { userLookup: labUserLookup } : {},
  );

  const server = createApp({
    // The Lab's fictional Twitch consent page: its environment only.
    ...(lab ? { labPublic: labTwitchConsentRoutes() } : {}),
    // Public Core: the /v1/lab/* routes (Studio secret, viewer in the body) are never served.
    labRoutes: false,
    ...frontier?.deps,
    daily: core.daily,
    streams: core.streams,
    presence: core.presence,
    wallet: core.wallet,
    loyalty: core.loyalty,
    bonkLab: core.bonkLab,
    soundLab: core.soundLab,
    ttsLab: core.ttsLab,
    studioInstallations: core.studioInstallations,
    // Twitch alerts V1 (§ 22): served to the paired Studio for the configured channel only.
    alerts: core.alerts,
    // Points de chaîne V1: configuration by the paired Studio, redemptions by the bot (switch OFF by default).
    channelPoints: core.channelPoints,
    // Random Ban V2: the paired Studio (state, tests, animations) and the bot (Twitch executor).
    randomBan: core.randomBan,
    // Dock OBS V1: the activity feed and visual replays for the paired Studio (read-only projection).
    dock: core.dock,
    eventShop: core.eventShop,
    // Progression native (docs/PROGRESSION.md): OFF until turned on in Studio.
    progression: core.progression,
    siteToken: config.SITE_TOKEN,
    // Boutique cosmétique (docs/COSMETIC_SHOP.md): Studio › Boutique and, with SITE_TOKEN, raptoru.fr's shop.
    cosmetics: core.cosmetics,
    // Défis (docs/CHALLENGES.md): Studio's editor; with SITE_TOKEN, raptoru.fr's read. 503 until the migration exists.
    challenges: core.challenges,
    // Caution: the paired Studio (state) and the bot (Twitch executor); `!caution` itself only with CAUTION_CHAT=true.
    caution: core.caution,
    // Votekick V2: the paired Studio (state, overlay, mute) and the bot (Twitch executor); chat only with VOTEKICK_CHAT.
    votekick: core.votekick,
    // Spotify V2: the paired Studio (panel, sync, jobs) and the bot (redemption statuses, Raptoru's reward).
    spotify: core.spotify,
    cpTwitch: core.cpTwitch,
    // Roue du Sub: OFF by default; gains recorded, never credited automatically.
    subWheel: core.subWheel,
    // Single active production bot: the lease (bot) and its health for the paired Studio.
    botInstances: core.botInstances,
    // Delivery tooling: commit, live state (stream session + Helix), bot lease, migrations — read-only, OPS_TOKEN only.
    ops: config.OPS_TOKEN
      ? {
          token: config.OPS_TOKEN,
          status: () =>
            opsStatus({
              session: () => core.streams.current(),
              helix: liveOnTwitch,
              bot: core.botInstances ? () => core.botInstances!.status() : null,
              db,
              commit: /^[0-9a-f]{7,40}$/.test(config.SOURCE_COMMIT ?? '')
                ? config.SOURCE_COMMIT!
                : null,
              startedAt,
              now: () => clock.now(),
            }),
        }
      : undefined,
    botSecret: config.BOT_SECRET,
    studioSecret: config.STUDIO_SECRET,
    db,
  });
  return { server, frontier };
}
