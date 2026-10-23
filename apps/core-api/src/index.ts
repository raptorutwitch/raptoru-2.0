import { createCore } from './app.js';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import {
  DeferredWalletCreditProvider,
  type CreditProvider,
  WalletCreditProvider,
} from './daily/credits.js';
import { createPgDb, SERVER_DB_LIMITS } from './db/db.js';
import {
  CORE_ECONOMY_MODULES,
  EconomyActivationError,
  economyConfigProblems,
  selectEconomy,
} from './economy/activation.js';
import { type EconomyPort, labEconomy } from './economy/economy.js';
import { WalletService } from './wallet/wallet-service.js';
import {
  createPublicFrontier,
  publicTwitchViewers,
} from './ext/public-frontier.js';
import { createApp } from './http/server.js';

const config = loadConfig();
const problems = economyConfigProblems(config);
if (problems.length) {
  console.error(
    `[core-api] configuration économique refusée : ${problems.join(' ; ')}`,
  );
  process.exit(1);
}
const db = createPgDb(config.DATABASE_URL, SERVER_DB_LIMITS);
// The economy of every paying module: the Lab test wallet unless ECONOMY_MODE=canonical, which starts only when the
// activation accepts it (opening imports, currencies, modules proven, nothing of the previous economy to reconcile).
let economy: EconomyPort = labEconomy;
if (config.ECONOMY_MODE === 'canonical') {
  try {
    economy = await selectEconomy({
      mode: 'canonical',
      q: db,
      wallet: new WalletService(db),
      modules: CORE_ECONOMY_MODULES,
    });
  } catch (e) {
    if (!(e instanceof EconomyActivationError)) throw e;
    console.error(
      `[core-api] économie canonique refusée : ${e.reasons.join(' ; ')}`,
    );
    await db.close();
    process.exit(1);
  }
}
// Daily credits: Core Wallet only with the explicit flag; otherwise no Wallet write at all — the credits stay pending
// for the Core Wallet (never « credited » without money, Astra B5) and are paid once when the flag is turned on.
const dailyProvider: CreditProvider =
  config.DAILY_WALLET_CREDITS === 'true'
    ? new WalletCreditProvider(db)
    : new DeferredWalletCreditProvider();
const core = createCore(
  db,
  systemClock,
  dailyProvider,
  {
    preview: config.LOYALTY_PREVIEW === 'true',
    passiveCredits: config.LOYALTY_PASSIVE_CREDITS === 'true',
    eventCredits: config.LOYALTY_EVENT_CREDITS === 'true',
  },
  publicTwitchViewers(db, systemClock, config),
  economy,
  {
    // The streamer of the chat modules (Tombola, Commands V2, games) and the Twitch app (Duel targets by login).
    broadcasterId: config.TWITCH_CHANNEL_ID ?? null,
    twitchApp:
      config.TWITCH_APP_CLIENT_ID && config.TWITCH_APP_CLIENT_SECRET
        ? {
            clientId: config.TWITCH_APP_CLIENT_ID,
            clientSecret: config.TWITCH_APP_CLIENT_SECRET,
          }
        : null,
    cautionChat: config.CAUTION_CHAT === 'true',
    alertsMaxAgeMs: config.ALERTS_MAX_AGE_SECONDS
      ? config.ALERTS_MAX_AGE_SECONDS * 1000
      : null,
  },
);

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
// Payment: the economy chosen above (Lab test wallet by default: nothing here moves real Jetons or Channel Points).
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
  // Twitch alerts V1 (§ 22): served to the paired Studio for the configured channel only.
  alerts: core.alerts,
  // Points de chaîne V1: configuration by the paired Studio, redemptions by the bot (switch OFF by default).
  channelPoints: core.channelPoints,
  // Random Ban V2: the paired Studio (state, tests, animations) and the bot (Twitch executor).
  randomBan: core.randomBan,
  // Caution: the paired Studio (state) and the bot (Twitch executor); `!caution` itself only with CAUTION_CHAT=true.
  caution: core.caution,
  // Roue du Sub: OFF by default; gains recorded, never credited automatically.
  subWheel: core.subWheel,
  // Single active production bot: the lease (bot) and its health for the paired Studio.
  botInstances: core.botInstances,
  botSecret: config.BOT_SECRET,
  studioSecret: config.STUDIO_SECRET,
  db,
}).listen(config.PORT, () => {
  console.log(
    `[core-api] listening on :${config.PORT} (daily credits: ${dailyProvider.name}${dailyProvider.deferred ? ' off — pending, nothing sent' : ''}, loyalty preview ${config.LOYALTY_PREVIEW}, passive credits ${config.LOYALTY_PASSIVE_CREDITS}, event credits ${config.LOYALTY_EVENT_CREDITS})`,
  );
  console.log(
    `[core-api] channel ${config.TWITCH_CHANNEL_ID ?? 'none'} · viewer frontier /v1/ext ${frontier?.deps.ext ? 'ON' : 'OFF'} · Studio cockpit ${frontier ? 'ON' : 'OFF'} · Twitch names ${config.TWITCH_APP_CLIENT_ID ? 'ON' : 'OFF'} · Twitch emotes linking ${core.twitchViewers?.canLink ? 'ON' : 'OFF'} · economy ${economy.mode}${economy.mode === 'lab' ? ' (payment simulated)' : ''} (${config.CORE_ENVIRONMENT})`,
  );
});
