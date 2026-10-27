import { AlertsService } from './alerts/service.js';
import { BotInstanceService } from './bot-instance/service.js';
import { DockActivityService } from './dock/service.js';
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
  /** Dock OBS V1: read-only activity projection and visual replays (docs/OBS_DOCK.md). */
  dock: DockActivityService;
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
    /** Duel targets by login without Twitch (tests). */
    loginLookup?: LoginLookup | null;
    /** Lot 9: alerts older than this are recorded, not animated (null / absent: off). */
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
  const votekick = new VotekickService(db, clock, broadcasterOf);
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
  const ttsLab = new TtsLabService(db, clock, undefined, undefined, economy);
  const cpTwitch = new CpTwitchActions(db, clock);
  const spotify = new SpotifyService(db, clock, cpTwitch);
  const channelPoints = new ChannelPointsService(
    db,
    clock,
    soundLab,
    randomBan,
    economy,
    spotify,
  );
  const raffleLab = new RaffleLabService(
    db,
    clock,
    undefined,
    broadcasterOf,
    economy,
  );
  const subWheel = new SubWheelService(db, clock, undefined, economy);
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
    ttsLab,
    raffleLab,
    studioInstallations: new StudioInstallations(db, clock),
    alerts: new AlertsService(
      db,
      clock,
      undefined,
      channel.alertsMaxAgeMs ?? null,
    ),
    channelPoints,
    randomBan,
    dock: new DockActivityService(db, clock),
    caution,
    votekick,
    subWheel,
    spotify,
    cpTwitch,
    botInstances: new BotInstanceService(db, clock),
    economy,
    chat: createChatGames({
      // « !roue » and the invitations: silent while the wheel is in mode v1 (production today).
      subWheel,
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
    }),
  };
}
