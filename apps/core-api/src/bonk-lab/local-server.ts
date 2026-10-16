import { systemClock } from '../clock.js';
import { createPgDb, SERVER_DB_LIMITS } from '../db/db.js';
import { AvatarCache, twitchAppUserLookup } from '../raffle-lab/avatars.js';
import { createLabCore } from './lab-core.js';

// Separate Lab entrypoint: no Wallet/Loyalty process, timers, bot, or public routes.
const url = new URL(process.env.BONK_LAB_DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  // The Lab database, or a dedicated throw-away copy for end-to-end tests (raptoru_bonk_lab_<name>).
  !/^\/raptoru_bonk_lab(_[a-z0-9]{1,32})?$/.test(url.pathname)
)
  throw new Error('dedicated_local_bonk_database_required');
const secret = process.env.BONK_LAB_SECRET ?? '';
if (secret.length < 32) throw new Error('bonk_secret_required');
const db = createPgDb(url.href, SERVER_DB_LIMITS);
const clientId = process.env.BONK_LAB_TWITCH_CLIENT_ID ?? '';
const clientSecret = process.env.BONK_LAB_TWITCH_CLIENT_SECRET ?? '';
const { server, raffle, wordGame } = createLabCore({
  db,
  clock: systemClock,
  secret,
  twitch: clientId && clientSecret ? { clientId, clientSecret } : null,
  channelTwitchId: process.env.BONK_LAB_CHANNEL_TWITCH_ID ?? '',
});
// 4301 by default (Studio runtime); another port only for isolated end-to-end tests.
const port = Number(process.env.BONK_LAB_CORE_PORT ?? 4301);
server.listen(port, '127.0.0.1', () =>
  console.log(`[bonk-lab-core] local port ${port}, isolated database`),
);
// Tombola V2: Core takes its own time-driven transitions (end of the announcement, draw at
// closes_at, reveal, end of the result) even when nobody reads, and refreshes the Twitch profile
// pictures of the participants in the background (initials fallback when absent).
const avatars = new AvatarCache(
  db,
  systemClock,
  clientId && clientSecret
    ? twitchAppUserLookup({ clientId, clientSecret })
    : null,
);
let ticking = false;
const raffleTick = setInterval(() => {
  if (ticking) return;
  ticking = true;
  raffle
    .tick()
    .catch((e) => console.error('[bonk-lab-core] tombola tick failed', e))
    .finally(() => (ticking = false));
}, 250);
// Jeu des mots V1: the 5–15 min cycle of every live channel (one word when due, never a burst).
let wordTicking = false;
const wordGameTick = setInterval(() => {
  if (wordTicking) return;
  wordTicking = true;
  wordGame
    .tick()
    .catch((e) => console.error('[bonk-lab-core] jeu des mots tick failed', e))
    .finally(() => (wordTicking = false));
}, 1000);
const avatarTick = setInterval(() => {
  avatars
    .refresh()
    .catch((e) => console.error('[bonk-lab-core] avatars failed', e));
}, 5000);
const stop = () => {
  clearInterval(raffleTick);
  clearInterval(wordGameTick);
  clearInterval(avatarTick);
  server.close(() => void db.close().then(() => process.exit(0)));
  // Open event streams (Jeu des mots → Studio) would otherwise keep the server from closing.
  server.closeAllConnections();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
