import { AlertsService } from './alerts/service.js';
import { BonkLabService } from './bonk-lab/bonk-lab-service.js';
import type { TwitchViewerCatalog } from './bonk-lab/twitch-viewer.js';
import { RaffleLabService } from './raffle-lab/raffle-lab-service.js';
import { SoundLabService } from './sound-lab/sound-lab-service.js';
import { TtsLabService } from './tts-lab/tts-lab-service.js';
import type { Clock } from './clock.js';
import { DailyCredits, type CreditProvider } from './daily/credits.js';
import { DailyService } from './daily/daily-service.js';
import type { Db } from './db/db.js';
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
}

export function createCore(
  db: Db,
  clock: Clock,
  provider: CreditProvider,
  loyaltyModes: LoyaltyModes = SHADOW_MODES,
  twitchViewers: TwitchViewerCatalog | null = null,
): Core {
  const credits = new DailyCredits(db, provider);
  const wallet = createWalletModule(db, clock);
  const loyalty = new LoyaltyEngine(db, clock, wallet.wallet, loyaltyModes);
  return {
    credits,
    daily: new DailyService(db, clock, credits),
    streams: new StreamSessions(db, clock),
    presence: new PresenceService(db, clock, loyalty.presenceListener),
    wallet,
    loyalty,
    // The Bonk accepts a Twitch emote only from the viewer's own catalog (none: Twitch emotes off).
    bonkLab: new BonkLabService(db, clock, twitchViewers),
    twitchViewers,
    soundLab: new SoundLabService(db, clock),
    ttsLab: new TtsLabService(db, clock),
    raffleLab: new RaffleLabService(db, clock),
    studioInstallations: new StudioInstallations(db, clock),
    alerts: new AlertsService(db, clock),
  };
}
