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
import { createMainCore, createMainServer } from './main-server.js';
import { labEnvironmentProblems } from './lab/environment.js';

const config = loadConfig();
const lab = config.CORE_ENVIRONMENT === 'lab';
// A Lab Core (this PC, fictional data) that could reach anything real refuses to start.
const labProblems = labEnvironmentProblems(config);
if (labProblems.length) {
  console.error(`[core-api] Lab refusé : ${labProblems.join(' ; ')}`);
  process.exit(1);
}
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
const core = createMainCore(db, systemClock, config, economy, dailyProvider);

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

const { server, frontier } = createMainServer(core, db, systemClock, config);
frontier?.start();

// Lab: this machine only. Production: the same bind as always (no host = Node's default).
server.listen(
  { port: config.PORT, ...(lab ? { host: '127.0.0.1' } : {}) },
  () => {
    console.log(
      `[core-api] listening on :${config.PORT} (daily credits: ${dailyProvider.name}${dailyProvider.deferred ? ' off — pending, nothing sent' : ''}, loyalty preview ${config.LOYALTY_PREVIEW}, passive credits ${config.LOYALTY_PASSIVE_CREDITS}, event credits ${config.LOYALTY_EVENT_CREDITS})`,
    );
    console.log(
      `[core-api] channel ${config.TWITCH_CHANNEL_ID ?? 'none'} · viewer frontier /v1/ext ${frontier?.deps.ext ? 'ON' : 'OFF'} · Studio cockpit ${frontier ? 'ON' : 'OFF'} · Twitch names ${config.TWITCH_APP_CLIENT_ID ? 'ON' : 'OFF'} · Twitch emotes linking ${core.twitchViewers?.canLink ? 'ON' : 'OFF'} · economy ${economy.mode}${economy.mode === 'lab' ? ' (payment simulated)' : ''} (${config.CORE_ENVIRONMENT})`,
    );
  },
);
