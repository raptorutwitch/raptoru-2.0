import { AlertsService } from './alerts/service.js';
import { RandomBanService } from './random-ban/service.js';
import { SubWheelService } from './sub-wheel/service.js';
import { ChannelPointsService } from './channel-points/service.js';
import { BonkLabService } from './bonk-lab/bonk-lab-service.js';
import type { TwitchViewerCatalog } from './bonk-lab/twitch-viewer.js';
import { RaffleLabService } from './raffle-lab/raffle-lab-service.js';
import { SoundLabService } from './sound-lab/sound-lab-service.js';
import { TtsLabService } from './tts-lab/tts-lab-service.js';
import type { Clock } from './clock.js';
import { DailyCredits, type CreditProvider } from './daily/credits.js';
import { DailyService } from './daily/daily-service.js';
import type { Db } from './db/db.js';
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
  /** Roue du Sub (fed by the alerts reception; OFF by default). */
  subWheel: SubWheelService;
  /**
   * Economy of every paying module of this Core (Bonk, Soundboard, TTS, Tombola, Roue du Sub, Points de chaîne,
   * moderation): the Lab test wallet unless the process passes the canonical Wallet (economy/activation.ts).
   */
  economy: EconomyPort;
  /** Commands V2, Jeu des mots, Roulette / Slot / Duel: the same assembly as the Lab Core (lab-chat/games.ts). */
  chat: ChatGames;
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
    twitchApp?: { clientId: string; clientSecret: string } | null;
    /** Duel targets by login without Twitch (tests). */
    loginLookup?: LoginLookup | null;
  } = {},
): Core {
  const broadcasterOf = () => channel.broadcasterId ?? null;
  const credits = new DailyCredits(db, provider);
  const wallet = createWalletModule(db, clock);
  const loyalty = new LoyaltyEngine(db, clock, wallet.wallet, loyaltyModes);
  const soundLab = new SoundLabService(db, clock, undefined, economy);
  const randomBan = new RandomBanService(db, clock);
  const raffleLab = new RaffleLabService(
    db,
    clock,
    undefined,
    broadcasterOf,
    economy,
  );
  return {
    credits,
    daily: new DailyService(db, clock, credits),
    streams: new StreamSessions(db, clock),
    presence: new PresenceService(db, clock, loyalty.presenceListener),
    wallet,
    loyalty,
    // The Bonk accepts a Twitch emote only from the viewer's own catalog (none: Twitch emotes off).
    bonkLab: new BonkLabService(db, clock, twitchViewers, null, economy),
    twitchViewers,
    soundLab,
    ttsLab: new TtsLabService(db, clock, undefined, undefined, economy),
    raffleLab,
    studioInstallations: new StudioInstallations(db, clock),
    alerts: new AlertsService(db, clock),
    channelPoints: new ChannelPointsService(
      db,
      clock,
      soundLab,
      randomBan,
      economy,
    ),
    randomBan,
    subWheel: new SubWheelService(db, clock, undefined, economy),
    economy,
    chat: createChatGames({
      db,
      clock,
      economy,
      raffle: raffleLab,
      broadcasterOf,
      twitch: channel.twitchApp ?? null,
      loginLookup: channel.loginLookup ?? null,
    }),
  };
}
