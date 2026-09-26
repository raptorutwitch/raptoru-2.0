import { createCore } from './app.js';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import {
  DevFakeCreditProvider,
  type CreditProvider,
  WalletCreditProvider,
} from './daily/credits.js';
import { createPgDb } from './db/db.js';
import { createApp } from './http/server.js';

const config = loadConfig();
const db = createPgDb(config.DATABASE_URL);
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

createApp({
  daily: core.daily,
  streams: core.streams,
  presence: core.presence,
  wallet: core.wallet,
  loyalty: core.loyalty,
  botSecret: config.BOT_SECRET,
  studioSecret: config.STUDIO_SECRET,
}).listen(config.PORT, () => {
  console.log(
    `[core-api] listening on :${config.PORT} (daily credits: ${dailyProvider.name}, loyalty preview ${config.LOYALTY_PREVIEW}, passive credits ${config.LOYALTY_PASSIVE_CREDITS}, event credits ${config.LOYALTY_EVENT_CREDITS})`,
  );
});
