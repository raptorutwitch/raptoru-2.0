import { createCore } from './app.js';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import {
  DevFakeCreditProvider,
  type CreditProvider,
  WalletCreditProvider,
} from './daily/credits.js';
import { createPgDb, SERVER_DB_LIMITS } from './db/db.js';
import { createPublicFrontier } from './ext/public-frontier.js';
import { createApp } from './http/server.js';

const config = loadConfig();
const db = createPgDb(config.DATABASE_URL, SERVER_DB_LIMITS);
// Daily credits: Core Wallet only with the explicit flag; otherwise no Wallet write at all.
const dailyProvider: CreditProvider =
  config.DAILY_WALLET_CREDITS === 'true'
    ? new WalletCreditProvider(db)
    : new DevFakeCreditProvider();
const core = createCore(db, systemClock, dailyProvider, {
  preview: config.LOYALTY_PREVIEW === 'true',
  passiveCredits: config.LOYALTY_PASSIVE_CREDITS === 'true',
  eventCredits: config.LOYALTY_EVENT_CREDITS === 'true',
});

const interrupted = await core.credits.recoverInterrupted();
if (interrupted)
  console.warn(
    `[core-api] ${interrupted} Daily credit(s) interrupted by a restart: ${dailyProvider.idempotent ? 'requeued (idempotent Wallet)' : 'marked unknown'}`,
  );
await core.credits.processPending();
await core.loyalty.processPending();

// Pending credits (Wallet briefly unavailable, crashed Core…) are retried every minute, chained
// so two sweeps of this instance never overlap; several Core instances are safe (row locks and
// idempotent Wallet keys). No Wallet write while the credit flags are off.
const CREDIT_RETRY_MS = 60_000;
const retryCredits = async () => {
  try {
    await core.credits.retryTick();
    await core.loyalty.processPending();
  } catch (error) {
    console.error('[core-api] credit retry failed', (error as Error).message);
  }
  setTimeout(retryCredits, CREDIT_RETRY_MS);
};
setTimeout(retryCredits, CREDIT_RETRY_MS);

// Viewer frontier (/v1/ext/*, Twitch JWT) and Studio cockpit: only when the channel is configured.
// Payment stays simulated (Lab test wallet): nothing here moves real Jetons or Channel Points.
const frontier = createPublicFrontier(core, db, systemClock, config);
frontier?.start();

createApp({
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
  botSecret: config.BOT_SECRET,
  studioSecret: config.STUDIO_SECRET,
  db,
}).listen(config.PORT, () => {
  console.log(
    `[core-api] listening on :${config.PORT} (daily credits: ${dailyProvider.name}, loyalty preview ${config.LOYALTY_PREVIEW}, passive credits ${config.LOYALTY_PASSIVE_CREDITS}, event credits ${config.LOYALTY_EVENT_CREDITS})`,
  );
  console.log(
    `[core-api] channel ${config.TWITCH_CHANNEL_ID ?? 'none'} · viewer frontier /v1/ext ${frontier?.deps.ext ? 'ON' : 'OFF'} · Studio cockpit ${frontier ? 'ON' : 'OFF'} · Twitch names ${config.TWITCH_APP_CLIENT_ID ? 'ON' : 'OFF'} · payment simulated (${config.CORE_ENVIRONMENT})`,
  );
});
