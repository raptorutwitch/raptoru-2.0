import { ThirdPartyEmotes } from './bonk-lab/third-party-emotes.js';
import { ALERT_RULES, AlertsService } from './alerts/service.js';
import {
  eventShopModule,
  randomBanModule,
  wordGameModule,
} from './modules/status-adapters.js';
import { cautionModule, cautionRates } from './modules/caution.js';
import { miniGameLimits } from './modules/mini-games.js';
import { votekickLimits, votekickModule } from './modules/votekick.js';
import { MODULES } from './modules/index.js';
import { ModuleHost } from './modules/host.js';
import { ModuleSettings } from './module-settings/service.js';
import { BotInstanceService } from './bot-instance/service.js';
import { DockActivityService } from './dock/service.js';
import { EventShopService } from './event-shop/service.js';
import { RandomBanService } from './random-ban/service.js';
import { CautionService } from './caution/service.js';
import { VotekickService } from './votekick/service.js';
import { SubWheelService } from './sub-wheel/service.js';
import { ChannelPointsService } from './channel-points/service.js';
import { CpTwitchActions } from './channel-points/twitch-actions.js';
import { SpotifyService } from './spotify/service.js';
import { BonkLabService } from './bonk-lab/bonk-lab-service.js';
import type { TwitchViewerCatalog } from './bonk-lab/twitch-viewer.js';
import { RaffleLabService } from './raffle-lab/raffle-lab-service.js';
import { SoundLabService } from './sound-lab/sound-lab-service.js';
import { TtsLabService } from './tts-lab/tts-lab-service.js';
import type { Clock } from './clock.js';
import { DailyCredits, type CreditProvider } from './daily/credits.js';
import { DailyService } from './daily/daily-service.js';
import type { Db } from './db/db.js';
import { CosmeticShopService } from './cosmetics/service.js';
import { type EconomyPort, labEconomy } from './economy/economy.js';
import { type ChatGames, createChatGames } from './lab-chat/games.js';
import type { LoginLookup } from './mini-games/twitch-login.js';
import {
  LoyaltyEngine,
  SHADOW_MODES,
  type LoyaltyModes,
} from './loyalty/engine.js';
import { PresenceService } from './presence/presence-service.js';
import { StreamSessions } from './stream/stream-sessions.js';
import { StudioInstallations } from './studio/installations.js';
import { createWalletModule, type WalletModule } from './wallet/index.js';
import { withBonbonsRewards } from './event-shop/raffle-currency.js';
import { ProgressionService } from './progression/service.js';
import { ChallengeService } from './challenges/service.js';

export interface Core {
  daily: DailyService;
  streams: StreamSessions;
  credits: DailyCredits;
  presence: PresenceService;
  wallet: WalletModule;
  loyalty: LoyaltyEngine;
  bonkLab: BonkLabService;
  soundLab: SoundLabService;
  ttsLab: TtsLabService;
  raffleLab: RaffleLabService;
  /** Twitch viewers (Bonk emotes): linking + personal catalogs. Null = Twitch emotes off. */
  twitchViewers: TwitchViewerCatalog | null;
  /** Studio installation credentials of the future production transport (ASTRA-P1-019). */
  studioInstallations: StudioInstallations;
  /** Twitch alerts V1: the durable queue (same service as the Lab Core). */
  alerts: AlertsService;
  /** Points de chaîne V1 (same service as the Lab Core; sounds through this Core's Soundboard). */
  channelPoints: ChannelPointsService;
  /** Random Ban V2 (same service as the Lab Core; triggered by the channel points rule). */
  randomBan: RandomBanService;
  /** Dock OBS V1: read-only activity projection and visual replays (docs/OBS_DOCK.md). */
  dock: DockActivityService;
  eventShop: EventShopService;
  progression: ProgressionService;
  /** Boutique cosmétique V1 (docs/COSMETIC_SHOP.md): looks, offers, purchases, module awards. */
  cosmetics: CosmeticShopService;
  /** Défis et succès (docs/CHALLENGES.md): definitions from Studio, recount, idempotent rewards (shop award). */
  challenges: ChallengeService;
  /** Caution: the requests and the executor's routes always; `!caution` in the chat only with `cautionChat`. */
  caution: CautionService;
  /** Votekick V2: votes and the broadcaster's mute always; `!votekick` / `!kick` / `!save` in the chat only with votekickChat. */
  votekick: VotekickService;
  /** Roue du Sub (fed by the alerts reception; OFF by default). */
  subWheel: SubWheelService;
  /** Spotify V2: song requests (channel points), Studio's jobs; the chat commands only with spotifyChat. */
  spotify: SpotifyService;
  /** Twitch-side channel points actions run by the bot (redemption statuses, Raptoru's reward). */
  cpTwitch: CpTwitchActions;
  /** Single active production bot (lease + the health Studio shows). */
  botInstances: BotInstanceService;
  /**
   * Economy of every paying module of this Core (Bonk, Soundboard, TTS, Tombola, Roue du Sub, Points de chaîne,
   * moderation): the Lab test wallet unless the process passes the canonical Wallet (economy/activation.ts).
   */
  economy: EconomyPort;
  /** Commands V2, Jeu des mots, Roulette / Slot / Duel: the same assembly as the Lab Core (lab-chat/games.ts). */
  chat: ChatGames;
  /** Refonte H10 / H12: the module settings (prices, delays, limits). */
  moduleSettings: ModuleSettings;
  /** The module host (modules/host.ts): the modules of modules/index.ts. */
  modules: ModuleHost;
}

