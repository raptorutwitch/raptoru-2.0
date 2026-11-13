import { randomUUID } from 'node:crypto';
import { createCpTwitchActionsExecutor } from '../cp-twitch-actions-executor.js';
import {
  createRandomBanExecutor,
  memoryRbJournal,
} from '../random-ban-executor.js';
import { LAB_CHATTERS, labFakeTwitch } from '../rb-lab-twitch.js';

// LAB ONLY — Random Ban end to end without Twitch (docs/mini-jeux/PLAN_IMPLEMENTATION.md, lot 3b): the REAL executor
// (random-ban-executor.ts: claim, search, buyer weight, target before any timeout, journal, result) against a FAKE
// Twitch — fictional chatters, every one follows, nobody moderator or banned, `ban()` only logs. No second draw: the
// search is the executor's own. Refuses any Core that is not on this machine.
//   LAB_CHAT_CORE_URL=http://127.0.0.1:<port> LAB_CHAT_SECRET=… LAB_CHAT_CHANNEL_ID=… npm run rb:lab-simulator

const url = process.env.LAB_CHAT_CORE_URL ?? '';
const secret = process.env.LAB_CHAT_SECRET ?? '';
const channelId = process.env.LAB_CHAT_CHANNEL_ID ?? '';
if (
  !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url) ||
  !secret ||
  !channelId
) {
  console.error(
    '[rb-lab-simulator] LAB_CHAT_CORE_URL (local only), LAB_CHAT_SECRET and LAB_CHAT_CHANNEL_ID are required.',
  );
  process.exit(1);
}

const core = async (path: string, body: unknown) => {
  const res = await fetch(new URL(path, url), {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, body: (await res.json()) as unknown };
};

const executor = createRandomBanExecutor({
  core,
  channelId,
  broadcasterId: '0',
  executorId: 'lab-simulator',
  login: 'lecroupier_simule',
  // Every right the real executor checks: the fake Twitch grants them all.
  botScopes: [
    'moderator:read:chatters',
    'moderator:read:followers',
    'moderator:manage:banned_users',
  ],
  broadcasterScopes: ['moderation:read', 'channel:read:subscriptions'],
  twitch: labFakeTwitch(),
  journal: memoryRbJournal(),
});
// The Twitch actions of Studio's reward administration (create, pause, refund), on a FAKE Twitch: each one « applied »
// at once and logged — the Lab sees a creation complete without any reward appearing on the real channel.
const cpActions = createCpTwitchActionsExecutor({
  core,
  base: '/v1/lab/channel-points/twitch-actions',
  channelId,
  scopes: ['channel:manage:redemptions'],
  twitch: {
    updateRedemptionStatus: async (reward, redemption, status) =>
      console.log(
        `[rb-lab-simulator] rachat ${redemption} de ${reward} : ${status} SIMULÉ (aucun appel Twitch)`,
      ),
    createCustomReward: async (reward) => {
      const id = `lab-${randomUUID()}`;
      console.log(
        `[rb-lab-simulator] récompense « ${reward.title} » (${reward.cost} points) SIMULÉE : ${id}`,
      );
      return id;
    },
    updateCustomReward: async (reward, patch) =>
      console.log(
        `[rb-lab-simulator] récompense ${reward} modifiée SIMULÉE : ${JSON.stringify(patch)}`,
      ),
  },
  log: (...a) => console.log(...a),
});
void cpActions.run();
process.on('SIGINT', () => {
  cpActions.stop();
  executor.stop();
  process.exit(0);
});
console.log(
  `[rb-lab-simulator] exécuteur simulé prêt sur ${url} (chaîne ${channelId}) — ${LAB_CHATTERS.length} viewers fictifs`,
);
void executor.run();
