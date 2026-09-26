import { createCore } from './app.js';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { DevFakeCreditProvider } from './daily/credits.js';
import { createPgDb } from './db/db.js';
import { createApp } from './http/server.js';

const config = loadConfig();
const db = createPgDb(config.DATABASE_URL);
const core = createCore(db, systemClock, new DevFakeCreditProvider(), {
  preview: config.LOYALTY_PREVIEW === 'true',
  passiveCredits: config.LOYALTY_PASSIVE_CREDITS === 'true',
  eventCredits: config.LOYALTY_EVENT_CREDITS === 'true',
});

const interrupted = await core.credits.recoverInterrupted();
if (interrupted)
  console.warn(
    `[core-api] ${interrupted} Daily credit(s) marked unknown after restart`,
  );
await core.credits.processPending();
await core.loyalty.processPending();

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
    `[core-api] listening on :${config.PORT} (credit provider: ${config.DAILY_CREDIT_PROVIDER}, loyalty preview ${config.LOYALTY_PREVIEW}, passive credits ${config.LOYALTY_PASSIVE_CREDITS}, event credits ${config.LOYALTY_EVENT_CREDITS})`,
  );
});