export function createCore(
  db: Db,
  clock: Clock,
  provider: CreditProvider,
  loyaltyModes: LoyaltyModes = SHADOW_MODES,
  twitchViewers: TwitchViewerCatalog | null = null,
  economy: EconomyPort = labEconomy,
  /** The channel this Core serves: its broadcaster (streamer of the chat modules) and the Twitch app (Duel logins). */
  channel: {
    broadcasterId?: string | null;
    /** Random Ban V3: the streamer's login (history, the chat line of his mute). */
    broadcasterLogin?: string | null;
    twitchApp?: { clientId: string; clientSecret: string } | null;
    /** CORE_ENVIRONMENT=lab: the Lab's simulated events pay fictional gains (Roue du Sub, Bonbons, XP of the simulator). */
    lab?: boolean;
    /** Bonk: the channel's PUBLIC 7TV / BTTV / FFZ catalogs (read-only, no token); null = none (default). */
    emoteCatalog?: ThirdPartyEmotes | null;
    /** Duel targets by login without Twitch (tests). */
    loginLookup?: LoginLookup | null;
    /** Lot 9: alerts older than this are recorded, not animated (absent: 30 min, refonte H3). */
    alertsMaxAgeMs?: number | null;
    /** `!caution` answered in the chat (main Core: CAUTION_CHAT=true; SAMMI still answers it until the cutover). */
    cautionChat?: boolean;
    /** `!votekick` / `!kick` / `!save` answered in the chat (main Core: VOTEKICK_CHAT=true). */
    votekickChat?: boolean;
    /** `!song`, `!songqueue`, `!mysong`, `!songcancel`, `!songremove`, `!songskip` (main Core: SPOTIFY_CHAT=true). */
    spotifyChat?: boolean;
  } = {},
): Core {
  const broadcasterOf = () => channel.broadcasterId ?? null;
  const credits = new DailyCredits(db, provider);
  const wallet = createWalletModule(db, clock);
  const loyalty = new LoyaltyEngine(db, clock, wallet.wallet, loyaltyModes);
  const soundLab = new SoundLabService(db, clock, undefined, economy);
  // Refonte H10 / H12: prices, delays and limits set from Studio, read by the executors (module-settings/service.ts).
  const moduleSettings = new ModuleSettings(db, clock);
  const bonkLab = new BonkLabService(
    db,
    clock,
    twitchViewers,
    channel.emoteCatalog ?? null,
    economy,
  );
  bonkLab.settings = moduleSettings;
  // The module host: every module of modules/index.ts, on this Core's economy (Lab-only modules never on canonical).
  const modules = new ModuleHost(MODULES, {
    db,
    clock,
    economy,
    settings: moduleSettings,
  });
  const votekick = new VotekickService(db, clock, broadcasterOf);
  votekick.economy = economy; // refonte H1: votes only during the canonical live
  // Module host (architecture MIGRATIONS.md): Votekick's adapter — H10 delays and range, its supervision.
  modules.add(votekickModule(votekick, { chat: !!channel.votekickChat }));
  votekick.limits = votekickLimits(moduleSettings);
  // Random Ban V3: the streamer as an exceptional target (his mic muted in OBS), never while Votekick mutes him.
  const randomBan = new RandomBanService(db, clock, undefined, {
    streamer: () =>
      channel.broadcasterId
        ? {
            id: channel.broadcasterId,
            login: channel.broadcasterLogin ?? 'raptoru_',
          }
        : null,
    otherMutes: votekick,
  });
  // The broadcaster's caution ends ONE of his OBS mutes: Votekick's or the Random Ban's.
  const caution = new CautionService(db, clock, economy, broadcasterOf, [
    { kind: 'votekick', label: 'Votekick', source: votekick },
    { kind: 'random_ban', label: 'Random Ban', source: randomBan.mutes },
  ]);
  // Module host: Caution's adapter — H10 rates read in the quote's transaction, its supervision.
  modules.add(cautionModule(caution, { chat: !!channel.cautionChat }));
  caution.rates = cautionRates(moduleSettings);
  const ttsLab = new TtsLabService(db, clock, undefined, undefined, economy);
  const cpTwitch = new CpTwitchActions(db, clock);
  const spotify = new SpotifyService(db, clock, cpTwitch);
  spotify.economy = economy; // Music Hub: the extension's requests are paid in Jetons on this Core's economy
  const channelPoints = new ChannelPointsService(
    db,
    clock,
    soundLab,
    randomBan,
    economy,
    spotify,
    cpTwitch,
  );
  // The Tombola may also reward in Bonbons while the event is open (docs/HALLOWEEN.md); every other currency as before.
  const raffleLab = new RaffleLabService(
    db,
    clock,
    undefined,
    broadcasterOf,
    withBonbonsRewards(economy),
  );
  const subWheel = new SubWheelService(db, clock, undefined, economy, {
    labCredits: channel.lab === true,
  });
  const alerts = new AlertsService(
    db,
    clock,
    undefined,
    // Refonte H3: 30 min unless the channel sets its own (ALERTS_MAX_AGE_SECONDS).
    channel.alertsMaxAgeMs ?? ALERT_RULES.defaultMaxAgeMs,
  );
  // Boutique d'événement (docs/HALLOWEEN.md): Bonbons for real Twitch subs / gifts, once per event.
  const eventShop = new EventShopService(db, clock, economy, {
    rewardSimulations: channel.lab === true,
  });
  alerts.attachListener('event_shop', (q, e) => eventShop.onAlert(q, e));
  // `!solde` shows the Bonbons too while the event is open (the channel's own shop).
  wallet.chat.balanceExtra = async (viewerId) => {
    const ch = broadcasterOf();
    return ch ? eventShop.balanceLine(ch, viewerId) : null;
  };
  // Progression native (docs/PROGRESSION.md): XP from validated presence and chat, levels, titles and badges.
  const progression = new ProgressionService(db, clock, broadcasterOf, {
    lab: channel.lab === true,
  });
  // The shop pays with this Core's economy (Jetons) and the event ledger (Bonbons).
  const cosmetics = new CosmeticShopService(db, clock, progression, economy);
  const chat = createChatGames({
    // Refonte H10: !rb and !fxcam prices from the module settings (defaults = today's prices).
    chatPrices: moduleSettings.chatPrices(),
    hostChatModules: modules.chatModules(),
    hostReservedWords: modules.reservedWords(),
    miniGameLimits: miniGameLimits(moduleSettings),
    // « !roue » and the invitations: silent while the wheel is in mode v1 (production today).
    subWheel,
    eventShop,
    db,
    clock,
    economy,
    tts: ttsLab,
    randomBan,
    channelPoints,
    caution: channel.cautionChat ? caution : null,
    votekick: channel.votekickChat ? votekick : null,
    spotify: channel.spotifyChat ? spotify : null,
    raffle: raffleLab,
    broadcasterOf,
    twitch: channel.twitchApp ?? null,
    loginLookup: channel.loginLookup ?? null,
  });
  // Module host: supervision adapters of historical modules (they only READ their module's own state).
  modules.add(randomBanModule(randomBan));
  modules.add(wordGameModule(chat.wordGame));
  modules.add(eventShopModule);
  return {
    credits,
    daily: new DailyService(db, clock, credits),
    streams: new StreamSessions(db, clock),
    // Each validated presence interval feeds the Loyalty Engine (Jetons) and the progression (XP), in its cycle.
    presence: new PresenceService(db, clock, {
      validated: async (q, interval) => {
        await loyalty.presenceListener.validated(q, interval);
        await progression.presenceListener.validated(q, interval);
        // Halloween: Bonbons for watching (only while the event is open and its presence rule is on).
        await eventShop.presenceListener.validated(q, interval);
      },
      committed: () =>
        loyalty.presenceListener.committed?.() ?? Promise.resolve(),
    }),
    progression,
    cosmetics,
    // Challenges pay through the shop's award (an item or Jetons, once per key) and revoke through the progression.
    challenges: new ChallengeService(db, clock, cosmetics, progression),
    wallet,
    loyalty,
    // The Bonk accepts a Twitch emote only from the viewer's own catalog (none: Twitch emotes off).
    bonkLab,
    moduleSettings,
    modules,
    twitchViewers,
    soundLab,
    ttsLab,
    raffleLab,
    studioInstallations: new StudioInstallations(db, clock),
    alerts,
    channelPoints,
    randomBan,
    dock: new DockActivityService(db, clock),
    eventShop,
    caution,
    votekick,
    subWheel,
    spotify,
    cpTwitch,
    botInstances: new BotInstanceService(db, clock),
    economy,
    chat,
  };
}
