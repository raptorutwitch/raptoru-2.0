import { BonkLabService } from './bonk-lab/bonk-lab-service.js';
import { SoundLabService } from './sound-lab/sound-lab-service.js';
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
}

export function createCore(
  db: Db,
  clock: Clock,
  provider: CreditProvider,
  loyaltyModes: LoyaltyModes = SHADOW_MODES,
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
    bonkLab: new BonkLabService(db, clock),
    soundLab: new SoundLabService(db, clock),
  };
}
